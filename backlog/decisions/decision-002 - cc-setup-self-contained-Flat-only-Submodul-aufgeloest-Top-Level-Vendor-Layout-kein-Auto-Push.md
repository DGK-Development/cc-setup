---
id: decision-002
title: >-
  cc-setup self-contained: Flat-only, Submodul aufgeloest,
  Top-Level-Vendor-Layout, kein Auto-Push
date: '2026-06-05 07:51'
status: accepted
---
## Context

cc-setup bündelte seine Runtime-Assets (context-load-Skill, context-init-Command, Hooks,
Scripts) über das Git-Submodul `vendor/cc-plugin-project-context` und installierte sie
auf zwei Wegen: einem Legacy-**Plugin/Marketplace**-Pfad (`just install` → Marketplace
`niclasedge-pkm`) und einem **Flat**-Pfad (`just setup`).

Drei Probleme:

1. `bundle.sh` rief `git submodule update --init --remote` — das verwarf bei jedem Build
   lokale Submodul-Commits (z.B. `d55c6c3`).
2. Zwei Install-Pfade erzeugten Skill-Dubletten und divergierende Quellen.
3. Der Stop-/Sync-Hook committete/pushte ungeprüft (belegt: `a3e52f9` mit kaputtem
   Submodul-Gitlink gepusht) — kollidiert mit der Org-Regel (KI-Code vor produktivem
   Einsatz human-reviewt; Entwicklung ≠ Review in einer Session).

Beim Vendoring stellten sich vier Entscheidungen, die in dieser Session mit dem User
geklärt wurden (Milestone `ccs-flat`, CCS-005..009).

## Decision

1. **Self-contained Flat-only.** Submodul `cc-plugin-project-context` aufgelöst, Inhalt
   direkt ins Repo vendored. `bundle.sh` liest Quellen repo-lokal, kein
   `submodule update --remote` mehr. Der Legacy-Plugin-/Marketplace-Pfad
   (`just install`, `templates/.claude-plugin/`, plugin validate) ist entfernt — `just setup`
   ist der einzige Install-Weg. `vendor/hook-redactor` bleibt Submodul (eigener Upstream).

2. **Vendor-Layout = Top-Level-Dirs.** Submodul-Inhalt landet als `hooks/`, `commands/`,
   Runtime-Scripts gemischt in `scripts/`, der context-load-Skill unter
   `templates/skills/context-load/`. (Verworfen: dediziertes `runtime/`-Verzeichnis,
   Bündelung unter `templates/`.) Namenskonflikt: Submodul-`scripts/setup.sh`
   (Dep-Bootstrap) → `scripts/context-deps.sh`, da `scripts/setup.sh` der Flat-Installer ist.

3. **Stop-/Sync-Hook: kein Auto-Push.** `stop-workflow.sh` + `pkm-sync-stop.sh` werden als
   managed source ins Repo vendored und gehärtet: NIE automatisch pushen (commit-only
   lokal; Push immer manuell/human), Auto-Commit substanzieller Artefakte nur auf
   explizites Signal, Submodul-Pointer-Guard vor (manuellem) Push. (Verworfen:
   Env-Var-Opt-in für Auto-Push; nur die SKILL härten ohne Hooks zu vendoren.)

4. **Deploy-Grenze für KI-Sessions = nur Repo + Test-Home.** Implementierung läuft über
   Developer-Subagenten, Review über einen separaten Reviewer-Subagenten (Dev ≠ Review).
   Es wird in den feature-branch committet und gegen ein temporäres CLAUDE_HOME verifiziert
   — **kein** `git push`, **kein** Anfassen des echten `~/.claude`. Push, Live-Install
   (`just setup` + Restart) und Marketplace-Uninstall macht der Mensch in separater Session.

## Consequences

- cc-setup ist self-contained; frische Clones brauchen kein
  `cc-plugin-project-context`-Submodul. `git submodule status` zeigt nur `hook-redactor`.
- Eine einzige Install-Wahrheit (`just setup`) → keine Skill-Dubletten mehr (verifiziert:
  12 Skills, flach, kein Plugin-Namespace).
- Der Flat-only-Pfad deckte zwei latente `setup.sh`-Bugs auf, die unter dem Plugin-Pfad nie
  liefen: GNU-only `sed -i` (BSD/macOS bricht) und bare `python3` (uv-strict) — beide gefixt.
- Skill-Bodies/Hooks dürfen `${CLAUDE_PLUGIN_ROOT}` nicht mehr annehmen; `setup.sh` patcht
  Rest-Referenzen defensiv auf den absoluten Flat-Pfad (`$HOME/.claude/skills/cc-setup/scripts/`).
- Der Stop-Hook pusht nicht mehr automatisch — sicher, aber der Mensch muss bewusst pushen.
  Bis der gehärtete Hook deployt ist, bleibt der alte Live-Hook der Hazard (s. CCS-010 für
  die externen Sub-Hooks `$PAI_DIR/hooks/*`).
- Offen/human-gated: CCS-005.09 AC#4 (Live-Status-intent-Skip gegen die laufende
  context-load) ist erst nach Deploy + Restart verifizierbar.

Verwandt: decision-001 (Knowledge-Daten pro Repo via Backlog). Tasks: CCS-005 (+ .01–.09),
CCS-006, CCS-008, CCS-009. Operativer Guide: doc-002 (Architektur & Deployment).
