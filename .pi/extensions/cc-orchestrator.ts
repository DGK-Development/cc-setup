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
 * pi-Invocation (Dispatcher mit Ollama):
 *   pi --provider ollama --model gemma4:12b-mlx \
 *      -e .pi/extensions/cc-orchestrator.ts \
 *      --no-builtin-tools -p "Start orchestrator pipeline"
 *
 * Robustere Alternative (besseres Tool-Calling):
 *   pi --provider ollama --model gemma4-tool \
 *      -e .pi/extensions/cc-orchestrator.ts \
 *      --no-builtin-tools -p "Start orchestrator pipeline"
 *
 * Notiz: Caps-Enforcement, single-flight Lock und Kill-Switch sind Naht für Task .08.
 *        Pause/Resume/ntfy-Mechanik ist Naht für Task .09.
 *        requestHuman() + .pi/orchestrator-state.json sind die Verbindungspunkte.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

// ── Caps-Konstanten (Task .08 verdrahtet Enforcement/single-flight/Kill-Switch) ──

const CAPS = {
  MAX_DEV_RETRIES: 2,           // Maximale Builder-Retry-Zyklen bei Gate-Fail
  MAX_REVIEW_RETRIES: 1,        // Maximale Builder-Retries bei Reviewer-REJECT
  MAX_COST_USD_PER_TASK: 5.0,   // Kostenlimit pro Task (Enforcement: Task .08)
  MAX_WALL_CLOCK_PER_TASK: 900, // Wanduhrlimit in Sekunden pro Task (Enforcement: Task .08)
};

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

// ── Repo-Root ermitteln ──────────────────────────────────────────────────────

function getRepoRoot(): string {
  // import.meta.url ist .pi/extensions/cc-orchestrator.ts
  // → zwei Ebenen hoch = Repo-Root
  return resolve(new URL("../..", import.meta.url).pathname);
}

// ── cc-backlog.sh Wrapper ────────────────────────────────────────────────────

