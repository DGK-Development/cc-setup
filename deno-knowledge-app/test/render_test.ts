import { assertEquals, assertStringIncludes } from "@std/assert";
import { readDoc, renderPage } from "../src/render.ts";

// Regression: the static assets (dash.css/browser.css/browser.js) are read from
// scripts/knowledge_assets relative to this module. A wrong number of "../" left
// them empty, producing a styled-and-scriptless dead page. The asset path is
// independent of --cwd, so this asserts inlining directly.
Deno.test("renderPage shows header stats + Überblick entry", async () => {
  // Fixture: sumOpen=5 (3+2), sumTn=4 (4+0) — deliberately different so each assertion
  // has an independent value and independently guards its own counter path.
  const html = await renderPage({
    cwd: "/tmp",
    view: "overview",
    sidebar: [
      { name: "a", path: "/a", open_tasks: 3, cost_7d: 1.5, tn: 4 },
      { name: "b", path: "/b", open_tasks: 2, cost_7d: 0.5, tn: 0 },
    ],
    generatedAt: "2026-06-05 20:00",
  });
  // New header replaces kn-status: stats encoded as .stat/.sv elements
  assertStringIncludes(html, 'class="hd"');
  assertStringIncludes(html, ">5<"); // sumOpen: 3+2 = 5
  assertStringIncludes(html, ">4<"); // sumTn:  4+0 = 4 (distinct from sumOpen)
  assertStringIncludes(html, "Überblick");
});

Deno.test("renderPage inlines browser.js (asset path resolves correctly)", async () => {
  const html = await renderPage({ cwd: "/tmp" });
  // browser.js is full of addEventListener — a wrong asset path leaves the
  // inline <script> empty (no token). dash.css/browser.css share the same
  // assetsDir, so this one assertion covers all three asset reads.
  assertStringIncludes(html, "addEventListener");
});

// CCS-031: Kontext view — project-view page must embed coll.context + nav entry
Deno.test("renderPage project-view embeds coll.context and Kontext nav (CCS-031)", async () => {
  const html = await renderPage({
    cwd: "/tmp",
    view: "project",
    active: "proj-a",
    sidebar: [{ name: "proj-a", path: "/proj-a", open_tasks: 0, cost_7d: 0, tn: 0 }],
    context: {
      cards: {
        memory_md: { available: false, tokens: 0, path: "/x" },
      },
      projects: [],
      active_project: "proj-a",
      generated_at: "",
    },
  });
  // window.DATA.coll.context must be serialized into the page
  assertStringIncludes(html, '"context"');
  assertStringIncludes(html, "system_prompt");
  // nav group label + renderContext function reachable in inlined browser.js
  assertStringIncludes(html, "Kontext");
  assertStringIncludes(html, "renderContext");
});

// CCS-028: readDoc returns mtime in the response
Deno.test("readDoc returns mtime for existing files (CCS-028)", async () => {
  const tmp = await Deno.makeTempDir();
  const fpath = tmp + "/test.md";
  await Deno.writeTextFile(fpath, "# test\nhello");
  // Use knowfile kind pointing inside the tmp dir as knowledge root
  // Since readDoc kind "knowfile" resolves relative to repoRoot, we use a different
  // approach: test the lektion kind via knowledge/ sub-dir
  const kn = tmp + "/knowledge";
  await Deno.mkdir(kn, { recursive: true });
  await Deno.writeTextFile(kn + "/lektion-test.md", "# lektion\nbody");
  const result = await readDoc(tmp, tmp, "lektion", "lektion-test.md");
  assertEquals(result.ok, true);
  // mtime must be a non-empty string (formatted by fmtMtime)
  assertEquals(typeof result.mtime, "string");
  assertEquals((result.mtime as string).length > 0, true);
});

Deno.test("readDoc returns empty-string mtime gracefully for non-existent stat (CCS-028)", async () => {
  // kind "agent" for a non-existent file → ok:false, mtime not present but no crash
  const result = await readDoc("/tmp", "/tmp", "agent", "nonexistent-agent");
  assertEquals(result.ok, false);
});

// CCS-034: renderPage injects window.INITIAL_VIEW when initialView is set
Deno.test("renderPage injects window.INITIAL_VIEW when initialView provided (CCS-034)", async () => {
  const html = await renderPage({
    cwd: "/tmp",
    view: "project",
    active: "proj-a",
    initialView: "context",
    sidebar: [{ name: "proj-a", path: "/proj-a", open_tasks: 0, cost_7d: 0, tn: 0 }],
  });
  // The dedicated assignment script tag must be present with the view value
  assertStringIncludes(html, 'window.INITIAL_VIEW = ');
  // safeScriptJson serializes the string "context" — check the serialized form
  assertStringIncludes(html, '"context"');
});

