// Tests for all collectors — TDD, RED first, then GREEN.
// Mirrors test_knowledge.py fixture patterns: injected temp dirs, no network.

import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import {
  collectBacklog,
  collectCost,
  collectGit,
  collectGlobal,
  collectKnowledge,
  collectProject,
} from "../src/collectors/index.ts";
import { buildData, discoverProjects, resolveProjectCwd } from "../src/context.ts";
import { safeScriptJson } from "../src/render.ts";
import { parseDecisionsMd } from "../src/collectors/knowledge.ts";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function write(path: string, content: string): Promise<void> {
  const parts = path.split("/");
  const dir = parts.slice(0, -1).join("/");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(path, content);
}

// ---------------------------------------------------------------------------
// parseDecisionsMd
// ---------------------------------------------------------------------------

Deno.test("parseDecisionsMd: extracts id, title, status", () => {
  const text = "## 001 — First decision\nStatus: accepted\nrationale line\n\n" +
    "## 002 -- Second\n- **Status:** rejected\n";
  const out = parseDecisionsMd(text);
  assertEquals(out.map((d) => [d.id, d.title, d.status]), [
    ["001", "First decision", "accepted"],
    ["002", "Second", "rejected"],
  ]);
  assertStringIncludes(out[0].body, "rationale line");
});

// ---------------------------------------------------------------------------
// collect_global
// ---------------------------------------------------------------------------

Deno.test("collectGlobal: missing home returns unavailable", async () => {
  const tmp = await Deno.makeTempDir();
  const res = await collectGlobal(`${tmp}/nope`);
  assertEquals(res.available, false);
  assertStringIncludes(String(res.reason), "not found");
});

Deno.test("collectGlobal: managed block detected", async () => {
  const tmp = await Deno.makeTempDir();
  await write(`${tmp}/CLAUDE.md`, "## A\nx\n<!-- BEGIN cc-setup -->\ny\n<!-- END cc-setup -->\n");
  const res = await collectGlobal(tmp);
  assertEquals(res.available, true);
  assertEquals((res.claude_md as Record<string, unknown>).managed_block, true);
  assertEquals((res.claude_md as Record<string, unknown>).headers, ["A"]);
});

Deno.test("collectGlobal: no managed block", async () => {
  const tmp = await Deno.makeTempDir();
  await write(`${tmp}/CLAUDE.md`, "## Only\n");
  const res = await collectGlobal(tmp);
  assertEquals((res.claude_md as Record<string, unknown>).managed_block, false);
});

Deno.test("collectGlobal: skills and agents enumerated", async () => {
  const tmp = await Deno.makeTempDir();
  await Deno.mkdir(`${tmp}/skills/audit`, { recursive: true });
  await Deno.mkdir(`${tmp}/skills/qmd`, { recursive: true });
  await Deno.mkdir(`${tmp}/skills/_old`, { recursive: true }); // excluded
  await write(
    `${tmp}/skills/audit/SKILL.md`,
    "---\nname: audit\ndescription: Audit a project.\n---\n# Audit\nbody\n",
  );
  await Deno.mkdir(`${tmp}/agents`, { recursive: true });
  await write(`${tmp}/agents/Engineer.md`, "x");
  await write(`${tmp}/agents/Architect.md`, "x");

  const res = await collectGlobal(tmp);
  const skills = res.skills as Record<string, unknown>;
  assertEquals((skills.names as string[]).sort(), ["audit", "qmd"]);
  assertEquals(skills.count, 2);
  const items = skills.items as Array<Record<string, unknown>>;
  const audit = items.find((i) => i.name === "audit")!;
  assertEquals(audit.description, "Audit a project.");
  assertEquals(audit.has_md, true);
  const qmd = items.find((i) => i.name === "qmd")!;
  assertEquals(qmd.has_md, false);
  assertEquals((res.agents as string[]).sort(), ["Architect", "Engineer"]);
});

