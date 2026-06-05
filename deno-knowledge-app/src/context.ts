// Context assembly — build_context, discover_projects, resolve_project_cwd, build_data.
// Mirrors knowledge.py's same-named functions faithfully.

import {
  collectBacklog,
  collectCost,
  collectGit,
  collectGlobal,
  collectKnowledge,
  collectProject,
  collectTn,
  collectTokens,
} from "./collectors/index.ts";
import { repoRoot } from "./collectors/project.ts";
import { discoverProjectsIn, projectRoots } from "./collectors/sidebar.ts";

const HOME = Deno.env.get("HOME") ?? "/tmp";

// ---------------------------------------------------------------------------
// discover_projects + resolve_project_cwd
// ---------------------------------------------------------------------------

export function discoverProjects(
  activeRepo: string,
  base?: string,
): Promise<Array<{ name: string; path: string }>> {
  // Explicit base (tests) → that single root; otherwise all configured roots.
  return discoverProjectsIn(base ? [base] : projectRoots(), activeRepo);
}

export function resolveProjectCwd(
  project: string,
  projects: Array<{ name: string; path: string }>,
  defaultCwd: string,
): string {
  if (project) {
    for (const p of projects) {
      if (p.name === project) return p.path;
    }
  }
  return defaultCwd;
}

// ---------------------------------------------------------------------------
// build_context
// ---------------------------------------------------------------------------

