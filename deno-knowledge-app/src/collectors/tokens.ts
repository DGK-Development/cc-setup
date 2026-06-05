// collect_tokens — mirrors knowledge.py collect_tokens
// Last finished session (in/out/cache) + rolling 7-day sum (total + count).

import { parseJson, run } from "../shared.ts";
import { fmtMtime } from "../md.ts";
import { join } from "@std/path";

const SCRIPTS_DIR = join(new URL("../../..", import.meta.url).pathname, "scripts");

// Rough per-MTok USD rates (Claude Sonnet-4 tier). Labelled "≈" everywhere.
const RATE_INPUT = 3.0;
const RATE_OUTPUT = 15.0;
const RATE_CACHE_WRITE = 3.75;
const RATE_CACHE_READ = 0.30;

function estCost(inp: number, out: number, cacheRead: number, cacheCreation: number): number {
  return (inp * RATE_INPUT + out * RATE_OUTPUT + cacheCreation * RATE_CACHE_WRITE +
    cacheRead * RATE_CACHE_READ) / 1_000_000;
}

function encodeCwd(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

async function sessionMtimes(cwd: string): Promise<Map<string, number>> {
  const projectsDir = Deno.env.get("CLAUDE_PROJECTS_DIR") ??
    `${Deno.env.get("HOME")}/.claude/projects`;
  const sessDir = join(projectsDir, encodeCwd(cwd));
  const out = new Map<string, number>();
  try {
    for await (const e of Deno.readDir(sessDir)) {
      if (!e.isFile || !e.name.endsWith(".jsonl")) continue;
      try {
        const stat = await Deno.stat(join(sessDir, e.name));
        out.set(e.name.replace(/\.jsonl$/, ""), stat.mtime?.getTime() ?? 0 / 1000);
      } catch { /* skip */ }
    }
  } catch { /* dir doesn't exist */ }
  return out;
}

interface SessionAnalyzeOutput {
  token_stats?: {
    per_session?: Array<Record<string, unknown>>;
  };
  failed_commands?: Array<Record<string, unknown>>;
  waste_signals?: { repeated_commands?: Array<Record<string, unknown>> };
  tool_frequencies?: Record<string, number>;
}

async function sessionAnalyzeJson(cwd: string): Promise<SessionAnalyzeOutput | null> {
  const saPath = join(SCRIPTS_DIR, "session_analyze.py");
  try {
    await Deno.stat(saPath);
  } catch {
    return null;
  }
  const out = await run(
    ["uv", "run", "--script", saPath, "--output-json", "--cwd", cwd],
    { cwd },
  );
  return parseJson<SessionAnalyzeOutput>(out);
}

function getMtime(mtimes: Map<string, number>, s: Record<string, unknown>): number {
  const sid = String(s.session_id ?? "");
  return mtimes.get(sid) ?? 0;
}

export async function collectTokens(cwd: string): Promise<Record<string, unknown>> {
  try {
    const agg = await sessionAnalyzeJson(cwd);
    if (agg === null) {
      return { available: false, reason: "session_analyze.py unavailable" };
    }
    const perSession = agg.token_stats?.per_session ?? [];
    if (!perSession.length) {
      return { available: true, last_session: null, week: null, sessions: [] };
    }

    const mtimes = await sessionMtimes(cwd);
    const now = Date.now();
    const cutoff = now - 7 * 24 * 3600 * 1000;

    // Last session = highest mtime; fallback to last in list order.
    const last = mtimes.size > 0
      ? perSession.reduce((best, s) => getMtime(mtimes, s) > getMtime(mtimes, best) ? s : best)
      : perSession[perSession.length - 1];

    const lastSession = {
      session_id: String(last.session_id ?? "").slice(0, 8),
      turns: Number(last.turns ?? 0),
      input: Number(last.total_input_tokens ?? 0),
      output: Number(last.total_output_tokens ?? 0),
      cache_read: Number(last.total_cache_read_tokens ?? 0),
      cache_creation: Number(last.total_cache_creation_tokens ?? 0),
      cost: Math.round(
        estCost(
          Number(last.total_input_tokens ?? 0),
          Number(last.total_output_tokens ?? 0),
          Number(last.total_cache_read_tokens ?? 0),
          Number(last.total_cache_creation_tokens ?? 0),
        ) * 10000,
      ) / 10000,
    };

    // Clustering inputs indexed by full session id
    const failedAll = agg.failed_commands ?? [];
    const repeatedAll = agg.waste_signals?.repeated_commands ?? [];
    const failedBySess = new Map<string, Array<Record<string, unknown>>>();
    for (const fc of failedAll) {
      const sid = String(fc.session_id ?? "");
      if (!failedBySess.has(sid)) failedBySess.set(sid, []);
      failedBySess.get(sid)!.push(fc);
    }

    // Rolling 7-day window
    let wkIn = 0, wkOut = 0, wkCr = 0, wkCc = 0, wkCount = 0;
    for (const s of perSession) {
      const mt = mtimes.get(String(s.session_id ?? "")) ?? null;
      if (mt === null || mt < cutoff) continue;
      wkCount++;
      wkIn += Number(s.total_input_tokens ?? 0);
      wkOut += Number(s.total_output_tokens ?? 0);
      wkCr += Number(s.total_cache_read_tokens ?? 0);
      wkCc += Number(s.total_cache_creation_tokens ?? 0);
    }
    const week = {
      session_count: wkCount,
      input: wkIn,
      output: wkOut,
      cache_read: wkCr,
      cache_creation: wkCc,
      total: wkIn + wkOut + wkCr + wkCc,
    };

    // Full session list (newest first, capped at 30)
    const sessions = perSession.map((s) => {
      const sid = String(s.session_id ?? "");
      const mt = mtimes.get(sid) ?? null;
      const inp = Number(s.total_input_tokens ?? 0);
      const out = Number(s.total_output_tokens ?? 0);
      const cr = Number(s.total_cache_read_tokens ?? 0);
      const cc = Number(s.total_cache_creation_tokens ?? 0);
      const errs = failedBySess.get(sid) ?? [];
      const reps = repeatedAll
        .filter((r) => (r.sessions as string[] ?? []).includes(sid))
        .sort((a, b) => Number(b.count ?? 0) - Number(a.count ?? 0));
      return {
        session_id: sid.slice(0, 8),
        turns: Number(s.turns ?? 0),
        input: inp,
        output: out,
        cache_read: cr,
        cache_creation: cc,
        total: inp + out + cr + cc,
        cost: Math.round(estCost(inp, out, cr, cc) * 10000) / 10000,
        date: fmtMtime(mt !== null ? mt / 1000 : null),
        error_count: errs.length,
        errors: errs.slice(0, 12).map((e) => ({
          tool: String(e.tool ?? ""),
          command: String(e.command ?? "").slice(0, 200),
          preview: String(e.error_preview ?? "").slice(0, 240),
        })),
        repeat_count: reps.length,
        repeats: reps.slice(0, 12).map((r) => ({
          command: String(r.command ?? "").slice(0, 200),
          count: Number(r.count ?? 0),
        })),
        _mt: mt ?? 0,
      };
    });
    sessions.sort((a, b) => b._mt - a._mt);
    const result = sessions.slice(0, 30).map(({ _mt: _, ...rest }) => rest);

    return {
      available: true,
      last_session: lastSession,
      week,
      sessions: result,
      errors_total: failedAll.length,
      repeats_total: repeatedAll.length,
      tool_freq: agg.tool_frequencies ?? {},
    };
  } catch (exc) {
    return { available: false, reason: `collect_tokens failed: ${exc}` };
  }
}
