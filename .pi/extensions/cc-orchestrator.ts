/**
 * cc-orchestrator.ts — pi Dispatcher-Extension für den cc-setup Orchestrator-Workflow
 *
 * Der pi-Primäragent hat KEINE Code-Tools (kein read/write/edit/bash).
 * Alle Arbeit wird über genau 6 grobkörnige Tools (ein Tool ≈ ein Pipeline-Schritt)
 * an claude -p Worker delegiert oder als deterministischer Schritt (Gates, Backlog)
 * direkt ausgeführt.
 *
 * Pipeline: PICK → SPEC → GATE₀(Human) → DEV → GATE₁ → REVIEW → DONE → Human-Merge
 *
 * Vorlage: reference/pi-vs-claude-code/extensions/agent-team.ts
 * Reuse:   scripts/cc-dispatch.ts (dispatchWorker — NICHT dupliziert, über bun importiert)
 *          scripts/cc-backlog.sh  (Backlog-Bridge)
 *          scripts/run-gates.sh   (deterministischer Gate-Runner)
 *
 * pi-Invocation (beide Extensions — damage-control + orchestrator):
 *   pi --provider ollama --model gemma4:12b-mlx \
 *      -e .pi/extensions/damage-control.ts \
 *      -e .pi/extensions/cc-orchestrator.ts \
 *      --no-builtin-tools -p "Start orchestrator pipeline"
 *
 * Robustere Alternative (besseres Tool-Calling):
 *   pi --provider ollama --model gemma4-tool \
 *      -e .pi/extensions/damage-control.ts \
 *      -e .pi/extensions/cc-orchestrator.ts \
 *      --no-builtin-tools -p "Start orchestrator pipeline"
 *
 * Safety (Task .08):
 *   - Caps-Enforcement: MAX_DEV_RETRIES, MAX_REVIEW_RETRIES, MAX_COST_USD, MAX_WALL_CLOCK
 *   - Single-Flight Lock: .pi/orchestrator.lock (PID-based, Stale-Lock-Handling)
 *   - Kill-Switch: touch .pi/orchestrator.kill (pipeline aborts cleanly, no Done set)
 *   - damage-control: blocks rm -rf / git reset --hard / git push / .env/.pem/~/.ssh
 *
 * Naht für Task .09: Pause/Resume/ntfy — requestHuman() + .pi/orchestrator-state.json.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { classifyHumanAnswer } from "../../scripts/slack-ask.ts";

// ── Caps-Konstanten ────────────────────────────────────────────────────────────

const CAPS = {
  MAX_DEV_RETRIES: 2,           // Maximale Builder-Retry-Zyklen bei Gate-Fail
  MAX_REVIEW_RETRIES: 1,        // Maximale Builder-Retries bei Reviewer-REJECT
  MAX_COST_USD_PER_TASK: 5.0,   // Kostenlimit pro Task in USD
  MAX_WALL_CLOCK_PER_TASK: 900, // Wanduhrlimit in Sekunden pro Task
  MAX_CAP_OVERRIDES: 2,         // Max. Human-Cap-Overrides pro Task (CCS-036.11):
                                // danach harter Pause statt endloser Override-Anfragen.
};

// ── Caps-Enforcement-State (pro Task-Lauf) ────────────────────────────────────
// Wird in session_start zurueckgesetzt; von dispatch_worker fortgeschrieben.

const capsState = {
  devRetries: 0,
  reviewRetries: 0,
  totalCostUsd: 0,
  taskStartTs: 0,       // Unix-ms bei Task-Start
  overridesConsumed: 0, // Anzahl bereits konsumierter Human-Cap-Overrides (CCS-036.11)
};

// Letzter vollständiger Planner-Output (Plan + AC + Dateien + Risiken). Wird beim
// planner-Dispatch gespeichert und bei GATE0_SPEC VOLLSTÄNDIG an den Menschen geschickt
// (statt nur einer 2-Zeilen-Zusammenfassung) — CCS-036.13.
let lastPlannerOutput = "";

// Aktueller Task (von backlog_next gesetzt) — damit JEDE Meldung Titel+ID trägt.
let currentTask: { id: string; title: string } = { id: "", title: "" };

/** Pipeline-Schritt-Label je request_human-Phase — lesbare Meldungen statt nur "phase=GATE0_SPEC". */
function phaseStep(phase: string): string {
  switch (phase) {
    case "OPEN_QUESTION":      return "STEP 2 · SPEC (offene Frage)";
    case "GATE0_SPEC":         return "STEP 3 · GATE₀ (Spec-Freigabe)";
    case "GATE1_RETRIES":      return "STEP 4 · GATE₁ (Retry-Override)";
    case "REVIEW_RETRIES":     return "STEP 5 · REVIEW (Retry-Override)";
    case "CAP_EXCEEDED":       return "Intervention (Cap)";
    case "CAP_OVERRIDE_LIMIT": return "Intervention (Cap-Limit)";
    default:                    return phase;
  }
}

/** Kurzer Task-Tag mit Titel: `PIT-6 „Titel…"`. Titel aus currentTask, wenn die ID passt. */
function taskTag(id?: string): string {
  const tid = id || currentTask.id || "?";
  const title = (!id || id === currentTask.id) ? currentTask.title : "";
  if (!title) return tid;
  const short = title.length > 60 ? title.slice(0, 57) + "…" : title;
  return `${tid} „${short}"`;
}

/**
 * Kurze Änderungs-/Diff-Übersicht für den Builder ("bei Bearbeiter Diff zeigen"):
 * bevorzugt uncommittete Änderungen vs HEAD, sonst den letzten Commit. Truncated.
 */
function builderChangeSummary(repoRoot: string): string {
  const git = (args: string[]): string => {
    try {
      const r = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf-8", timeout: 10000 });
      return (r.stdout || "").trim();
    } catch { return ""; }
  };
  const trunc = (s: string) => (s.length > 1500 ? s.slice(0, 1500) + "\n… [Diff gekürzt]" : s);

  const workStat = git(["diff", "HEAD", "--stat"]);
  if (workStat) {
    return trunc(`uncommittete Änderungen vs HEAD:\n${workStat}\n\n${git(["diff", "HEAD"])}`);
  }
  const commitStat = git(["show", "HEAD", "--stat", "--format=%h %s"]);
  if (commitStat) {
    return trunc(`letzter Commit:\n${commitStat}\n\n${git(["show", "HEAD", "--format="])}`);
  }
  return "";
}

/**
 * Einmaliger consume-on-use Cap-Override.
 * Wird von requestHuman() gesetzt wenn der Mensch bei CAP_EXCEEDED/GATE1_RETRIES/REVIEW_RETRIES
 * mit "approve"/"continue" antwortet. precheck()/checkCaps() läst genau den nächsten Schritt
 * durch und setzt das Flag dann zurück (consumed).
 */
let capsOverridePending = false;

/**
 * Setzt den Caps-State zurueck. Wird am Anfang von backlog_next.execute() aufgerufen
 * (= einmal pro Task/PICK-Schritt). session_start ruft es initial auf; die eigentliche
 * Per-Task-Semantik liegt in backlog_next, damit bei mehreren Tasks pro Session die
 * Caps nicht task-uebergreifend akkumulieren.
 */
function resetCapsState(): void {
  capsState.devRetries = 0;
  capsState.reviewRetries = 0;
  capsState.totalCostUsd = 0;
  capsState.taskStartTs = Date.now();
  capsState.overridesConsumed = 0;
  capsOverridePending = false;
}

/**
 * Prueft ob ein Cap ueberschritten ist.
 * Gibt null zurueck wenn alles ok, sonst eine Fehlermeldung.
 *
 * Wenn capsOverridePending gesetzt ist (Mensch hat bei cap-Überschreitung "approve" geantwortet),
 * wird der Override für GENAU diesen einen Aufruf konsumiert: Zaehler werden auf Cap-Niveau
 * zurückgesetzt, Flag wird gecleart, Funktion gibt null zurück.
 * Der Override gilt nur einmal — nächster Aufruf prüft normal.
 */
