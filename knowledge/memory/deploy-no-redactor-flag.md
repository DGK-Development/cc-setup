---
name: deploy-no-redactor-flag
description: deploy.sh --no-redactor Flag + Sentinel; diese Maschine ist bewusst redactor-frei
metadata: 
  node_type: memory
  type: project
  originSessionId: bc979326-c8c2-4093-89de-f7b2c984830c
---

`scripts/deploy.sh --no-redactor` (+ `just deploy-no-redactor`) entfernt Redactor: strippt `redactor hook`-Einträge aus `settings.json`, die `## Redactor (Strict Mode)`-Sektion aus dem cc-setup managed block UND eine handgeschriebene Redactor-Sektion aus der Home-CLAUDE.md (mit `.bak.<ts>`). Sentinel `$CLAUDE_HOME/.cc-setup-no-redactor` macht es persistent — künftige `just deploy`-Läufe bleiben auto redactor-frei.

**Status (2026-06-07):** Auf DIESER Maschine deployed gegen aktiven Config-Dir `/Users/niclasedge/claude niclasedge` (NICHT `~/.claude` — CLAUDE_CONFIG_DIR mit Leerzeichen!). settings.json 0 redactor-Hooks, CLAUDE.md redactor-frei, Sentinel gesetzt. Enforcement greift erst nach Claude-Code-**Restart**.

**Why:** User braucht redactor auf diesem Rechner nicht; Repo-Default bleibt aber redactor (CONTRACT.md unverändert) für andere Maschinen.

**How to apply:** Wenn redactor hier nicht enforced ist → kein Bug, Sentinel-gewollt. Bash-Calls brauchen in laufender Session evtl. noch `redactor wrap` bis Restart. Reaktivieren: Sentinel löschen + normaler `just deploy` (re-added managed block) + `redactor install-plugin global`. Code (deploy.sh+justfile) war Stand 2026-06-07 uncommitted + ungereviewt — Review separat (Org-Regel, [[org-rule-subagent-isolation]]). Restliche descriptive Erwähnung "redactor strict mode" in CONTRACT.md Z.3 bleibt. Vorsicht [[cc-setup-auto-sync-push-hazard]]: Stop-Hook könnte uncommitteten Code ungeprüft pushen.