Deno.test("collectGlobal: settings hook events present, env never leaks", async () => {
  const tmp = await Deno.makeTempDir();
  const cmd = "/Users/x/.claude/hooks/redactor.py wrap";
  const settings = {
    env: { OBSIDIAN_VAULT_PATH: "/secret/value" },
    hooks: {
      SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: cmd }] }],
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: cmd }] },
        { matcher: "Write", hooks: [{ type: "command", command: cmd }] },
      ],
    },
  };
  await write(`${tmp}/settings.json`, JSON.stringify(settings));
  const res = await collectGlobal(tmp);
  const s = res.settings as Record<string, unknown>;
  const events = s.hook_events as Record<string, number>;
  assertEquals(events.SessionStart, 1);
  assertEquals(events.PreToolUse, 2);
  const detail = s.hook_detail as Record<string, Array<Record<string, string>>>;
  assertEquals(detail.PreToolUse[0].matcher, "Bash");
  // env VALUES must never appear in output
  assertEquals(JSON.stringify(res).includes("/secret/value"), false);
});

// ---------------------------------------------------------------------------
// collect_project
// ---------------------------------------------------------------------------

Deno.test("collectProject: knowledge index parsed, headers extracted", async () => {
  const tmp = await Deno.makeTempDir();
  await write(`${tmp}/CLAUDE.md`, "# Project\n## Rules\n");
  await write(
    `${tmp}/knowledge/README.md`,
    "## Index\n- [Lektion A](a.md) — desc\n- [HTML B](b.html) — more\n",
  );
  const res = await collectProject(tmp);
  assertEquals(res.available, true);
  assertEquals(res.claude_md_headers, ["Project", "Rules"]);
  const ki = res.knowledge_index as Array<Record<string, string>>;
  assertEquals(ki.map((e) => e.title), ["Lektion A", "HTML B"]);
});

// ---------------------------------------------------------------------------
// collect_knowledge
// ---------------------------------------------------------------------------

Deno.test("collectKnowledge: backlog/decisions fallback", async () => {
  const tmp = await Deno.makeTempDir();
  await Deno.mkdir(`${tmp}/backlog/decisions`, { recursive: true });
  await write(
    `${tmp}/backlog/decisions/decision-001 - Foo.md`,
    "---\nstatus: accepted\n---\n# Foo decision\n",
  );
  await write(`${tmp}/knowledge/lektion-x.md`, "x");
  const res = await collectKnowledge(tmp, `${tmp}/no-vault`);
  assertEquals(res.available, true);
  const decs = res.decisions as Array<Record<string, string>>;
  assertEquals(decs.length, 1);
  assertEquals(decs[0].title, "Foo decision");
  assertEquals(decs[0].status, "accepted");
  assertEquals((res.lektionen as string[]).length, 1);
});

Deno.test("collectKnowledge: knowledge/decisions.md preferred", async () => {
  const tmp = await Deno.makeTempDir();
  await Deno.mkdir(`${tmp}/backlog/decisions`, { recursive: true });
  await write(`${tmp}/backlog/decisions/decision-001 - X.md`, "---\nstatus: rejected\n---\n# X\n");
  await write(
    `${tmp}/knowledge/decisions.md`,
    "## 001 — Preferred\nStatus: superseded\n\n## 002 -- Second\n",
  );
  const res = await collectKnowledge(tmp);
  const decs = res.decisions as Array<Record<string, string>>;
  assertEquals(decs.length, 2);
  assertEquals(decs[0].title, "Preferred");
  assertEquals(decs[0].status, "superseded");
});

// ---------------------------------------------------------------------------
// collect_backlog
// ---------------------------------------------------------------------------

