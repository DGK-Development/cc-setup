// hook_inject — runs the SessionStart hook (inject-project-context.sh) on demand
// and reports its token cost. This is the LIVE part of the Kontext view: it
// captures exactly what the hook would emit into a fresh session in `cwd`.
//
// Safety properties (CCS-031 AC #4):
//   - per-cwd SINGLE-FLIGHT: concurrent callers share one in-flight run
//   - per-cwd TTL cache (60s): repeated requests don't re-spawn the subprocess
//   - 5s TIMEOUT via AbortSignal
//   - CC_HOOK_LOG_FILE=/dev/null so the canonical hook-session-start.log is NOT
//     clobbered by dashboard-triggered runs (the hook honours this override)
//
// The hook output contains only the repo backlog stand + a project tree — NO
// tn (TaskNotes) content and nothing cross-project (Org rule).

import { estTokens } from "../md.ts";

const TTL_MS = 60_000;
const TIMEOUT_MS = 5_000;

export interface HookInjectResult {
  ok: boolean;
  tokens: number;
  output: string;
  /** present only on failure (hook not found / spawn error) */
  error?: string;
}

/** Injectable hook runner — default spawns bash; tests pass a fake. */
export type HookRunner = (cwd: string) => Promise<{ ok: boolean; output: string; error?: string }>;

/** Resolve the hook path relative to this module: src/collectors/ → repo root. */
function hookPath(): string {
  // src/collectors/hook_inject.ts → ../../../hooks/inject-project-context.sh
  return new URL("../../../hooks/inject-project-context.sh", import.meta.url).pathname;
}

/** Real runner: spawn `bash <hook>` in cwd with the log override + timeout. */
const realRunner: HookRunner = async (cwd) => {
  const path = hookPath();
  try {
    await Deno.stat(path);
  } catch {
    return { ok: false, output: "", error: `Hook nicht gefunden: ${path}` };
  }
  try {
    const cmd = new Deno.Command("bash", {
      args: [path],
      cwd,
      // Override the hook's log target so the canonical session log is untouched.
      env: { ...Deno.env.toObject(), CC_HOOK_LOG_FILE: "/dev/null" },
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const { stdout, stderr } = await cmd.output();
    const dec = new TextDecoder();
    const output = dec.decode(stdout) + dec.decode(stderr);
    return { ok: true, output };
  } catch (exc) {
    return { ok: false, output: "", error: String(exc) };
  }
};

interface CacheEntry {
  at: number;
  value: HookInjectResult;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<HookInjectResult>>();

/**
 * Run the SessionStart hook for `cwd`, returning {ok, tokens, output}.
 * Cached per cwd for {@link TTL_MS}; concurrent calls share one in-flight run.
 * Pass a `runner` to bypass the real subprocess (tests).
 */
export function collectHookInject(
  cwd: string,
  runner: HookRunner = realRunner,
): Promise<HookInjectResult> {
  const now = Date.now();
  const cached = cache.get(cwd);
  if (cached && (now - cached.at) < TTL_MS) {
    return Promise.resolve(cached.value);
  }
  const existing = inflight.get(cwd);
  if (existing) return existing;

  const run = (async () => {
    const r = await runner(cwd);
    const value: HookInjectResult = r.ok
      ? { ok: true, tokens: estTokens(r.output), output: r.output }
      : { ok: false, tokens: 0, output: r.output ?? "", error: r.error };
    cache.set(cwd, { at: Date.now(), value });
    return value;
  })().finally(() => {
    inflight.delete(cwd);
  });
  inflight.set(cwd, run);
  return run;
}

/** Test helper: drop the per-cwd cache so TTL/single-flight tests start clean. */
export function _resetHookCache(): void {
  cache.clear();
  inflight.clear();
}
