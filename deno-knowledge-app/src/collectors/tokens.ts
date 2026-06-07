// collect_tokens — native Deno reimplementation (kein session_analyze.py/uv).
// Liest Session-JSONLs direkt aus ~/.claude/projects/<encodedCwd>/*.jsonl und
// berechnet token-stats, errors, repeats und tool_freq exakt wie session_analyze.py.
//
// Parity-Notiz: Die Logik folgt session_analyze.py Zeile für Zeile:
//   - turns = Anzahl assistant-Eintraege MIT usage-Feld (wie _extract_token_stats)
//   - errors = tool_result entries mit is_error=true (alle Tools, nicht nur Bash)
//   - repeats = Bash-Commands die ≥3× insgesamt aufgerufen werden (wie _extract_waste_signals)
//   - tool_freq = Counter über assistant-entries/tool_use-items (wie _extract_tool_frequencies)

import { estCost, encodeCwd } from "./sessions_native.ts";
import { fmtMtime } from "../md.ts";
import { join } from "@std/path";

// Schwellwert: Bash-Command muss ≥ diesen Wert erreichen, um als "repeated" zu gelten.
const REPEATED_CMD_THRESHOLD = 3;

/** Pfad zum Sessions-Verzeichnis fuer ein bestimmtes CWD. */
function sessionsDir(cwd: string): string {
  const base = Deno.env.get("CLAUDE_PROJECTS_DIR") ??
    `${Deno.env.get("HOME") ?? "/tmp"}/.claude/projects`;
  return join(base, encodeCwd(cwd));
}

interface UsageLine {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  hasTurn: boolean; // true wenn type=="assistant" UND usage-Feld vorhanden
}

interface ToolUse {
  name: string;
  command: string; // command (Bash) oder file_path (Read/Write) aus input
  sessionId: string;
}

/** Parst eine einzelne JSONL-Datei und gibt alle relevanten Signale zurueck. */
async function parseSessionFile(path: string, sessionId: string): Promise<{
  usage: UsageLine[];
  toolUses: Map<string, ToolUse>; // tool_use_id -> ToolUse
  failedEntries: Array<{ tool: string; command: string; errorPreview: string }>;
  toolFreq: Map<string, number>;
  bashCommands: string[]; // alle Bash-Commands (fuer repeated-Berechnung)
}> {
  const usage: UsageLine[] = [];
  const toolUses = new Map<string, ToolUse>();
  const failedEntries: Array<{ tool: string; command: string; errorPreview: string }> = [];
  const toolFreqMap = new Map<string, number>();
  const bashCommands: string[] = [];

  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch {
    return { usage, toolUses, failedEntries, toolFreq: toolFreqMap, bashCommands };
  }

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const entryType = String(entry.type ?? "");
    const msg = (entry.message && typeof entry.message === "object")
      ? entry.message as Record<string, unknown>
      : null;

    if (entryType === "assistant" && msg) {
      // Token-Stats: turns = assistant-entries mit usage-Feld
      const rawUsage = msg.usage;
      const hasUsage = rawUsage && typeof rawUsage === "object";
      const u = hasUsage ? rawUsage as Record<string, unknown> : null;
      usage.push({
        input: u ? Number(u.input_tokens ?? 0) : 0,
        output: u ? Number(u.output_tokens ?? 0) : 0,
        cacheRead: u ? Number(u.cache_read_input_tokens ?? 0) : 0,
        cacheCreation: u ? Number(u.cache_creation_input_tokens ?? 0) : 0,
        hasTurn: !!hasUsage,
      });

      // Tool-Uses aus dem Content-Array extrahieren
      const content = Array.isArray(msg.content) ? msg.content as unknown[] : [];
      for (const item of content) {
        if (!item || typeof item !== "object") continue;
        const it = item as Record<string, unknown>;
        if (it.type !== "tool_use") continue;

        const tuId = String(it.id ?? "");
        const toolName = String(it.name ?? "");
        const inp = (it.input && typeof it.input === "object")
          ? it.input as Record<string, unknown>
          : {};
        // command fuer Bash, file_path fuer Read/Write
        const cmd = String(inp.command ?? inp.file_path ?? "");

        if (tuId) {
          toolUses.set(tuId, { name: toolName, command: cmd, sessionId });
        }

        // Tool-Frequenz zaehlen (wie _extract_tool_frequencies)
        toolFreqMap.set(toolName, (toolFreqMap.get(toolName) ?? 0) + 1);

        // Bash-Commands fuer repeated-Berechnung sammeln
        if (toolName === "Bash" && cmd.trim()) {
          bashCommands.push(cmd.trim());
        }
      }
    } else if (entryType === "user" && msg) {
      // Fehler: tool_result entries mit is_error=true
      const content = Array.isArray(msg.content) ? msg.content as unknown[] : [];
      for (const item of content) {
        if (!item || typeof item !== "object") continue;
        const it = item as Record<string, unknown>;
        if (it.type !== "tool_result") continue;
        if (!it.is_error) continue;

        const tuId = String(it.tool_use_id ?? "");
        const tu = toolUses.get(tuId);
        const errorContent = it.content;
        const errorPreview = String(
          Array.isArray(errorContent)
            ? (errorContent[0] && typeof errorContent[0] === "object"
              ? (errorContent[0] as Record<string, unknown>).text ?? ""
              : errorContent[0] ?? "")
            : errorContent ?? "",
        ).slice(0, 300);

        failedEntries.push({
          tool: tu?.name ?? "",
          command: tu?.command ?? "",
          errorPreview,
        });
      }
    }
  }

  return { usage, toolUses, failedEntries, toolFreq: toolFreqMap, bashCommands };
}

