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
import {
  type ContextCategory,
  ctxTok,
  CTX_WINDOW,
  memoryMdTokens,
  SYS_PROMPT_TOK,
  SYS_TOOLS_TOK,
} from "./collectors/context_view.ts";
import {
  collectPluginItems,
  collectProjectAgents,
  type PluginItem,
} from "./collectors/plugins.ts";
import { fmtMtime } from "./md.ts";

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

  // Plugin-Items + Project-Agents für die Kontext-View.
  // collectPluginItems ist datei-basiert (kein Python-Spawn), daher immer ausführen.
  // collectProjectAgents braucht cwd, wird bei skip übersprungen.
  const [pluginItems, projectAgents] = await Promise.all([
    collectPluginItems(home),
    skip ? Promise.resolve([]) : collectProjectAgents(await repoRoot(cwd).catch(() => cwd)),
  ]);

  return {
    generated_at: now,
    cwd,
    projects,
    active_project: activeProject,
    plugin_skills: pluginItems.skills,
    plugin_agents: pluginItems.agents,
    project_agents: projectAgents,
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
      // MEMORY.md tokens — only for the per-project Kontext view (CCS-031).
      // Overview view skips it (na-Stub) since die Kontext view ist project-only.
      memory_md: skip ? na : await memoryMdTokens(cwd),
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
    // metaTokens: session-start cost (name + description only). The context view
    // uses this; `tokens` (full SKILL.md) stays the standalone-nav corpus metric.
    metaTokens: Number(s.meta_tokens ?? 0),
    size: Number(s.size_bytes ?? 0),
    has_md: Boolean(s.has_md),
    scripts: (s.scripts as unknown[]) ?? [],
  }));
  const skillsTok = skills.reduce((sum, s) => sum + s.tokens, 0);
  // _skillsMetaTok: raw meta-tokens (uncalibrated). Kontext-View nutzt ctxTok stattdessen.
  const _skillsMetaTok = skills.reduce((sum, s) => sum + s.metaTokens, 0); void _skillsMetaTok;

  // Agents
  const agentItemsRaw = (g.agent_items as Array<Record<string, unknown>> | undefined) ??
    (g.agents as string[] ?? []).map((n) => ({ name: n }));
  const agentItems = agentItemsRaw as Array<Record<string, unknown>>;
  const agents = agentItems.map((a) => ({
    name: a.name,
    role: String(a.description ?? ""),
    tools: [],
    tokens: Number(a.tokens ?? 0),
    // metaTokens: session-start cost (name + description only). See skills above.
    metaTokens: Number(a.meta_tokens ?? 0),
    size: Number(a.size_bytes ?? 0),
  }));
  const agentsTok = agents.reduce((sum, a) => sum + a.tokens, 0);
  // _agentsMetaTok: raw meta-tokens (uncalibrated). Kontext-View nutzt ctxTok stattdessen.
  const _agentsMetaTok = agents.reduce((sum, a) => sum + a.metaTokens, 0); void _agentsMetaTok;

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
    date: fmtMtime(Number(d.mtime) || 0),
  }));
  // memory: supports both old string[] shape (cache-compatibility) and new {name,mtime} shape
  const memory = (kn.memory as Array<string | Record<string, unknown>> ?? []).map((m) => {
    if (typeof m === "string") return { name: m, desc: "", date: "" };
    return { name: String(m.name ?? ""), desc: "", date: fmtMtime(Number(m.mtime) || 0) };
  });
  // lessons: supports both old string[] shape and new {name,mtime} shape
  const lessons = (kn.lektionen as Array<string | Record<string, unknown>> ?? []).map((x) => {
    if (typeof x === "string") return { name: x, desc: "", date: "" };
    return { name: String(x.name ?? ""), desc: "", date: fmtMtime(Number(x.mtime) || 0) };
  });
  const changelog = (kn.changelog as Array<{ heading: string; body: string } | string> ?? [])
    .map((c) => {
      if (typeof c === "string") return { name: c, body: "", type: "changelog", desc: "" };
      return {
        name: c.heading,
        body: c.body ?? "",
        type: "changelog",
        desc: (c.body ?? "").split("\n").filter(Boolean).slice(0, 2).join(" · "),
      };
    });
  const docs = (kn.docs as Array<{ id: string; title: string; file: string; mtime?: number }> ?? [])
    .map((d) => ({
      name: d.file,
      title: d.title,
      id: d.id,
      desc: d.title,
      date: fmtMtime(Number(d.mtime) || 0),
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

  // tn items (col → kanban column: next | blocked | overdue)
  // CCS-027: include `id` field so browser.js can fetch the tn note via /tn-note?id=
  const tnItems = [
    ...(tnc.next as Array<Record<string, unknown>> ?? []).map((t) => ({
      id: t.id,
      name: t.title,
      status: String(t.status ?? "action"),
      desc: String(t.next_action ?? ""),
      project: t.project,
      col: "next",
    })),
    ...(tnc.blocked as Array<Record<string, unknown>> ?? []).map((t) => ({
      id: t.id,
      name: t.title,
      status: "blocked",
      desc: "",
      project: t.project,
      col: "blocked",
    })),
    ...(tnc.overdue as Array<Record<string, unknown>> ?? []).map((t) => ({
      id: t.id,
      name: t.title,
      status: "overdue",
      desc: String(t.scheduled ?? ""),
      project: t.project,
      col: "overdue",
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

  // Cross-project open tasks (dev backlog data) for the Überblick Kanban board.
  // CCS-026: use openTasks (all non-done tasks with project label) instead of the old
  // milestone-grouped list. Each item carries project as desc/group for the Kanban card.
  const projForMs = (context.projects as Array<{
    name: string;
    openTasks?: Array<
      {
        id: string;
        title: string;
        status: string;
        milestone: string;
        project: string;
        file: string;
      }
    >;
    // legacy fields kept for backward compat (parity tests read milestones/looseTasks)
    milestones?: Array<{ name: string; done: number; total: number }>;
    looseTasks?: Array<{ id: string; title: string; status: string; file: string }>;
  }>) ?? [];
  // Each open task becomes a Kanban card with project label.
  // done=false so browser.js never collapses them into a Done bucket.
  const msItems = projForMs.flatMap((pr) => {
    const openT = pr.openTasks;
    // Prefer openTasks when available (populated by collectSidebar CCS-026).
    // Use != null (not length > 0) so a project with 0 open tasks returns [] instead
    // of falling through to the old milestone/looseTasks fallback.
    if (openT != null) {
      return openT.map((t) => ({
        name: t.id,
        title: t.title,
        status: t.status,
        group: t.project || pr.name,
        milestone: t.milestone || "(ohne Milestone)",
        done: false,
        desc: `${t.project || pr.name} · ${t.id}`,
        file: t.file,
        project: t.project || pr.name,
      }));
    }
    // Fallback: old milestone+looseTasks approach (cache not yet primed / test fixtures)
    const ms = (pr.milestones ?? []).map((m) => ({
      name: m.name,
      title: `${m.done}/${m.total} Tasks`,
      status: m.done === m.total ? "done" : "in progress",
      group: pr.name,
      milestone: "Milestone",
      done: false,
      desc: `${pr.name} · Milestone · ${m.done}/${m.total} Tasks`,
      project: pr.name,
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
      project: pr.name,
    }));
    return [...ms, ...loose];
  });

  // ---- Kontext view (CCS-034C): static initial-session context breakdown -----
  // MEMORY.md tokens come from the buildContext-collected card (best-effort).
  // Plugin-/Project-Items kommen aus context.plugin_skills/plugin_agents/project_agents.
  // ctxTok(estTokens) wendet den Kalibrierungsfaktor (CTX_CALIB=1.7) an — nur hier,
  // nicht im globalen estTokens (parity-gebunden gegen knowledge.py).

  const pluginSkills = (context.plugin_skills as PluginItem[] | undefined) ?? [];
  const pluginAgents = (context.plugin_agents as PluginItem[] | undefined) ?? [];
  const projAgents = (context.project_agents as PluginItem[] | undefined) ?? [];

  const memCard = (cards.memory_md && typeof cards.memory_md === "object")
    ? cards.memory_md as Record<string, unknown>
    : {};
  const memMdAvail = Boolean(memCard.available);
  const memMdTok = Number(memCard.tokens ?? 0);

  // Memory items: ctxTok auf estTokens anwenden (Kalibrierung für Markdown/Deutsch)
  const memoryItems: Array<{
    name: string;
    tokens: number;
    desc?: string;
    read?: string;
    readPath?: string;
  }> = [];
  if (gdoc.tokens) {
    memoryItems.push({
      name: "CLAUDE.md (global)",
      tokens: ctxTok(gdoc.tokens),
      desc: "~/.claude/CLAUDE.md",
      read: "claude-global",
    });
  }
  if (pdoc.tokens) {
    const repoName = String(
      ((cards.project && typeof cards.project === "object")
        ? (cards.project as Record<string, unknown>).repo
        : undefined) ?? "Projekt",
    );
    memoryItems.push({
      name: "CLAUDE.md (Projekt)",
      tokens: ctxTok(pdoc.tokens),
      desc: `${repoName}/CLAUDE.md`,
      read: "claude-project",
    });
  }
  if (memMdAvail && memMdTok) {
    const memPath = String(memCard.path ?? "");
    const homeDir = HOME;
    const claudeDir = `${homeDir}/.claude`;
    const isUnderClaude = memPath.startsWith(claudeDir);
    memoryItems.push({
      name: "MEMORY.md",
      tokens: ctxTok(memMdTok),
      desc: memPath,
      // Only allow readDoc(homefile) when path is under ~/.claude (security boundary matches readDoc logic).
      ...(isUnderClaude && memPath ? { read: "homefile", readPath: memPath } : {}),
    });
  }
  const memoryTok = memoryItems.reduce((s, i) => s + i.tokens, 0);

  // Agents: Reihenfolge Project → User → Plugin (Built-in: keine separaten Agents)
  // User-Agents aus collectGlobal bekommen ctxTok(metaTokens) + Gruppe "User"
  const agentItemsCtx = [
    // Project-Agents (aus .claude/agents/)
    ...projAgents.map((a) => ({
      name: a.name,
      tokens: a.meta_tokens,
      desc: a.description,
      group: a.group,
      read: a.read,
      readPath: a.readPath,
    })),
    // User-Agents (~/.claude/agents/) — ctxTok auf meta_tokens (schon estTokens)
    ...agents.map((a) => ({
      name: String(a.name),
      tokens: ctxTok(a.metaTokens),
      desc: a.role,
      group: "User",
      read: "agent",
    })),
    // Plugin-Agents
    ...pluginAgents.map((a) => ({
      name: a.name,
      tokens: a.meta_tokens,
      desc: a.description,
      group: a.group,
      read: a.read,
      readPath: a.readPath,
    })),
  ];
  const agentsCtxTok = agentItemsCtx.reduce((s, a) => s + a.tokens, 0);

  // Skills: Reihenfolge User → Plugin → Built-in
  // Built-in: eine aggregierte Näherungszeile (~1700 tok fix, nicht lesbar)
  const BUILTIN_SKILLS_TOK = 1700;
  const skillItemsCtx = [
    // User-Skills — ctxTok auf metaTokens
    ...skills.map((s) => ({
      name: String(s.name),
      tokens: ctxTok(s.metaTokens),
      desc: s.desc,
      group: "User",
      read: "skill",
    })),
    // Plugin-Skills
    ...pluginSkills.map((s) => ({
      name: s.name,
      tokens: s.meta_tokens,
      desc: s.description,
      group: s.group,
      read: s.read,
      readPath: s.readPath,
    })),
    // Built-in: aggregierte Näherung — fix, nicht lesbar
    {
      name: "(Built-in ≈)",
      tokens: BUILTIN_SKILLS_TOK,
      desc: "run / browser / verify-ui u.a. — nicht lesbar",
      group: "Built-in",
    },
  ];
  const skillsCtxTok = skillItemsCtx.reduce((s, i) => s + i.tokens, 0);

  const contextCategories: ContextCategory[] = [
    {
      key: "system_prompt",
      label: "System prompt",
      tokens: SYS_PROMPT_TOK,
      fixed: true,
      items: [],
    },
    { key: "system_tools", label: "System tools", tokens: SYS_TOOLS_TOK, fixed: true, items: [] },
    {
      // Context view: kalibrierte Meta-Tokens (ctxTok) aller Agents (Project+User+Plugin).
      // agentsTok (full, uncalibrated) bleibt Standalone-Nav-Metrik.
      key: "agents",
      label: "Custom agents",
      tokens: agentsCtxTok,
      items: agentItemsCtx,
    },
    {
      // Context view: kalibrierte Meta-Tokens aller Skills (User+Plugin+Built-in).
      // skillsTok (full, uncalibrated) bleibt Standalone-Nav-Metrik.
      key: "skills",
      label: "Skills",
      tokens: skillsCtxTok,
      items: skillItemsCtx,
    },
    { key: "memory", label: "Memory files", tokens: memoryTok, items: memoryItems },
    { key: "hooks", label: "Hook-Injektion", tokens: 0, live: true, items: [] },
  ];
  // measured_total: sum of all categories EXCEPT the live hook (filled client-side).
  const contextMeasuredTotal = contextCategories
    .filter((c) => !c.live)
    .reduce((sum, c) => sum + c.tokens, 0);

  const coll = {
    milestones: {
      title: "Backlog projektweit",
      scope: "alle Projekte",
      type: "task",
      accent: "a",
      items: msItems,
    },
    context: {
      title: "Kontext",
      scope: "session",
      type: "context",
      accent: "m",
      window: CTX_WINDOW,
      categories: contextCategories,
      measured_total: contextMeasuredTotal,
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
    docs: {
      title: "Docs",
      scope: "wissen",
      type: "doc",
      accent: "c",
      items: docs,
    },
    backlog: { title: "Tasks", scope: "backlog", type: "task", accent: "a", items: tasks },
    tn: { title: "tn", scope: "backlog", type: "task", accent: "c", items: tnItems },
    sessions: { title: "Sessions", scope: "usage", type: "session", accent: "m", items: sessions },
  };

  // Pre-compute open counts for reuse in nav + overview (avoid duplicate calculation)
  const backlogOpenN = (bl.tasks as Array<Record<string, unknown>> ?? []).filter(
    (t) => (String(t.status ?? "")).trim().toLowerCase() !== "done",
  ).length;
  const tnOpenN = (tnc.next as unknown[] ?? []).length +
    (tnc.blocked as unknown[] ?? []).length +
    (tnc.overdue as unknown[] ?? []).length;

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
        { id: "docs", label: "Docs", dot: "c" },
      ],
    },
    {
      g: "Backlog",
      items: [
        {
          id: "boards",
          label: "Boards (tn + backlog)",
          dot: "c",
          cnt: `${backlogOpenN} / ${tnOpenN}`,
        },
      ],
    },
    {
      g: "Usage",
      items: [
        { id: "sessions", label: "Sessions", dot: "m", tok: fmtCompact(sessionsTok) },
      ],
    },
    {
      g: "Kontext",
      items: [
        { id: "context", label: "Kontext", dot: "m", tok: fmtCompact(contextMeasuredTotal) },
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
    // Cross-project tn total: sum of per-project counts from sidebar (working_dir-match).
    // ONLY the aggregated number — no titles/content/kunde (Org-Regel).
    tn_total: (context.projects as Array<{ tn?: number }> ?? []).reduce(
      (s, p) => s + (Number(p.tn) || 0),
      0,
    ),
    // Boards-Header counts: reuse pre-computed values (avoids duplicate filter logic)
    backlog_open: backlogOpenN,
    tn_open: tnOpenN,
    claude_tok_global: fmtCompact(gdoc.tokens),
    claude_tok_project: fmtCompact(pdoc.tokens),
    // Projekt-Settings (Item 4): local .claude/ stats + estimated initial context tokens
    proj_skills: Number(p.proj_skills_count ?? 0),
    proj_agents: Number(p.proj_agents_count ?? 0),
    proj_hooks: Number(p.proj_hooks_count ?? 0),
    proj_init_tok: fmtCompact(Number(gmd.tokens ?? 0) + Number(p.claude_md_tokens ?? 0)),
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
