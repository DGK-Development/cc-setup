import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  encodeCwd,
  estCost,
  fileCost,
  sevenDayCostNative,
} from "../src/collectors/sessions_native.ts";
import { join } from "@std/path";

Deno.test("estCost applies the per-MTok rates", () => {
  assertAlmostEquals(estCost(1_000_000, 0, 0, 0), 3.0);
  assertAlmostEquals(estCost(0, 1_000_000, 0, 0), 15.0);
  assertAlmostEquals(estCost(0, 0, 1_000_000, 1_000_000), 0.30 + 3.75);
});

Deno.test("encodeCwd maps non-alphanumerics to '-'", () => {
  assertEquals(encodeCwd("/Users/x/GITHUB_DG/cc-setup"), "-Users-x-GITHUB-DG-cc-setup");
});

Deno.test("fileCost sums message.usage tokens across JSONL lines, ignores non-usage", () => {
  // Built inline so the test owns the fixture content.
  return (async () => {
    const f = join(await Deno.makeTempDir(), "s.jsonl");
    const lines = [
      JSON.stringify({ type: "user", message: { content: "hi" } }), // no usage
      JSON.stringify({ message: { usage: { input_tokens: 1_000_000, output_tokens: 0 } } }),
      JSON.stringify({ message: { usage: { cache_read_input_tokens: 1_000_000 } } }),
      "", // blank line tolerated
      "{not json", // malformed tolerated
    ];
    await Deno.writeTextFile(f, lines.join("\n"));
    // 1M input → $3.00 ; 1M cache_read → $0.30
    assertAlmostEquals(await fileCost(f), 3.30);
  })();
});

Deno.test("sevenDayCostNative counts only JSONLs with mtime in the last 7 days", async () => {
  const base = await Deno.makeTempDir();
  Deno.env.set("CLAUDE_PROJECTS_DIR", base);
  const cwd = "/proj/alpha";
  const dir = join(base, encodeCwd(cwd));
  await Deno.mkdir(dir, { recursive: true });

  const recent = join(dir, "recent.jsonl");
  const old = join(dir, "old.jsonl");
  const entry = JSON.stringify({ message: { usage: { input_tokens: 1_000_000 } } });
  await Deno.writeTextFile(recent, entry); // $3.00, fresh
  await Deno.writeTextFile(old, entry); // $3.00 but backdated below

  const now = Date.now();
  const eightDaysAgo = new Date(now - 8 * 24 * 3600 * 1000);
  await Deno.utime(old, eightDaysAgo, eightDaysAgo);

  // Only the recent file counts.
  assertAlmostEquals(await sevenDayCostNative(cwd, now), 3.0);
  Deno.env.delete("CLAUDE_PROJECTS_DIR");
});
