// File-backed aggregate cache with periodic background refresh.
// Caches the EXPENSIVE shared data: the global layer (skills/agents/hooks/global
// CLAUDE.md — identical for every project) + the multi-project sidebar (open
// tasks + 7d cost per project). The currently-selected project DETAIL stays live
// (computed per request in server.ts), never cached.

import { dirname, join } from "@std/path";
import { collectGlobal } from "./collectors/index.ts";
import { collectSidebar, type SidebarProject } from "./collectors/sidebar.ts";
import { buildContext } from "./context.ts";

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

function cacheFile(): string {
  return Deno.env.get("CC_KNOWLEDGE_CACHE") ??
    join(HOME, ".cache", "cc-knowledge", "cache.json");
}

function ttlMs(): number {
  const v = Number(Deno.env.get("CC_KNOWLEDGE_TTL_MS"));
  return Number.isFinite(v) && v > 0 ? v : 15 * 60 * 1000;
}

/** Pure freshness predicate (testable without IO). */
export function isFresh(agg: Aggregate | null, ttl: number, now: number): boolean {
  return !!agg && (now - agg.generated_at) < ttl;
}

/** Pure freshness predicate fuer Per-Projekt-Cache-Eintraege. */
export function isProjectContextFresh(
  entry: { generated_at: number; context: Record<string, unknown> } | undefined,
  ttl: number,
  now: number,
): boolean {
  return !!entry && (now - entry.generated_at) < ttl;
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

async function computeAggregate(
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
function isRefreshing(): boolean {
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
function refreshAggregate(activeRepo: string, home: string): Promise<void> {
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
async function startCache(activeRepo: string, home: string): Promise<void> {
  started = true;
  const fromFile = await readCacheFile();
  if (isFresh(fromFile, ttlMs(), Date.now())) {
    current = fromFile;
    return;
  }
  await refreshAggregate(activeRepo, home);
}

// ---------------------------------------------------------------------------
// Per-Projekt-Detail-Cache (B2)
// ---------------------------------------------------------------------------
// Jedes Projekt bekommt einen eigenen Cache-Eintrag (TTL + single-flight).
// Verhindert, dass bei jedem GET /cc-setup der teure buildContext (inkl.
// collectTokens mit JSONL-Parsing) komplett neu durchlaeuft.

interface ProjectContextEntry {
  generated_at: number; // epoch ms
  context: Record<string, unknown>;
}

// In-memory Projekt-Cache (kein File-Backing noetig — fluechtiger Prozess-Cache)
const projectContextCache = new Map<string, ProjectContextEntry>();
// Single-flight: aktive Berechnungen pro Projekt
const projectContextInFlight = new Map<string, Promise<Record<string, unknown>>>();
// Generations-Zaehler pro Projekt: wird bei jeder Invalidierung inkrementiert.
// Ein in-flight computeFn merkt sich die Generation bei Start und schreibt das
// Ergebnis NUR in den Cache wenn die Generation unveraendert ist — sonst Verwerfen.
const projectContextGeneration = new Map<string, number>();

/**
 * Liefert den gecachten Projekt-Kontext oder startet eine single-flight Berechnung.
 * `projectKey` = aufgeloester Projektpfad (absoluter Pfad) fuer Konsistenz.
 * `computeFn` = die tatsaechliche buildContext-Berechnung.
 */
export async function getProjectContext(
  projectKey: string,
  computeFn: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  if (!started) {
    // Im Test-Modus (started=false) immer live berechnen — kein Cache
    return await computeFn();
  }

  const now = Date.now();
  const cached = projectContextCache.get(projectKey);
  if (isProjectContextFresh(cached, ttlMs(), now)) {
    return cached!.context;
  }

  // Single-flight: wenn bereits eine Berechnung laeuft, dieselbe awaiten
  const existing = projectContextInFlight.get(projectKey);
  if (existing) return existing;

  // Snapshot der aktuellen Generation: wird nach Abschluss mit dem Ist-Stand
  // verglichen. Hat invalidateProjectContext inzwischen inkrementiert, ist das
  // Ergebnis veraltet → verwerfen, nicht cachen (Race-Fix).
  const genAtStart = projectContextGeneration.get(projectKey) ?? 0;

  const promise = (async () => {
    try {
      const ctx = await computeFn();
      // Nur schreiben wenn keine Invalidierung waehrend des Laufs kam
      if ((projectContextGeneration.get(projectKey) ?? 0) === genAtStart) {
        projectContextCache.set(projectKey, { generated_at: Date.now(), context: ctx });
      }
      return ctx;
    } finally {
      projectContextInFlight.delete(projectKey);
    }
  })();
  projectContextInFlight.set(projectKey, promise);
  return promise;
}

/**
 * Invalidiert den Per-Projekt-Cache-Eintrag — nach Mutations-Aktionen
 * (commit/push/merge/delete/task-status) aufrufen, damit die naechste
 * Anfrage frische Daten sieht statt des alten Caches.
 */
export function invalidateProjectContext(projectKey: string): void {
  projectContextCache.delete(projectKey);
  // Generations-Zaehler inkrementieren: eine in-flight computeFn liest den
  // Zaehler nach Abschluss erneut und verwirft ihr Ergebnis, wenn es sich
  // veraendert hat — so schreibt ein "zu spaet" abgeschlossener Lauf keine
  // veralteten Daten in den Cache (Race-Fix).
  projectContextGeneration.set(
    projectKey,
    (projectContextGeneration.get(projectKey) ?? 0) + 1,
  );
}

/**
 * Boot-Prime fuer das Start-Projekt: einmalig nach startCache aufrufen.
 * Berechnet den Projekt-Kontext fuer das `--cwd`-Repo, damit die erste
 * GET-Anfrage sofort aus dem Cache bedient werden kann.
 * KEIN Prime aller Projekte (vermeide N×-schwere Laeufe).
 */
async function primeProjectContext(
  cwd: string,
  claudeHome: string,
  agg: Aggregate | null,
): Promise<void> {
  if (!started) return;
  // Nur priemen wenn nicht bereits frisch
  if (isProjectContextFresh(projectContextCache.get(cwd), ttlMs(), Date.now())) return;

  try {
    await getProjectContext(cwd, () =>
      buildContext(cwd, claudeHome, {
        projects: agg?.projects ?? [],
        active_project: cwd.split("/").pop()!,
        global: agg?.global,
        skipProject: false,
      }));
  } catch {
    // Boot-Prime ist best-effort; Fehler werden still ignoriert
  }
}

// Fuer Tests: Cache-State resetten
export function _resetProjectContextCacheForTest(): void {
  projectContextCache.clear();
  projectContextInFlight.clear();
  projectContextGeneration.clear();
}

/** Nur fuer Tests: `started`-Flag setzen um Caching-Pfad zu aktivieren. */
export function _setStartedForTest(value: boolean): void {
  started = value;
}
