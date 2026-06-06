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
      "context", // CCS-031: additive Kontext view collection
      "decisions",
      "docs",
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
  assertEquals(project, ["Übersicht", "Projekt", "Git", "Wissen", "Backlog", "Usage", "Kontext"]);
});

Deno.test("buildData top-level keys are stable", () => {
  assertEquals(
    Object.keys(buildData(EMPTY)).sort(),
    ["active_project", "coll", "cost", "git", "meta", "nav", "overview", "projects"],
  );
});

// CCS-030 / CCS-019: Backlog nav-group has "boards" only (tn-Board nav-entry removed in CCS-019)
Deno.test("buildData project-view Backlog nav-group has boards entry only (CCS-019)", () => {
  const nav = buildData(EMPTY, "project").nav as Array<
    { g: string; items: Array<{ id: string; cnt?: string }> }
  >;
  const backlogGroup = nav.find((g) => g.g === "Backlog");
  assertEquals(backlogGroup !== undefined, true);
  assertEquals(backlogGroup!.items.map((i) => i.id), ["boards"]);
  // boards item must have cnt in "N / M" format
  const boardsItem = backlogGroup!.items.find((i) => i.id === "boards");
  assertEquals(typeof boardsItem!.cnt, "string");
  assertEquals(boardsItem!.cnt!.includes(" / "), true);
});

// CCS-025: overview.backlog_open = count of non-done tasks from bl.tasks
Deno.test("buildData overview.backlog_open counts non-done tasks (incl. completed/)", () => {
  const ctx = {
    cards: {
      backlog: {
        available: true,
        tasks: [
          { id: "T-1", status: "To Do" },
          { id: "T-2", status: "In Progress" },
          { id: "T-3", status: "Done" }, // not open
          { id: "T-4", status: "done" }, // not open (lowercase)
        ],
        milestones: [],
        in_progress_count: 1,
      },
    },
    projects: [],
    active_project: "",
  };
  const overview = buildData(ctx).overview as Record<string, unknown>;
  assertEquals(overview.backlog_open, 2);
});

// CCS-025: overview.tn_open = next + blocked + overdue (project-scoped, org-konform)
Deno.test("buildData overview.tn_open sums next+blocked+overdue (project-scoped)", () => {
  const ctx = {
    cards: {
      tn: {
        available: true,
        next: [{ title: "N1" }, { title: "N2" }],
        blocked: [{ title: "B1" }],
        overdue: [{ title: "O1" }, { title: "O2" }, { title: "O3" }],
      },
    },
    projects: [],
    active_project: "",
  };
  const overview = buildData(ctx).overview as Record<string, unknown>;
  assertEquals(overview.tn_open, 6); // 2 + 1 + 3
});

