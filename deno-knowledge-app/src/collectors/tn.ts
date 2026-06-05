// collect_tn — mirrors knowledge.py collect_tn
// Calls tasknotes_cli.py via uv run --script; degrades cleanly if unavailable.

import { parseJson, run } from "../shared.ts";
import { join } from "@std/path";
import { repoRoot } from "./project.ts";

// Path to tasknotes_cli.py is relative to the scripts/ dir next to deno-knowledge-app.
// We derive it from import.meta.url at module load time.
const SCRIPTS_DIR = join(new URL("../../..", import.meta.url).pathname, "scripts");

interface TnTask {
  id: unknown;
  title: unknown;
  status: unknown;
  project: unknown;
  next_action: unknown;
  scheduled: unknown;
}

interface TnPayload {
  tasks?: Array<Record<string, unknown>>;
}

function extractTnTasks(payload: TnPayload | null): TnTask[] {
  if (!payload) return [];
  const tasks: TnTask[] = [];
  for (const t of payload.tasks ?? []) {
    const proj = (t.project as Record<string, unknown>) ?? {};
    const meta = (t.metadata as Record<string, unknown>) ?? {};
    tasks.push({
      id: t.id,
      title: t.title,
      status: t.status,
      project: proj.name,
      next_action: meta.nextAction,
      scheduled: t.scheduled,
    });
  }
  return tasks;
}

/**
 * Project-scoped OVERDUE selection (pure → synthetic-testable). Keeps tasks that
 * are not done, have a `scheduled` date strictly before `todayIso`, and are not
 * already shown in the BLOCKED column. Sorted by scheduled ascending. Dates are
 * compared as YYYY-MM-DD strings. Deliberately does NOT pull from cross-project
 * data — the caller guarantees project scope (see collectTn).
 */
export function pickOverdue(
  tasks: TnTask[],
  todayIso: string,
  blockedIds: Set<unknown>,
): TnTask[] {
  const today = todayIso.slice(0, 10);
  return tasks
    .filter((t) => {
      const st = String(t.status ?? "").toLowerCase();
      if (st === "done" || st === "completed") return false;
      if (blockedIds.has(t.id)) return false;
      const sd = String(t.scheduled ?? "").slice(0, 10);
      return sd !== "" && sd < today;
    })
    .sort((a, b) =>
      String(a.scheduled ?? "").slice(0, 10).localeCompare(
        String(b.scheduled ?? "").slice(0, 10),
      )
    );
}

async function tnJson(repo: string, ...args: string[]): Promise<TnPayload | null> {
  const tnPath = join(SCRIPTS_DIR, "tasknotes_cli.py");
  try {
    await Deno.stat(tnPath);
  } catch {
    return null;
  }
  const out = await run(["uv", "run", "--script", tnPath, ...args], { cwd: repo });
  return parseJson<TnPayload>(out);
}

export async function collectTn(cwd: string): Promise<Record<string, unknown>> {
  try {
    const repo = await repoRoot(cwd);
    const nxt = await tnJson(repo, "next", "--format", "json", "--limit", "5");
    if (nxt === null) {
      return { available: false, reason: "tn unavailable (no tasknotes_cli.py or no vault)" };
    }
    const blocked = await tnJson(repo, "list", "--status", "blocked", "--format", "json");
    const blockedTasks = extractTnTasks(blocked);
    // OVERDUE — project-scoped via the same cwd auto-detection as next/blocked.
    // Guard: if the list spans more than one project (cwd matched no working_dir →
    // tn fell back to ALL projects), skip overdue entirely. Never aggregate
    // cross-project tn data (customer-/person-related). See deno-knowledge-tn-org-block.
    const listAll = await tnJson(repo, "list", "--format", "json", "--limit", "200");
    const allTasks = extractTnTasks(listAll);
    const projNames = new Set(allTasks.map((t) => t.project).filter(Boolean));
    const blockedIds = new Set(blockedTasks.map((t) => t.id));
    const today = new Date().toISOString().slice(0, 10);
    const overdue = projNames.size > 1 ? [] : pickOverdue(allTasks, today, blockedIds);
    return {
      available: true,
      next: extractTnTasks(nxt),
      blocked: blockedTasks,
      overdue,
    };
  } catch (exc) {
    return { available: false, reason: `collect_tn failed: ${exc}` };
  }
}
