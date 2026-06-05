import { assertEquals } from "@std/assert";
import { type Aggregate, isFresh, readCacheFile, writeCacheFile } from "../src/cache.ts";
import { join } from "@std/path";

const sample: Aggregate = {
  generated_at: 1_000_000,
  global: { available: true },
  projects: [
    { name: "x", path: "/x", open_tasks: 3, cost_7d: 0.5, milestones: [], looseTasks: [], tn: 0 },
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