Deno.test("buildData overview.tn_open is 0 when tn unavailable", () => {
  const overview = buildData(EMPTY).overview as Record<string, unknown>;
  assertEquals(overview.tn_open, 0);
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

// CCS-027: tn items carry `id` field for dblclick tn-note fetch
Deno.test("buildData tn coll items carry id field (CCS-027)", () => {
  const ctx = {
    cards: {
      tn: {
        available: true,
        next: [{ id: "TN-001", title: "N1", status: "action", next_action: "do it", project: "x" }],
        blocked: [{ id: "TN-002", title: "B1", status: "blocked", project: "x" }],
        overdue: [{
          id: "TN-003",
          title: "O1",
          status: "overdue",
          scheduled: "2026-05-01",
          project: "x",
        }],
      },
    },
    projects: [],
    active_project: "",
  };
  const coll = buildData(ctx, "project").coll as Record<
    string,
    { items: Array<Record<string, unknown>> }
  >;
  assertEquals(coll.tn.items[0].id, "TN-001");
  assertEquals(coll.tn.items[1].id, "TN-002");
  assertEquals(coll.tn.items[2].id, "TN-003");
});

// CCS-026: coll.milestones uses openTasks when available (non-done board items)
Deno.test("buildData coll.milestones uses openTasks from context.projects (CCS-026)", () => {
  const ctx = {
    cards: {},
    projects: [
      {
        name: "proj-a",
        openTasks: [
          {
            id: "T-1",
            title: "Alpha",
            status: "To Do",
            milestone: "m1",
            project: "proj-a",
            file: "t1.md",
          },
          {
            id: "T-2",
            title: "Beta",
            status: "In Progress",
            milestone: "",
            project: "proj-a",
            file: "t2.md",
          },
        ],
      },
    ],
    active_project: "",
  };
  const coll = buildData(ctx).coll as Record<string, { items: Array<Record<string, unknown>> }>;
  assertEquals(coll.milestones.items.length, 2);
  assertEquals(coll.milestones.items[0].name, "T-1");
  assertEquals(coll.milestones.items[0].project, "proj-a");
  assertEquals(coll.milestones.items[1].name, "T-2");
  // done=false for all (board items should not be collapsed)
  assertEquals(coll.milestones.items.every((i) => i.done === false), true);
});

// CCS-030: overview.backlog_open / tn_open reuse pre-computed values (Item 3)
Deno.test("buildData overview.backlog_open and boards nav cnt use same value (CCS-030)", () => {
  const ctx = {
    cards: {
      backlog: {
        available: true,
        tasks: [
          { id: "T-1", status: "To Do" },
          { id: "T-2", status: "In Progress" },
          { id: "T-3", status: "Done" },
        ],
        milestones: [],
        in_progress_count: 1,
      },
      tn: {
        available: true,
        next: [{ title: "N1" }, { title: "N2" }],
        blocked: [{ title: "B1" }],
        overdue: [],
      },
    },
    projects: [],
    active_project: "",
  };
  const d = buildData(ctx, "project");
  const overview = d.overview as Record<string, unknown>;
  assertEquals(overview.backlog_open, 2); // 2 non-done tasks
  assertEquals(overview.tn_open, 3); // 2 next + 1 blocked
  // nav boards item cnt should reflect same values
  const nav = d.nav as Array<{ g: string; items: Array<{ id: string; cnt?: string }> }>;
  const backlogGroup = nav.find((g) => g.g === "Backlog")!;
  const boardsItem = backlogGroup.items.find((i) => i.id === "boards")!;
  assertEquals(boardsItem.cnt, "2 / 3");
});

// CCS-030: overview proj_skills/proj_hooks/proj_agents/proj_init_tok from project card (Item 4)
Deno.test("buildData overview includes proj_settings fields from project card (CCS-030)", () => {
  const ctx = {
    cards: {
      project: {
        available: true,
        repo: "test",
        branch: "main",
        claude_md_headers: [],
        claude_md_tokens: 500,
        claude_md_size: 0,
        knowledge_index: [],
        proj_skills_count: 3,
        proj_agents_count: 2,
        proj_hooks_count: 5,
      },
      global: {
        available: true,
        skills: { count: 0, names: [], items: [] },
        agents: [],
        agent_items: [],
        claude_md: { headers: [], tokens: 1000, size_bytes: 0, managed_block: false },
        settings: { hook_events: {}, hook_detail: {} },
      },
    },
    projects: [],
    active_project: "",
  };
  const overview = buildData(ctx).overview as Record<string, unknown>;
  assertEquals(overview.proj_skills, 3);
  assertEquals(overview.proj_agents, 2);
  assertEquals(overview.proj_hooks, 5);
  // proj_init_tok = global tokens (1000) + project tokens (500) → formatted
  assertEquals(typeof overview.proj_init_tok, "string");
  assertEquals((overview.proj_init_tok as string).length > 0, true);
});

// CCS-030: memory/lessons items have date field (Item 1)
Deno.test("buildData memory and lessons items carry date field from mtime (CCS-030)", () => {
  const ctx = {
    cards: {
      knowledge: {
        available: true,
        decisions: [],
        lektionen: [
          { name: "lektion-001.md", mtime: 1717200000 },
          { name: "lektion-002.md", mtime: 1717100000 },
        ],
        memory: [
          { name: "mem-a.md", mtime: 1717300000 },
          { name: "mem-b.md", mtime: 1717250000 },
        ],
        changelog: [],
        docs: [],
      },
    },
    projects: [],
    active_project: "",
  };
  const coll = buildData(ctx).coll as Record<string, { items: Array<Record<string, unknown>> }>;
  // memory items should have non-empty date
  const memItems = coll.memory.items;
  assertEquals(memItems.length, 2);
  assertEquals(typeof memItems[0].date, "string");
  assertEquals((memItems[0].date as string).length > 0, true);
  // lessons items should have non-empty date
  const lessonItems = coll.lessons.items;
  assertEquals(lessonItems.length, 2);
  assertEquals(typeof lessonItems[0].date, "string");
  assertEquals((lessonItems[0].date as string).length > 0, true);
});

// CCS-030: backward-compat — old string[] shape for memory/lektionen is handled (Item 1)
Deno.test("buildData handles old string-array shape for memory/lektionen (CCS-030 compat)", () => {
  const ctx = {
    cards: {
      knowledge: {
        available: true,
        decisions: [],
        lektionen: ["lektion-001.md", "lektion-002.md"],
        memory: ["mem-a.md"],
        changelog: [],
        docs: [],
      },
    },
    projects: [],
    active_project: "",
  };
  const coll = buildData(ctx).coll as Record<string, { items: Array<Record<string, unknown>> }>;
  assertEquals(coll.memory.items.length, 1);
  assertEquals(coll.memory.items[0].name, "mem-a.md");
  assertEquals(coll.memory.items[0].date, ""); // old shape → empty date
  assertEquals(coll.lessons.items.length, 2);
  assertEquals(coll.lessons.items[0].date, "");
});
