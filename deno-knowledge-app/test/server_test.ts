import { assertEquals, assertStringIncludes } from "@std/assert";
import { createHandler } from "../src/server.ts";

const handler = createHandler({ cwd: "/tmp", assetsDir: "/tmp" });

Deno.test("GET / returns 200 HTML with 3-pane shell", async () => {
  const res = await handler(new Request("http://127.0.0.1/"));
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("content-type") ?? "", "text/html");
  const text = await res.text();
  // The render produces the browser shell: mp-nav + window.DATA
  assertStringIncludes(text, "mp-nav");
  assertStringIncludes(text, "window.DATA");
});

Deno.test("unknown route returns 404", async () => {
  const res = await handler(new Request("http://127.0.0.1/nope"));
  assertEquals(res.status, 404);
  await res.text();
});