/** Liest mtimes aller JSONL-Dateien fuer ein Projekt. */
async function sessionMtimes(dir: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile || !e.name.endsWith(".jsonl")) continue;
      try {
        const stat = await Deno.stat(join(dir, e.name));
        out.set(e.name.replace(/\.jsonl$/, ""), stat.mtime?.getTime() ?? 0);
      } catch { /* skip */ }
    }
  } catch { /* dir existiert nicht */ }
  return out;
}

/** Haupt-Export: native Version von collectTokens, kein Python-Spawn. */
async function collectTokens(cwd: string): Promise<Record<string, unknown>> {
  try {
    const dir = sessionsDir(cwd);
    const mtimes = await sessionMtimes(dir);

    // Alle JSONL-Dateien auflisten
    const files: string[] = [];
    try {
      for await (const e of Deno.readDir(dir)) {
        if (e.isFile && e.name.endsWith(".jsonl")) {
          files.push(e.name);
        }
      }
    } catch {
      return { available: true, last_session: null, week: null, sessions: [] };
    }

    if (!files.length) {
      return { available: true, last_session: null, week: null, sessions: [] };
    }

    // Aggregierte Strukturen ueber alle Sessions
    const allFailed: Array<{ tool: string; command: string; errorPreview: string }> = [];
    // command -> Gesamtzahl Aufrufe (fuer repeated-Berechnung)
    const bashCmdCount = new Map<string, number>();
    // command -> Set of session_ids (fuer sessions-Liste in repeats)
    const bashCmdSessions = new Map<string, Set<string>>();
    const globalToolFreq = new Map<string, number>();

    // Per-Session Stats
    interface SessionStat {
      sessionId: string;
      turns: number;
      input: number;
      output: number;
      cacheRead: number;
      cacheCreation: number;
      failed: Array<{ tool: string; command: string; errorPreview: string }>;
      mtime: number;
    }
    const perSession: SessionStat[] = [];

    // Alle Dateien sequenziell parsen (surgical: kein paralleles Spawnen)
    for (const fname of files) {
      const sessionId = fname.replace(/\.jsonl$/, "");
      const fpath = join(dir, fname);
      const { usage, failedEntries, toolFreq, bashCommands } = await parseSessionFile(
        fpath,
        sessionId,
      );

      // Token-Summen + turns
      let inp = 0, out = 0, cr = 0, cc = 0, turns = 0;
      for (const u of usage) {
        if (u.hasTurn) turns++;
        inp += u.input;
        out += u.output;
        cr += u.cacheRead;
        cc += u.cacheCreation;
      }

      // Fehler dieser Session
      allFailed.push(...failedEntries);

      // Tool-Frequenzen aggregieren
      for (const [name, cnt] of toolFreq) {
        globalToolFreq.set(name, (globalToolFreq.get(name) ?? 0) + cnt);
      }

      // Bash-Commands zaehlen (fuer repeated-Berechnung cross-session)
      for (const cmd of bashCommands) {
        bashCmdCount.set(cmd, (bashCmdCount.get(cmd) ?? 0) + 1);
        if (!bashCmdSessions.has(cmd)) bashCmdSessions.set(cmd, new Set());
        bashCmdSessions.get(cmd)!.add(sessionId);
      }

      perSession.push({
        sessionId,
        turns,
        input: inp,
        output: out,
        cacheRead: cr,
        cacheCreation: cc,
        failed: failedEntries,
        mtime: mtimes.get(sessionId) ?? 0,
      });
    }

    if (!perSession.length) {
      return { available: true, last_session: null, week: null, sessions: [] };
    }

    // repeated_commands: Commands mit >= REPEATED_CMD_THRESHOLD Aufrufen
    // Sortiert nach count absteigend (wie session_analyze.py)
    const repeatedCommands = Array.from(bashCmdCount.entries())
      .filter(([, cnt]) => cnt >= REPEATED_CMD_THRESHOLD)
      .map(([cmd, cnt]) => ({
        command: cmd,
        count: cnt,
        sessions: Array.from(bashCmdSessions.get(cmd) ?? []).sort(),
      }))
      .sort((a, b) => b.count - a.count);

    // Last Session = neuestem mtime
    const lastStat = perSession.reduce((best, s) => s.mtime > best.mtime ? s : best);
    const lastSession = {
      session_id: lastStat.sessionId.slice(0, 8),
      turns: lastStat.turns,
      input: lastStat.input,
      output: lastStat.output,
      cache_read: lastStat.cacheRead,
      cache_creation: lastStat.cacheCreation,
      cost: Math.round(
        estCost(lastStat.input, lastStat.output, lastStat.cacheRead, lastStat.cacheCreation) *
          10000,
      ) / 10000,
    };

    // Rolling 7-day window
    const now = Date.now();
    const cutoff = now - 7 * 24 * 3600 * 1000;
    let wkIn = 0, wkOut = 0, wkCr = 0, wkCc = 0, wkCount = 0;
    for (const s of perSession) {
      if (s.mtime < cutoff) continue;
      wkCount++;
      wkIn += s.input;
      wkOut += s.output;
      wkCr += s.cacheRead;
      wkCc += s.cacheCreation;
    }
    const week = {
      session_count: wkCount,
      input: wkIn,
      output: wkOut,
      cache_read: wkCr,
      cache_creation: wkCc,
      total: wkIn + wkOut + wkCr + wkCc,
    };

    // sessions[] aufbauen aus perSession
    // Fehler sind bereits pro Session in perSession.failed gespeichert (via parseSessionFile)
    const sessions = perSession
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 30)
      .map((s) => {
        const reps = repeatedCommands
          .filter((r) => r.sessions.includes(s.sessionId))
          .slice(0, 12)
          .map((r) => ({ command: r.command.slice(0, 200), count: r.count }));
        return {
          session_id: s.sessionId.slice(0, 8),
          turns: s.turns,
          input: s.input,
          output: s.output,
          cache_read: s.cacheRead,
          cache_creation: s.cacheCreation,
          total: s.input + s.output + s.cacheRead + s.cacheCreation,
          cost: Math.round(
            estCost(s.input, s.output, s.cacheRead, s.cacheCreation) * 10000,
          ) / 10000,
          date: fmtMtime(s.mtime > 0 ? s.mtime / 1000 : null),
          error_count: s.failed.length,
          errors: s.failed.slice(0, 12).map((e) => ({
            tool: e.tool,
            command: e.command.slice(0, 200),
            preview: e.errorPreview.slice(0, 240),
          })),
          repeat_count: reps.length,
          repeats: reps,
        };
      });

    // tool_freq als plain Record (sortiert nach count fuer Konsistenz)
    const toolFreqObj: Record<string, number> = {};
    for (const [name, cnt] of Array.from(globalToolFreq.entries()).sort(([, a], [, b]) => b - a)) {
      toolFreqObj[name] = cnt;
    }

    return {
      available: true,
      last_session: lastSession,
      week,
      sessions,
      errors_total: allFailed.length,
      repeats_total: repeatedCommands.length,
      tool_freq: toolFreqObj,
    };
  } catch (exc) {
    return { available: false, reason: `collect_tokens failed: ${exc}` };
  }
}
