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
    });
  }
  return tasks;
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
    return {
      available: true,
      next: extractTnTasks(nxt),
      blocked: extractTnTasks(blocked),
    };
  } catch (exc) {
    return { available: false, reason: `collect_tn failed: ${exc}` };
  }
}
