/**
 * cc-dispatch.ts — claude -p Spawn-Helper für den pi-Orchestrator-Workflow
 *
 * Exportiert dispatchWorker(roleNameOrDef, prompt, opts) das:
 * - aus .pi/agents/<role>.md (Frontmatter: tools + Body: systemPrompt) ODER
 *   aus direkt übergebenen opts.tools / opts.systemPrompt die claude-Flags baut
 * - claude -p headless spawnt (stdout/stderr getrennt)
 * - Timeout via SIGTERM sauber abbricht
 * - JSON-Output parst → {result, is_error, total_cost_usd, num_turns, exitCode}
 *
 * CLI: bun scripts/cc-dispatch.ts <role-or-tools> <prompt>
 *
 * Flag-Mapping (aus spec-pi-orchestrator-workflow.md § "claude -p Flag-Mapping"):
 *   -p / --print               → headless, einmalig
 *   --output-format json       → maschinenlesbares Ergebnis
 *   --model <id>               → Modell pro Worker (default: claude-haiku-4-5-20251001)
 *   --allowedTools "<list>"    → Tool-Whitelist pro Rolle (space-getrennt)
 *   --append-system-prompt     → Rollen-Persona (Body aus .md)
 *   --permission-mode auto     → Headless ohne User-Prompt (keine interaktive Abfrage)
 *   CC_ORCHESTRATED=1 (env)    → Hook-Gating der cc-setup SessionStart/Stop-Hooks
 *
 * Nicht verwendet: --settings mit leerem hooks → würde redactor abschalten (Org-Verstoß)
 */

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Typen ────────────────────────────────────────────────────────────────────

export interface WorkerResult {
  result: string;
  is_error: boolean;
  total_cost_usd: number;
  num_turns: number;
  exitCode: number;
  stderr: string;
  error?: string;
}

export interface DispatchOpts {
  /** Claude-Modell-ID (default: claude-haiku-4-5-20251001 — günstig für Smoke) */
  model?: string;
  /** Space-getrennte Tool-Namen, überschreibt Frontmatter tools falls angegeben */
  tools?: string;
  /** System-Prompt-Body, überschreibt .md-Body falls angegeben */
  systemPrompt?: string;
  /** Timeout in Sekunden (default: 120) */
  timeoutSecs?: number;
  /** Arbeitsverzeichnis für den Worker */
  cwd?: string;
  /** Falls true: baue argv, spawne NICHT (für dry-run / Tests) */
  dryRun?: boolean;
}

interface RoleDef {
  tools: string;      // space-getrennte Tool-Namen für --allowedTools
  systemPrompt: string;
}

// ── Rolle aus .pi/agents/<name>.md parsen ────────────────────────────────────

/**
 * Liest .pi/agents/<role>.md relativ zu diesem Repo-Root und parst:
 *   - Frontmatter-Feld "tools:" → comma→space normalisiert
 *   - Body nach dem zweiten "---" → systemPrompt
 *
 * Falls die Datei nicht existiert, gibt null zurück (Caller muss opts.tools liefern).
 */
function loadRoleDef(roleOrPath: string): RoleDef | null {
  // Absoluter Pfad oder relativ zu cwd
  let filePath = roleOrPath;
  if (!roleOrPath.includes("/") && !roleOrPath.endsWith(".md")) {
    // Nur ein Name → suche in .pi/agents/
    const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
    filePath = join(repoRoot, ".pi", "agents", `${roleOrPath}.md`);
  }

  if (!existsSync(filePath)) {
    return null;
  }

  const text = readFileSync(filePath, "utf-8");

  // Frontmatter extrahieren: zwischen erstem und zweitem "---"
  const parts = text.split(/^---\s*$/m);
  if (parts.length < 3) {
    // Kein valides Frontmatter → ganzer Text als systemPrompt
    return { tools: "", systemPrompt: text.trim() };
  }

  const frontmatter = parts[1];
  const body = parts.slice(2).join("---").trim();

  // tools: Zeile extrahieren — zwei Formate:
  //   Einzeiler:  tools: Read,Write,Bash  oder  tools: Read Write Bash
  //   Block-Liste:  tools:\n  - Read\n  - Write
  let tools = "";
  const fmLines = frontmatter.split("\n");
  let i = 0;
  while (i < fmLines.length) {
    const inlineMatch = fmLines[i].match(/^tools:\s*(.+)$/);
    if (inlineMatch) {
      // Einzeiler: Komma→space normalisieren
      tools = inlineMatch[1].trim().replace(/,\s*/g, " ");
      break;
    }
    if (fmLines[i].match(/^tools:\s*$/)) {
      // Block-Liste: folgende Zeilen mit "- <item>" einsammeln
      const items: string[] = [];
      i++;
      while (i < fmLines.length) {
        const itemMatch = fmLines[i].match(/^[ \t]*-\s*(.+)$/);
        if (itemMatch) {
          items.push(itemMatch[1].trim());
          i++;
        } else {
          break;
        }
      }
      tools = items.join(" ");
      break;
    }
    i++;
  }

  return { tools, systemPrompt: body };
}

