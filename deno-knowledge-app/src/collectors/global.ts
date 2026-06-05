// collect_global — mirrors knowledge.py collect_global
// Inspects ~/.claude: CLAUDE.md, skills/, settings.json hooks (keys only, no env values), agents/

import { readText } from "../shared.ts";
import { estTokens, frontmatterField, mdHeaders } from "../md.ts";
import { join } from "@std/path";

const SCRIPT_EXTS = new Set([
  ".py",
  ".sh",
  ".bash",
  ".zsh",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".rb",
  ".pl",
  ".lua",
]);

interface ScriptMeta {
  path: string;
  size: number;
  lang: string;
}

interface SkillMeta {
  name: string;
  description: string;
  tokens: number;
  size_bytes: number;
  has_md: boolean;
  scripts: ScriptMeta[];
}

interface AgentMeta {
  name: string;
  tokens: number;
  size_bytes: number;
  description: string;
}

async function scanScripts(root: string, limit = 40): Promise<ScriptMeta[]> {
  const out: ScriptMeta[] = [];
  try {
    for await (const entry of Deno.readDir(root)) {
      if (out.length >= limit) break;
      const fullPath = join(root, entry.name);
      if (entry.isDirectory) {
        const sub = await scanScripts(fullPath, limit - out.length);
        out.push(...sub);
      } else if (entry.isFile) {
        const dotIdx = entry.name.lastIndexOf(".");
        const ext = dotIdx >= 0 ? entry.name.slice(dotIdx) : "";
        if (!SCRIPT_EXTS.has(ext.toLowerCase())) continue;
        try {
          const stat = await Deno.stat(fullPath);
          const rel = fullPath.slice(root.length + 1);
          out.push({ path: rel, size: stat.size, lang: ext.slice(1) });
        } catch {
          // skip
        }
      }
    }
  } catch {
    // dir not readable
  }
  return out;
}

async function skillMeta(skillDir: string): Promise<SkillMeta> {
  const name = skillDir.split("/").pop()!;
  const mdPath = join(skillDir, "SKILL.md");
  const scripts = await scanScripts(skillDir);
  const base: SkillMeta = {
    name,
    description: "",
    tokens: 0,
    size_bytes: 0,
    has_md: false,
    scripts,
  };
  try {
    const stat = await Deno.stat(mdPath);
    const text = await readText(mdPath);
    if (!text) return base;
    return {
      name,
      description: frontmatterField(text, "description"),
      tokens: estTokens(text),
      size_bytes: stat.size,
      has_md: true,
      scripts,
    };
  } catch {
    return base;
  }
}

async function agentMeta(agentMd: string): Promise<AgentMeta> {
  const filename = agentMd.split("/").pop()!;
  const name = filename.replace(/\.md$/, "");
  try {
    const stat = await Deno.stat(agentMd);
    const text = await readText(agentMd);
    if (!text) return { name, tokens: 0, size_bytes: 0, description: "" };
    return {
      name,
      tokens: estTokens(text),
      size_bytes: stat.size,
      description: frontmatterField(text, "description"),
    };
  } catch {
    return { name, tokens: 0, size_bytes: 0, description: "" };
  }
}

export async function collectGlobal(claudeHome: string): Promise<Record<string, unknown>> {
  try {
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.stat(claudeHome);
    } catch {
      return { available: false, reason: `~/.claude not found: ${claudeHome}` };
    }
    if (!stat.isDirectory) {
      return { available: false, reason: `~/.claude not found: ${claudeHome}` };
    }

    const data: Record<string, unknown> = { available: true, home: claudeHome };

    // CLAUDE.md
    const claudeMdPath = join(claudeHome, "CLAUDE.md");
    const claudeMdText = await readText(claudeMdPath);
    if (claudeMdText !== null) {
      let size = 0;
      try {
        size = (await Deno.stat(claudeMdPath)).size;
      } catch { /* ok */ }
      const managed = /<!--\s*BEGIN cc-setup\s*-->/.test(claudeMdText) &&
        /<!--\s*END cc-setup\s*-->/.test(claudeMdText);
      data.claude_md = {
        size_bytes: size,
        tokens: estTokens(claudeMdText),
        headers: mdHeaders(claudeMdText, [2]),
        managed_block: managed,
      };
    } else {
      data.claude_md = null;
    }

    // skills/
    const skillsDir = join(claudeHome, "skills");
    const skillDirs: string[] = [];
    try {
      for await (const e of Deno.readDir(skillsDir)) {
        if (e.isDirectory && !e.name.startsWith(".") && !e.name.startsWith("_")) {
          skillDirs.push(join(skillsDir, e.name));
        }
      }
      skillDirs.sort();
    } catch { /* no skills dir */ }
    const skillItems = await Promise.all(skillDirs.map(skillMeta));
    const skillNames = skillDirs.map((d) => d.split("/").pop()!);
    data.skills = { count: skillNames.length, names: skillNames, items: skillItems };

    // settings.json hooks — event names, matcher, type, command. env NEVER read.
    const settingsPath = join(claudeHome, "settings.json");
    const settingsText = await readText(settingsPath);
    if (settingsText !== null) {
      try {
        const raw = JSON.parse(settingsText) as Record<string, unknown>;
        const hooks = (raw.hooks ?? {}) as Record<string, unknown>;
        const events: Record<string, number> = {};
        const detail: Record<string, Array<Record<string, string>>> = {};
        if (typeof hooks === "object") {
          for (const [eventName, matchers] of Object.entries(hooks)) {
            let n = 0;
            const entries: Array<Record<string, string>> = [];
            if (Array.isArray(matchers)) {
              for (const matcher of matchers) {
                if (!matcher || typeof matcher !== "object") continue;
                const pattern = String((matcher as Record<string, unknown>).matcher ?? "");
                const inner = (matcher as Record<string, unknown>).hooks;
                if (!Array.isArray(inner)) continue;
                for (const h of inner) {
                  if (!h || typeof h !== "object") continue;
                  n++;
                  entries.push({
                    matcher: pattern,
                    type: String((h as Record<string, unknown>).type ?? ""),
                    command: String((h as Record<string, unknown>).command ?? ""),
                  });
                }
              }
            }
            events[eventName] = n;
            detail[eventName] = entries;
          }
        }
        data.settings = { hook_events: events, hook_detail: detail };
      } catch {
        data.settings = { hook_events: {}, hook_detail: {}, parse_error: true };
      }
    } else {
      data.settings = null;
    }

    // agents/*.md
    const agentsDir = join(claudeHome, "agents");
    const agentFiles: string[] = [];
    try {
      for await (const e of Deno.readDir(agentsDir)) {
        if (e.isFile && e.name.endsWith(".md")) {
          agentFiles.push(join(agentsDir, e.name));
        }
      }
      agentFiles.sort();
    } catch { /* no agents dir */ }
    data.agents = agentFiles.map((f) => f.split("/").pop()!.replace(/\.md$/, ""));
    data.agent_items = await Promise.all(agentFiles.map(agentMeta));

    return data;
  } catch (exc) {
    return { available: false, reason: `collect_global failed: ${exc}` };
  }
}
