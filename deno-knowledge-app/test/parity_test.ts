import { assertEquals } from "@std/assert";
import { buildData } from "../src/context.ts";

// Output-parity contract vs knowledge.py: buildData must emit the same coll
// sections and nav groups that the (reused) browser.js depends on. Value-exact
// parity is N/A (live data: sessions/cost/git change per run); this pins the
// STRUCTURAL contract, which is what the rewrite must preserve.

const EMPTY = { cards: {}, projects: [], active_project: "" };

Deno.test("buildData coll has the knowledge.py section contract", () => {
  const coll = buildData(EMPTY).coll as Record<string, unknown>;
  assertEquals(
    Object.keys(coll).sort(),
    [
      "agents",
      "backlog",
      "changelog",
      "decisions",
      "gclaude",
      "hooks",
      "lessons",
      "memory",
      "milestones",
      "pknow",
      "psections",
      "sessions",
      "skills",
      "tn",
    ],
  );
});

Deno.test("buildData nav groups depend on view (global only in overview)", () => {
  const overview = (buildData(EMPTY, "overview").nav as Array<{ g: string }>).map((n) => n.g);
  assertEquals(overview, ["Überblick · alle Projekte", "Global · alle Projekte"]);

  const project = (buildData(EMPTY, "project").nav as Array<{ g: string }>).map((n) => n.g);
  assertEquals(project, ["Übersicht", "Projekt", "Git", "Wissen", "Backlog", "Usage"]);
});

Deno.test("buildData top-level keys are stable", () => {
  assertEquals(
    Object.keys(buildData(EMPTY)).sort(),
    ["active_project", "coll", "cost", "git", "meta", "nav", "overview", "projects"],
  );
});

Deno.test("buildData tn coll carries col=next|blocked|overdue (kanban columns)", () => {
  // Synthetic tn card — no real vault data. desc of an overdue item = scheduled date.
  const ctx = {
    cards: {
      tn: {
        available: true,
        next: [{ title: "N1", status: "action", next_action: "do it" }],
        blocked: [{ title: "B1", status: "blocked" }],
        overdue: [{ title: "O1", status: "action", scheduled: "2026-05-01" }],
      },
    },
    projects: [],
    active_project: "",
  };
  const coll = buildData(ctx, "project").coll as Record<
    string,
    { items: Array<Record<string, unknown>> }
  >;
  assertEquals(coll.tn.items.map((i) => i.col), ["next", "blocked", "overdue"]);
  const overdue = coll.tn.items.find((i) => i.col === "overdue")!;
  assertEquals(overdue.desc, "2026-05-01");
});
