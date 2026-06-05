// File-backed aggregate cache with periodic background refresh.
// Caches the EXPENSIVE shared data: the global layer (skills/agents/hooks/global
// CLAUDE.md — identical for every project) + the multi-project sidebar (open
// tasks + 7d cost per project). The currently-selected project DETAIL stays live
// (computed per request in server.ts), never cached.

import { dirname, join } from "@std/path";
import { collectGlobal } from "./collectors/index.ts";
import { collectSidebar, type SidebarProject } from "./collectors/sidebar.ts";

const HOME = Deno.env.get("HOME") ?? "/tmp";

// NOTE: tn (TaskNotes) is intentionally NOT aggregated here. The vault tn system
// spans customer-specific (kunde) and personal projects; aggregating it would
// process exactly the data the org rules forbid. The cross-project view stays
// limited to repo backlog (dev tasks) + token cost.
export interface Aggregate {
  generated_at: number; // epoch ms
  global: Record<string, unknown>;
  projects: SidebarProject[];
}

export function cacheFile(): string {
  return Deno.env.get("CC_KNOWLEDGE_CACHE") ??
    join(HOME, ".cache", "cc-knowledge", "cache.json");
}

export function ttlMs(): number {
  const v = Number(Deno.env.get("CC_KNOWLEDGE_TTL_MS"));
  return Number.isFinite(v) && v > 0 ? v : 15 * 60 * 1000;
}

/** Pure freshness predicate (testable without IO). */
export function isFresh(agg: Aggregate | null, ttl: number, now: number): boolean {
  return !!agg && (now - agg.generated_at) < ttl;
}

export async function readCacheFile(path = cacheFile()): Promise<Aggregate | null> {
  try {
    const obj = JSON.parse(await Deno.readTextFile(path)) as Aggregate;
    if (obj && typeof obj.generated_at === "number" && Array.isArray(obj.projects)) return obj;
    return null;
  } catch {
    return null;
  }
}

export async function writeCacheFile(agg: Aggregate, path = cacheFile()): Promise<void> {
  try {
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, JSON.stringify(agg));
  } catch { /* best-effort; a missing cache just means recompute next refresh */ }
}

export async function computeAggregate(
  activeRepo: string,
  home: string,
  now: number,
): Promise<Aggregate> {
  return {
    generated_at: now,
    global: await collectGlobal(home),
    projects: await collectSidebar(activeRepo),
  };
}

let current: Aggregate | null = null;
let refreshing: Promise<void> | null = null;
let started = false; // true once a real server primed the cache (not in tests)

/** Latest aggregate (in-memory). */
export function getAggregate(): Aggregate | null {
  return current;
}

/** True while an aggregate refresh (the cross-project scan) is in flight. */
export function isRefreshing(): boolean {
  return refreshing !== null;
}

/**
 * Single-flight refresh: at most ONE aggregate computation runs at a time across
 * the whole process. Concurrent callers (boot prime + per-request lazy trigger)
 * all await the SAME in-flight run instead of starting their own — this prevents
 * overlapping cross-project scans (the original cause of the RAM blow-up, when
 * overlapping batches each spawned session_analyze.py). The sidebar now reads
 * session JSONLs natively (sessions_native.ts), so this path spawns no Python.
 */
export function refreshAggregate(activeRepo: string, home: string): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const next = await computeAggregate(activeRepo, home, Date.now());
      current = next;
      await writeCacheFile(next);
    } catch { /* keep last good aggregate */ }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/**
 * Lazy trigger for request handlers: kick off a refresh ONLY if the cache is
 * stale/missing AND none is already running. Non-blocking, fire-and-forget.
 */
export function ensureFresh(activeRepo: string, home: string): void {
  if (!started) return; // never trigger heavy scans from a bare createHandler (tests)
  if (refreshing) return;
  if (isFresh(current, ttlMs(), Date.now())) return;
  refreshAggregate(activeRepo, home);
}

/**
 * Prime once on boot: load a fresh cache file if present (no Python spawned),
 * otherwise compute one aggregate (single-flight). NO background timer — staleness
 * is handled lazily via ensureFresh() on request, so nothing churns while idle.
 */
export async function startCache(activeRepo: string, home: string): Promise<void> {
  started = true;
  const fromFile = await readCacheFile();
  if (isFresh(fromFile, ttlMs(), Date.now())) {
    current = fromFile;
    return;
  }
  await refreshAggregate(activeRepo, home);
}
