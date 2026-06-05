// Sidebar collector — multi-project overview across roots (~/GITHUB_DG + ~/GITHUB).
// Per project: name, open backlog tasks, 7-day estimated cost. The cross-project
// scan is expensive (uv per project) → consumed via the cached aggregate (cache.ts).

import { join } from "@std/path";
import { frontmatterField } from "../md.ts";
import { parseJson, readText, run } from "../shared.ts";
import { sevenDayCostNative } from "./sessions_native.ts";

const HOME = Deno.env.get("HOME") ?? "/tmp";
const SCRIPTS_DIR = join(new URL("../../..", import.meta.url).pathname, "scripts");

export interface ProjectRef {
  name: string;
  path: string;
}

export interface Milestone {
  name: string;
  done: number;
  total: number;
}

export interface LooseTask {
  id: string;
  title: string;
  status: string;
  file: string;
}

export interface SidebarProject extends ProjectRef {
  open_tasks: number;
  cost_7d: number;
  milestones: Milestone[];
  looseTasks: LooseTask[];
  tn: number;
}

/**
 * tn task counts keyed by absolute working_dir. Reads ONLY `working_dir` + `tasks`
 * from `tn projects` ({count, projects:[…]}); `working_dir` may be a comma list and
 * use `~`. The `kunde` field, project names and customer-only entries (no
 * working_dir) are deliberately ignored — only a count for repos the sidebar
 * already lists is ever surfaced.
 */
export function parseTnProjects(jsonText: string | null): Map<string, number> {
  const out = new Map<string, number>();
  const parsed = parseJson<unknown>(jsonText);
  const arr: Array<Record<string, unknown>> = Array.isArray(parsed)
    ? parsed as Array<Record<string, unknown>>
    : (parsed && typeof parsed === "object" &&
        Array.isArray((parsed as Record<string, unknown>).projects))
    ? (parsed as Record<string, unknown>).projects as Array<Record<string, unknown>>
    : [];
  for (const p of arr) {
    const wd = p.working_dir;
    if (typeof wd !== "string" || !wd) continue; // skip entries without a repo
    const count = Number(p.tasks ?? 0);
    for (const part of wd.split(",")) {
      const t = part.trim();
      if (!t) continue;
      const abs = (t.startsWith("~") ? HOME + t.slice(1) : t).replace(/\/+$/, "");
      out.set(abs, count);
    }
  }
  return out;
}

async function tnTaskCounts(): Promise<Map<string, number>> {
  const tnPath = join(SCRIPTS_DIR, "tasknotes_cli.py");
  try {
    await Deno.stat(tnPath);
  } catch {
    return new Map();
  }
  const out = await run(["uv", "run", "--script", tnPath, "projects", "--format", "json"]);
  return parseTnProjects(out);
}

/** Scan roots: CC_KNOWLEDGE_ROOTS (comma-separated) overrides; default DG + private. */
export function projectRoots(): string[] {
  const env = Deno.env.get("CC_KNOWLEDGE_ROOTS");
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  return [`${HOME}/GITHUB_DG`, `${HOME}/GITHUB`];
}

/** A project = a directory containing backlog/. Dedupe by name; active repo always included. */
export async function discoverProjectsIn(
  roots: string[],
  activeRepo: string,
): Promise<ProjectRef[]> {
  const found = new Map<string, string>();
  for (const root of roots) {
    try {
      for await (const e of Deno.readDir(root)) {
        if (!e.isDirectory) continue;
        const full = join(root, e.name);
        try {
          await Deno.stat(join(full, "backlog"));
          if (!found.has(e.name)) found.set(e.name, full);
        } catch { /* no backlog/ in this dir */ }
      }
    } catch { /* root not readable */ }
  }
  const activeName = activeRepo.split("/").pop()!;
  if (!found.has(activeName)) found.set(activeName, activeRepo);
  return [...found.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, path]) => ({ name, path }));
}

/** Count non-Done tasks in a project's backlog/tasks/ (frontmatter status). */
export async function countOpenTasks(repoPath: string): Promise<number> {
  const tasksDir = join(repoPath, "backlog", "tasks");
  let open = 0;
  try {
    for await (const e of Deno.readDir(tasksDir)) {
      if (!e.isFile || !e.name.endsWith(".md")) continue;
      const text = await readText(join(tasksDir, e.name));
      if (text === null) continue;
      if (frontmatterField(text, "status").trim().toLowerCase() !== "done") open++;
    }
  } catch { /* no backlog/tasks */ }
  return open;
}

/** Milestones (name + done/total) from a project's backlog/tasks (dev data only). */
export async function projectMilestones(repoPath: string): Promise<Milestone[]> {
  const tasksDir = join(repoPath, "backlog", "tasks");
  const agg = new Map<string, { done: number; total: number }>();
  try {
    for await (const e of Deno.readDir(tasksDir)) {
      if (!e.isFile || !e.name.endsWith(".md")) continue;
      const text = await readText(join(tasksDir, e.name));
      if (text === null) continue;
      const ms = frontmatterField(text, "milestone");
      if (!ms) continue; // only tasks that belong to a milestone
      const slot = agg.get(ms) ?? { done: 0, total: 0 };
      slot.total++;
      if (frontmatterField(text, "status").trim().toLowerCase() === "done") slot.done++;
      agg.set(ms, slot);
    }
  } catch { /* no backlog/tasks */ }
  return [...agg.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, v]) => ({ name, done: v.done, total: v.total }));
}

/** Backlog tasks WITHOUT a milestone (id/title/status/file), for the project-wide overview. */
export async function projectLooseTasks(repoPath: string): Promise<LooseTask[]> {
  const tasksDir = join(repoPath, "backlog", "tasks");
  const out: LooseTask[] = [];
  try {
    for await (const e of Deno.readDir(tasksDir)) {
      if (!e.isFile || !e.name.endsWith(".md")) continue;
      const text = await readText(join(tasksDir, e.name));
      if (text === null) continue;
      if (frontmatterField(text, "milestone")) continue; // has a milestone → not loose
      const id = frontmatterField(text, "id") || e.name.replace(/\.md$/, "");
      out.push({
        id,
        title: frontmatterField(text, "title") || id,
        status: frontmatterField(text, "status"),
        file: e.name,
      });
    }
  } catch { /* no backlog/tasks */ }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Full sidebar aggregate: every project with open tasks + 7d cost + milestones + loose tasks. */
export async function collectSidebar(activeRepo: string): Promise<SidebarProject[]> {
  const projects = await discoverProjectsIn(projectRoots(), activeRepo);
  const tnCounts = await tnTaskCounts(); // one call; counts keyed by working_dir
  const out: SidebarProject[] = [];
  for (const p of projects) {
    const open_tasks = await countOpenTasks(p.path);
    const milestones = await projectMilestones(p.path);
    const looseTasks = await projectLooseTasks(p.path);
    let cost_7d = 0;
    try {
      cost_7d = await sevenDayCostNative(p.path);
    } catch { /* sessions unavailable → 0 */ }
    const tn = tnCounts.get(p.path.replace(/\/+$/, "")) ?? 0;
    out.push({ ...p, open_tasks, cost_7d, milestones, looseTasks, tn });
  }
  return out;
}