Deno.test("collectBacklog: milestone grouping + done/total counts", async () => {
  const tmp = await Deno.makeTempDir();
  await Deno.mkdir(`${tmp}/backlog/tasks`, { recursive: true });
  await write(
    `${tmp}/backlog/tasks/task-T-001.md`,
    "---\nid: T-001\ntitle: Alpha\nstatus: To Do\nmilestone: m1\n---\n",
  );
  await write(
    `${tmp}/backlog/tasks/task-T-002.md`,
    "---\nid: T-002\ntitle: Beta\nstatus: In Progress\nmilestone: m1\n---\n",
  );
  await write(
    `${tmp}/backlog/tasks/task-T-003.md`,
    "---\nid: T-003\ntitle: Gamma\nstatus: Done\nmilestone: m1\n---\n",
  );
  const res = await collectBacklog(tmp);
  assertEquals(res.available, true);
  const ms = res.milestones as Array<Record<string, unknown>>;
  const m1 = ms.find((m) => m.name === "m1")!;
  assertEquals(m1.done, 1);
  assertEquals(m1.total, 3);
  assertEquals(res.in_progress_count, 1);
});

Deno.test("collectBacklog: completed/ folder folded in as Done", async () => {
  const tmp = await Deno.makeTempDir();
  await Deno.mkdir(`${tmp}/backlog/tasks`, { recursive: true });
  await Deno.mkdir(`${tmp}/backlog/completed`, { recursive: true });
  await write(
    `${tmp}/backlog/tasks/task-T-001.md`,
    "---\nid: T-001\ntitle: Live\nstatus: To Do\n---\n",
  );
  await write(`${tmp}/backlog/completed/task-T-002.md`, "---\nid: T-002\ntitle: Done\n---\n");
  const res = await collectBacklog(tmp);
  const tasks = res.tasks as Array<Record<string, unknown>>;
  assertEquals(tasks.length, 2);
  const doneTask = tasks.find((t) => t.id === "T-002")!;
  assertEquals(doneTask.status, "Done");
});

Deno.test("collectBacklog: no backlog dir returns unavailable", async () => {
  const tmp = await Deno.makeTempDir();
  const res = await collectBacklog(tmp);
  assertEquals(res.available, false);
});

// ---------------------------------------------------------------------------
// collect_cost
// ---------------------------------------------------------------------------

Deno.test("collectCost: sums today/yesterday correctly", async () => {
  const tmp = await Deno.makeTempDir();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const yestStr = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
  await write(
    `${tmp}/${todayStr}.json`,
    JSON.stringify({ date: todayStr, ccusage: { total_cost: 2.5 } }),
  );
  await write(
    `${tmp}/${yestStr}.json`,
    JSON.stringify({ date: yestStr, ccusage: { total_cost: 1.0 } }),
  );
  const res = await collectCost(tmp);
  assertEquals(res.available, true);
  assertEquals(res.today, 2.5);
  assertEquals(res.yesterday, 1.0);
  assertEquals((res.total as number) >= 3.5, true);
});

Deno.test("collectCost: missing usage dir returns unavailable", async () => {
  const tmp = await Deno.makeTempDir();
  const res = await collectCost(`${tmp}/nope`);
  assertEquals(res.available, false);
});

Deno.test("collectCost: skips _rl.json and old combined format", async () => {
  const tmp = await Deno.makeTempDir();
  const todayStr = new Date().toISOString().slice(0, 10);
  await write(
    `${tmp}/${todayStr}.json`,
    JSON.stringify({ date: todayStr, ccusage: { total_cost: 1.0 } }),
  );
  await write(`${tmp}/2024-01-01_rl.json`, JSON.stringify({ ts: "2024-01-01", five_hour_pct: 50 }));
  await write(`${tmp}/old.json`, JSON.stringify({ ccusage_daily: [], date: "2024-01-01" }));
  const res = await collectCost(tmp);
  assertEquals(res.available, true);
  assertEquals(res.total, 1.0);
});

// ---------------------------------------------------------------------------
// collect_git
// ---------------------------------------------------------------------------

Deno.test("collectGit: clean repo has branch, no dirty flag", async () => {
  const tmp = await Deno.makeTempDir();
  await new Deno.Command("git", { args: ["init"], cwd: tmp }).output();
  await new Deno.Command("git", { args: ["config", "user.email", "t@t.com"], cwd: tmp }).output();
  await new Deno.Command("git", { args: ["config", "user.name", "T"], cwd: tmp }).output();
  await write(`${tmp}/README.md`, "hello");
  await new Deno.Command("git", { args: ["add", "-A"], cwd: tmp }).output();
  await new Deno.Command("git", { args: ["commit", "-m", "init"], cwd: tmp }).output();
  const res = await collectGit(tmp);
  assertEquals(res.available, true);
  assertEquals(typeof res.branch, "string");
  assertEquals(res.dirty, false);
});

