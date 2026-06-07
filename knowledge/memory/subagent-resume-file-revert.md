---
name: fallow-stop-hook-strips-exports
description: "cleanup-dispatch-stop.sh läuft `fallow fix --yes` bei Stop und strippt `export` von Symbolen, deren Consumer fallow nicht sieht (.pi/ Dot-Dir, nur-Test-Nutzung)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 08d0e3a6-b6fa-4850-8ab1-161a694d9689
---

Beim Bau von CCS-036 (cc-setup) verschwand das `export`-Keyword auf `scripts/slack-ask.ts`
(`askSlack`, `classifyHumanAnswer`) **viermal** reproduzierbar — Tests dann 0 pass. Ursache final belegt:
`~/.claude/hooks/cleanup-dispatch-stop.sh` führt bei jedem **Stop** `fallow fix --yes` aus (Z.45), das
„unused exports" entfernt. `fallow list` zeigte nur `scripts/*.ts` als gescannt — **`.pi/extensions/cc-orchestrator.ts`** (der Consumer von `classifyHumanAnswer`) liegt im **Dot-Dir `.pi/`, das fallow nicht scannt**; `askSlack` wird nur via Subprozess-CLI + Test genutzt. Also hält fallow beide für tot und strippt `export`. (Frühere Hypothese „Subagent-Resume-Drift" war falsch.)

**Why:** Ein Stop-Hook, der `fallow fix --yes` ungezielt über alle geänderten TS-Files fährt, mutiert
neu-hinzugefügten Library-Code, dessen Consumer außerhalb von fallows Scan-Scope liegen (Dot-Dirs,
Subprozess-CLIs, nur-Test-Nutzung). Verschärft [[subagent-selfreport-verify]] und [[cc-setup-auto-sync-push-hazard]] (Stop-Hook mutiert ungeprüft).

**How to apply:** (1) Nach JEDEM Stop / Subagent-Zyklus den Plattenzustand neuer Exporte selbst prüfen
(`sed -n`, `bun test`) — `fallow fix --dry-run --format compact` zeigt, ob fallow strippen würde.
(2) Robuster Fix: `.fallowrc.json` im Repo-Root mit `ignoreExports` für die betroffene Datei ODER
`.pi/extensions/**` als `entryPoints` registrieren (Schema: `fallow config-schema`; `fallow init`).
(3) Triviale, vom Reviewer vorab freigegebene Wiederherstellungen (Keyword zurück) deterministisch selbst
per Edit — dev≠review bleibt gewahrt (Review fand in separater Session statt).