function checkCaps(): string | null {
  if (capsOverridePending) {
    // CCS-036.11: Override-Schleife begrenzen. Ein Override resettet devRetries UND
    // die Wall-Clock — ohne Obergrenze loopt das endlos (jeder Retry tript den Cap
    // erneut, Human approved, reset, …). Ab MAX_CAP_OVERRIDES wird der Override NICHT
    // mehr konsumiert: terminaler Fehler → Caller pausiert hart, statt neu zu fragen.
    if (capsState.overridesConsumed >= CAPS.MAX_CAP_OVERRIDES) {
      capsOverridePending = false; // Flag clearen, aber NICHT konsumieren/resetten
      console.error(`[cc-orchestrator] CAP_OVERRIDE_LIMIT reached (${capsState.overridesConsumed}/${CAPS.MAX_CAP_OVERRIDES}) — refusing further auto-override.`);
      return `CAP_OVERRIDE_LIMIT: max cap overrides (${CAPS.MAX_CAP_OVERRIDES}) reached — pipeline must pause (no further auto-overrides)`;
    }
    // Consume-on-use: Zaehler auf gerade-noch-erlaubt zurücksetzen
    capsState.devRetries = Math.min(capsState.devRetries, CAPS.MAX_DEV_RETRIES);
    capsState.reviewRetries = Math.min(capsState.reviewRetries, CAPS.MAX_REVIEW_RETRIES);
    capsState.taskStartTs = Date.now(); // Wall-clock-Reset
    capsState.overridesConsumed += 1;
    capsOverridePending = false;
    console.error(`[cc-orchestrator] CAP OVERRIDE consumed (${capsState.overridesConsumed}/${CAPS.MAX_CAP_OVERRIDES}) — caps reset for this step only.`);
    return null;
  }
  const elapsedSecs = (Date.now() - capsState.taskStartTs) / 1000;
  if (capsState.devRetries > CAPS.MAX_DEV_RETRIES) {
    return `MAX_DEV_RETRIES (${CAPS.MAX_DEV_RETRIES}) exceeded (current: ${capsState.devRetries})`;
  }
  if (capsState.reviewRetries > CAPS.MAX_REVIEW_RETRIES) {
    return `MAX_REVIEW_RETRIES (${CAPS.MAX_REVIEW_RETRIES}) exceeded (current: ${capsState.reviewRetries})`;
  }
  if (capsState.totalCostUsd > CAPS.MAX_COST_USD_PER_TASK) {
    return `MAX_COST_USD_PER_TASK ($${CAPS.MAX_COST_USD_PER_TASK}) exceeded (accumulated: $${capsState.totalCostUsd.toFixed(4)})`;
  }
  if (capsState.taskStartTs > 0 && elapsedSecs > CAPS.MAX_WALL_CLOCK_PER_TASK) {
    return `MAX_WALL_CLOCK_PER_TASK (${CAPS.MAX_WALL_CLOCK_PER_TASK}s) exceeded (elapsed: ${Math.round(elapsedSecs)}s)`;
  }
  return null;
}

// ── Kill-Switch ────────────────────────────────────────────────────────────────
// Datei-Flag: Wenn .pi/orchestrator.kill existiert, bricht die Pipeline ab.

function isKillSwitchActive(repoRoot: string): boolean {
  return existsSync(join(repoRoot, ".pi", "orchestrator.kill"));
}

/**
 * Gemeinsame Pre-Check-Funktion: Kill-Switch + Caps.
 * Gibt null zurueck wenn ok, sonst einen Error-String.
 */
function precheck(repoRoot: string): string | null {
  if (isKillSwitchActive(repoRoot)) {
    return "KILL_SWITCH: .pi/orchestrator.kill exists — pipeline aborted. Remove the file to resume.";
  }
  return checkCaps();
}

// ── Typen ─────────────────────────────────────────────────────────────────────

interface BacklogNextResult {
  id: string;
  title: string;
}

interface GateResult {
  pass: boolean;
  failed: string[];
  log: string;
}

interface WorkerResult {
  result: string;
  is_error: boolean;
  total_cost_usd: number;
  num_turns: number;
  exitCode: number;
  stderr: string;
  error?: string;
}

// ── CC_SETUP_DIR Aufloesung ────────────────────────────────────────────────────
// Zentrales cc-setup-Verzeichnis: CC_SETUP_DIR env (fuer pio in fremden Repos)
// oder repoRoot (Fallback = bisheriges cc-setup-Verhalten, Backward-Compat).
// HINWEIS: ccSetupDir wird einmalig in session_start gesetzt (nach repoRoot).
// Lock/Kill/State verbleiben immer in repoRoot/.pi/ (gehoeren ins Ziel-Repo).

let ccSetupDir = ""; // wird in session_start gesetzt

// ── cc-backlog.sh Wrapper ────────────────────────────────────────────────────

function runBacklogScript(repoRoot: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const scriptPath = join(ccSetupDir || repoRoot, "scripts", "cc-backlog.sh");

    const proc = spawn("bash", [scriptPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: repoRoot,
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout!.setEncoding("utf-8");
    proc.stdout!.on("data", (chunk: string) => { stdout += chunk; });

    proc.stderr!.setEncoding("utf-8");
    proc.stderr!.on("data", (chunk: string) => { stderr += chunk; });

    proc.on("close", (code: number | null) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1 });
    });

    proc.on("error", (err: Error) => {
      resolve({ stdout: "", stderr: err.message, exitCode: 1 });
    });
  });
}

// ── run-gates.sh Wrapper ─────────────────────────────────────────────────────