Deno.test("collectGit: dirty flag set when uncommitted changes", async () => {
  const tmp = await Deno.makeTempDir();
  await new Deno.Command("git", { args: ["init"], cwd: tmp }).output();
  await new Deno.Command("git", { args: ["config", "user.email", "t@t.com"], cwd: tmp }).output();
  await new Deno.Command("git", { args: ["config", "user.name", "T"], cwd: tmp }).output();
  await write(`${tmp}/README.md`, "hello");
  await new Deno.Command("git", { args: ["add", "-A"], cwd: tmp }).output();
  await new Deno.Command("git", { args: ["commit", "-m", "init"], cwd: tmp }).output();
  await write(`${tmp}/dirty.txt`, "change");
  const res = await collectGit(tmp);
  assertEquals(res.dirty, true);
});

Deno.test("collectGit: non-git dir returns unavailable", async () => {
  const tmp = await Deno.makeTempDir();
  const res = await collectGit(tmp);
  assertEquals(res.available, false);
});

// ---------------------------------------------------------------------------
// discover_projects + resolve_project_cwd
// ---------------------------------------------------------------------------

Deno.test("discoverProjects: finds backlog dirs + always includes active", async () => {
  const tmp = await Deno.makeTempDir();
  await Deno.mkdir(`${tmp}/GITHUB/proj_a/backlog`, { recursive: true });
  await Deno.mkdir(`${tmp}/GITHUB/proj_b`, { recursive: true }); // no backlog
  await Deno.mkdir(`${tmp}/GITHUB/proj_c/backlog`, { recursive: true });
  const active = `${tmp}/elsewhere/cc-setup`;
  await Deno.mkdir(active, { recursive: true });
  const out = await discoverProjects(active, `${tmp}/GITHUB`);
  assertEquals(out.map((p) => p.name).sort(), ["cc-setup", "proj_a", "proj_c"]);
});

Deno.test("discoverProjects: active inside base not duplicated", async () => {
  const tmp = await Deno.makeTempDir();
  await Deno.mkdir(`${tmp}/GITHUB/cc/backlog`, { recursive: true });
  const out = await discoverProjects(`${tmp}/GITHUB/cc`, `${tmp}/GITHUB`);
  assertEquals(out.map((p) => p.name), ["cc"]);
});

Deno.test("discoverProjects: missing base keeps active", async () => {
  const tmp = await Deno.makeTempDir();
  await Deno.mkdir(`${tmp}/repo`, { recursive: true });
  const out = await discoverProjects(`${tmp}/repo`, `${tmp}/nope`);
  assertEquals(out.map((p) => p.name), ["repo"]);
});

Deno.test("resolveProjectCwd: whitelist + fallback on unknown", () => {
  const tmp = "/tmp/test";
  const projects = [
    { name: "a", path: `${tmp}/a` },
    { name: "b", path: `${tmp}/b` },
  ];
  const def = `${tmp}/home`;
  assertEquals(resolveProjectCwd("a", projects, def), `${tmp}/a`);
  assertEquals(resolveProjectCwd("../../etc/passwd", projects, def), def);
  assertEquals(resolveProjectCwd("", projects, def), def);
});

// ---------------------------------------------------------------------------
// safeScriptJson
// ---------------------------------------------------------------------------

Deno.test("safeScriptJson: escapes script-breakout and & characters", () => {
  const out = safeScriptJson({ x: "</script><b>", y: "a & b" });
  assertEquals(out.includes("</script>"), false);
  assertStringIncludes(out, "\\u003c/script\\u003e");
  assertStringIncludes(out, "\\u0026");
});

// ---------------------------------------------------------------------------
// build_data
// ---------------------------------------------------------------------------

