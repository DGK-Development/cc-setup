// Native (Deno-only) session-cost reader — replaces the heavy `uv run
// session_analyze.py` call for the cross-project sidebar. Streams the same usage
// fields session_analyze.py sums (message.usage.{input,output,cache_read,
// cache_creation}_tokens) straight from the JSONL, so cost numbers stay in
// parity — but with no Python subprocess and tiny memory (one file at a time).

import { join } from "@std/path";

// Per-MTok USD rates (Claude Sonnet-4 tier) — kept identical to tokens.ts.
const RATE_INPUT = 3.0;
const RATE_OUTPUT = 15.0;
const RATE_CACHE_WRITE = 3.75;
const RATE_CACHE_READ = 0.30;

function estCost(
  inp: number,
  out: number,
  cacheRead: number,
  cacheCreation: number,
): number {
  return (inp * RATE_INPUT + out * RATE_OUTPUT + cacheCreation * RATE_CACHE_WRITE +
    cacheRead * RATE_CACHE_READ) / 1_000_000;
}

/** Claude Code encodes a project's cwd into its session dir name (non-alnum → '-'). */
function encodeCwd(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

function sessionsDir(cwd: string): string {
  const base = Deno.env.get("CLAUDE_PROJECTS_DIR") ??
    `${Deno.env.get("HOME") ?? "/tmp"}/.claude/projects`;
  return join(base, encodeCwd(cwd));
}

/** Estimated cost (≈ USD) from one session JSONL: sum usage tokens over its lines. */
async function fileCost(path: string): Promise<number> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch {
    return 0;
  }
  let inp = 0, out = 0, cr = 0, cc = 0;
  for (const line of text.split("\n")) {
    if (!line) continue;
    let e: { message?: { usage?: Record<string, unknown> } };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = e?.message?.usage;
    if (!usage || typeof usage !== "object") continue;
    inp += Number(usage.input_tokens ?? 0);
    out += Number(usage.output_tokens ?? 0);
    cr += Number(usage.cache_read_input_tokens ?? 0);
    cc += Number(usage.cache_creation_input_tokens ?? 0);
  }
  return estCost(inp, out, cr, cc);
}

/**
 * Native 7-day cost (≈ USD): sum the cost of session JSONLs whose file mtime is
 * within the last 7 days. No subprocess. `now` is injectable for tests.
 */
async function sevenDayCostNative(cwd: string, now: number = Date.now()): Promise<number> {
  const dir = sessionsDir(cwd);
  const cutoff = now - 7 * 24 * 3600 * 1000;
  let cost = 0;
  try {
    for await (const ent of Deno.readDir(dir)) {
      if (!ent.isFile || !ent.name.endsWith(".jsonl")) continue;
      const p = join(dir, ent.name);
      let mt: number;
      try {
        mt = (await Deno.stat(p)).mtime?.getTime() ?? 0;
      } catch {
        continue;
      }
      if (mt < cutoff) continue;
      cost += await fileCost(p);
    }
  } catch { /* no session dir for this project */ }
  return Math.round(cost * 100) / 100;
}
