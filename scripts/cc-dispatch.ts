/**
 * cc-dispatch.ts — Claude Agent SDK Worker-Dispatcher für den pi-Orchestrator-Workflow
 *
 * Exportiert dispatchWorker(roleNameOrDef, prompt, opts) das:
 * - aus .pi/agents/<role>.md (Frontmatter: tools + Body: systemPrompt) ODER
 *   aus direkt übergebenen opts.tools / opts.systemPrompt die SDK-Options baut
 * - Claude in-process via @anthropic-ai/claude-agent-sdk query() startet
 * - Timeout via AbortController sauber abbricht
 * - SDKResultMessage ausliest → {result, is_error, total_cost_usd, num_turns, exitCode}
 *
 * CLI: bun scripts/cc-dispatch.ts <role-or-tools> <prompt> [--model X] [--timeout S] [--dry-run]
 *
 * Sicherheits-Entscheidungen (vom User autorisiert):
 *   settingSources: []       — SDK isolation mode: lädt KEINE ~/.claude/settings.json
 *                              und KEINE Hooks (inkl. redactor) im Worker.
 *                              Bewusste Entscheidung für den pi-Workflow: Worker
 *                              laufen isoliert, redactor-Hook gilt nur in der Hauptsession.
 *   env: { ...process.env } — env ERSETZT process.env vollständig im SDK (kein Merge).
 *                              Spread ist Pflicht, sonst fehlt PATH/ANTHROPIC_API_KEY.
 *   permissionMode:'default' — zusammen mit canUseTool der Headless-Approver.
 *     + canUseTool           'bypassPermissions' wird unter der Enterprise-Managed-Policy
 *                            NICHT honoriert (headless-auto-deny → Worker bleibt stecken);
 *                            'auto' ist nur ein Modell-Klassifizierer. canUseTool lässt
 *                            genau die Tools der Rolle (Frontmatter `tools`) zu und lehnt
 *                            alles andere ab — verifiziert mit SDK v0.3.168.
 *
 * Tool-Name-Mapping (CLI-Name → SDK-Name):
 *   read → Read, write → Write, edit → Edit, bash → Bash, grep → Grep,
 *   find → Glob, ls → Glob
 */

import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Typen ────────────────────────────────────────────────────────────────────

export interface WorkerUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface WorkerResult {
  result: string;
  is_error: boolean;
  total_cost_usd: number;
  num_turns: number;
  exitCode: number;
  stderr: string;
  error?: string;
  usage?: WorkerUsage;
  durationMs?: number;
}

export interface DispatchOpts {
  /** Claude-Modell-ID (default: claude-haiku-4-5 — günstig für Smoke) */
  model?: string;
  /** Komma- oder space-getrennte CLI-Tool-Namen, überschreibt Frontmatter tools falls angegeben */
  tools?: string;
  /** System-Prompt-Body, überschreibt .md-Body falls angegeben */
  systemPrompt?: string;
  /** Timeout in Sekunden (default: 120) */
  timeoutSecs?: number;
  /** Arbeitsverzeichnis für den Worker */
  cwd?: string;
  /** Falls true: zeige assemblierten query-Options-Dump ohne zu spawnen */
  dryRun?: boolean;
  /** Falls true: alle system-Messages auf stderr ausgeben (inkl. thinking_tokens u.ä. Rauschen) */
  debug?: boolean;
  /**
   * Rolle des Workers (planner | builder | reviewer) — nur für Logging/Label.
   * Permissions laufen NICHT über die Rolle, sondern über den canUseTool-Approver
   * in buildQueryOpts: zugelassen sind genau die Tools der Rolle (Frontmatter `tools`).
   */
  role?: string;
}

interface RoleDef {
  tools: string;      // space-getrennte CLI-Tool-Namen (read, bash, grep, …)
  systemPrompt: string;
}

// ── Tool-Name-Mapping: CLI → SDK ─────────────────────────────────────────────