// ── argv bauen ────────────────────────────────────────────────────────────────

/**
 * Baut die vollständige Argument-Liste für `claude`.
 * Gibt {argv, roleDef} zurück — roleDef.tools/systemPrompt sind die genutzten Werte.
 */
export function buildArgv(
  roleNameOrDef: string,
  prompt: string,
  opts: DispatchOpts = {},
): { argv: string[]; roleDef: RoleDef } {
  const model = opts.model ?? "claude-haiku-4-5-20251001";

  // Rolle laden (falls tools/systemPrompt direkt per opts übergeben → Datei optional)
  let roleDef: RoleDef = { tools: "", systemPrompt: "" };
  const loaded = loadRoleDef(roleNameOrDef);
  if (loaded) {
    roleDef = loaded;
  }
  // opts überschreiben immer
  if (opts.tools !== undefined) roleDef.tools = opts.tools;
  if (opts.systemPrompt !== undefined) roleDef.systemPrompt = opts.systemPrompt;

  // WICHTIG: claude erwartet den Prompt direkt nach -p (bzw. als erstes positionales Arg).
  // Reihenfolge: claude -p <prompt> --output-format json --model … --allowedTools …
  // Flags nach dem Prompt sind weiterhin gültig (claude parst alle Optionen).
  const argv: string[] = [
    "-p", prompt,         // headless + Prompt direkt nach -p
    "--output-format", "json",
    "--model", model,
    "--permission-mode", "auto",
  ];

  if (roleDef.tools) {
    argv.push("--allowedTools", roleDef.tools);
  }

  if (roleDef.systemPrompt) {
    argv.push("--append-system-prompt", roleDef.systemPrompt);
  }

  return { argv, roleDef };

}

// ── Spawn + Parse ─────────────────────────────────────────────────────────────

/**
 * Hauptfunktion: spawnt claude -p, wartet auf Ergebnis, parst JSON.
 *
 * @param roleNameOrDef  Rollenname (sucht .pi/agents/<name>.md) oder Pfad zur .md
 * @param prompt         Prompt, der dem Worker übergeben wird
 * @param opts           Optionale Überschreibungen (model, tools, systemPrompt, timeout, …)
 */