function runGatesScript(repoRoot: string): Promise<GateResult> {
  return new Promise((resolve) => {
    const scriptPath = join(ccSetupDir || repoRoot, "scripts", "run-gates.sh");

    const proc = spawn("bash", [scriptPath], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: repoRoot,
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout!.setEncoding("utf-8");
    proc.stdout!.on("data", (chunk: string) => { stdout += chunk; });

    proc.stderr!.setEncoding("utf-8");
    proc.stderr!.on("data", (chunk: string) => { stderr += chunk; });

    proc.on("close", (code: number | null) => {
      const raw = stdout.trim();
      let parsed: GateResult = { pass: false, failed: ["parse-error"], log: "" };
      try {
        parsed = JSON.parse(raw) as GateResult;
      } catch {
        parsed = { pass: false, failed: [`run-gates exit ${code ?? 1}`], log: stderr.slice(0, 500) };
      }
      resolve(parsed);
    });

    proc.on("error", (err: Error) => {
      resolve({ pass: false, failed: [`spawn-error: ${err.message}`], log: "" });
    });
  });
}

// ── cc-dispatch.ts Worker-Spawn (REUSE über bun, kein Duplikat) ─────────────

/**
 * Startet einen claude -p Worker via scripts/cc-dispatch.ts.
 * REUSE: dispatchWorker-Logik lebt in cc-dispatch.ts — wir spawnen bun als
 * Prozess, um keine Duplikation zu haben (pi's jiti-Runtime ≠ Node, daher
 * direktes import() von cc-dispatch.ts nicht garantiert kompatibel).
 *
 * @param onChunk  Optionaler Callback für Live-stderr-Zeilen aus dem Worker.
 *                 Wird pro Zeile aufgerufen — ermöglicht pi-TUI-Streaming via
 *                 dispatch_worker's onUpdate-Callback (Muster: agent-team.ts).
 */
function spawnDispatchWorker(
  repoRoot: string,
  role: string,
  prompt: string,
  model?: string,
  timeoutSecs?: number,
  onChunk?: (line: string) => void,
): Promise<WorkerResult> {
  return new Promise((resolve) => {
    const scriptPath = join(ccSetupDir || repoRoot, "scripts", "cc-dispatch.ts");
    // Übergib Rolle als --role Flag damit cc-dispatch.ts den permissionMode korrekt setzt
    const args = [scriptPath, role, prompt, "--role", role];
    if (model) { args.push("--model", model); }
    if (timeoutSecs) { args.push("--timeout", String(timeoutSecs)); }

    const proc = spawn("bun", args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: repoRoot,
      env: {
        ...process.env,
        CC_ORCHESTRATED: "1", // Hook-Gating: SessionStart/Stop überspringen
      },
    });

    let stdout = "";
    let stderr = "";
    // Zeilenpuffer für onChunk: Zeilen nur komplett weitergeben (nicht mitten in einer Zeile)
    let stderrLineBuf = "";

    proc.stdout!.setEncoding("utf-8");
    proc.stdout!.on("data", (chunk: string) => { stdout += chunk; });

    proc.stderr!.setEncoding("utf-8");
    proc.stderr!.on("data", (chunk: string) => {
      stderr += chunk;
      if (onChunk) {
        // Zeilen aus dem Puffer extrahieren und einzeln weiterleiten
        stderrLineBuf += chunk;
        const lines = stderrLineBuf.split("\n");
        // Letztes Element: unvollständige Zeile → zurück in Puffer
        stderrLineBuf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) { onChunk(line); }
        }
      }
    });

    proc.on("close", (code: number | null) => {
      // Restzeile im Puffer noch weiterleiten (falls Worker ohne \n endet)
      if (onChunk && stderrLineBuf.trim()) {
        onChunk(stderrLineBuf);
      }
      const exitCode = code ?? 1;
      const raw = stdout.trim();
      let parsed: WorkerResult = {
        result: "",
        is_error: true,
        total_cost_usd: 0,
        num_turns: 0,
        exitCode,
        stderr,
        error: "JSON parse error",
      };
      try {
        parsed = JSON.parse(raw) as WorkerResult;
        parsed.exitCode = exitCode;
      } catch (e) {
        parsed = {
          result: raw.slice(0, 500),
          is_error: exitCode !== 0,
          total_cost_usd: 0,
          num_turns: 0,
          exitCode,
          stderr: stderr.slice(0, 500),
          error: `JSON parse: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
      resolve(parsed);
    });

    proc.on("error", (err: Error) => {
      resolve({
        result: "",
        is_error: true,
        total_cost_usd: 0,
        num_turns: 0,
        exitCode: 1,
        stderr: err.message,
        error: `spawn error: ${err.message}`,
      });
    });
  });
}

// ── slack-ask CLI Spawn ────────────────────────────────────────────────────────

interface SlackAskSpawnResult {
  answered: boolean;
  answer: string | null;
  timed_out: boolean;
  ts: string;
  error?: string;
}

/**
 * Spawnt `bun scripts/slack-ask.ts "<question>"` und parst das stdout-JSON.
 * Gleicher Spawn-Stil wie spawnDispatchWorker (async, stdout sammeln, JSON parsen).
 * Timeout: DEFAULT_TIMEOUT_SECS (900s) + 30s Buffer = 930s spawnSync-Äquivalent,
 * aber da wir async spawn nutzen, übergeben wir den Wert nur an das CLI (kein eigener Timer).
 */
function spawnSlackAsk(repoRoot: string, question: string): Promise<SlackAskSpawnResult> {
  return new Promise((resolve) => {
    const scriptPath = join(ccSetupDir || repoRoot, "scripts", "slack-ask.ts");
    const proc = spawn("bun", [scriptPath, question], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: repoRoot,
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout!.setEncoding("utf-8");
    proc.stdout!.on("data", (chunk: string) => { stdout += chunk; });

    proc.stderr!.setEncoding("utf-8");
    proc.stderr!.on("data", (chunk: string) => { stderr += chunk; });

    proc.on("close", (_code: number | null) => {
      const raw = stdout.trim();
      let parsed: SlackAskSpawnResult = {
        answered: false,
        answer: null,
        timed_out: false,
        ts: "",
        error: "JSON parse error",
      };
      try {
        parsed = JSON.parse(raw) as SlackAskSpawnResult;
      } catch {
        parsed = {
          answered: false,
          answer: null,
          timed_out: false,
          ts: "",
          error: `slack-ask spawn/parse error: ${stderr.slice(0, 300) || raw.slice(0, 300) || "no output"}`,
        };
      }
      resolve(parsed);
    });

    proc.on("error", (err: Error) => {
      resolve({
        answered: false,
        answer: null,
        timed_out: false,
        ts: "",
        error: `slack-ask spawn failed: ${err.message}`,
      });
    });
  });
}

// ── Single-Flight Lock ─────────────────────────────────────────────────────────
// Lock-Datei: .pi/orchestrator.lock  enthält die PID des laufenden Orchestrators.
// Verhindert, dass zwei Orchestrator-Instanzen gleichzeitig am selben Repo arbeiten.

function acquireLock(repoRoot: string): { acquired: boolean; message: string } {
  const lockFile = join(repoRoot, ".pi", "orchestrator.lock");
  const myPid = process.pid;

  if (existsSync(lockFile)) {
    let existingPid: number | null = null;
    try {
      existingPid = parseInt(readFileSync(lockFile, "utf-8").trim(), 10);
    } catch {
      // Lesefehler → Stale Lock annehmen
    }

    if (existingPid !== null && !isNaN(existingPid)) {
      // Pruefe ob der Prozess noch lebt
      try {
        process.kill(existingPid, 0); // Wirft, wenn Prozess tot
        // Prozess lebt → Lock gehalten
        return {
          acquired: false,
          message: `SINGLE_FLIGHT_LOCK: Orchestrator already running (PID ${existingPid}). Remove .pi/orchestrator.lock to force-clear. Exiting.`,
        };
      } catch {
        // Prozess tot → Stale Lock; uebernehmen
        console.error(`[cc-orchestrator] Stale lock detected (PID ${existingPid} dead). Overwriting.`);
      }
    }
  }

  try {
    writeFileSync(lockFile, String(myPid), "utf-8");
    return { acquired: true, message: `Lock acquired (PID ${myPid})` };
  } catch (e) {
    return {
      acquired: false,
      message: `Could not write lock file: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function releaseLock(repoRoot: string): void {
  const lockFile = join(repoRoot, ".pi", "orchestrator.lock");
  try {
    if (existsSync(lockFile)) {
      const content = readFileSync(lockFile, "utf-8").trim();
      if (content === String(process.pid)) {
        unlinkSync(lockFile);
      }
      // Falls die PID nicht unsere ist (Race-Condition), nicht loeschen
    }
  } catch {
    // Best-effort; kein fataler Fehler
  }
}

// ── ntfy Notification (best-effort, uv-based) ────────────────────────────────
//
// Auth: Token wird NUR aus process.env.NTFY_TOKEN gelesen — kein Literal, kein
// Fallback, kein Pfad-Hinweis im Quellcode. Ist die Variable nicht gesetzt,
// wird der Versand still übersprungen (best-effort, Pipeline läuft weiter).
//
// Reuse: delegiert an ~/.claude/skills/ntfy/scripts/send-ntfy.py (kanonischer
// Sender, hat Auth intern geregelt) — kein eigener curl-Token-Aufbau nötig.

const NTFY_URL = "https://ntfy.niclasedge.com";
const NTFY_TOPIC = "info";

/**
 * Sendet eine ntfy-Benachrichtigung via uv run send-ntfy.py --stdin (best-effort).
 * Message wird via stdin übergeben (--stdin Flag) — keine Newline-Probleme in spawn-Args.
 * Fehler crashen die Pipeline NICHT — werden nur geloggt.
 * Der Token wird NIE im Code, NIE in Logs ausgegeben.
 * Gibt { sent: boolean, error?: string } zurück.
 *
 * F5-Fix: settled-Guard + clearTimeout verhindert Timer-Leak und Double-Resolve.
 * F6-Fix: kein hardcodierter Username-Fallback; wenn HOME unset oder Skript fehlt → skip.
 */
function sendNtfy(
  title: string,
  message: string,
  priority: "default" | "high" | "max" = "high",
  tags: string = "bell,robot",
): Promise<{ sent: boolean; error?: string }> {
  return new Promise((resolve) => {
    // F6: HOME muss gesetzt sein; kein hardcodierter Fallback-Username.
    const home = process.env.HOME;
    if (!home) {
      console.error("[cc-orchestrator] ntfy skipped: HOME env not set, sender not found");
      resolve({ sent: false, error: "ntfy skipped: HOME env not set" });
      return;
    }
    const scriptPath = `${home}/.claude/skills/ntfy/scripts/send-ntfy.py`;
    if (!existsSync(scriptPath)) {
      console.error(`[cc-orchestrator] ntfy skipped: sender not found at expected path`);
      resolve({ sent: false, error: "ntfy skipped: sender not found" });
      return;
    }

    // F5: settled-Guard verhindert Double-Resolve nach Timeout + close.
    let settled = false;
    const done = (result: { sent: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const args = [
      "run",
      scriptPath,
      title,          // positional: title
      "--stdin",      // message kommt via stdin
      "--topic", NTFY_TOPIC,
      "--tags", tags,
      "--priority", priority,
    ];

    const proc = spawn("uv", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stderr = "";

    proc.stdout!.setEncoding("utf-8");
    // stdout wird nicht geloggt (könnte Confirmation-Details enthalten)

    proc.stderr!.setEncoding("utf-8");
    proc.stderr!.on("data", (chunk: string) => { stderr += chunk; });

    proc.stdin!.end(message, "utf-8");

    proc.on("close", (code: number | null) => {
      if (code === 0) {
        console.error(`[cc-orchestrator] ntfy sent (exit 0): ${title}`);
        done({ sent: true });
      } else {
        // stderr NICHT vollständig loggen — könnte Auth-Details enthalten.
        const safe = stderr.replace(/tk_[A-Za-z0-9]+/g, "<redacted>").slice(0, 200);
        const errMsg = `uv exit=${code} stderr=${safe}`;
        console.error(`[cc-orchestrator] ntfy FAILED (best-effort, pipeline continues): ${errMsg}`);
        done({ sent: false, error: errMsg });
      }
    });

    proc.on("error", (err: Error) => {
      console.error(`[cc-orchestrator] ntfy spawn error (best-effort, pipeline continues): ${err.message}`);
      done({ sent: false, error: `spawn: ${err.message}` });
    });

    // F5: Timer-Referenz gespeichert → clearTimeout in done() verhindert Leak.
    // Timeout: 15s — uv braucht beim ersten Lauf ggf. einen Moment für venv.
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      done({ sent: false, error: "ntfy timeout after 15s" });
    }, 15_000);
  });
}

// ── Resume-Naht: wie gibt der Mensch frei? ────────────────────────────────────
//
// Einfache, YAGNI-konforme Resume-Mechanik:
//   1. Orchestrator pausiert → schreibt .pi/orchestrator-state.json (status: "waiting_for_human")
//   2. Mensch prüft den State + den Spec-Output
//   3. Mensch erstellt .pi/orchestrator-resume (Datei-Flag):
//        touch .pi/orchestrator-resume           → weiter (approved)
//        touch .pi/orchestrator-resume-cancel    → abbrechen
//   4. Beim nächsten pi-Start (oder wenn die Pipeline nach requestHuman
//      weiterlaufen soll): checkResumeState() prüft die Flagge
//
// Kein interaktiver Daemon nötig — YAGNI. Die nächste pi-Invocation
// liest den letzten State und die Resume-Flagge.

/**
 * Prüft ob eine Resume-Freigabe vorliegt.
 * Gibt "approved", "cancelled" oder "waiting" zurück.
 * Räumt die Resume-Flagge auf (einmalig lesen → löschen).
 */
function checkResumeState(repoRoot: string): "approved" | "cancelled" | "waiting" {
  const resumeFile = join(repoRoot, ".pi", "orchestrator-resume");
  const cancelFile = join(repoRoot, ".pi", "orchestrator-resume-cancel");

  if (existsSync(cancelFile)) {
    try { unlinkSync(cancelFile); } catch { /* best-effort */ }
    return "cancelled";
  }

  if (existsSync(resumeFile)) {
    try { unlinkSync(resumeFile); } catch { /* best-effort */ }
    return "approved";
  }

  return "waiting";
}

// ── requestHuman — blockierendes Slack-Warten (CCS-036.02) ──────────────────
//
// Ablauf:
//   1. Frage über Slack senden + blockierend auf Antwort warten (spawnSlackAsk).
//   2. Bei Antwort: klassifizieren (approve/abort/answer) → strukturiertes Ergebnis zurück.
//      - GATE0_SPEC / OPEN_QUESTION: answered → Antworttext zurückgeben, Pipeline läuft weiter.
//        abort → STOP.
//      - CAP_EXCEEDED / GATE1_RETRIES / REVIEW_RETRIES: approve → capsOverridePending=true
//        (einmaliger Override für nächsten Schritt). abort → STOP.
//   3. Bei Timeout/Slack-Fehler (answered:false): FALLBACK — orchestrator-state.json + ntfy +
//      File-Flag-Resume (unveränderter bisheriger Pfad). Rückgabe "PAUSED…".

/**
 * Pausiert die Pipeline hart: schreibt .pi/orchestrator-state.json (file-flag-resumebar),
 * sendet ntfy und gibt den "HUMAN_REQUIRED/PAUSED…"-String zurück.
 *
 * Genutzt von (a) requestHuman als Slack-Timeout/Fehler-Fallback und
 * (b) dem CAP_OVERRIDE_LIMIT-Pfad (CCS-036.11), wo NICHT erneut um einen Override
 * gefragt werden darf. detail = Kontext (Slack-Fallback-Grund bzw. Policy-Hinweis).
 */
async function pausePipeline(repoRoot: string, taskId: string | null, phase: string, reason: string, detail: string): Promise<string> {
  const stateFile = join(repoRoot, ".pi", "orchestrator-state.json");
  const piDir = join(repoRoot, ".pi");
  if (!existsSync(piDir)) {
    mkdirSync(piDir, { recursive: true });
  }

  const state = {
    task_id: taskId,
    phase,
    reason,
    ts: new Date().toISOString(),
    status: "waiting_for_human",
    slack_fallback: detail,
    resume_instructions: [
      "To approve/continue: touch .pi/orchestrator-resume",
      "To cancel:          touch .pi/orchestrator-resume-cancel",
      "Then re-run: pi --provider ollama --model gemma4:12b-mlx -e .pi/extensions/damage-control.ts -e .pi/extensions/cc-orchestrator.ts --no-builtin-tools -p 'Resume pipeline'",
    ],
  };

  let stateWritten = false;
  try {
    writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf-8");
    stateWritten = true;
  } catch (e) {
    console.error(`[cc-orchestrator] Warning: could not write state file: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ntfy — best-effort. Titel: nur ASCII.
  const ntfyTitle = `Orchestrator PAUSED -- ${phase}`;
  const ntfyMessage = [
    `**Task:** ${taskId ?? "unknown"}`,
    `**Phase:** ${phase}`,
    `**Reason:** ${reason}`,
    `**Detail:** ${detail}`,
    "",
    "**Resume:**",
    "```",
    `touch .pi/orchestrator-resume`,
    "```",
    `State file: ${stateWritten ? ".pi/orchestrator-state.json (written)" : "WRITE FAILED"}`,
  ].join("\n");

  await sendNtfy(ntfyTitle, ntfyMessage, "high", "pause_button,robot");

  return `HUMAN_REQUIRED/PAUSED: [${phaseStep(phase)}] task=${taskTag(taskId ?? undefined)} phase=${phase} | ${reason} | detail=${detail} | state=${stateWritten ? "written" : "ERROR"} | resume: touch .pi/orchestrator-resume`;
}

/**
 * Stellt dem Menschen eine Frage via Slack und wartet blockierend auf die Antwort.
 * Gibt einen strukturierten String zurück, der als Tool-Result an pi geht.
 *
 * Fallback (Timeout/Slack-Fehler): pausePipeline() — schreibt .pi/orchestrator-state.json
 * + sendet ntfy + gibt "PAUSED…"-String zurück (identisch zum alten Verhalten).
 */
async function requestHuman(repoRoot: string, taskId: string | null, phase: string, reason: string): Promise<string> {
  // ── Slack-Frage formulieren ────────────────────────────────────────────────
  // Bei GATE0_SPEC den VOLLSTÄNDIGEN Planner-Plan mitschicken (CCS-036.13), damit
  // der Mensch die echte Spec sieht statt einer 2-Zeilen-Zusammenfassung.
  const specBlock = phase === "GATE0_SPEC" && lastPlannerOutput.trim()
    ? ["", "──────── Vollständiger Plan (Spec) ────────", lastPlannerOutput.trim(), "───────────────────────────────────────────"]
    : [];
  const question = [
    `[${phaseStep(phase)}] Task: ${taskTag(taskId ?? undefined)}`,
    `Reason: ${reason}`,
    ...specBlock,
    "",
    phase === "GATE0_SPEC" || phase === "OPEN_QUESTION"
      ? "Reply with your answer or 'ja'/'ok'/'approved' to proceed, 'nein'/'cancel'/'abort' to stop."
      : "Reply 'ja'/'ok'/'approved'/'continue' to override and proceed, or 'nein'/'cancel'/'stop' to abort.",
  ].join("\n");

  console.error(`[cc-orchestrator] requestHuman: sending Slack question for ${phase}...`);

  // Tag mit echtem Pipeline-Schritt + Task-Titel. Steht NACH dem Prefix, damit das
  // Modell weiterhin auf "HUMAN_APPROVED:"/"HUMAN_ANSWERED:"/… (startsWith) prüfen kann.
  const tag = `[${phaseStep(phase)}] task=${taskTag(taskId ?? undefined)} phase=${phase}`;

  const slackResult = await spawnSlackAsk(repoRoot, question);

  // ── Antwort erhalten → klassifizieren ─────────────────────────────────────
  if (slackResult.answered && slackResult.answer) {
    const decision = classifyHumanAnswer(slackResult.answer);
    console.error(`[cc-orchestrator] Slack answer received: "${slackResult.answer}" → decision: ${decision}`);

    const isCapPhase = phase === "CAP_EXCEEDED" || phase === "GATE1_RETRIES" || phase === "REVIEW_RETRIES";

    if (decision === "abort") {
      return `CANCELLED_BY_HUMAN: ${tag} | ${slackResult.answer}`;
    }

    if (isCapPhase) {
      // Cap-Phasen: approve ODER answer (alles außer abort) → einmaliger Override
      capsOverridePending = true;
      console.error(`[cc-orchestrator] CAP OVERRIDE pending — next step will bypass cap check.`);
      return `HUMAN_APPROVED_OVERRIDE: ${tag} | cap-override=pending | ${slackResult.answer}`;
    }

    // GATE0_SPEC / OPEN_QUESTION: approve → HUMAN_APPROVED:, Freitext → HUMAN_ANSWERED:
    if (decision === "approve") {
      return `HUMAN_APPROVED: ${tag} | ${slackResult.answer}`;
    }
    // answer (Freitext): in Plan/Spec einarbeiten; bei GATE0_SPEC erneut GATE0 durchlaufen
    return `HUMAN_ANSWERED: ${tag} | ${slackResult.answer}`;
  }

  // ── Kein Slack-Antwort (Timeout oder Fehler) → FALLBACK ───────────────────
  const fallbackReason = slackResult.timed_out
    ? `Slack timeout after 900s (no reply received)`
    : `Slack unavailable: ${slackResult.error ?? "unknown error"}`;

  console.error(`[cc-orchestrator] requestHuman fallback: ${fallbackReason}`);

  return await pausePipeline(repoRoot, taskId, phase, reason, fallbackReason);
}

// ── Extension ─────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let repoRoot = "";

  // ── Tool: backlog_next ─────────────────────────────────────────────────────
  // Ein Tool ≈ ein Pipeline-Schritt: PICK

  pi.registerTool({
    name: "backlog_next",
    label: "Backlog Next Task",
    description: "Returns the next actionable 'To Do' task from the backlog. Output: { id, title }.",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      // F3: Caps-State pro Task zurücksetzen (hier = Anfang von PICK, nicht session_start).
      // session_start setzt initial; dieser Reset stellt sicher, dass bei mehreren
      // Tasks pro Session devRetries/totalCostUsd nicht über Task-Grenzen akkumulieren.
      resetCapsState();

      const r = await runBacklogScript(repoRoot, ["next"]);

      if (r.exitCode !== 0) {
        return {
          content: [{ type: "text", text: `ERROR: backlog_next failed: ${r.stderr || r.stdout}` }],
          details: { error: r.stderr, exitCode: r.exitCode },
        };
      }

      // Output format: "<ID>\t<title>"
      const parts = r.stdout.split("\t");
      const id = parts[0]?.trim() ?? "";
      const title = parts.slice(1).join("\t").trim();

      const task: BacklogNextResult = { id, title };
      currentTask = { id, title }; // für Titel in allen folgenden Meldungen

      return {
        content: [{ type: "text", text: `STEP 1 · PICK — ${id} „${title}"` }],
        details: task,
      };
    },
  });

  // ── Tool: backlog_set ──────────────────────────────────────────────────────
  // Pipeline-Schritt: Status-Update (PICK: In Progress; DONE; etc.)

  pi.registerTool({
    name: "backlog_set",
    label: "Backlog Set Status",
    description: "Sets the status of a backlog task. Use for: 'In Progress', 'Done', 'To Do'.",
    parameters: Type.Object({
      id: Type.String({ description: "Task ID (e.g. CCS-042)" }),
      status: Type.String({ description: "New status: 'In Progress', 'Done', 'To Do'" }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { id, status } = params as { id: string; status: string };
      const r = await runBacklogScript(repoRoot, ["set", id, status]);

      if (r.exitCode !== 0) {
        return {
          content: [{ type: "text", text: `ERROR: backlog_set failed for ${id}: ${r.stderr || r.stdout}` }],
          details: { id, status, error: r.stderr, exitCode: r.exitCode },
        };
      }

      return {
        content: [{ type: "text", text: `STEP 1 · PICK — ${taskTag(id)} → ${status}` }],
        details: { id, status, exitCode: 0 },
      };
    },
  });

  // ── Tool: dispatch_worker ──────────────────────────────────────────────────
  // Pipeline-Schritte: SPEC (planner), DEV (builder), REVIEW (reviewer)
  // REUSE: spawnDispatchWorker() ruft scripts/cc-dispatch.ts via bun

  pi.registerTool({
    name: "dispatch_worker",
    label: "Dispatch claude Worker",
    description: [
      "Spawns a headless claude -p worker for one of three roles:",
      "  planner  — analyzes task, produces numbered plan + AC (no file changes)",
      "  builder  — implements the approved plan, commits locally (no push)",
      "  reviewer — reviews diff, returns APPROVE or REJECT + findings",
      "Returns: { result, is_error, total_cost_usd, num_turns, exitCode }",
    ].join("\n"),
    parameters: Type.Object({
      role: Type.String({ description: "Worker role: planner | builder | reviewer" }),
      prompt: Type.String({ description: "Task description or context to pass to the worker" }),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const { role, prompt } = params as { role: string; prompt: string };

      // Pre-Check: Kill-Switch + Caps vor jedem Worker-Dispatch
      const precheckErr = precheck(repoRoot);
      if (precheckErr) {
        return {
          content: [{ type: "text", text: `BLOCKED: ${precheckErr}` }],
          details: { role, is_error: true, blocked: precheckErr },
        };
      }

      const validRoles = ["planner", "builder", "reviewer"];
      if (!validRoles.includes(role)) {
        return {
          content: [{ type: "text", text: `ERROR: invalid role "${role}". Must be one of: ${validRoles.join(", ")}` }],
          details: { role, is_error: true },
        };
      }

      if (onUpdate) {
        onUpdate({
          content: [{ type: "text", text: `Dispatching ${role} worker...` }],
          details: { role, status: "dispatching" },
        });
      }

      // Live-stderr-Zeilen per onUpdate ins pi-TUI surfacen (AC#3).
      // Jede Zeile aus cc-dispatch.ts stderr ([assistant]/[result]/[system])
      // wird akkumuliert und als partielles Update an pi weitergereicht.
      // Das finale Tool-Result bleibt das geparste stdout-JSON (Contract unverändert).
      let liveLines: string[] = [];
      const onChunk = onUpdate
        ? (line: string) => {
            liveLines.push(line);
            // Zeige immer nur die letzten 20 Zeilen (kein unbegrenztes Wachstum)
            if (liveLines.length > 20) { liveLines = liveLines.slice(-20); }
            onUpdate({
              content: [{ type: "text", text: liveLines.join("\n") }],
              details: { role, status: "running" },
            });
          }
        : undefined;

      // ── Deterministischer Prompt-Header: Repo-Root + Autonomie ───────────────
      // Modellunabhängig (egal wie der Orchestrator-LLM den Prompt baut): der Worker
      // bekommt IMMER seinen echten Repo-Root und — bei ausführenden Rollen — die
      // klare Headless-Autonomie-Ansage. Das verhindert (a) erfundene Absolut-Pfade
      // wie /home/user/… und (b) den "Ich warte auf Genehmigung"-Loop.
      const execRole = role === "builder" || role === "reviewer";
      const header = [
        `Repo root (your working directory / CWD): ${repoRoot}`,
        `Use paths RELATIVE to this directory. Never invent absolute paths like /home/... or /.`,
        execRole
          ? `You run HEADLESS and autonomous — no human approves tool calls. NEVER ask for permission or confirmation; execute the required tools directly.`
          : ``,
        ``,
        prompt,
      ].filter((l) => l !== "").join("\n");

      // Leite CAPS.MAX_WALL_CLOCK_PER_TASK als Worker-Timeout durch.
      const result = await spawnDispatchWorker(repoRoot, role, header, undefined, CAPS.MAX_WALL_CLOCK_PER_TASK, onChunk);

      // ── Caps-Enforcement: Zaehler deterministisch im Code hochzaehlen ────────
      // Semantik:
      //   devRetries    — jeder builder-Dispatch (inkl. Erst-Build) wird gezaehlt.
      //                   Cap greift ab dem (MAX_DEV_RETRIES+1)ten builder-Aufruf.
      //   reviewRetries — jeder reviewer-Dispatch (inkl. Erst-Review) wird gezaehlt.
      //                   Cap greift ab dem (MAX_REVIEW_RETRIES+1)ten Aufruf.
      // KEIN Modell-seitiges Zaehlen — der Code ist alleinige Quelle.
      if (role === "builder") {
        capsState.devRetries += 1;
      } else if (role === "reviewer") {
        capsState.reviewRetries += 1;
      }
      capsState.totalCostUsd += result.total_cost_usd || 0;

      // Post-Call Cap-Check: Zaehler oder Kostenlimit koennte jetzt ueberschritten sein.
      const postErr = checkCaps();
      if (postErr) {
        // CCS-036.11: Override-Limit erreicht → NICHT erneut um Override bitten
        // (sonst Endlosschleife: approve → reset → Cap → approve …). Hart pausieren.
        if (postErr.startsWith("CAP_OVERRIDE_LIMIT")) {
          const pausedMsg = await pausePipeline(
            repoRoot,
            null,
            "CAP_OVERRIDE_LIMIT",
            `Cap override limit reached after ${role} worker: ${postErr}`,
            `auto-override budget exhausted (${capsState.overridesConsumed}/${CAPS.MAX_CAP_OVERRIDES}) — human must intervene manually`,
          );
          return {
            content: [{ type: "text", text: `PIPELINE PAUSED — no further auto-overrides.\n${pausedMsg}\n\nWorker output was:\n${result.result.slice(0, 2000)}` }],
            details: { role, ...result, cap_exceeded: postErr, paused: true },
          };
        }
        const humanMsg = await requestHuman(
          repoRoot,
          null,
          "CAP_EXCEEDED",
          `Cap exceeded after ${role} worker: ${postErr}`
        );
        return {
          content: [{ type: "text", text: `CAP EXCEEDED — intervention required.\n${humanMsg}\n\nWorker output was:\n${result.result.slice(0, 2000)}` }],
          details: { role, ...result, cap_exceeded: postErr, intervention: true },
        };
      }

      // Vollständigen Planner-Output für GATE0 (Voll-Spec an den Menschen) merken.
      if (role === "planner" && !result.is_error && result.result) {
        lastPlannerOutput = result.result;
      }

      const STEP_BY_ROLE: Record<string, string> = {
        planner: "STEP 2 · SPEC",
        builder: "STEP 4 · DEV",
        reviewer: "STEP 5 · REVIEW",
      };
      const stepLabel = STEP_BY_ROLE[role] ?? `· ${role}`;
      const icon = result.is_error ? "❌" : "✅";
      const status = result.is_error ? "error" : "done";
      const cost = result.total_cost_usd.toFixed(4);
      const accumulated = capsState.totalCostUsd.toFixed(4);

      const summary = `${stepLabel} (${role}) — ${taskTag()}\n${icon} ${status} · turns=${result.num_turns} · cost=$${cost} (Σ $${accumulated})`;
      const truncated = result.result.length > 6000
        ? result.result.slice(0, 6000) + "\n\n... [truncated]"
        : result.result;

      // "bei Bearbeiter Diff zeigen": nach dem Builder die geänderten Dateien anhängen.
      let diffBlock = "";
      if (role === "builder") {
        const diff = builderChangeSummary(repoRoot);
        if (diff) diffBlock = `\n\n── Δ geänderte Dateien ──\n${diff}`;
      }

      return {
        content: [{ type: "text", text: `${summary}\n\n${truncated}${diffBlock}` }],
        details: { role, ...result, caps: { ...capsState } },
      };
    },
  });

  // ── Tool: run_gates ────────────────────────────────────────────────────────
  // Pipeline-Schritt: GATE₁ (deterministisch — kein LLM)

  pi.registerTool({
    name: "run_gates",
    label: "Run Quality Gates",
    description: "Runs deterministic quality gates (tests, lint, build, typecheck). Returns: { pass, failed: [], log }.",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, onUpdate, _ctx) {
      // Pre-Check: Kill-Switch + Caps
      const precheckErr = precheck(repoRoot);
      if (precheckErr) {
        return {
          content: [{ type: "text", text: `BLOCKED: ${precheckErr}` }],
          details: { pass: false, failed: ["precheck-blocked"], log: precheckErr },
        };
      }

      if (onUpdate) {
        onUpdate({
          content: [{ type: "text", text: "Running gates (just test + go-build)..." }],
          details: { status: "running" },
        });
      }

      const result = await runGatesScript(repoRoot);
      // SKIP = pass:true, keine failed-Gates, Log beginnt mit "skipped:" (keine Gates konfiguriert).
      const isSkip = result.pass && (result.failed?.length ?? 0) === 0 && /^skipped:/i.test(result.log || "");
      let statusText: string;
      if (isSkip) {
        statusText = "⏭️  SKIP — keine Gates in diesem Repo konfiguriert (nichts zu prüfen → gilt als bestanden)";
      } else if (result.pass) {
        statusText = "✅ PASS";
      } else {
        statusText = `❌ FAIL (${result.failed.join(", ")})`;
      }

      return {
        content: [{ type: "text", text: `STEP 4 · GATE₁ (run_gates) — ${taskTag()}\n${statusText}\nLog: ${result.log || "(leer)"}` }],
        details: result,
      };
    },
  });

  // ── Tool: request_human ────────────────────────────────────────────────────
  // Pipeline-Schritte: GATE₀ (Spec-Gate), Intervention bei Cap-Überschreitung
  // Naht für Task .09: Pause/Resume/ntfy-Erweiterung

  pi.registerTool({
    name: "request_human",
    label: "Request Human Intervention",
    description: [
      "Asks the human a question via Slack and BLOCKS until they reply (up to 900s).",
      "Use for: Spec approval (GATE₀), cap exceeded, open questions from planner.",
      "Returns one of these canonical prefixes (exact literals):",
      "  HUMAN_APPROVED: <text>         — human approved (non-cap phase: GATE0_SPEC/OPEN_QUESTION); proceed to next step.",
      "  HUMAN_ANSWERED: <text>         — human gave free-text answer (non-cap phase); incorporate into plan, then re-run GATE0 before DEV.",
      "  HUMAN_APPROVED_OVERRIDE: ...   — human approved cap override (CAP_EXCEEDED/GATE1_RETRIES/REVIEW_RETRIES); retry failed step once.",
      "  CANCELLED_BY_HUMAN: ...        — human said abort/cancel/nein; STOP immediately (no Done set).",
      "  HUMAN_REQUIRED/PAUSED: ...     — Slack timeout/unavailable; pipeline paused, use file-flag resume.",
      "IMPORTANT: On CANCELLED or PAUSED, STOP. On APPROVED/ANSWERED/APPROVED_OVERRIDE, continue pipeline.",
      "NOTE: HUMAN_ANSWERED_OVERRIDE does NOT exist — never expect it.",
    ].join("\n"),
    parameters: Type.Object({
      task_id: Type.Optional(Type.String({ description: "Current task ID (if known)" })),
      phase: Type.String({ description: "Current pipeline phase (e.g. GATE0_SPEC, GATE1_RETRIES, REVIEW_REJECT)" }),
      reason: Type.String({ description: "Human-readable reason why intervention is needed" }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { task_id, phase, reason } = params as { task_id?: string; phase: string; reason: string };
      const message = await requestHuman(repoRoot, task_id ?? null, phase, reason);

      return {
        content: [{ type: "text", text: message }],
        details: { task_id, phase, reason, status: "waiting_for_human" },
      };
    },
  });

  // ── Tool: mark_done ────────────────────────────────────────────────────────
  // Pipeline-Schritt: DONE (Backlog-Tracking — KEIN git push)

  pi.registerTool({
    name: "mark_done",
    label: "Mark Task Done",
    description: [
      "Marks a task as Done in the backlog via CLI (no git push).",
      "Optionally checks AC indices and sets a final summary.",
      "IMPORTANT: Only call this after gates PASS and review APPROVE.",
    ].join("\n"),
    parameters: Type.Object({
      id: Type.String({ description: "Task ID to mark as Done" }),
      ac_indices: Type.Optional(Type.Array(Type.Number(), { description: "AC indices to check (1-based)" })),
      final_summary: Type.Optional(Type.String({ description: "PR-style summary of what was implemented" })),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { id, ac_indices, final_summary } = params as {
        id: string;
        ac_indices?: number[];
        final_summary?: string;
      };

      // CRITICAL: mark_done NEVER proceeds if Kill-Switch or any Cap is active.
      // "Status bleibt In Progress, NICHT Done" — AC#2 Enforcement.
      const precheckErr = precheck(repoRoot);
      if (precheckErr) {
        return {
          content: [{ type: "text", text: `mark_done ${id} BLOCKED — caps/kill-switch active. Task stays In Progress, NOT Done.\nReason: ${precheckErr}` }],
          details: { id, done_set: false, blocked: precheckErr, exitCode: 1 },
        };
      }

      // G3 FIX: Gate-Pass ist Pflicht vor Done.
      // Das LLM soll laut System-Prompt run_gates vor mark_done aufrufen, aber nichts
      // erzwingt es im Code. Hier wird sichergestellt, dass die Gates IMMER code-seitig
      // grün sind, bevor Status=Done gesetzt wird — unabhaengig davon, ob run_gates
      // zuvor im Gespraech aufgerufen wurde.
      const gateResult = await runGatesScript(repoRoot);
      if (!gateResult.pass) {
        const failedList = gateResult.failed.join(", ");
        return {
          content: [{
            type: "text",
            text: `mark_done ${id} BLOCKED — gates are RED. Done NOT set. Fix the failing gates first, then retry.\nFailed: ${failedList}\nLog: ${gateResult.log}`,
          }],
          details: { id, done_set: false, gate_pass: false, failed_gates: gateResult.failed, gate_log: gateResult.log, exitCode: 1 },
        };
      }

      const prereqErrors: string[] = [];

      // 1. AC-Indizes setzen (falls angegeben) — Voraussetzung für Done
      if (ac_indices && ac_indices.length > 0) {
        for (const idx of ac_indices) {
          const r = await runBacklogScript(repoRoot, ["check-ac", id, String(idx)]);
          if (r.exitCode !== 0) {
            prereqErrors.push(`check-ac ${idx}: ${r.stderr || r.stdout}`);
          }
        }
      }

      // 2. Final Summary setzen (falls angegeben) — Voraussetzung für Done
      if (final_summary && final_summary.trim()) {
        const r = await runBacklogScript(repoRoot, ["final-summary", id, final_summary]);
        if (r.exitCode !== 0) {
          prereqErrors.push(`final-summary: ${r.stderr || r.stdout}`);
        }
      }

      // Fix F2: Done NUR setzen wenn check-ac + final-summary erfolgreich.
      // Bei Voraussetzungsfehlern: KEIN Done, klarer Fehler ohne widersprüchliches
      // "Done aber exitCode:1".
      if (prereqErrors.length > 0) {
        return {
          content: [{ type: "text", text: `mark_done ${id} — prerequisites failed, Done NOT set:\n${prereqErrors.join("\n")}` }],
          details: { id, errors: prereqErrors, done_set: false, exitCode: 1 },
        };
      }

      // 3. Status → Done (nur nach erfolgreichen Voraussetzungen)
      const doneResult = await runBacklogScript(repoRoot, ["set", id, "Done"]);
      if (doneResult.exitCode !== 0) {
        return {
          content: [{ type: "text", text: `mark_done ${id} — set Done failed: ${doneResult.stderr || doneResult.stdout}` }],
          details: { id, errors: [`set Done: ${doneResult.stderr || doneResult.stdout}`], done_set: false, exitCode: 1 },
        };
      }

      return {
        content: [{ type: "text", text: `STEP 6 · DONE — ${taskTag(id)} ✅ Done (kein git push — Human-Merge nötig).` }],
        details: { id, ac_indices, has_summary: Boolean(final_summary), done_set: true, exitCode: 0 },
      };
    },
  });

  // ── System Prompt Override (before_agent_start) ────────────────────────────

  pi.on("before_agent_start", async (_event, _ctx) => {
    return {
      systemPrompt: `You are the cc-setup Orchestrator — a MECHANICAL SEQUENCER.
You do NOT write code, read files, or make creative decisions.
You execute exactly the pipeline below in order, using ONLY the registered tools.

===========================================================================
CAPS CONFIG (read-only — enforcement in Task .08):
  MAX_DEV_RETRIES      = ${CAPS.MAX_DEV_RETRIES}
  MAX_REVIEW_RETRIES   = ${CAPS.MAX_REVIEW_RETRIES}
  MAX_COST_USD_PER_TASK= ${CAPS.MAX_COST_USD_PER_TASK}
  MAX_WALL_CLOCK_SECS  = ${CAPS.MAX_WALL_CLOCK_PER_TASK}
===========================================================================

PIPELINE (execute in this EXACT order — never skip, never improvise):

STEP 1 — PICK
  Call: backlog_next
  Then: backlog_set(id, "In Progress")
  On error (no tasks): STOP. Report "No actionable tasks found."

STEP 2 — SPEC
  Call: dispatch_worker(role="planner", prompt="<task-id>: <task-title>. Analyze this task and produce: numbered implementation plan, sharpened AC, files to change, risks.")
  CRITICAL — check planner output BEFORE anything else:
  If planner output contains the literal string "OPEN QUESTION":
    Extract the full OPEN QUESTION text (everything after "OPEN QUESTION:").
    Call: request_human(task_id=<id>, phase="OPEN_QUESTION", reason="Planner open question: <extracted question>")
    Read the return value:
      - Starts with "HUMAN_APPROVED:" → human approved; incorporate implicit answer and proceed to STEP 3.
      - Starts with "HUMAN_ANSWERED:" → incorporate the free-text answer into the plan; then proceed to STEP 3 (do NOT go directly to DEV).
      - Starts with "CANCELLED_BY_HUMAN:" → STOP. Report "Cancelled by human."
      - Starts with "HUMAN_REQUIRED/PAUSED:" → STOP. Pipeline paused; resume via file-flag.

STEP 3 — GATE₀ (Spec Gate — Human Approval MANDATORY)
  This step is NON-OPTIONAL. ALWAYS call request_human here, even if the plan looks good.
  Call: request_human(task_id=<id>, phase="GATE0_SPEC", reason="Spec ready for human approval.")
  NOTE: The COMPLETE planner spec (plan + AC + files + risks) is attached to the human message AUTOMATICALLY. Do NOT summarize it into the reason — keep the reason to one short line.
  Read the return value:
    - Starts with "HUMAN_APPROVED:" → human approved; proceed to STEP 4 (DEV).
    - Starts with "HUMAN_ANSWERED:" → human gave a free-text comment; incorporate into plan; call request_human AGAIN for GATE0_SPEC (do NOT proceed to DEV yet).
    - Starts with "CANCELLED_BY_HUMAN:" → STOP. Report "Cancelled by human."
    - Starts with "HUMAN_REQUIRED/PAUSED:" → STOP. Pipeline paused; resume via file-flag.
  This gate exists because: Human-Oversight-Pflicht (Org-Regel) requires human spec approval before code is written.

STEP 4 — DEV (repeat up to MAX_DEV_RETRIES times if gates fail)
  Call: dispatch_worker(role="builder", prompt="<approved-plan>. Implement exactly this plan. Task: <id>.")
  Then: run_gates
  run_gates returns one of: PASS, SKIP (no gates configured in the repo), or FAIL.
  Treat SKIP exactly like PASS (nothing to verify automatically) → proceed to STEP 5. Do NOT retry the builder on SKIP.
  If gates FAIL:
    dev_retries += 1
    If dev_retries > MAX_DEV_RETRIES:
      Call: request_human(task_id=<id>, phase="GATE1_RETRIES", reason="Gates failed after ${CAPS.MAX_DEV_RETRIES} retries: <failed-gates>")
      Read the return value:
        - Starts with "HUMAN_APPROVED_OVERRIDE:" → cap overridden; continue with one more builder retry.
        - Starts with "CANCELLED_BY_HUMAN:" → STOP. Report "Cancelled by human."
        - Starts with "HUMAN_REQUIRED/PAUSED:" → STOP.
    Else:
      Call: dispatch_worker(role="builder", prompt="Gates failed: <gate-log>. Fix only the failing tests/lint. Do not change anything else.")
      Repeat run_gates check.

STEP 5 — REVIEW
  Call: dispatch_worker(role="reviewer", prompt="Review the current diff. Task: <id>. AC: <ac-list>.")
  If reviewer verdict is APPROVE (no BLOCKER / no "REJECT"):
    → Do NOT stop. Do NOT just say "proceed to STEP 6". IMMEDIATELY go to STEP 6 and CALL the mark_done tool in your VERY NEXT action.
  If REJECT in reviewer output:
    review_retries += 1
    If review_retries > MAX_REVIEW_RETRIES:
      Call: request_human(task_id=<id>, phase="REVIEW_RETRIES", reason="Reviewer rejected after ${CAPS.MAX_REVIEW_RETRIES} retries: <findings>")
      Read the return value:
        - Starts with "HUMAN_APPROVED_OVERRIDE:" → cap overridden; continue with one more builder+review cycle.
        - Starts with "CANCELLED_BY_HUMAN:" → STOP. Report "Cancelled by human."
        - Starts with "HUMAN_REQUIRED/PAUSED:" → STOP.
    Else:
      Call: dispatch_worker(role="builder", prompt="Reviewer rejected. Findings:\n<findings>\nFix exactly these issues.")
      Go back to run_gates, then re-dispatch reviewer.

STEP 6 — DONE
  You MUST emit the mark_done TOOL CALL now. Announcing "I proceed to STEP 6" in text is NOT enough and is a failure — the task stays unfinished until mark_done actually runs.
  Call: mark_done(id=<id>, ac_indices=[1,2,...], final_summary="<reviewer summary>")
  Only AFTER the mark_done tool returns, report: "Task <id> complete. Awaiting human push/merge to main."

RESUME PROTOCOL:
  When you see ".pi/orchestrator-resume exists" in your prompt or context:
  - The human has approved via file-flag (Slack was unavailable). Continue from the NEXT step after the last paused phase.
  - Read .pi/orchestrator-state.json to find: task_id, phase, reason.
  - If phase is "GATE0_SPEC" or "OPEN_QUESTION": proceed to STEP 4 (DEV) with the previously planned spec.
  - If phase is "GATE1_RETRIES" or "REVIEW_RETRIES": treat as override approved; resume builder/review cycle.
  - If .pi/orchestrator-resume-cancel exists: STOP, report "Cancelled by human."

RULES (non-negotiable):
- Call tools in STEP ORDER only. Never skip a step.
- GATE₀ (STEP 3) is MANDATORY — never skip it, never go from SPEC directly to DEV.
- OPEN QUESTION in planner output → request_human immediately, then act on the return value.
- request_human NOW RETURNS the human's answer. Read the prefix to decide:
  HUMAN_APPROVED: → proceed to next step (non-cap approval).
  HUMAN_ANSWERED: → incorporate free-text; re-run GATE0 before DEV (never skip re-gate).
  HUMAN_APPROVED_OVERRIDE: → cap override granted; retry failed step once.
  CANCELLED_BY_HUMAN: → STOP immediately (no Done set).
  HUMAN_REQUIRED/PAUSED: → STOP; pipeline paused; resume via file-flag.
  NOTE: HUMAN_ANSWERED_OVERRIDE does NOT exist — never expect it.
- intervention (Cap exceeded, retries exhausted) → request_human → act on return value. Never set Done without human approval.
- You have NO code tools (no read, write, edit, bash). Never attempt to use them.
- Never mark Done if gates FAIL or reviewer REJECTED.
- Never git push. Push and merge are HUMAN actions only.
- If uncertain about anything: call request_human, not improvise.
- Dev ≠ Review: builder and reviewer are always separate worker dispatches (different sessions — Org-Compliance).
- intervention (Cap exceeded, retries exhausted) → request_human → act on return value. Never set Done without approval.
`,
    };
  });

  // ── Session Start ──────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    // F4: harter Fehler bei leerem ctx.cwd — import.meta.url-Fallback ist in pi's
    // jiti-Runtime unzuverlaessig und wuerde Lock/Kill/State an falschem Pfad ablegen.
    if (!ctx.cwd) {
      console.error("[cc-orchestrator] FATAL: ctx.cwd is empty — cannot determine repo root. Exiting.");
      process.exit(1);
    }
    repoRoot = ctx.cwd;

    // Portabilitaet: CC_SETUP_DIR zeigt auf die cc-setup-Installation (Maschinerie).
    // Ohne Env-Variable: Fallback auf repoRoot (= bisheriges cc-setup-Verhalten).
    // Lock/Kill/State bleiben immer in repoRoot/.pi/ (gehoeren ins Ziel-Repo).
    ccSetupDir = process.env["CC_SETUP_DIR"] || repoRoot;

    // Sicherstellen dass .pi/ existiert
    const piDir = join(repoRoot, ".pi");
    if (!existsSync(piDir)) {
      mkdirSync(piDir, { recursive: true });
    }

    // ── Kill-Switch Pre-Placement pruefen ─────────────────────────────────────
    // Konvention: .pi/orchestrator.kill anlegen = Start verhindern.
    //             Datei entfernen = naechster Start laeuft durch.
    // Wenn die Datei VOR dem Start existiert, ist das ein bewusster Operator-Stop —
    // NICHT loeschen, NICHT starten. Lock noch nicht gehalten → kein releaseLock noetig.
    const killFile = join(repoRoot, ".pi", "orchestrator.kill");
    if (existsSync(killFile)) {
      const msg = `[cc-orchestrator] KILL_SWITCH: .pi/orchestrator.kill exists — start aborted by operator. Remove the file to allow startup.`;
      console.error(msg);
      ctx.ui.notify(msg);
      process.exit(1);
    }

    // ── Single-Flight Lock ─────────────────────────────────────────────────
    const lockResult = acquireLock(repoRoot);
    if (!lockResult.acquired) {
      // Klare Meldung, kein Doppel-Worker starten
      ctx.ui.notify(`SINGLE_FLIGHT_LOCK: ${lockResult.message}`);
      console.error(`[cc-orchestrator] ${lockResult.message}`);
      // Prozess sauber beenden — kein Tool wird registriert
      process.exit(1);
    }

    // Caps-State zuruecksetzen
    resetCapsState();

    // ── SIGINT / Kill-Switch SIGTERM Handler ───────────────────────────────
    // Sauberer Abbruch: Lock freigeben, keine Done-Markierung.
    const _onSignal = () => {
      console.error("\n[cc-orchestrator] Signal received — releasing lock, pipeline aborted (no Done set).");
      releaseLock(repoRoot);
      process.exit(130);
    };
    process.once("SIGINT", _onSignal);
    process.once("SIGTERM", _onSignal);

    // Lock beim normalen Prozessende freigeben
    process.once("exit", () => { releaseLock(repoRoot); });

    // ── Tool-Lock: NUR die 6 Orchestrator-Tools — keine Code-Tools für pi ──
    pi.setActiveTools([
      "backlog_next",
      "backlog_set",
      "dispatch_worker",
      "run_gates",
      "request_human",
      "mark_done",
    ]);

    ctx.ui.setStatus("cc-orchestrator", "ready");

    // ── Resume-State prüfen beim Start ────────────────────────────────────────
    // F2: "cancelled" bricht die Pipeline tatsächlich ab (releaseLock + exit).
    // "approved" und "waiting" laufen durch — der Dispatcher bekommt die Notice.
    const existingStateFile = join(repoRoot, ".pi", "orchestrator-state.json");
    let resumeNotice = "";
    if (existsSync(existingStateFile)) {
      const resumeStatus = checkResumeState(repoRoot);
      if (resumeStatus === "cancelled") {
        // F2: Cancel enforced — Lock freigeben, dann sauber beenden.
        const cancelMsg = "[cc-orchestrator] RESUME-CANCEL: .pi/orchestrator-resume-cancel was set — pipeline cancelled by human. Exiting cleanly.";
        console.error(cancelMsg);
        ctx.ui.notify(cancelMsg);
        releaseLock(repoRoot);
        process.exit(0);
      } else if (resumeStatus === "approved") {
        resumeNotice = "\nRESUME: .pi/orchestrator-resume flag found — human approved. Pipeline will continue from last paused phase.";
      } else {
        resumeNotice = "\nWARNING: .pi/orchestrator-state.json exists with status=waiting_for_human. Create .pi/orchestrator-resume to approve or .pi/orchestrator-resume-cancel to cancel.";
      }
    }

    ctx.ui.notify(
      [
        "cc-setup Orchestrator ready",
        `Repo: ${repoRoot}`,
        `Lock: PID ${process.pid} (.pi/orchestrator.lock)`,
        resumeNotice,
        "",
        "Active tools (ONLY these 6 — no code tools):",
        "  backlog_next   — PICK next To Do task",
        "  backlog_set    — set task status",
        "  dispatch_worker — spawn planner/builder/reviewer worker",
        "  run_gates      — deterministic quality gates",
        "  request_human  — request human intervention (GATE₀, caps, OPEN QUESTIONs)",
        "  mark_done      — mark task Done in backlog (no git push)",
        "",
        "Human-Gate / Resume:",
        "  After PAUSED: touch .pi/orchestrator-resume         → approve/continue",
        "                touch .pi/orchestrator-resume-cancel  → cancel pipeline",
        "  ntfy: https://ntfy.niclasedge.com/info (push notification sent on pause)",
        "",
        "Safety (Task .08):",
        `  MAX_DEV_RETRIES      = ${CAPS.MAX_DEV_RETRIES}`,
        `  MAX_REVIEW_RETRIES   = ${CAPS.MAX_REVIEW_RETRIES}`,
        `  MAX_COST_USD_PER_TASK= $${CAPS.MAX_COST_USD_PER_TASK}`,
        `  MAX_WALL_CLOCK_SECS  = ${CAPS.MAX_WALL_CLOCK_PER_TASK}`,
        "  Kill-Switch: touch .pi/orchestrator.kill (aborts pipeline cleanly)",
        "",
        "pi-Invocation (beide Extensions — damage-control + orchestrator):",
        "  pi --provider ollama --model gemma4:12b-mlx \\",
        "     -e .pi/extensions/damage-control.ts \\",
        "     -e .pi/extensions/cc-orchestrator.ts \\",
        "     --no-builtin-tools -p 'Start orchestrator pipeline'",
        "",
        "Robuster (besseres Tool-Calling):",
        "  pi --provider ollama --model gemma4-tool \\",
        "     -e .pi/extensions/damage-control.ts \\",
        "     -e .pi/extensions/cc-orchestrator.ts \\",
        "     --no-builtin-tools -p 'Start orchestrator pipeline'",
      ].join("\n"),
      "info",
    );

    // Footer: repo + model info
    ctx.ui.setFooter((_tui, theme, _footerData) => ({
      dispose: () => {},
      invalidate() {},
      render(width: number): string[] {
        const model = ctx.model?.id || "no-model";
        const usage = ctx.getContextUsage();
        const pct = (usage && usage.percent !== null) ? usage.percent : 0;
        const filled = Math.round(pct / 10);
        const bar = "#".repeat(filled) + "-".repeat(10 - filled);

        const left = theme.fg("dim", ` cc-orchestrator`) +
          theme.fg("muted", " · ") +
          theme.fg("accent", model);
        const right = theme.fg("dim", `[${bar}] ${Math.round(pct)}% `);

        // Compute visible widths manually (no imported helper — YAGNI)
        const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
        const leftLen = stripAnsi(left).length;
        const rightLen = stripAnsi(right).length;
        const pad = " ".repeat(Math.max(1, width - leftLen - rightLen));

        return [(left + pad + right).slice(0, width)];
      },
    }));
  });
}