function runBacklogScript(repoRoot: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const scriptPath = join(repoRoot, "scripts", "cc-backlog.sh");

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
    const scriptPath = join(repoRoot, "scripts", "run-gates.sh");

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
 */
function spawnDispatchWorker(
  repoRoot: string,
  role: string,
  prompt: string,
  model?: string,
  timeoutSecs?: number,
): Promise<WorkerResult> {
  return new Promise((resolve) => {
    const scriptPath = join(repoRoot, "scripts", "cc-dispatch.ts");
    const args = [scriptPath, role, prompt];
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

    proc.stdout!.setEncoding("utf-8");
    proc.stdout!.on("data", (chunk: string) => { stdout += chunk; });

    proc.stderr!.setEncoding("utf-8");
    proc.stderr!.on("data", (chunk: string) => { stderr += chunk; });

    proc.on("close", (code: number | null) => {
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

// ── requestHuman — Naht für Task .09 (Pause/Resume/ntfy) ────────────────────

/**
 * Persistiert den Orchestrator-Zustand und gibt HUMAN_REQUIRED zurück.
 * Task .09 erweitert diese Funktion um ntfy-Benachrichtigung und Resume-Logik.
 * Die State-Datei (.pi/orchestrator-state.json) ist der Verbindungspunkt.
 */
function requestHuman(repoRoot: string, taskId: string | null, phase: string, reason: string): string {
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
    status: "waiting_for_human", // Task .09 setzt → "resumed" oder "cancelled"
  };

  try {
    writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf-8");
  } catch (e) {
    // State-Write-Fehler ist nicht fatal — Hauptsache die Rückgabe ist klar
    console.error(`[cc-orchestrator] Warning: could not write state file: ${e instanceof Error ? e.message : String(e)}`);
  }

  return `HUMAN_REQUIRED: ${reason} | task=${taskId ?? "unknown"} phase=${phase} | state written to .pi/orchestrator-state.json`;
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

      return {
        content: [{ type: "text", text: `Next task: ${id} — ${title}` }],
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
        content: [{ type: "text", text: `Task ${id} status set to: ${status}` }],
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

      const result = await spawnDispatchWorker(repoRoot, role, prompt);
      const status = result.is_error ? "error" : "done";
      const cost = result.total_cost_usd.toFixed(4);

      const summary = `[${role}] ${status} | turns=${result.num_turns} cost=$${cost}`;
      const truncated = result.result.length > 6000
        ? result.result.slice(0, 6000) + "\n\n... [truncated]"
        : result.result;

      return {
        content: [{ type: "text", text: `${summary}\n\n${truncated}` }],
        details: { role, ...result },
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
      if (onUpdate) {
        onUpdate({
          content: [{ type: "text", text: "Running gates (just test + go-build)..." }],
          details: { status: "running" },
        });
      }

      const result = await runGatesScript(repoRoot);
      const statusText = result.pass ? "PASS" : `FAIL (${result.failed.join(", ")})`;

      return {
        content: [{ type: "text", text: `Gates: ${statusText}\nLog: ${result.log}` }],
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
      "Signals that human intervention is required. Writes state to .pi/orchestrator-state.json.",
      "Use for: Spec approval (GATE₀), cap exceeded, open questions from planner.",
      "Returns: HUMAN_REQUIRED: <reason> | task=<id> phase=<phase>",
      "IMPORTANT: After calling this tool, STOP and wait. Do not proceed to next pipeline step.",
    ].join("\n"),
    parameters: Type.Object({
      task_id: Type.Optional(Type.String({ description: "Current task ID (if known)" })),
      phase: Type.String({ description: "Current pipeline phase (e.g. GATE0_SPEC, GATE1_RETRIES, REVIEW_REJECT)" }),
      reason: Type.String({ description: "Human-readable reason why intervention is needed" }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { task_id, phase, reason } = params as { task_id?: string; phase: string; reason: string };
      const message = requestHuman(repoRoot, task_id ?? null, phase, reason);

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

      const errors: string[] = [];

      // 1. AC-Indizes setzen (falls angegeben)
      if (ac_indices && ac_indices.length > 0) {
        for (const idx of ac_indices) {
          const r = await runBacklogScript(repoRoot, ["check-ac", id, String(idx)]);
          if (r.exitCode !== 0) {
            errors.push(`check-ac ${idx}: ${r.stderr || r.stdout}`);
          }
        }
      }

      // 2. Final Summary setzen (falls angegeben)
      if (final_summary && final_summary.trim()) {
        const r = await runBacklogScript(repoRoot, ["final-summary", id, final_summary]);
        if (r.exitCode !== 0) {
          errors.push(`final-summary: ${r.stderr || r.stdout}`);
        }
      }

      // 3. Status → Done
      const r = await runBacklogScript(repoRoot, ["set", id, "Done"]);
      if (r.exitCode !== 0) {
        errors.push(`set Done: ${r.stderr || r.stdout}`);
      }

      if (errors.length > 0) {
        return {
          content: [{ type: "text", text: `mark_done ${id} — partial errors:\n${errors.join("\n")}` }],
          details: { id, errors, exitCode: 1 },
        };
      }

      return {
        content: [{ type: "text", text: `Task ${id} marked as Done. No git push performed (human merge required).` }],
        details: { id, ac_indices, has_summary: Boolean(final_summary), exitCode: 0 },
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
  If planner output contains "OPEN QUESTION:":
    Call: request_human(task_id=<id>, phase="GATE0_SPEC", reason="Planner has open question: <question>")
    STOP and wait. Do not proceed until human resolves.

STEP 3 — GATE₀ (Spec Gate — Human Approval)
  Call: request_human(task_id=<id>, phase="GATE0_SPEC", reason="Spec ready for human approval. Plan: <summary>")
  STOP. Do not proceed to DEV until human explicitly says "approved" or "go".

STEP 4 — DEV (repeat up to MAX_DEV_RETRIES times if gates fail)
  Call: dispatch_worker(role="builder", prompt="<approved-plan>. Implement exactly this plan. Task: <id>.")
  Then: run_gates
  If gates FAIL:
    dev_retries += 1
    If dev_retries > MAX_DEV_RETRIES:
      Call: request_human(task_id=<id>, phase="GATE1_RETRIES", reason="Gates failed after ${CAPS.MAX_DEV_RETRIES} retries: <failed-gates>")
      STOP.
    Else:
      Call: dispatch_worker(role="builder", prompt="Gates failed: <gate-log>. Fix only the failing tests/lint. Do not change anything else.")
      Repeat run_gates check.

STEP 5 — REVIEW
  Call: dispatch_worker(role="reviewer", prompt="Review the current diff. Task: <id>. AC: <ac-list>.")
  If REJECT in reviewer output:
    review_retries += 1
    If review_retries > MAX_REVIEW_RETRIES:
      Call: request_human(task_id=<id>, phase="REVIEW_RETRIES", reason="Reviewer rejected after ${CAPS.MAX_REVIEW_RETRIES} retries: <findings>")
      STOP.
    Else:
      Call: dispatch_worker(role="builder", prompt="Reviewer rejected. Findings:\n<findings>\nFix exactly these issues.")
      Go back to run_gates, then re-dispatch reviewer.

STEP 6 — DONE
  Call: mark_done(id=<id>, ac_indices=[1,2,...], final_summary="<reviewer summary>")
  Report: "Task <id> complete. Awaiting human push/merge to main."

RULES (non-negotiable):
- Call tools in STEP ORDER only. Never skip a step.
- You have NO code tools (no read, write, edit, bash). Never attempt to use them.
- Never mark Done if gates FAIL or reviewer REJECTED.
- Never git push. Push and merge are HUMAN actions only.
- If uncertain about anything: call request_human, not improvise.
- Dev ≠ Review: builder and reviewer are always separate worker dispatches (different sessions — Org-Compliance).
`,
    };
  });

  // ── Session Start ──────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    repoRoot = ctx.cwd || resolve(new URL("../..", import.meta.url).pathname);

    // Sicherstellen dass .pi/ existiert
    const piDir = join(repoRoot, ".pi");
    if (!existsSync(piDir)) {
      mkdirSync(piDir, { recursive: true });
    }

    // Tool-Lock: NUR die 6 Orchestrator-Tools — keine Code-Tools für pi
    pi.setActiveTools([
      "backlog_next",
      "backlog_set",
      "dispatch_worker",
      "run_gates",
      "request_human",
      "mark_done",
    ]);

    ctx.ui.setStatus("cc-orchestrator", "ready");

    ctx.ui.notify(
      [
        "cc-setup Orchestrator ready",
        `Repo: ${repoRoot}`,
        "",
        "Active tools (ONLY these 6 — no code tools):",
        "  backlog_next   — PICK next To Do task",
        "  backlog_set    — set task status",
        "  dispatch_worker — spawn planner/builder/reviewer worker",
        "  run_gates      — deterministic quality gates",
        "  request_human  — request human intervention (GATE₀, caps, OPEN QUESTIONs)",
        "  mark_done      — mark task Done in backlog (no git push)",
        "",
        "pi-Invocation (default model):",
        "  pi --provider ollama --model gemma4:12b-mlx \\",
        "     -e .pi/extensions/cc-orchestrator.ts \\",
        "     --no-builtin-tools -p 'Start orchestrator pipeline'",
        "",
        "Robuster (besseres Tool-Calling):",
        "  pi --provider ollama --model gemma4-tool \\",
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