export async function dispatchWorker(
  roleNameOrDef: string,
  prompt: string,
  opts: DispatchOpts = {},
): Promise<WorkerResult> {
  const timeoutMs = (opts.timeoutSecs ?? 120) * 1000;
  const { argv } = buildArgv(roleNameOrDef, prompt, opts);

  if (opts.dryRun) {
    // Dry-Run: gibt zusammengebaute argv zurück ohne zu spawnen
    return {
      result: `[dry-run] claude ${argv.join(" ")}`,
      is_error: false,
      total_cost_usd: 0,
      num_turns: 0,
      exitCode: 0,
      stderr: "",
    };
  }

  return new Promise<WorkerResult>((resolve) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CC_ORCHESTRATED: "1",   // Hook-Gating: SessionStart/Stop überspringen
    };

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn("claude", argv, {
        stdio: ["ignore", "pipe", "pipe"],
        env,
        cwd: opts.cwd,
      });
    } catch (spawnErr: unknown) {
      const msg = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
      resolve({
        result: "",
        is_error: true,
        total_cost_usd: 0,
        num_turns: 0,
        exitCode: 1,
        stderr: "",
        error: `spawn error: ${msg}`,
      });
      return;
    }

    let stdoutBuf = "";
    let stderrBuf = "";
    let timedOut = false;

    // Timeout: SIGTERM nach timeoutMs
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeoutMs);

    proc.stdout!.setEncoding("utf-8");
    proc.stdout!.on("data", (chunk: string) => { stdoutBuf += chunk; });

    proc.stderr!.setEncoding("utf-8");
    proc.stderr!.on("data", (chunk: string) => { stderrBuf += chunk; });

    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      const exitCode = code ?? 1;

      if (timedOut) {
        resolve({
          result: "",
          is_error: true,
          total_cost_usd: 0,
          num_turns: 0,
          exitCode: exitCode !== 0 ? exitCode : 1,
          stderr: stderrBuf,
          error: `timeout after ${opts.timeoutSecs ?? 120}s — worker killed via SIGTERM`,
        });
        return;
      }

      // JSON parsen
      const raw = stdoutBuf.trim();
      let parsed: Record<string, unknown> = {};
      let parseError = "";
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        parseError = `JSON parse error: ${e instanceof Error ? e.message : String(e)} — raw: ${raw.slice(0, 200)}`;
      }

      const is_error =
        Boolean(parsed.is_error) || exitCode !== 0 || parseError !== "";

      resolve({
        result: String(parsed.result ?? ""),
        is_error,
        total_cost_usd: Number(parsed.total_cost_usd ?? 0),
        num_turns: Number(parsed.num_turns ?? 0),
        exitCode,
        stderr: stderrBuf,
        // Fehlerquelle: parseError > parsed.result (enthält claude-Fehlermeldung) > stderr (nur MCP-Warnings etc.)
        error: parseError
          || (is_error ? (String(parsed.result || "") || stderrBuf.slice(0, 500)) : undefined),
      });
    });

    proc.on("error", (err: Error) => {
      clearTimeout(timer);
      resolve({
        result: "",
        is_error: true,
        total_cost_usd: 0,
        num_turns: 0,
        exitCode: 1,
        stderr: stderrBuf,
        error: `process error: ${err.message}`,
      });
    });
  });
}

// ── CLI-Entry ─────────────────────────────────────────────────────────────────

// Wird direkt ausgeführt: bun scripts/cc-dispatch.ts <role-or-tools> <prompt> [--model <id>] [--timeout <secs>] [--dry-run]
if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error(
      "Usage: bun scripts/cc-dispatch.ts <role|tools> <prompt> [--model <id>] [--timeout <secs>] [--dry-run]",
    );
    console.error("  role:    Name einer .pi/agents/<role>.md (z.B. reviewer)");
    console.error("  tools:   Space-getrennte Tool-Namen wenn keine .md-Datei (z.B. 'Read')");
    console.error("  prompt:  Prompt-Text");
    console.error("  --model: Claude-Modell-ID (default: claude-haiku-4-5-20251001)");
    console.error("  --timeout: Timeout in Sekunden (default: 120)");
    console.error("  --dry-run: Gibt nur die zusammengebaute argv aus, spawnt nicht");
    process.exit(1);
  }

  const roleOrTools = args[0];
  const prompt = args[1];

  // Optionen aus CLI-Args parsen
  const opts: DispatchOpts = {};
  for (let i = 2; i < args.length; i++) {
    if (args[i] === "--model" && args[i + 1]) {
      opts.model = args[++i];
    } else if (args[i] === "--timeout" && args[i + 1]) {
      opts.timeoutSecs = parseInt(args[++i], 10);
    } else if (args[i] === "--dry-run") {
      opts.dryRun = true;
    }
  }

  // loadRoleDef löst Pfade, Namen und .md-Suffixe selbst auf.
  const rolePath = roleOrTools;

  const loaded = loadRoleDef(rolePath);
  if (!loaded && !roleOrTools.includes("/") && !roleOrTools.endsWith(".md")) {
    // Kein Rollendatei gefunden → treat als direkte Tool-Whitelist
    opts.tools = roleOrTools;
  }

  try {
    const result = await dispatchWorker(rolePath, prompt, opts);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.exitCode);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Fatal: ${msg}`);
    process.exit(1);
  }
}
