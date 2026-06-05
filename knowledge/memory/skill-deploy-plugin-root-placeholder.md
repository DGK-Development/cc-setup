---
name: skill-deploy-plugin-root-placeholder
description: "cc-setup Skills MUESSEN ${CLAUDE_PLUGIN_ROOT}-Platzhalter nutzen, nicht hardcoded $HOME/.claude — deploy.sh substituiert zur Deploy-Zeit"
metadata: 
  node_type: memory
  type: project
  originSessionId: 58981769-d854-47ac-9392-515460c2091d
---

In cc-setup-Skills (`skills/*/SKILL.md`) für Skript-Pfade IMMER den Platzhalter
`${CLAUDE_PLUGIN_ROOT}/scripts/...` verwenden — NICHT hardcoded `$HOME/.claude/...`.

`${CLAUDE_PLUGIN_ROOT}` ist **kein Runtime-Var** (im Bash-Tool unset → leer →
`/scripts/...` Fehler). Es ist ein **Deploy-Zeit-Platzhalter**: `deploy.sh`
ersetzt ihn per `sed` durch den absoluten Flat-Pfad `$CC_SETUP_DIR`
(= `$CLAUDE_HOME/skills/cc-setup`). local-ci + audit machen das korrekt;
context-load war fälschlich auf hardcoded `$HOME/.claude` umgestellt → brach,
weil der aktive `CLAUDE_CONFIG_DIR` = `~/claude niclasedge` (nicht `~/.claude`).

Zweiter Teil des Fixes: `deploy.sh` defaultet `CLAUDE_HOME` jetzt auf
`$CLAUDE_CONFIG_DIR` (Precedence: `--home` > `$CLAUDE_HOME` > `$CLAUDE_CONFIG_DIR`
> `$HOME/.claude`), damit `just deploy` ohne Args den aktiven Config-Dir trifft.

**Why:** Stale Deploy + hardcoded falscher Home → context-load-Skripte
unauffindbar bei jedem Session-Start. **How to apply:** Neue Skill-Skript-Refs
mit `${CLAUDE_PLUGIN_ROOT}` schreiben; nach Skill-Edits `just deploy` laufen +
mit `grep -c CLAUDE_PLUGIN_ROOT <deployte SKILL.md>` (soll 0) verifizieren.
Verwandt: [[cc-setup-flat-migration]], [[cc-setup-auto-sync-push-hazard]].
