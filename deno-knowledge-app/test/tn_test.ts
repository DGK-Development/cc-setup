import { assertEquals } from "@std/assert";
import { pickOverdue } from "../src/collectors/tn.ts";

// Synthetic fixtures only — no real tn/vault data (org rule: tn is customer-/
// person-related; never pull tn content into context). See deno-knowledge-tn-org-block.
const TASKS = [
  {
    id: "1",
    title: "past",
    status: "action",
    scheduled: "2026-05-01",
    project: "p",
    next_action: "",
  },
  {
    id: "2",
    title: "today",
    status: "action",
    scheduled: "2026-06-05",
    project: "p",
    next_action: "",
  },
  {
    id: "3",
    title: "future",
    status: "action",
    scheduled: "2026-07-01",
    project: "p",
    next_action: "",
  },
  {
    id: "4",
    title: "done-past",
    status: "done",
    scheduled: "2026-05-02",
    project: "p",
    next_action: "",
  },
  {
    id: "5",
    title: "blocked-past",
    status: "action",
    scheduled: "2026-04-01",
    project: "p",
    next_action: "",
  },
  { id: "6", title: "no-sched", status: "action", scheduled: "", project: "p", next_action: "" },
  {
    id: "7",
    title: "older",
    status: "action",
    scheduled: "2026-03-01",
    project: "p",
    next_action: "",
  },
];

Deno.test("pickOverdue: scheduled<today, not done, not blocked, sorted ascending", () => {
  const out = pickOverdue(TASKS, "2026-06-05", new Set(["5"]));
  // today (2) excluded (not strictly <), future (3) excluded, done (4) excluded,
  // blocked (5) excluded, no-sched (6) excluded → 7 (03-01) then 1 (05-01).
  assertEquals(out.map((t) => t.id), ["7", "1"]);
});

Deno.test("pickOverdue: ISO datetime scheduled is truncated to date", () => {
  const out = pickOverdue(
    [{
      id: "a",
      title: "x",
      status: "action",
      scheduled: "2026-06-04T09:30",
      project: "p",
      next_action: "",
    }],
    "2026-06-05T00:00",
    new Set(),
  );
  assertEquals(out.map((t) => t.id), ["a"]);
});

Deno.test("pickOverdue: empty when nothing overdue", () => {
  const out = pickOverdue(
    [{
      id: "a",
      title: "x",
      status: "action",
      scheduled: "2026-12-31",
      project: "p",
      next_action: "",
    }],
    "2026-06-05",
    new Set(),
  );
  assertEquals(out, []);
});
