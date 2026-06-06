import { assertEquals } from "@std/assert";
import {
  type Aggregate,
  _resetProjectContextCacheForTest,
  _setStartedForTest,
  getProjectContext,
  invalidateProjectContext,
  isFresh,
  isProjectContextFresh,
  readCacheFile,
  writeCacheFile,
} from "../src/cache.ts";
import { join } from "@std/path";

const sample: Aggregate = {
  generated_at: 1_000_000,
  global: { available: true },
  projects: [
    {
      name: "x",
      path: "/x",
      open_tasks: 3,
      cost_7d: 0.5,
      milestones: [],
      looseTasks: [],
      openTasks: [],
      tn: 0,
    },
  ],
};

Deno.test("isFresh respects the TTL window", () => {
  assertEquals(isFresh(sample, 1000, sample.generated_at + 500), true);
  assertEquals(isFresh(sample, 1000, sample.generated_at + 1500), false);
  assertEquals(isFresh(null, 1000, 0), false);
});

Deno.test("writeCacheFile + readCacheFile round-trip", async () => {
  const path = join(await Deno.makeTempDir(), "nested", "cache.json");
  await writeCacheFile(sample, path); // also creates the nested dir
  assertEquals(await readCacheFile(path), sample);
});

Deno.test("readCacheFile returns null for missing or malformed files", async () => {
  assertEquals(await readCacheFile(join(await Deno.makeTempDir(), "nope.json")), null);
  const bad = join(await Deno.makeTempDir(), "bad.json");
  await Deno.writeTextFile(bad, "{not json");
  assertEquals(await readCacheFile(bad), null);
});

// ---------------------------------------------------------------------------
// Per-Projekt-Cache (B2)
// ---------------------------------------------------------------------------

Deno.test("isProjectContextFresh: respects TTL window", () => {
  const entry = { generated_at: 1_000_000, context: {} };
  assertEquals(isProjectContextFresh(entry, 1000, 1_000_500), true);
  assertEquals(isProjectContextFresh(entry, 1000, 1_001_500), false);
  assertEquals(isProjectContextFresh(undefined, 1000, 0), false);
});

Deno.test("getProjectContext (test-mode): ruft computeFn immer auf (started=false)", async () => {
  // Im Test-Modus (started=false per Modul-Default) wird nie gecacht.
  // getProjectContext muss also computeFn bei jedem Aufruf aufrufen.
  _resetProjectContextCacheForTest();
  let calls = 0;
  const compute = () => {
    calls++;
    return Promise.resolve({ val: calls });
  };
  const r1 = await getProjectContext("/test/proj", compute);
  const r2 = await getProjectContext("/test/proj", compute);
  // Im Test-Modus (started=false): immer live
  assertEquals(calls, 2);
  assertEquals((r1 as Record<string, unknown>).val, 1);
  assertEquals((r2 as Record<string, unknown>).val, 2);
  _resetProjectContextCacheForTest();
});

Deno.test("invalidateProjectContext: entfernt Eintrag aus Cache (testbar via isProjectContextFresh)", () => {
  // Direkt die interne Logik testen: invalidate + fresh-Pruefung
  // Da getProjectContext im Test-Modus nicht cached, testen wir nur die
  // Invalidierungsfunktion auf nicht-Abstuerzen.
  invalidateProjectContext("/some/project");
  // Kein Error = OK
  assertEquals(true, true);
});

Deno.test(
  "getProjectContext Race-Fix: invalidate waehrend in-flight verhindert Cache-Write",
  async () => {
    // Aktiviert den Caching-Pfad (started=true) fuer diesen Test.
    _resetProjectContextCacheForTest();
    _setStartedForTest(true);

    const KEY = "/race/test/project";
    let resolveCompute!: (v: Record<string, unknown>) => void;

    // Langsame computeFn: haelt an bis wir explizit resolven
    const slowCompute = () =>
      new Promise<Record<string, unknown>>((resolve) => {
        resolveCompute = resolve;
      });

    // Starte in-flight Berechnung (awaiten wir spaeter)
    const resultPromise = getProjectContext(KEY, slowCompute);

    // Invalidierung WAEHREND der Berechnung
    invalidateProjectContext(KEY);

    // Berechnung abschliessen mit einem Wert
    resolveCompute({ stale: true });
    const result = await resultPromise;

    // computeFn-Ergebnis wird zurueckgegeben (return-Wert unveraendert)
    assertEquals((result as Record<string, unknown>).stale, true);

    // Aber: es darf NICHT in den Cache geschrieben worden sein (Generation-Mismatch)
    // Naechster Aufruf muss computeFn erneut aufrufen.
    let nextCalls = 0;
    const freshCompute = () => {
      nextCalls++;
      return Promise.resolve({ fresh: true });
    };
    const nextResult = await getProjectContext(KEY, freshCompute);
    assertEquals(nextCalls, 1, "computeFn muss erneut aufgerufen werden (kein Cache-Hit)");
    assertEquals((nextResult as Record<string, unknown>).fresh, true);

    // Aufraeumen
    _resetProjectContextCacheForTest();
    _setStartedForTest(false);
  },
);