export async function buildContext(
  cwd: string,
  claudeHome?: string,
  opts?: {
    projects?: Array<{ name: string; path: string }>;
    active_project?: string;
    global?: Record<string, unknown>;
    skipProject?: boolean;
  },
): Promise<Record<string, unknown>> {
  const home = claudeHome ?? `${HOME}/.claude`;
  const projects = opts?.projects ?? [];
  const activeProject = opts?.active_project ?? "";

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  // Overview view shows only global + cross-project → skip the per-project
  // collectors (incl. collectTokens, which would spawn session_analyze.py).
  const skip = opts?.skipProject === true;
  const na = { available: false, reason: "overview" };

  return {
    generated_at: now,
    cwd,
    projects,
    active_project: activeProject,
    cards: {
      // Global layer is identical for every project → reuse the cached copy when
      // provided, otherwise collect it live (e.g. tests, cache priming).
      global: opts?.global ?? await collectGlobal(home),
      project: skip ? na : await collectProject(cwd),
      git: skip ? na : await collectGit(cwd),
      knowledge: skip ? na : await collectKnowledge(cwd),
      backlog: skip ? na : await collectBacklog(cwd),
      tn: skip ? na : await collectTn(cwd),
      tokens: skip ? na : await collectTokens(cwd),
      cost: await collectCost(),
    },
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function fmtCompact(n: unknown): string {
  let v: number;
  try {
    v = parseFloat(String(n));
  } catch {
    return "0";
  }
  if (isNaN(v)) return "0";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.floor(v));
}

export function fmtCost(v: unknown): string {
  let n: number;
  try {
    n = parseFloat(String(v));
  } catch {
    return "$0.00";
  }
  if (isNaN(n)) return "$0.00";
  if (n >= 1000) return `$${(n / 1000).toFixed(2)}k`;
  return `$${n.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// build_data — maps collector cards into the browser DATA object
// ---------------------------------------------------------------------------

export function buildData(
  context: Record<string, unknown>,
  view: "overview" | "project" = "overview",
): Record<string, unknown> {
  const cards = (context.cards ?? {}) as Record<string, Record<string, unknown>>;

  function av(key: string): Record<string, unknown> {
    const c = cards[key];
    return (c && typeof c === "object" && c.available) ? c : {};
  }

  const g = av("global"), p = av("project"), kn = av("knowledge");
  const bl = av("backlog"), tnc = av("tn"), tok = av("tokens");
  const gitc = (cards.git && typeof cards.git === "object") ? cards.git : {};
  const costc = (cards.cost && typeof cards.cost === "object") ? cards.cost : {};

  // Skills
  const skillItemsRaw =
    (g.skills as Record<string, unknown>)?.items as Array<Record<string, unknown>> | null ??
      ((g.skills as Record<string, unknown>)?.names as string[] ?? []).map((n) => ({ name: n }));
  const skillItems = skillItemsRaw as Array<Record<string, unknown>>;
  const skills = skillItems.map((s) => ({
    name: s.name,
    cat: "",
    desc: String(s.description ?? ""),
    tokens: Number(s.tokens ?? 0),
    size: Number(s.size_bytes ?? 0),
    has_md: Boolean(s.has_md),
    scripts: (s.scripts as unknown[]) ?? [],
  }));
  const skillsTok = skills.reduce((sum, s) => sum + s.tokens, 0);

  // Agents
  const agentItemsRaw = (g.agent_items as Array<Record<string, unknown>> | undefined) ??
    (g.agents as string[] ?? []).map((n) => ({ name: n }));
  const agentItems = agentItemsRaw as Array<Record<string, unknown>>;
  const agents = agentItems.map((a) => ({
    name: a.name,
    role: String(a.description ?? ""),
    tools: [],
    tokens: Number(a.tokens ?? 0),
    size: Number(a.size_bytes ?? 0),
  }));
  const agentsTok = agents.reduce((sum, a) => sum + a.tokens, 0);

  // Hooks
  const settings = (g.settings as Record<string, unknown>) ?? {};
  const hookEvents = (settings.hook_events as Record<string, number>) ?? {};
  const hookDetail = (settings.hook_detail as Record<string, Array<Record<string, string>>>) ?? {};
  const hooks = Object.entries(hookEvents).map(([name, count]) => ({
    name,
    count,
    entries: hookDetail[name] ?? [],
  }));

  // Project knowledge
  const pknow = (p.knowledge_index as Array<Record<string, string>> ?? []).map((e) => ({
    name: e.title,
    type: e.path ? e.path.split(".").pop() ?? "" : "",
    desc: e.desc ?? "",
    path: e.path ?? "",
  }));

  // Project CLAUDE.md
  const psections = (p.claude_md_headers as string[] ?? []).map((h) => ({
    name: h,
    type: "section",
    desc: "",
  }));
  const pdoc = {
    kind: "claude-project",
    tokens: Number(p.claude_md_tokens ?? 0),
    size: Number(p.claude_md_size ?? 0),
  };
  const psectionsEff = psections.length > 0
    ? psections
    : ((pdoc.tokens || pdoc.size) ? [{ name: "(ganze Datei)", type: "section", desc: "" }] : []);

  // Global CLAUDE.md
  const gmd = (g.claude_md as Record<string, unknown>) ?? {};
  const gsections = (gmd.headers as string[] ?? []).map((h) => ({
    name: h,
    type: "section",
    desc: "",
  }));
  const gdoc = {
    kind: "claude-global",
    tokens: Number(gmd.tokens ?? 0),
    size: Number(gmd.size_bytes ?? 0),
    managed: Boolean(gmd.managed_block),
  };
  const gsectionsEff = gsections.length > 0
    ? gsections
    : ((gdoc.tokens || gdoc.size) ? [{ name: "(ganze Datei)", type: "section", desc: "" }] : []);

  // Knowledge
  const decisions = (kn.decisions as Array<Record<string, unknown>> ?? []).map((d) => ({
    name: `${d.id} — ${d.title}`,
    id: d.id,
    status: String(d.status ?? ""),
    ctx: "",
    dec: "",
    body: String(d.body ?? ""),
  }));
  const memory = (kn.memory as string[] ?? []).map((m) => ({ name: m, desc: "" }));
  const lessons = (kn.lektionen as string[] ?? []).map((x) => ({ name: x, desc: "" }));
  const changelog = (kn.changelog as string[] ?? []).map((c) => ({
    name: c,
    type: "changelog",
    desc: "",
  }));

  // Backlog tasks
  const STATUS_ORDER: Record<string, number> = {
    "in progress": 0,
    "to do": 1,
    "blocked": 2,
    "done": 9,
  };
  const blTasks = (bl.tasks as Array<Record<string, unknown>>) ?? [];
  const openTasks = blTasks.filter((t) => (String(t.status ?? "")).trim().toLowerCase() !== "done");
  const doneTasks = blTasks.filter((t) => (String(t.status ?? "")).trim().toLowerCase() === "done");
  openTasks.sort((a, b) => {
    const ma = String(a.milestone ?? "~"), mb = String(b.milestone ?? "~");
    if (ma !== mb) return ma.localeCompare(mb);
    const sa = STATUS_ORDER[(String(a.status ?? "")).trim().toLowerCase()] ?? 5;
    const sb = STATUS_ORDER[(String(b.status ?? "")).trim().toLowerCase()] ?? 5;
    if (sa !== sb) return sa - sb;
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });
  doneTasks.sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")));

  function taskItem(t: Record<string, unknown>, group: string, done = false) {
    return {
      name: t.id,
      title: String(t.title ?? ""),
      status: (String(t.status ?? "")).trim().toLowerCase(),
      milestone: String(t.milestone ?? "") || "—",
      group,
      done,
      desc: String(t.desc ?? ""),
      file: String(t.file ?? ""),
    };
  }
  const tasks = [
    ...openTasks.map((t) => taskItem(t, String(t.milestone ?? "") || "—")),
    ...doneTasks.map((t) => taskItem(t, "Done", true)),
  ];

  // tn items
  const tnItems = [
    ...(tnc.next as Array<Record<string, unknown>> ?? []).map((t) => ({
      name: t.title,
      status: String(t.status ?? "action"),
      desc: String(t.next_action ?? ""),
      project: t.project,
    })),
    ...(tnc.blocked as Array<Record<string, unknown>> ?? []).map((t) => ({
      name: t.title,
      status: "blocked",
      desc: "",
      project: t.project,
    })),
  ];

  // Sessions
  const last = tok.last_session as Record<string, unknown> | null | undefined;
  const sessSrc = (tok.sessions as Array<Record<string, unknown>> | undefined) ??
    (last ? [last] : []);
  const sessions = sessSrc.filter(Boolean).map((s) => ({
    name: s.session_id,
    date: String(s.date ?? ""),
    turns: Number(s.turns ?? 0),
    input: Number(s.input ?? 0),
    output: Number(s.output ?? 0),
    cc: Number(s.cache_creation ?? 0),
    cr: Number(s.cache_read ?? 0),
    total: Number(
      s.total ?? (
        Number(s.input ?? 0) + Number(s.output ?? 0) + Number(s.cache_read ?? 0) +
        Number(s.cache_creation ?? 0)
      ),
    ),
    cost: Number(s.cost ?? 0),
    error_count: Number(s.error_count ?? 0),
    errors: (s.errors as unknown[]) ?? [],
    repeat_count: Number(s.repeat_count ?? 0),
    repeats: (s.repeats as unknown[]) ?? [],
  }));
  const sessionsTok = sessions.reduce((sum, s) => sum + s.total, 0);
  const sessionsCost = sessions.reduce((sum, s) => sum + s.cost, 0);
  const week = (tok.week as Record<string, unknown>) ?? {};

  // Cross-project milestones (dev backlog data) for the Überblick. Each project's
  // milestones become grouped list items: name + done/total + status.
  const projForMs = (context.projects as Array<{
    name: string;
    milestones?: Array<{ name: string; done: number; total: number }>;
    looseTasks?: Array<{ id: string; title: string; status: string; file: string }>;
  }>) ?? [];
  // Grouped by PROJECT (done:false so browser.js does not collapse them into a
  // "Done" bucket): each project's milestones (X/Y) + its tasks without a milestone.
  const msItems = projForMs.flatMap((pr) => {
    const ms = (pr.milestones ?? []).map((m) => ({
      name: m.name,
      title: `${m.done}/${m.total} Tasks`,
      status: m.done === m.total ? "done" : "in progress",
      group: pr.name,
      milestone: "Milestone",
      done: false,
      desc: `${pr.name} · Milestone · ${m.done}/${m.total} Tasks`,
    }));
    const loose = (pr.looseTasks ?? []).map((t) => ({
      name: t.id,
      title: t.title,
      status: t.status,
      group: pr.name,
      milestone: "(ohne Milestone)",
      done: false,
      desc: `${pr.name} · ${t.id} (ohne Milestone)`,
      file: t.file,
    }));
    return [...ms, ...loose];
  });

  const coll = {
    milestones: {
      title: "Backlog projektweit",
      scope: "alle Projekte",
      type: "task",
      accent: "a",
      items: msItems,
    },
    skills: { title: "Skills", scope: "global", type: "skill", accent: "g", items: skills },
    agents: { title: "Agents", scope: "global", type: "agent", accent: "c", items: agents },
    hooks: { title: "Hooks", scope: "global", type: "hook", accent: "", items: hooks },
    gclaude: {
      title: "CLAUDE.md",
      scope: "global",
      type: "claude",
      accent: "c",
      items: gsectionsEff,
      doc: gdoc,
    },
    pknow: { title: "knowledge/", scope: "projekt", type: "know", accent: "c", items: pknow },
    psections: {
      title: "CLAUDE.md",
      scope: "projekt",
      type: "claude",
      accent: "c",
      items: psectionsEff,
      doc: pdoc,
    },
    decisions: {
      title: "Decisions",
      scope: "wissen",
      type: "decision",
      accent: "g",
      items: decisions,
    },
    memory: { title: "Memory", scope: "wissen", type: "memory", accent: "", items: memory },
    lessons: { title: "Lektionen", scope: "wissen", type: "lesson", accent: "a", items: lessons },
    changelog: {
      title: "CHANGELOG",
      scope: "wissen",
      type: "changelog",
      accent: "",
      items: changelog,
    },
    backlog: { title: "Tasks", scope: "backlog", type: "task", accent: "a", items: tasks },
    tn: { title: "tn", scope: "backlog", type: "task", accent: "c", items: tnItems },
    sessions: { title: "Sessions", scope: "usage", type: "session", accent: "m", items: sessions },
  };

  // Global (skills/agents/hooks/global CLAUDE.md) gilt fuer ALLE Projekte → lebt
  // im Ueberblick (view "overview"), NICHT pro Projekt. Projektauswahl ("project")
  // zeigt nur die projektzugehoerigen Gruppen.
  const ovItem = { id: "ov", label: "Übersicht", dot: "g" };
  const globalGroup = {
    g: "Global · alle Projekte",
    items: [
      { id: "skills", label: "Skills", dot: "g", tok: fmtCompact(skillsTok) },
      { id: "agents", label: "Agents", dot: "c", tok: fmtCompact(agentsTok) },
      { id: "hooks", label: "Hooks", dot: "" },
      { id: "gclaude", label: "CLAUDE.md", dot: "c", tok: fmtCompact(gdoc.tokens) },
    ],
  };
  const projectGroups = [
    {
      g: "Projekt",
      items: [
        { id: "pknow", label: "knowledge/", dot: "c" },
        { id: "psections", label: "CLAUDE.md", dot: "c", tok: fmtCompact(pdoc.tokens) },
      ],
    },
    { g: "Git", items: [{ id: "git", label: "Status & Actions", dot: "g" }] },
    {
      g: "Wissen",
      items: [
        { id: "decisions", label: "Decisions", dot: "g" },
        { id: "memory", label: "Memory", dot: "" },
        { id: "lessons", label: "Lektionen", dot: "a" },
        { id: "changelog", label: "CHANGELOG", dot: "" },
      ],
    },
    {
      g: "Backlog",
      items: [
        { id: "backlog", label: "Tasks", dot: "a" },
        { id: "tn", label: "tn next/blocked", dot: "c" },
      ],
    },
    {
      g: "Usage",
      items: [
        { id: "sessions", label: "Sessions", dot: "m", tok: fmtCompact(sessionsTok) },
        { id: "cost", label: "Kosten", dot: "m" },
      ],
    },
  ];
  const nav = view === "overview"
    ? [
      {
        g: "Überblick · alle Projekte",
        items: [{ id: "milestones", label: "Backlog projektweit", dot: "a" }, ovItem],
      },
      globalGroup,
    ]
    : [{ g: "Übersicht", items: [ovItem] }, ...projectGroups];

  const branch = String(gitc.branch ?? p.branch ?? "?");
  const namedMs = (bl.milestones as Array<Record<string, unknown>> ?? [])
    .filter((m) => m.name && m.name !== "—");
  const msTotal = namedMs.length;
  const msDone = namedMs.filter((m) => m.total && m.done === m.total).length;
  const msLabels = namedMs
    .filter((m) => m.done !== m.total)
    .map((m) => `${m.name} ${m.done}/${m.total}`);

  const allTasks = bl.tasks as Array<Record<string, unknown>> ?? [];
  const tasksTotal = allTasks.length;
  const tasksDone = allTasks.filter(
    (t) => (String(t.status ?? "")).trim().toLowerCase() === "done",
  ).length;

  const lastTotal = last
    ? (Number(last.input ?? 0) + Number(last.output ?? 0) +
      Number(last.cache_read ?? 0) + Number(last.cache_creation ?? 0))
    : 0;
  const costAv = Boolean(costc.available);

  const overview = {
    subtitle: `${String(p.repo ?? "cc-setup")} · ${branch} · ${String(context.generated_at ?? "")}`,
    skills: skills.length,
    agents: agents.length,
    hooks: hooks.reduce((sum, h) => sum + h.count, 0),
    skills_tok: fmtCompact(skillsTok),
    agents_tok: fmtCompact(agentsTok),
    branch,
    dirty: Boolean(gitc.dirty),
    git_recommend: String(gitc.recommend ?? ""),
    backlog_inprogress: Number(bl.in_progress_count ?? 0),
    milestones: msLabels,
    ms_done: msDone,
    ms_total: msTotal,
    tasks_done: tasksDone,
    tasks_total: tasksTotal,
    cost_today: costAv ? fmtCost(costc.today) : "n/a",
    cost_week: costAv ? fmtCost(costc.week) : "n/a",
    cost_total: costAv ? fmtCost(costc.total) : "n/a",
    cost_5h: costAv ? (costc.five_hour ?? null) : null,
    cost_7d: costAv ? (costc.seven_day ?? null) : null,
    decisions: (kn.decisions as Array<Record<string, unknown>> ?? []).slice(0, 3)
      .map((d) => ({ id: d.id, title: d.title })),
    tok_last: last ? fmtCompact(lastTotal) : "—",
    tok_week: week.total !== undefined ? fmtCompact(week.total) : "—",
    cost_last: last ? fmtCost((last as Record<string, unknown>).cost ?? 0) : "—",
    tok_sessions: fmtCompact(sessionsTok),
    cost_sessions: fmtCost(sessionsCost),
    know_counts: {
      decisions: decisions.length,
      memory: memory.length,
      lektionen: lessons.length,
      changelog: changelog.length,
      pknow: pknow.length,
    },
    errors_total: Number(tok.errors_total ?? 0),
    repeats_total: Number(tok.repeats_total ?? 0),
    top_tools: Object.entries((tok.tool_freq as Record<string, number>) ?? {})
      .sort(([, a], [, b]) => b - a).slice(0, 4),
    tn_next: (tnc.next as unknown[] ?? []).length,
    tn_blocked: (tnc.blocked as unknown[] ?? []).length,
    tn_available: Boolean(Object.keys(tnc).length),
    claude_tok_global: fmtCompact(gdoc.tokens),
    claude_tok_project: fmtCompact(pdoc.tokens),
  };

  const meta = {
    cwd: context.cwd,
    generated_at: context.generated_at,
    branch,
    turns: last ? Number((last as Record<string, unknown>).turns ?? 0) : 0,
    tok: week.total !== undefined ? fmtCompact(week.total) : "—",
  };

  return {
    meta,
    nav,
    coll,
    git: gitc,
    cost: costc,
    overview,
    projects: context.projects ?? [],
    active_project: context.active_project ?? "",
  };
}

// Re-export repoRoot for use in server.ts
export { repoRoot };
