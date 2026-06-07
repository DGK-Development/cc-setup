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
  mtime?: number; // epoch seconds
}

export interface MemoryEntry {
  name: string;
  mtime: number; // epoch seconds
}

export interface LektionEntry {
  name: string;
  mtime: number; // epoch seconds
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
      let mtime = 0;
      try {
        const stat = await Deno.stat(fpath);
        mtime = stat.mtime ? Math.floor(stat.mtime.getTime() / 1000) : 0;
      } catch { /* ok */ }
      out.push({ id: did, title, status, body: body.trim().slice(0, 8000), mtime });
    }
    // Sort: mtime DESC (newest first), then id as tiebreaker
    out.sort((a, b) => {
      const md = (b.mtime ?? 0) - (a.mtime ?? 0);
      if (md !== 0) return md;
      return a.id.localeCompare(b.id);
    });
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

export interface ChangelogEntry {
  heading: string; // e.g. "## 2024-06-01 — feat: foo"
  body: string; // lines below the heading until next heading
}

/** Parse a CHANGELOG.md into blocks (one block = one `##`/`###` heading + its body).
 *  H1 (`#`) is treated as document title and skipped.
 *  Blocks with empty body are skipped (avoids the document-title artefact).
 *  Result is sorted newest-first: if headings contain ISO dates and the file
 *  appears to be oldest-first (first date < last date), the array is reversed.
 */
export function parseChangelogBlocks(text: string, limit = 20): ChangelogEntry[] {
  const blocks: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  const bodyLines: string[] = [];

  function flush() {
    if (current !== null) {
      const body = bodyLines.join("\n").trim();
      if (body) {
        current.body = body;
        blocks.push(current);
      }
      current = null;
    }
    bodyLines.length = 0;
  }

  for (const line of text.split("\n")) {
    // Only ## and ### are release-entry headings; # is document title → skip
    if (/^#{2,3}\s+/.test(line)) {
      flush();
      current = { heading: line.trim(), body: "" };
    } else if (/^#\s+/.test(line)) {
      // H1: flush any open block but don't start a new entry
      flush();
    } else if (current !== null) {
      bodyLines.push(line);
    }
  }
  flush();

  // Ensure newest-first: detect oldest-first by comparing ISO-date in first vs last heading.
  const dateRe = /(\d{4}-\d{2}-\d{2})/;
  if (blocks.length >= 2) {
    const firstDate = (blocks[0].heading.match(dateRe) ?? [])[1];
    const lastDate = (blocks[blocks.length - 1].heading.match(dateRe) ?? [])[1];
    if (firstDate && lastDate && firstDate < lastDate) {
      blocks.reverse(); // file was oldest-first → flip to newest-first
    }
  }

  return blocks.slice(0, limit);
}

async function vaultChangelog(
  repo: string,
  repoName: string,
  vault: string | null,
  limit = 20,
): Promise<ChangelogEntry[]> {
  // Prefer repo-local knowledge/CHANGELOG.md first.
  const localPath = join(repo, "knowledge", "CHANGELOG.md");
  const localText = await readText(localPath);
  if (localText) return parseChangelogBlocks(localText, limit);

  // Fall back to vault path (dgk-specific).
  if (!vault) return [];
  const vaultPath = join(vault, "Efforts", "Work", "dgk", repoName, "CHANGELOG.md");
  const vaultText = await readText(vaultPath);
  if (!vaultText) return [];
  return parseChangelogBlocks(vaultText, limit);
}

export interface DocEntry {
  id: string;
  title: string;
  file: string; // filename within backlog/docs/
  mtime?: number; // epoch seconds
}

