// collect_backlog — mirrors knowledge.py collect_backlog
// Reads backlog/tasks/*.md + backlog/completed/*.md directly (read-only).
// Groups by milestone, counts done/total, collects in-progress tasks.

import { readText } from "../shared.ts";
import { frontmatterField } from "../md.ts";
import { join } from "@std/path";
import { repoRoot } from "./project.ts";

interface TaskRecord {
  id: string;
  title: string;
  status: string;
  milestone: string;
  parent: string;
  desc: string;
  file: string;
}

const SECTION_RE = /SECTION:DESCRIPTION:BEGIN\s*-->\s*(.*?)\s*<!--\s*SECTION:DESCRIPTION:END/s;
const DESC_HEADER_RE = /^##\s+Description\s*$(.*?)(?=^##\s|\Z)/ms;

function taskDescription(text: string): string {
  const m = text.match(SECTION_RE);
  if (m) return m[1].trim();
  const m2 = text.match(DESC_HEADER_RE);
  return m2 ? m2[1].trim() : "";
}

async function parseTaskFile(fpath: string, filename: string): Promise<TaskRecord | null> {
  const text = await readText(fpath);
  if (!text) return null;
  const id = frontmatterField(text, "id") || filename.replace(/\.md$/, "");
  const title = frontmatterField(text, "title") || id;
  const status = frontmatterField(text, "status");
  const milestone = frontmatterField(text, "milestone");
  const parent = frontmatterField(text, "parent_task_id");
  return {
    id,
    title,
    status,
    milestone,
    parent,
    desc: taskDescription(text).slice(0, 2000),
    file: filename,
  };
}

export async function collectBacklog(cwd: string): Promise<Record<string, unknown>> {
  try {
    const repo = await repoRoot(cwd);
    const tasksDir = join(repo, "backlog", "tasks");

    try {
      await Deno.stat(tasksDir);
    } catch {
      return { available: false, reason: "backlog not initialized (no backlog/tasks)" };
    }

    const tasks: TaskRecord[] = [];
    const seenIds = new Set<string>();

    // tasks/
    const taskFiles: string[] = [];
    for await (const e of Deno.readDir(tasksDir)) {
      if (e.isFile && e.name.endsWith(".md")) taskFiles.push(e.name);
    }
    taskFiles.sort();
    for (const fname of taskFiles) {
      const t = await parseTaskFile(join(tasksDir, fname), fname);
      if (t) {
        tasks.push(t);
        seenIds.add(t.id);
      }
    }

    // completed/ — finished tasks not already in tasks/
    const completedDir = join(repo, "backlog", "completed");
    try {
      const compFiles: string[] = [];
      for await (const e of Deno.readDir(completedDir)) {
        if (e.isFile && e.name.endsWith(".md")) compFiles.push(e.name);
      }
      compFiles.sort();
      for (const fname of compFiles) {
        const t = await parseTaskFile(join(completedDir, fname), fname);
        if (t && !seenIds.has(t.id)) {
          t.status = "Done"; // completed/ folder is the truth
          tasks.push(t);
          seenIds.add(t.id);
        }
      }
    } catch { /* no completed/ dir */ }

    // Milestone aggregation
    const agg = new Map<string, { done: number; total: number }>();
    for (const t of tasks) {
      const name = t.milestone || "—";
      if (!agg.has(name)) agg.set(name, { done: 0, total: 0 });
      const slot = agg.get(name)!;
      slot.total++;
      if (t.status.trim().toLowerCase() === "done") slot.done++;
    }
    const milestones = [...agg.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, v]) => ({ name, done: v.done, total: v.total }));

    const in_progress_count = tasks.filter(
      (t) => t.status.trim().toLowerCase() === "in progress",
    ).length;

    return { available: true, tasks, milestones, in_progress_count };
  } catch (exc) {
    return { available: false, reason: `collect_backlog failed: ${exc}` };
  }
}