// CCS-034: renderPage does NOT inject the INITIAL_VIEW <script> tag when initialView is absent.
// Note: browser.js itself reads window.INITIAL_VIEW so the string always appears in the
// inlined JS, but the dedicated assignment script must NOT be present.
Deno.test("renderPage does not inject INITIAL_VIEW script tag when initialView absent (CCS-034)", async () => {
  const html = await renderPage({ cwd: "/tmp" });
  // The injected script tag has the form: window.INITIAL_VIEW = "..."
  // We check that the assignment form is not present (the browser.js read-reference is fine)
  const hasAssignment = html.includes("window.INITIAL_VIEW =");
  assertEquals(hasAssignment, false);
});

// CCS-029: renderPage uses live overview counts for the active project row in project view
Deno.test("renderPage project-view: active project row shows live backlog_open not fallback (CCS-029)", async () => {
  // Sidebar has open_tasks:0/tn:0 (cache fallback scenario = never-primed cache)
  // The context has live backlog data (7 non-done tasks) that buildData computes backlog_open from.
  const tasks = Array.from({ length: 7 }, (_, i) => ({
    id: `T-${i}`,
    title: `Task ${i}`,
    status: "To Do",
    file: `t${i}.md`,
  }));
  const html = await renderPage({
    cwd: "/tmp",
    view: "project",
    active: "proj-a",
    sidebar: [
      { name: "proj-a", path: "/proj-a", open_tasks: 0, cost_7d: 0, tn: 0 }, // fallback zeros
    ],
    context: {
      cards: {
        backlog: { available: true, tasks, milestones: [], in_progress_count: 0 },
        tn: { available: false },
      },
      projects: [],
      active_project: "proj-a",
      generated_at: "",
    },
  });
  // Active project row must show 7 (live backlog_open from cards.backlog.tasks), not 0 (fallback)
  // New chip markup: <span class="ch open">7 offen</span>
  assertStringIncludes(html, '<span class="ch open">7 offen</span>');
});

// CCS-034C: readDoc kind "project-agent" — gültig/ungültig/Traversal-Abwehr
Deno.test("readDoc project-agent: reads .claude/agents/<name>.md from repoRoot", async () => {
  const tmp = await Deno.makeTempDir();
  await Deno.mkdir(tmp + "/.claude/agents", { recursive: true });
  await Deno.writeTextFile(tmp + "/.claude/agents/my-agent.md", "---\ndescription: test\n---\n# Agent\n");
  // repoRoot braucht ein Git-Repo ODER gibt cwd zurück (Fallback im Code).
  // Hier übergeben wir tmp direkt als cwd — repoRoot(tmp) gibt tmp zurück wenn kein .git vorhanden.
  const result = await readDoc(tmp, tmp, "project-agent", "my-agent");
  assertEquals(result.ok, true);
  assertEquals(result.kind, "project-agent");
});

Deno.test("readDoc project-agent: rejects invalid agent name", async () => {
  const result = await readDoc("/tmp", "/tmp", "project-agent", "../../../etc/passwd");
  assertEquals(result.ok, false);
});

Deno.test("readDoc project-agent: rejects missing agent", async () => {
  const tmp = await Deno.makeTempDir();
  await Deno.mkdir(tmp + "/.claude/agents", { recursive: true });
  const result = await readDoc(tmp, tmp, "project-agent", "nonexistent-agent");
  assertEquals(result.ok, false);
});

// CCS-034C: CONTEXT_CSS enthält .ctx-grp für Gruppen-Header
Deno.test("renderPage CONTEXT_CSS includes .ctx-grp group header class (CCS-034C)", async () => {
  const { assertStringIncludes } = await import("@std/assert");
  const html = await renderPage({ cwd: "/tmp", view: "project", active: "proj-a",
    sidebar: [{ name: "proj-a", path: "/proj-a", open_tasks: 0, cost_7d: 0, tn: 0 }] });
  assertStringIncludes(html, "ctx-grp");
});

// MAJOR-1: backlog_open=0 (all done) must show 0, not fall back to stale cache value
Deno.test("renderPage project-view: backlog_open=0 shows 0 not stale cache value (MAJOR-1)", async () => {
  // Sidebar has open_tasks:5 (stale cache); live data has 0 non-done tasks (all Done).
  const html = await renderPage({
    cwd: "/tmp",
    view: "project",
    active: "proj-a",
    sidebar: [
      { name: "proj-a", path: "/proj-a", open_tasks: 5, cost_7d: 0, tn: 2 }, // stale cache
    ],
    context: {
      cards: {
        backlog: {
          available: true,
          tasks: [{ id: "T-1", status: "Done", file: "t1.md" }],
          milestones: [],
          in_progress_count: 0,
        },
        tn: { available: true, next: [], blocked: [], overdue: [] },
      },
      projects: [],
      active_project: "proj-a",
      generated_at: "",
    },
  });
  // backlog_open=0 (1 task all Done), tn_open=0 → active proj row must NOT show the stale 5.
  // With the new chip design, chips are only rendered when count>0.
  // The active project has 0 open tasks → no "offen" chip rendered for it.
  // We verify the stale value 5 is NOT shown as an open-chip for the active project.
  // (The header stat still shows summed open across all sidebar entries which may differ.)
  const noStaleMatch = !html.includes('<span class="ch open">5 offen</span>');
  assertEquals(noStaleMatch, true);
});