/** Read backlog/docs/*.md — like backlogDecisions but for docs. */
async function backlogDocs(repo: string): Promise<DocEntry[]> {
  const docsDir = join(repo, "backlog", "docs");
  const out: DocEntry[] = [];
  try {
    for await (const e of Deno.readDir(docsDir)) {
      if (!e.isFile || !e.name.endsWith(".md")) continue;
      const fpath = join(docsDir, e.name);
      const text = await readText(fpath) ?? "";
      // Extract title from frontmatter or first heading
      let title = e.name.replace(/\.md$/, "");
      const fm = text.match(/^---\n([\s\S]*?)\n---/);
      if (fm) {
        const tm = fm[1].match(/^title:\s*(.+\S)\s*$/im);
        if (tm) title = tm[1].replace(/^["']|["']$/g, "").trim();
      }
      if (title === e.name.replace(/\.md$/, "")) {
        for (const line of text.split("\n")) {
          const hm = line.match(/^#\s+(.*\S)\s*$/);
          if (hm) {
            title = hm[1].trim();
            break;
          }
        }
      }
      // id from frontmatter or filename
      let id = e.name.replace(/\.md$/, "");
      if (fm) {
        const im = fm[1].match(/^id:\s*(.+\S)\s*$/im);
        if (im) id = im[1].trim();
      }
      let mtime = 0;
      try {
        const stat = await Deno.stat(fpath);
        mtime = stat.mtime ? Math.floor(stat.mtime.getTime() / 1000) : 0;
      } catch { /* ok */ }
      out.push({ id, title, file: e.name, mtime });
    }
    // Sort: mtime DESC (newest first)
    out.sort((a, b) => {
      const md = (b.mtime ?? 0) - (a.mtime ?? 0);
      if (md !== 0) return md;
      return a.id.localeCompare(b.id);
    });
  } catch { /* no docs dir */ }
  return out;
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
      // All decisions from decisions.md share the file mtime
      let decMdMtime = 0;
      try {
        const stat = await Deno.stat(decMdPath);
        decMdMtime = stat.mtime ? Math.floor(stat.mtime.getTime() / 1000) : 0;
      } catch { /* ok */ }
      for (const d of decisions) {
        d.mtime = decMdMtime;
      }
      // Sort: mtime DESC (all same mtime here), then id as tiebreaker
      decisions.sort((a, b) => {
        const md = (b.mtime ?? 0) - (a.mtime ?? 0);
        if (md !== 0) return md;
        return a.id.localeCompare(b.id);
      });
    }
    if (!decisions.length) {
      decisions = await backlogDecisions(repo);
    }

    // lektion-*.md + optional lessons-learned.md — with mtime, sorted newest-first
    const lektionen: LektionEntry[] = [];
    try {
      for await (const e of Deno.readDir(kdir)) {
        if (e.isFile && e.name.match(/^lektion-.*\.md$/)) {
          let mtime = 0;
          try {
            const stat = await Deno.stat(join(kdir, e.name));
            mtime = stat.mtime ? Math.floor(stat.mtime.getTime() / 1000) : 0;
          } catch { /* ok */ }
          lektionen.push({ name: e.name, mtime });
        }
      }
    } catch { /* no kdir */ }
    // Include lessons-learned.md as a special entry if present
    const lessonsFile = join(kdir, "lessons-learned.md");
    try {
      const stat = await Deno.stat(lessonsFile);
      const mtime = stat.mtime ? Math.floor(stat.mtime.getTime() / 1000) : 0;
      lektionen.push({ name: "lessons-learned.md", mtime });
    } catch { /* not present → skip */ }
    // Sort: newest first
    lektionen.sort((a, b) => b.mtime - a.mtime);

    // knowledge/memory/*.md — with mtime, sorted newest-first
    const memory: MemoryEntry[] = [];
    const memDir = join(kdir, "memory");
    try {
      for await (const e of Deno.readDir(memDir)) {
        if (e.isFile && e.name.endsWith(".md")) {
          let mtime = 0;
          try {
            const stat = await Deno.stat(join(memDir, e.name));
            mtime = stat.mtime ? Math.floor(stat.mtime.getTime() / 1000) : 0;
          } catch { /* ok */ }
          memory.push({ name: e.name, mtime });
        }
      }
    } catch { /* no memory dir */ }
    // Sort: newest first
    memory.sort((a, b) => b.mtime - a.mtime);

    // CHANGELOG: prefer knowledge/CHANGELOG.md, fall back to vault path
    const vault = vaultPath ?? resolveVault();
    const repoName = repo.split("/").pop()!;
    const changelog = await vaultChangelog(repo, repoName, vault);

    // backlog/docs/*.md
    const docs = await backlogDocs(repo);

    return { available: true, decisions, lektionen, memory, changelog, docs };
  } catch (exc) {
    return { available: false, reason: `collect_knowledge failed: ${exc}` };
  }
}
