// plugins — enumeriert enabled Plugins aus settings.json + installed_plugins.json
// und liefert Skills/Agents-Metadaten mit Quell-Gruppe für die Kontext-View.
//
// Org-Regel: KEINE tn-Inhalte; keine Cross-Project-Aggregation.
// Kein Python-Spawn; reine Dateisystem-Enumeration.

import { readText } from "../shared.ts";
import { estTokens, frontmatterField } from "../md.ts";
import { ctxTok } from "./context_view.ts";
import { join } from "@std/path";

/** Ein Skill-/Agent-Eintrag aus einem Plugin oder Projekt. */
export interface PluginItem {
  name: string;
  description: string;
  /** Kalibrierte Token-Schätzung (ctxTok = estTokens × CTX_CALIB). */
  meta_tokens: number;
  /** Quell-Gruppe für die UI, z.B. "User", "Plugin · superpowers", "Project". */
  group: string;
  /** readDoc-Kind für inline file viewer. */
  read: string;
  /** Absoluter Pfad (für read="homefile" oder read="project-agent"). */
  readPath?: string;
}

/** Liest enabledPlugins-Keys aus settings.json (nur true-Werte). */
async function readEnabledPlugins(claudeHome: string): Promise<Set<string>> {
  const settingsPath = join(claudeHome, "settings.json");
  const text = await readText(settingsPath);
  if (!text) return new Set();
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const ep = (raw.enabledPlugins ?? {}) as Record<string, unknown>;
    const enabled = new Set<string>();
    for (const [k, v] of Object.entries(ep)) {
      if (v === true) enabled.add(k);
    }
    return enabled;
  } catch {
    return new Set();
  }
}

/** Liest installPath für alle bekannten Plugins aus installed_plugins.json. */
async function readInstallPaths(
  claudeHome: string,
): Promise<Map<string, string>> {
  // installed_plugins.json liegt unter claudeHome/plugins/installed_plugins.json
  const ipPath = join(claudeHome, "plugins", "installed_plugins.json");
  const text = await readText(ipPath);
  if (!text) return new Map();
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const plugins = (raw.plugins ?? {}) as Record<
      string,
      Array<Record<string, unknown>>
    >;
    const paths = new Map<string, string>();
    for (const [key, entries] of Object.entries(plugins)) {
      if (!Array.isArray(entries) || entries.length === 0) continue;
      const ip = String(entries[0].installPath ?? "");
      if (ip) paths.set(key, ip);
    }
    return paths;
  } catch {
    return new Map();
  }
}

/** Liest SKILL.md-Metadaten (name + description) aus einem Skill-Verzeichnis. */
async function readSkillMeta(
  skillDir: string,
  skillName: string,
  group: string,
): Promise<PluginItem | null> {
  const mdPath = join(skillDir, "SKILL.md");
  const text = await readText(mdPath);
  if (text === null) return null;
  const description = frontmatterField(text, "description");
  const meta_tokens = ctxTok(estTokens(skillName + "\n" + description));
  // Plugin-Skills liegen stets unter ~/.claude/plugins/ → readDoc-homefile-Grenze greift;
  // "homefile" ist das korrekte Kind (erzwingt under(claudeHome) in readDoc).
  return {
    name: skillName,
    description,
    meta_tokens,
    group,
    read: "homefile",
    readPath: mdPath,
  };
}

/** Liest Agent-Metadaten (name + description) aus einer .md-Datei. */
async function readAgentMeta(
  agentMdPath: string,
  agentName: string,
  group: string,
  read: string,
): Promise<PluginItem | null> {
  const text = await readText(agentMdPath);
  if (text === null) return null;
  const description = frontmatterField(text, "description");
  const meta_tokens = ctxTok(estTokens(agentName + "\n" + description));
  return {
    name: agentName,
    description,
    meta_tokens,
    group,
    read,
    readPath: agentMdPath,
  };
}

/**
 * Sammelt Plugin-Skills und Plugin-Agents aus allen enabled Plugins.
 * Reihenfolge der Quell-Gruppe in der Kontext-View: Project → User → Plugin → Built-in.
 * Diese Funktion liefert NUR die Plugin-Einträge (User-Items kommen aus collectGlobal).
 */
async function collectPluginItems(claudeHome: string): Promise<{
  skills: PluginItem[];
  agents: PluginItem[];
}> {
  const skills: PluginItem[] = [];
  const agents: PluginItem[] = [];

  try {
    const enabled = await readEnabledPlugins(claudeHome);
    if (enabled.size === 0) return { skills, agents };

    const installPaths = await readInstallPaths(claudeHome);

    for (const pluginKey of enabled) {
      const installPath = installPaths.get(pluginKey);
      if (!installPath) continue;

      // Plugin-Name (ohne @marketplace) als Gruppen-Label
      const pluginName = pluginKey.split("@")[0];
      const group = `Plugin · ${pluginName}`;

      // Plugin-Skills aus <installPath>/skills/<skill-dir>/SKILL.md
      const skillsDir = join(installPath, "skills");
      try {
        for await (const entry of Deno.readDir(skillsDir)) {
          if (!entry.isDirectory || entry.name.startsWith(".")) continue;
          const skillDir = join(skillsDir, entry.name);
          const item = await readSkillMeta(skillDir, entry.name, group);
          if (item) skills.push(item);
        }
      } catch {
        // kein skills/-Verzeichnis in diesem Plugin
      }

      // Plugin-Agents aus <installPath>/agents/*.md
      const agentsDir = join(installPath, "agents");
      try {
        for await (const entry of Deno.readDir(agentsDir)) {
          if (!entry.isFile || !entry.name.endsWith(".md")) continue;
          const name = entry.name.replace(/\.md$/, "");
          const mdPath = join(agentsDir, entry.name);
          const item = await readAgentMeta(mdPath, name, group, "homefile");
          if (item) agents.push(item);
        }
      } catch {
        // kein agents/-Verzeichnis
      }
    }
  } catch {
    // collectPluginItems ist best-effort — nie einen Fehler nach oben durchreichen
  }

  return { skills, agents };
}

/**
 * Sammelt Project-Agents aus <repoRoot>/.claude/agents/*.md.
 * Nutzt read="project-agent" (neuer readDoc-Kind in render.ts).
 */
async function collectProjectAgents(cwd: string): Promise<PluginItem[]> {
  const agents: PluginItem[] = [];
  // repoRoot-Import hier vermeiden (Zirkularität) — direktes .claude/agents-Lookup
  // ausgehend vom cwd bis zum Git-Root ist nicht nötig; wir nutzen den übergebenen cwd
  // direkt (buildContext übergibt den aufgelösten repoRoot-cwd).
  const agentsDir = join(cwd, ".claude", "agents");
  try {
    for await (const entry of Deno.readDir(agentsDir)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      // Name-Whitelist: Traversal-Abwehr (gespiegelt von readDoc)
      if (!/^[A-Za-z0-9._-]+$/.test(entry.name.replace(/\.md$/, ""))) continue;
      const name = entry.name.replace(/\.md$/, "");
      const mdPath = join(agentsDir, entry.name);
      const item = await readAgentMeta(mdPath, name, "Project", "project-agent");
      if (item) agents.push(item);
    }
  } catch {
    // kein .claude/agents-Verzeichnis
  }
  return agents;
}
