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