/**
 * Übersetzt komma-/space-getrennte CLI-Tool-Namen (read,bash,grep,find,ls)
 * in die SDK-Kapitalisierung (Read, Bash, Grep, Glob).
 *
 * Unbekannte Namen werden unverändert durchgereicht — das erlaubt MCP-Tool-Namen
 * wie mcp__myserver__tool ohne Filterung.
 */
function cliToolsToSdkTools(cliTools: string): string[] {
  const CLI_TO_SDK: Record<string, string> = {
    read:  "Read",
    write: "Write",
    edit:  "Edit",
    bash:  "Bash",
    grep:  "Grep",
    find:  "Glob",
    ls:    "Glob",
  };

  const raw = cliTools
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const sdkNames = raw.map((name) => CLI_TO_SDK[name] ?? name);

  // Deduplizieren (z.B. find + ls → beide "Glob")
  return [...new Set(sdkNames)];
}

// ── Rolle aus .pi/agents/<name>.md parsen ────────────────────────────────────

/**
 * Liest .pi/agents/<role>.md relativ zu diesem Repo-Root und parst:
 *   - Frontmatter-Feld "tools:" → space-normalisiert
 *   - Body nach dem zweiten "---" → systemPrompt
 *
 * Falls die Datei nicht existiert, gibt null zurück (Caller muss opts.tools liefern).
 */
