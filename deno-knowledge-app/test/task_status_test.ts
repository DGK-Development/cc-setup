import { assertEquals } from "@std/assert";
import { setTaskStatus } from "../src/collectors/backlog.ts";

// Validation happens BEFORE any `backlog` CLI call, so these never mutate anything.
Deno.test("setTaskStatus rejects an invalid task id", async () => {
  const r = await setTaskStatus("/tmp", "not a valid id!", "To Do");
  assertEquals(r.ok, false);
  assertEquals(r.error, "ungültige Task-ID");
});

Deno.test("setTaskStatus rejects a status outside the allowed columns", async () => {
  const r = await setTaskStatus("/tmp", "CCS-1", "Bogus");
  assertEquals(r.ok, false);
  assertEquals(r.error, "ungültiger Status");
});
