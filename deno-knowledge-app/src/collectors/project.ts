// collect_project — mirrors knowledge.py collect_project
// Inspects cwd repo: name, branch, CLAUDE.md headers, knowledge/ index.

import { readText } from "../shared.ts";
import { estTokens, mdHeaders } from "../md.ts";
import { join } from "@std/path";
import { run } from "../shared.ts";

async function repoRoot(cwd: string): Promise<string> {
  const out = await run(["git", "-C", cwd, "rev-parse", "--show-toplevel"], { cwd });
  return out ? out.trim() : cwd;
}

interface KnowledgeEntry {
  title: string;
  path: string;
  desc: string;
}

const LINK_RE = /^\s*-\s*\[([^\]]+)\]\(([^)]+)\)\s*(?:—|--)?\s*(.*)\s*$/;

async function knowledgeIndex(repo: string): Promise<KnowledgeEntry[]> {
  const readmePath = join(repo, "knowledge", "README.md");
  const text = await readText(readmePath);
  if (!text) return [];
  const entries: KnowledgeEntry[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(LINK_RE);
    if (!m) continue;
    const path = m[2].trim();
    if (path.includes("<") || path.includes(">") || path.includes("://")) continue;
    entries.push({ title: m[1].trim(), path, desc: m[3].trim() });
  }
  return entries;
}

// Hooks: sum of all hook entries across settings.json + settings.local.json
function countHooksInSettings(text: string): number {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const hooks = (raw.hooks ?? {}) as Record<string, unknown>;
    let n = 0;
    if (typeof hooks === "object") {
      for (const matchers of Object.values(hooks)) {
        if (!Array.isArray(matchers)) continue;
        for (const matcher of matchers) {
          if (!matcher || typeof matcher !== "object") continue;
          const inner = (matcher as Record<string, unknown>).hooks;
          if (!Array.isArray(inner)) continue;
          for (const h of inner) {
            if (h && typeof h === "object") n++;
          }
        }
      }
    }
    return n;
  } catch {
    return 0;
  }
}

async function collectProject(cwd: string): Promise<Record<string, unknown>> {
  try {
    const repo = await repoRoot(cwd);
    const branch = await run(["git", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], { cwd });
    const data: Record<string, unknown> = {
      available: true,
      repo: repo.split("/").pop(),
      repo_path: repo,
      branch: branch ? branch.trim() : null,
    };

    const claudeMdPath = join(repo, "CLAUDE.md");
    const claudeMdText = await readText(claudeMdPath);
    if (claudeMdText !== null) {
      let size = 0;
      try {
        size = (await Deno.stat(claudeMdPath)).size;
      } catch { /* ok */ }
      data.claude_md_headers = mdHeaders(claudeMdText, [1, 2]).slice(0, 20);
      data.claude_md_tokens = estTokens(claudeMdText);
      data.claude_md_size = size;
    } else {
      data.claude_md_headers = [];
      data.claude_md_tokens = 0;
      data.claude_md_size = 0;
    }

    data.knowledge_index = await knowledgeIndex(repo);

    // Projekt-lokale .claude/ settings: skills count, agents count, hooks count
    const projClaudeDir = join(repo, ".claude");

    // Skills: subdirectories in .claude/skills/
    let projSkillsCount = 0;
    try {
      const skillsDir = join(projClaudeDir, "skills");
      for await (const e of Deno.readDir(skillsDir)) {
        if (e.isDirectory) projSkillsCount++;
      }
    } catch { /* no skills dir → 0 */ }
    data.proj_skills_count = projSkillsCount;

    // Agents: *.md files in .claude/agents/
    let projAgentsCount = 0;
    try {
      const agentsDir = join(projClaudeDir, "agents");
      for await (const e of Deno.readDir(agentsDir)) {
        if (e.isFile && e.name.endsWith(".md")) projAgentsCount++;
      }
    } catch { /* no agents dir → 0 */ }
    data.proj_agents_count = projAgentsCount;

    // Hooks: sum of all hook entries across settings.json + settings.local.json
    let projHooksCount = 0;
    try {
      const settingsText = await readText(join(projClaudeDir, "settings.json"));
      if (settingsText) projHooksCount += countHooksInSettings(settingsText);
    } catch { /* ok */ }
    try {
      const settingsLocalText = await readText(join(projClaudeDir, "settings.local.json"));
      if (settingsLocalText) projHooksCount += countHooksInSettings(settingsLocalText);
    } catch { /* ok */ }
    data.proj_hooks_count = projHooksCount;

    return data;
  } catch (exc) {
    return { available: false, reason: `collect_project failed: ${exc}` };
  }
}
