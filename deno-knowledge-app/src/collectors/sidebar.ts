// Sidebar collector — multi-project overview across roots (~/GITHUB_DG + ~/GITHUB).
// Per project: name, open backlog tasks, 7-day estimated cost. The cross-project
// scan is expensive (uv per project) → consumed via the cached aggregate (cache.ts).

import { join } from "@std/path";
import { frontmatterField } from "../md.ts";
import { readText } from "../shared.ts";
import { sevenDayCost } from "./tokens.ts";

const HOME = Deno.env.get("HOME") ?? "/tmp";

export interface ProjectRef {
  name: string;
  path: string;
}

export interface SidebarProject extends ProjectRef {
  open_tasks: number;
  cost_7d: number;
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

/** Full sidebar aggregate: every discovered project with open-task count + 7d cost. */
export async function collectSidebar(activeRepo: string): Promise<SidebarProject[]> {
  const projects = await discoverProjectsIn(projectRoots(), activeRepo);
  const out: SidebarProject[] = [];
  for (const p of projects) {
    const open_tasks = await countOpenTasks(p.path);
    let cost_7d = 0;
    try {
      cost_7d = await sevenDayCost(p.path);
    } catch { /* sessions unavailable → 0 */ }
    out.push({ ...p, open_tasks, cost_7d });
  }
  return out;
}
