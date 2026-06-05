---
name: cc-setup-flat-migration
description: "Flat-Install-Migration (Submodul aufgelöst) ist in-repo fertig, aber UNGEPUSHT und NICHT live-deployed"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9ef0bdae-f42d-4109-b5f4-38be4f0d96ad
---

Milestone `ccs-flat` (CCS-005 + .01–.09) plus CCS-006/007/008/009 **und** CCS-012 (voll-flache Quelle + `just deploy`, dist/ ephemer) sind implementiert, verifiziert (49 Tests, isolierter Deploy gegen temp CLAUDE_HOME, Reviewer-Subagent PASS) und auf Branch `feat/session-analyser-flat-install` committed. **Branch ist auf origin gepusht (2026-06-05), aber NICHT nach `main` gemergt und NICHT live deployed** (Org-Regel: Merge/Deploy = Review in separater Session). `gh pr create` scheiterte an Collaborator-Rechten des gh-Accounts → PR manuell anlegen. Die laufende Umgebung nutzt weiter das alte Marketplace-Plugin `niclasedge-pkm`.

cc-setup ist jetzt self-contained: Submodul `cc-plugin-project-context` ist aufgelöst, Inhalt liegt repo-lokal (`scripts/`, `hooks/`, `commands/`, `templates/skills/context-load/`). Layout = Top-Level-Dirs. Flat-Install (`just setup`) ist der einzige Pfad; Legacy-Plugin/Marketplace entfernt. Nur `hook-redactor` bleibt Submodul.

**Aktivierung (User, separate Session):** Review → `git push` → `just setup` + Restart → Marketplace `niclasedge-pkm` deinstallieren (README) gegen Skill-Dubletten. Erst das schließt CCS-005.09 AC#4 (Live-Check gegen laufende context-load).

**Nicht-offensichtlicher Befund:** Der Flat-only-Pfad triggerte zwei latente `setup.sh`-Bugs, die unter dem Plugin-Pfad nie liefen — GNU-only `sed -i` (BSD/macOS bricht) und bare `python3` (uv-strict) — beide gefixt. Siehe [[cc-setup-auto-sync-push-hazard]] (CCS-008 härtet den Stop-Hook in-repo, aber Fix ist noch nicht deployed → Live-Hook kann weiter auto-committen/pushen).
