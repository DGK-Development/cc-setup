import { assertEquals } from "@std/assert";
import { _resetHookCache, collectHookInject } from "../src/collectors/hook_inject.ts";
import { estTokens } from "../src/md.ts";

Deno.test("collectHookInject: tokens = estTokens(output) via injected runner", async () => {
  _resetHookCache();
  const out = "=== SESSION START ===\nCWD: /x\nBacklog: 3 open\n";
  const r = await collectHookInject("/proj-a", () => Promise.resolve({ ok: true, output: out }));
  assertEquals(r.ok, true);
  assertEquals(r.output, out);
  assertEquals(r.tokens, estTokens(out));
});

Deno.test("collectHookInject: failed runner → ok:false, tokens 0, error passed through", async () => {
  _resetHookCache();
  const r = await collectHookInject(
    "/proj-fail",
    () => Promise.resolve({ ok: false, output: "", error: "Hook nicht gefunden" }),
  );
  assertEquals(r.ok, false);
  assertEquals(r.tokens, 0);
  assertEquals(r.error, "Hook nicht gefunden");
});

Deno.test("collectHookInject: single-flight — two parallel calls run the runner ONCE", async () => {
  _resetHookCache();
  let calls = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((res) => (release = res));
  const runner = async (_cwd: string) => {
    calls++;
    await gate; // hold both callers in-flight until released
    return { ok: true, output: "hook output" };
  };
  const p1 = collectHookInject("/proj-sf", runner);
  const p2 = collectHookInject("/proj-sf", runner);
  release();
  const [r1, r2] = await Promise.all([p1, p2]);
  assertEquals(calls, 1); // both awaited the SAME in-flight run
  assertEquals(r1.tokens, r2.tokens);
  assertEquals(r1.output, "hook output");
});

Deno.test("collectHookInject: TTL cache — second call within TTL does NOT re-run the runner", async () => {
  _resetHookCache();
  let calls = 0;
  const runner = (_cwd: string) => {
    calls++;
    return Promise.resolve({ ok: true, output: "cached output" });
  };
  const r1 = await collectHookInject("/proj-ttl", runner);
  const r2 = await collectHookInject("/proj-ttl", runner); // fresh cache hit
  assertEquals(calls, 1);
  assertEquals(r1.tokens, r2.tokens);
  assertEquals(r2.output, "cached output");
});

Deno.test("collectHookInject: cache is per-cwd — different cwd runs the runner again", async () => {
  _resetHookCache();
  let calls = 0;
  const runner = (_cwd: string) => {
    calls++;
    return Promise.resolve({ ok: true, output: "out" });
  };
  await collectHookInject("/proj-1", runner);
  await collectHookInject("/proj-2", runner); // different cwd → not cached
  assertEquals(calls, 2);
});