Deno.test("build_data: degrades gracefully on all unavailable", () => {
  const unavail = { available: false, reason: "x" };
  const ctx = {
    generated_at: "now",
    cwd: "/x",
    projects: [],
    active_project: "",
    cards: {
      global: unavail,
      project: unavail,
      knowledge: unavail,
      backlog: unavail,
      tn: unavail,
      tokens: unavail,
      git: unavail,
      cost: unavail,
    },
  };
  const d = buildData(ctx);
  assertEquals((d.coll as Record<string, Record<string, unknown>>).skills.items, []);
  assertEquals((d.overview as Record<string, unknown>).skills, 0);
});

Deno.test("build_data: populates coll, nav, overview from rich context", () => {
  const ctx = {
    generated_at: "2024-01-01 00:00:00",
    cwd: "/x",
    projects: [],
    active_project: "",
    cards: {
      global: {
        available: true,
        skills: {
          count: 1,
          names: ["audit"],
          items: [{
            name: "audit",
            description: "A",
            tokens: 10,
            size_bytes: 100,
            has_md: true,
            scripts: [],
          }],
        },
        agents: ["Bot"],
        agent_items: [{ name: "Bot", tokens: 5, size_bytes: 50, description: "" }],
        claude_md: { headers: ["Rules"], tokens: 20, size_bytes: 200, managed_block: true },
        settings: {
          hook_events: { Stop: 1 },
          hook_detail: { Stop: [{ matcher: "*", type: "command", command: "x" }] },
        },
      },
      project: {
        available: true,
        repo: "cc-setup",
        branch: "main",
        claude_md_headers: ["Intro"],
        claude_md_tokens: 50,
        claude_md_size: 500,
        knowledge_index: [{ title: "Doc A", path: "doc-a.md", desc: "stuff" }],
      },
      knowledge: {
        available: true,
        decisions: [{ id: "001", title: "Use Deno", status: "accepted", body: "" }],
        lektionen: ["lektion-001.md"],
        memory: ["mem-a.md"],
        changelog: ["entry 1"],
      },
      backlog: {
        available: true,
        tasks: [
          {
            id: "T-001",
            title: "A",
            status: "To Do",
            milestone: "v1",
            file: "task-T-001.md",
            desc: "",
          },
          {
            id: "T-002",
            title: "B",
            status: "Done",
            milestone: "v1",
            file: "task-T-002.md",
            desc: "",
          },
        ],
        milestones: [{ name: "v1", done: 1, total: 2 }],
        in_progress_count: 0,
      },
      tn: {
        available: true,
        next: [{
          id: "n1",
          title: "Next task",
          status: "action",
          project: "p1",
          next_action: "Do it",
        }],
        blocked: [],
      },
      tokens: {
        available: true,
        last_session: {
          session_id: "abc",
          turns: 5,
          input: 100,
          output: 200,
          cache_read: 10,
          cache_creation: 20,
          cost: 0.01,
        },
        week: {
          total: 330,
          session_count: 1,
          input: 100,
          output: 200,
          cache_read: 10,
          cache_creation: 20,
        },
        sessions: [{
          session_id: "abc",
          turns: 5,
          input: 100,
          output: 200,
          cache_read: 10,
          cache_creation: 20,
          total: 330,
          cost: 0.01,
          date: "2024-01-01",
          error_count: 0,
          errors: [],
          repeat_count: 0,
          repeats: [],
        }],
        errors_total: 0,
        repeats_total: 0,
        tool_freq: {},
      },
      git: {
        available: true,
        branch: "main",
        branches: ["main"],
        staged: 0,
        unstaged: 0,
        untracked: 0,
        files: [],
        files_struct: [],
        dirty: false,
        shortstat: "",
        ahead_origin: 0,
        behind_origin: 0,
        ahead_main: null,
        recommend: "Clean",
      },
      cost: {
        available: true,
        today: 1.0,
        yesterday: 0.5,
        week: 3.0,
        month: 6.0,
        total: 12.0,
        five_hour: null,
        seven_day: null,
      },
    },
  };
  const d = buildData(ctx);
  const coll = d.coll as Record<string, Record<string, unknown>>;
  const overview = d.overview as Record<string, unknown>;
  assertEquals(coll.skills.items, [{
    name: "audit",
    cat: "",
    desc: "A",
    tokens: 10,
    size: 100,
    has_md: true,
    scripts: [],
  }]);
  assertEquals(coll.agents.items, [{ name: "Bot", role: "", tools: [], tokens: 5, size: 50 }]);
  assertEquals((coll.decisions.items as Array<Record<string, unknown>>)[0].id, "001");
  assertEquals(overview.skills, 1);
  assertEquals(overview.cost_today, "$1.00");
  assertEquals((d.meta as Record<string, unknown>).branch, "main");
});