export function loadRoleDef(roleOrPath: string): RoleDef | null {
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

// ── Query-Options bauen ───────────────────────────────────────────────────────

/**
 * Baut die SDK query()-Options aus Rolle + DispatchOpts.
 * Gibt {queryOpts, roleDef} zurück.
 */
export function buildQueryOpts(
  roleNameOrDef: string,
  prompt: string,
  opts: DispatchOpts = {},
): { queryOpts: Record<string, unknown>; roleDef: RoleDef } {
  const model = opts.model ?? "claude-haiku-4-5";

  // Rolle laden (falls tools/systemPrompt direkt per opts übergeben → Datei optional)
  let roleDef: RoleDef = { tools: "", systemPrompt: "" };
  const loaded = loadRoleDef(roleNameOrDef);
  if (loaded) {
    roleDef = loaded;
  }
  // opts überschreiben immer
  if (opts.tools !== undefined) roleDef.tools = opts.tools;
  if (opts.systemPrompt !== undefined) roleDef.systemPrompt = opts.systemPrompt;

  // CLI-Tool-Namen → SDK-Kapitalisierung
  const sdkTools = roleDef.tools ? cliToolsToSdkTools(roleDef.tools) : [];

  // ── Headless-Permissions: canUseTool-Whitelist-Approver ───────────────────
  // WICHTIG (verifiziert mit SDK v0.3.168 unter Enterprise-Managed-Policy):
  //   - permissionMode:'auto'  = MODELL-Klassifizierer (nicht "auto-allow").
  //   - permissionMode:'bypassPermissions' wird hier NICHT honoriert — die
  //     Managed-Policy (Human-Oversight) deaktiviert Bypass; headless folgt ein
  //     "headless-agent auto-deny", d.h. Write/Edit/Bash werden still verweigert.
  //     Das war die eigentliche Steckenbleib-Ursache: der Worker bekommt seine
  //     Tool-Calls verweigert und "fragt" dann im Output nach Genehmigung.
  //   - allowedTools allein reicht NICHT (wurde trotz Whitelisting auto-denied).
  // Lösung: permissionMode:'default' + ein expliziter canUseTool-Callback, der
  // genau die Tools der Rolle (sdkTools) zulässt und alles andere ablehnt. Das
  // ist der dokumentierte programmatische Approver ("Called before each tool
  // execution to determine if it should be allowed"). Keine bypass-Flags nötig.
  // Damage-control + Caps bleiben pi-seitig (cc-orchestrator.ts) aktiv; Human-
  // Oversight bleibt über Gate₀ + Review + "kein git push" gewahrt.
  const allowSet = new Set(sdkTools);
  const canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<{ behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string }> => {
    if (allowSet.has(toolName)) {
      return { behavior: "allow", updatedInput: input };
    }
    return { behavior: "deny", message: `Tool "${toolName}" not in worker whitelist [${[...allowSet].join(", ")}]` };
  };

  const queryOpts: Record<string, unknown> = {
    model,
    // tools: begrenzt die verfügbare Tool-Basis; leer = kein Built-in-Tool
    tools: sdkTools.length > 0 ? sdkTools : ([] as string[]),
    // permissionMode:'default' → jeder Tool-Call läuft durch canUseTool (unser Approver).
    permissionMode: "default",
    // canUseTool: programmatischer Headless-Approver (Whitelist = sdkTools der Rolle).
    canUseTool,
    // settingSources: [] = SDK isolation mode.
    // Lädt KEINE ~/.claude/settings.json und KEINE externen Hooks (inkl. redactor).
    // Explizit autorisiert vom User für den pi-Workflow: Worker laufen isoliert,
    // redactor-Schutz gilt in der Hauptsession (diese Datei), nicht im Worker-Subprocess.
    settingSources: [] as string[],
    // env ERSETZT process.env vollständig (SDK macht kein Merge).
    // Spread-Pflicht damit PATH, HOME, ANTHROPIC_API_KEY usw. erhalten bleiben.
    env: { ...process.env, CC_ORCHESTRATED: "1" },
    cwd: opts.cwd ?? process.cwd(),
  };

  if (roleDef.systemPrompt) {
    queryOpts.systemPrompt = roleDef.systemPrompt;
  }

  return { queryOpts, roleDef };
}

// ── Dispatch via SDK query() ──────────────────────────────────────────────────

/**
 * Baut ein WorkerResult aus dem SDK-ResultMessage und der gemessenen Dauer.
 * Pure Funktion — testbar ohne SDK-Lauf.
 */
export function mapResult(
  resultMsg: { subtype?: string; result?: string; is_error?: boolean; errors?: string[]; total_cost_usd?: number; num_turns?: number; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } | null,
  durationMs: number,
  stderrBuf: string,
): WorkerResult {
  if (!resultMsg) {
    return {
      result: "",
      is_error: true,
      total_cost_usd: 0,
      num_turns: 0,
      exitCode: 1,
      stderr: stderrBuf,
      error: "SDK query ended without result message",
      durationMs,
    };
  }

  const isSuccess = resultMsg.subtype === "success";
  const resultText = isSuccess ? (resultMsg.result ?? "") : "";
  const isError = resultMsg.is_error ?? !isSuccess;

  const errors = resultMsg.errors;
  const errorMsg = isError
    ? (errors?.length ? errors.join("; ") : (resultText || stderrBuf.slice(0, 500)) || undefined)
    : undefined;

  // SDK-Usage aus dem ResultMessage extrahieren (CCS-036.12 AC#1)
  const rawUsage = resultMsg.usage;
  const usage: WorkerUsage | undefined = rawUsage
    ? {
        input_tokens: rawUsage.input_tokens ?? 0,
        output_tokens: rawUsage.output_tokens ?? 0,
        ...(rawUsage.cache_read_input_tokens != null && { cache_read_input_tokens: rawUsage.cache_read_input_tokens }),
        ...(rawUsage.cache_creation_input_tokens != null && { cache_creation_input_tokens: rawUsage.cache_creation_input_tokens }),
      }
    : undefined;

  return {
    result: resultText,
    is_error: isError,
    total_cost_usd: resultMsg.total_cost_usd ?? 0,
    num_turns: resultMsg.num_turns ?? 0,
    exitCode: isError ? 1 : 0,
    stderr: stderrBuf,
    error: errorMsg,
    usage,
    durationMs,
  };
}

/**
 * Hauptfunktion: startet Claude in-process via @anthropic-ai/claude-agent-sdk,
 * wartet auf SDKResultMessage, gibt WorkerResult zurück.
 *
 * @param roleNameOrDef  Rollenname (sucht .pi/agents/<name>.md) oder Pfad zur .md
 * @param prompt         Prompt, der dem Worker übergeben wird
 * @param opts           Optionale Überschreibungen (model, tools, systemPrompt, timeout, …)
 *
 * Live-Streaming (AC#1):
 *   Jede SDK-Message wird auf process.stderr ausgegeben — stdout bleibt für das
 *   finale JSON {result,is_error,...} reserviert (Contract für Orchestrator-Parsing).
 *   Format:
 *     [assistant] <text>          — Text-Blöcke aus assistant-Messages
 *     [assistant] → tool: <Name>(<preview>)  — tool_use-Blöcke
 *     [system] <subtype>          — system/status/result-Messages (Debug)
 */
export async function dispatchWorker(
  roleNameOrDef: string,
  prompt: string,
  opts: DispatchOpts = {},
): Promise<WorkerResult> {
  const timeoutMs = (opts.timeoutSecs ?? 120) * 1000;
  // Rolle in opts.role setzen falls noch nicht gesetzt (für buildQueryOpts)
  // — wird aus dem CLI-Arg oder direkt übergeben
  const { queryOpts } = buildQueryOpts(roleNameOrDef, prompt, opts);

  if (opts.dryRun) {
    // Dry-Run: zeige assemblierten Options-Dump, spawne nicht
    const dumpOpts = { ...queryOpts };
    // env nicht im Dump ausgeben (enthält potentiell sensible Keys)
    dumpOpts.env = "[process.env spread + CC_ORCHESTRATED=1]";
    return {
      result: `[dry-run] query opts:\n${JSON.stringify({ prompt, options: dumpOpts }, null, 2)}`,
      is_error: false,
      total_cost_usd: 0,
      num_turns: 0,
      exitCode: 0,
      stderr: "",
    };
  }

  // AbortController für Timeout
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);

  let resultMsg: SDKMessage & { type: "result" } | null = null;
  let stderrBuf = "";
  let queryError: string | undefined;
  const startTs = Date.now(); // Wall-Clock für durationMs (CCS-036.12 AC#1)

  try {
    const queryResult = sdkQuery({
      prompt,
      options: {
        ...(queryOpts as Record<string, unknown>),
        abortController,
        stderr: (data: string) => { stderrBuf += data; },
      } as Parameters<typeof sdkQuery>[0]["options"],
    });

    for await (const message of queryResult) {
      // ── Live-Streaming auf stderr (AC#1) ─────────────────────────────────
      // stdout ist RESERVIERT für das finale JSON — kein mix!
      // Alle intermediären Messages kommen auf stderr für den pi-TUI-Consumer.
      if (message.type === "assistant") {
        // BetaMessage.content ist ein Array aus BetaContentBlock
        const msg = message as SDKMessage & { type: "assistant"; message: { content: Array<{ type: string; text?: string; name?: string; input?: unknown }> } };
        if (Array.isArray(msg.message?.content)) {
          for (const block of msg.message.content) {
            if (block.type === "text" && block.text) {
              // Text-Blöcke: Zeile für Zeile, um langen Output lesbar zu machen
              for (const line of block.text.split("\n")) {
                process.stderr.write(`[assistant] ${line}\n`);
              }
            } else if (block.type === "tool_use" && block.name) {
              // Tool-Call: Name + kurzes Input-Preview (max 120 Zeichen, kein Token-Leak)
              const inputStr = JSON.stringify(block.input ?? {});
              const preview = inputStr.length > 120 ? inputStr.slice(0, 117) + "..." : inputStr;
              process.stderr.write(`[assistant] → tool: ${block.name}(${preview})\n`);
            }
          }
        }
      } else if (message.type === "result") {
        resultMsg = message as SDKMessage & { type: "result" };
        process.stderr.write(`[result] turns=${(resultMsg as { num_turns?: number }).num_turns ?? "?"} is_error=${(resultMsg as { is_error?: boolean }).is_error ?? false}\n`);
        break;
      } else if (message.type === "system") {
        // Nur sinnvolle system-subtypes ausgeben; reines Token-Rauschen (thinking_tokens,
        // status_update, …) wird gefiltert damit das 20-Zeilen TUI-Fenster nicht geflutet wird.
        // Mit --debug werden alle system-Messages ausgegeben.
        const sub = (message as { subtype?: string }).subtype ?? "";
        const SYSTEM_NOISE = new Set([
          "thinking_tokens",
          "status_update",
          "api_error_retry",
          "rate_limit",
        ]);
        if (opts.debug || !SYSTEM_NOISE.has(sub)) {
          process.stderr.write(`[system] ${sub || message.type}\n`);
        }
      }
      // Andere Message-Typen (user, auth_status, …) werden still übersprungen —
      // sie sind für das TUI nicht relevant und würden die Ausgabe überfrachten.
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // AbortError → Timeout
    if (abortController.signal.aborted) {
      clearTimeout(timer);
      return {
        result: "",
        is_error: true,
        total_cost_usd: 0,
        num_turns: 0,
        exitCode: 1,
        stderr: stderrBuf,
        error: `timeout after ${opts.timeoutSecs ?? 120}s — worker aborted via AbortController`,
        durationMs: Date.now() - startTs,
      };
    }
    queryError = `SDK error: ${msg}`;
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - startTs;

  // AbortController ausgelöst aber kein Catch → Timeout ohne Exception
  if (abortController.signal.aborted && !resultMsg && !queryError) {
    return {
      result: "",
      is_error: true,
      total_cost_usd: 0,
      num_turns: 0,
      exitCode: 1,
      stderr: stderrBuf,
      error: `timeout after ${opts.timeoutSecs ?? 120}s — worker aborted via AbortController`,
      durationMs,
    };
  }

  if (queryError) {
    return {
      result: "",
      is_error: true,
      total_cost_usd: 0,
      num_turns: 0,
      exitCode: 1,
      stderr: stderrBuf,
      error: queryError,
      durationMs,
    };
  }

  // mapResult verarbeitet resultMsg (oder null) → WorkerResult mit usage + durationMs (CCS-036.12 AC#1)
  return mapResult(resultMsg, durationMs, stderrBuf);
}

// ── CLI-Entry ─────────────────────────────────────────────────────────────────

// Wird direkt ausgeführt: bun scripts/cc-dispatch.ts <role-or-tools> <prompt> [--model <id>] [--timeout <secs>] [--dry-run]
if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error(
      "Usage: bun scripts/cc-dispatch.ts <role|tools> <prompt> [--model <id>] [--timeout <secs>] [--role <role>] [--dry-run] [--debug]",
    );
    console.error("  role:      Name einer .pi/agents/<role>.md (z.B. reviewer)");
    console.error("  tools:     Komma/space-getrennte CLI-Tool-Namen wenn keine .md-Datei (z.B. 'read')");
    console.error("  prompt:    Prompt-Text");
    console.error("  --model:   Claude-Modell-ID (default: claude-haiku-4-5)");
    console.error("  --timeout: Timeout in Sekunden (default: 120)");
    console.error("  --role:    Worker-Rolle für Permission-Mode (builder → bypassPermissions; andere → auto)");
    console.error("  --dry-run: Gibt nur die assemblierten query-Options aus, spawnt nicht");
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
    } else if (args[i] === "--role" && args[i + 1]) {
      opts.role = args[++i];
    } else if (args[i] === "--dry-run") {
      opts.dryRun = true;
    } else if (args[i] === "--debug") {
      opts.debug = true;
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
