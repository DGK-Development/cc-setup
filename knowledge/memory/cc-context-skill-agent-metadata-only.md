---
name: cc-context-skill-agent-metadata-only
description: "Claude Code lädt beim Session-Start nur Skill/Agent-Metadaten (name+description), nicht die ganze Datei — relevant für /context-Footprint-Schätzung"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 1bdd687b-70a3-4179-8bef-ed2eefdf201f
---

Claude Code progressive disclosure: beim Session-Start kommen je **Skill** nur `name` + `description` (Frontmatter) in den Kontext — der volle `SKILL.md`-Body erst bei Invocation. **Subagents** laufen isoliert (eigener Context-Window); im Hauptkontext steht nur `name`+`description` der Agent-Registry (damit der Orchestrator weiß, was dispatchbar ist), nicht der volle Agent-System-Prompt.

**Für Token-Footprint-Tools (z.B. deno-knowledge-app Kontext-View):** pro Skill/Agent NUR `estTokens(name + description)` zählen, NICHT `estTokens(ganze Datei)`. Belegt: die Kontext-View zählte ganze Dateien → 128k statt ~28k (Skills 68k vs 4.9k, Agents 39k vs 1.2k; Faktor ~4.5 Über-Zählung).

Rest-Ungenauigkeit gegen echtes `/context` bleibt: `estTokens`=Zeichen/4 unterschätzt Markdown ~40 %, und die App sieht nur `~/.claude/skills` (keine Plugin-/Built-in-Skills, die `/context` mitzählt).

Quellen: code.claude.com/docs — how-claude-code-works, skills, sub-agents. Siehe [[subagent-selfreport-verify]].