// ---------------------------------------------------------------------------
// server routes: GET /read, GET /gitdiff, POST /action CSRF
// ---------------------------------------------------------------------------

Deno.test("GET /read with unknown kind returns ok:false JSON", async () => {
  const { createHandler } = await import("../src/server.ts");
  const handler = createHandler({ cwd: "/tmp", assetsDir: "/tmp" });
  const res = await handler(new Request("http://127.0.0.1/read?kind=nope&name=x"));
  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.ok, false);
});

Deno.test("GET /gitdiff returns JSON", async () => {
  const { createHandler } = await import("../src/server.ts");
  const handler = createHandler({ cwd: "/tmp", assetsDir: "/tmp" });
  const res = await handler(new Request("http://127.0.0.1/gitdiff?path="));
  assertEquals(res.status, 200);
  // may succeed or fail depending on whether /tmp is a git repo; just check JSON
  const body = await res.json() as Record<string, unknown>;
  assertEquals(typeof body.ok, "boolean");
});

Deno.test("POST /action/commit with foreign origin returns CSRF block HTML", async () => {
  const { createHandler } = await import("../src/server.ts");
  const handler = createHandler({ cwd: "/tmp", assetsDir: "/tmp" });
  const form = new FormData();
  form.append("message", "test");
  const res = await handler(
    new Request("http://127.0.0.1/action/commit", {
      method: "POST",
      headers: { "origin": "http://evil.example.com" },
      body: form,
    }),
  );
  assertEquals(res.status, 200);
  const text = await res.text();
  assertStringIncludes(text, "CSRF");
});

Deno.test("POST /action/delete requires exact branch name confirmation", async () => {
  const { createHandler } = await import("../src/server.ts");
  const handler = createHandler({ cwd: "/tmp", assetsDir: "/tmp" });
  const form = new FormData();
  form.append("branch", "feat/x");
  form.append("confirm", "wrong"); // wrong confirmation
  const res = await handler(
    new Request("http://127.0.0.1/action/delete", {
      method: "POST",
      body: form,
    }),
  );
  assertEquals(res.status, 200);
  const text = await res.text();
  assertStringIncludes(text, "Branch-Namen");
});

Deno.test("POST /action/merge requires MERGE token", async () => {
  const { createHandler } = await import("../src/server.ts");
  const handler = createHandler({ cwd: "/tmp", assetsDir: "/tmp" });
  const form = new FormData();
  form.append("branch", "feat/x");
  form.append("confirm", "wrong");
  const res = await handler(
    new Request("http://127.0.0.1/action/merge", {
      method: "POST",
      body: form,
    }),
  );
  const text = await res.text();
  assertStringIncludes(text, "MERGE");
});

Deno.test("POST /action/push requires PUSH token", async () => {
  const { createHandler } = await import("../src/server.ts");
  const handler = createHandler({ cwd: "/tmp", assetsDir: "/tmp" });
  const form = new FormData();
  form.append("confirm", "wrong");
  const res = await handler(
    new Request("http://127.0.0.1/action/push", {
      method: "POST",
      body: form,
    }),
  );
  const text = await res.text();
  assertStringIncludes(text, "PUSH");
});

// assertMatch imported but only used for potential future tests
const _assertMatch = assertMatch;
void _assertMatch;
