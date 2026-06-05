// File-backed aggregate cache with periodic background refresh.
// Caches the EXPENSIVE shared data: the global layer (skills/agents/hooks/global
// CLAUDE.md — identical for every project) + the multi-project sidebar (open
// tasks + 7d cost per project). The currently-selected project DETAIL stays live
// (computed per request in server.ts), never cached.

import { dirname, join } from "@std/path";
import { collectGlobal } from "./collectors/index.ts";
import { collectSidebar, type SidebarProject } from "./collectors/sidebar.ts";

const HOME = Deno.env.get("HOME") ?? "/tmp";

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
  return Number.isFinite(v) && v > 0 ? v : 5 * 60 * 1000;
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

/** Latest aggregate (in-memory, kept fresh by the background timer). */
export function getAggregate(): Aggregate | null {
  return current;
}

/**
 * Prime the cache (from a fresh file, else compute) and start periodic refresh.
 * The timer is unref'd so it never keeps the process alive on its own.
 */
export async function startCache(activeRepo: string, home: string): Promise<void> {
  const ttl = ttlMs();
  const fromFile = await readCacheFile();
  if (isFresh(fromFile, ttl, Date.now())) {
    current = fromFile;
  } else {
    current = await computeAggregate(activeRepo, home, Date.now());
    await writeCacheFile(current);
  }
  const timer = setInterval(async () => {
    try {
      const next = await computeAggregate(activeRepo, home, Date.now());
      current = next;
      await writeCacheFile(next);
    } catch { /* keep last good aggregate */ }
  }, ttl);
  Deno.unrefTimer(timer);
}
