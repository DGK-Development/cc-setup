import { assertEquals } from "@std/assert";
import { parseJson, run } from "../src/shared.ts";

Deno.test("run() returns trimmed stdout on success", async () => {
  assertEquals(await run(["echo", "hello"]), "hello");
});

Deno.test("run() returns null on non-zero exit", async () => {
  assertEquals(await run(["sh", "-c", "exit 3"]), null);
});

Deno.test("run() returns null when the binary is missing", async () => {
  assertEquals(await run(["definitely-not-a-real-binary-xyz-42"]), null);
});

Deno.test("parseJson() parses valid JSON", () => {
  assertEquals(parseJson('{"a":1}'), { a: 1 });
});

Deno.test("parseJson() returns null on malformed or empty input", () => {
  assertEquals(parseJson("{not json"), null);
  assertEquals(parseJson(""), null);
  assertEquals(parseJson(null), null);
});
