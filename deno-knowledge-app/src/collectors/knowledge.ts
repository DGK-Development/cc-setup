// collect_knowledge — mirrors knowledge.py collect_knowledge
// Inspects knowledge/: decisions, lektion-*, memory/*, vault CHANGELOG tail.

import { readText } from "../shared.ts";
import { join } from "@std/path";
import { repoRoot } from "./project.ts";

interface Decision {
  id: string;
  title: string;
  status: string;
  body: string;
}

const DECISION_LINE_RE = /^\s*##\s+(?<id>\d+)\s*(?:—|-{1,2})\s*(?<title>.*\S)\s*$/;
const STATUS_RE = /^\s*(?:[-*]\s*)?\**\s*Status\s*\**\s*[:=]\s*(.+\S)\s*$/i;

export function parseDecisionsMd(text: string): Decision[] {
  const out: Decision[] = [];
  let current: Decision | null = null;
  const body: string[] = [];

  function flush() {
    if (current !== null) {
      current.body = body.join("\n").trim();
    }
  }

  for (const line of text.split("\n")) {
    const m = line.match(DECISION_LINE_RE);
    if (m) {
      flush();
      body.length = 0;
      current = { id: m.groups!.id, title: m.groups!.title, status: "", body: "" };
      out.push(current);
      continue;
    }
    if (current !== null) {
      const sm = line.match(STATUS_RE);
      if (sm && !current.status) {
        current.status = sm[1].trim().replace(/^\*+|\*+$/g, "").trim();
      }
      body.push(line);
    }
  }
  flush();
  return out;
}

async function backlogDecisions(repo: string): Promise<Decision[]> {
  const ddir = join(repo, "backlog", "decisions");
  try {
    const out: Decision[] = [];
    for await (const e of Deno.readDir(ddir)) {
      if (!e.isFile || !e.name.match(/^decision-\d+/)) continue;
      const fpath = join(ddir, e.name);
      const m = e.name.match(/^decision-(\d+)/);
      const did = m ? m[1] : e.name.replace(/\.md$/, "");
      const text = await readText(fpath) ?? "";
      let title = e.name.replace(/\.md$/, "");
      let status = "";
      for (const line of text.split("\n")) {
        const hm = line.match(/^#\s+(.*\S)\s*$/);
        if (hm) {
          title = hm[1].trim();
          break;
        }
      }
      const sm = text.match(/^status:\s*(.+\S)\s*$/im);
      if (sm) status = sm[1].trim();
      let body = text;
      if (text.trimStart().startsWith("---")) {
        const parts = text.split("---");
        if (parts.length >= 3) body = parts.slice(2).join("---");
      }
      out.push({ id: did, title, status, body: body.trim().slice(0, 8000) });
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  } catch {
    return [];
  }
}

function resolveVault(): string | null {
  const env = Deno.env.get("OBSIDIAN_VAULT_PATH") ?? Deno.env.get("TASKNOTES_VAULT");
  if (env) return env;
  const def = `${Deno.env.get("HOME")}/GITHUB/ObsidianPKM`;
  try {
    Deno.statSync(def);
    return def;
  } catch {
    return null;
  }
}

async function vaultChangelog(
  repoName: string,
  vault: string | null,
  limit = 5,
): Promise<string[]> {
  if (!vault) return [];
  const changelog = join(vault, "Efforts", "Work", "dgk", repoName, "CHANGELOG.md");
  const text = await readText(changelog);
  if (!text) return [];
  const lines = text.split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  return lines.slice(-limit).reverse();
}

export async function collectKnowledge(
  cwd: string,
  vaultPath?: string,
): Promise<Record<string, unknown>> {
  try {
    const repo = await repoRoot(cwd);
    const kdir = join(repo, "knowledge");

    // Decisions: prefer knowledge/decisions.md, else backlog/decisions/*.
    let decisions: Decision[] = [];
    const decMdPath = join(kdir, "decisions.md");
    const decMdText = await readText(decMdPath);
    if (decMdText) {
      decisions = parseDecisionsMd(decMdText);
    }
    if (!decisions.length) {
      decisions = await backlogDecisions(repo);
    }

    // lektion-*.md
    const lektionen: string[] = [];
    try {
      for await (const e of Deno.readDir(kdir)) {
        if (e.isFile && e.name.match(/^lektion-.*\.md$/)) lektionen.push(e.name);
      }
      lektionen.sort();
    } catch { /* no kdir */ }

    // knowledge/memory/*.md
    const memory: string[] = [];
    const memDir = join(kdir, "memory");
    try {
      for await (const e of Deno.readDir(memDir)) {
        if (e.isFile && e.name.endsWith(".md")) memory.push(e.name);
      }
      memory.sort();
    } catch { /* no memory dir */ }

    // Vault CHANGELOG tail
    const vault = vaultPath ?? resolveVault();
    const repoName = repo.split("/").pop()!;
    const changelog = await vaultChangelog(repoName, vault);

    return { available: true, decisions, lektionen, memory, changelog };
  } catch (exc) {
    return { available: false, reason: `collect_knowledge failed: ${exc}` };
  }
}
