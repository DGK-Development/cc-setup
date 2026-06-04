---
id: CCS-008
title: >-
  session-end sync-hook: kein Auto-Push/Commit ungeprüfter Branches (Review-Gate
  + Submodul-Safety)
status: In Progress
assignee:
  - '@claude'
created_date: '2026-06-04 20:57'
updated_date: '2026-06-04 22:14'
labels:
  - infra
  - safety
  - hooks
dependencies: []
priority: high
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
stop-workflow.sh übergibt an einen inline-Claude (session-stop), der automatisch committet und teils pusht. Belegt: im Vorlauf wurde a3e52f9 ungeprüft gepusht, dessen Submodul-Gitlink auf das ungepushte d55c6c3 zeigte → kaputter Remote-Pointer für frische Clones. In dieser Session committete der Hook ungefragt den CCS-005-Milestone (2ea8253). Das kollidiert mit der Org-Regel (KI-Code vor Push human-reviewt; Entwicklung≠Review in einer Session). Der Hook soll Branches mit ungeprüften Änderungen NICHT auto-pushen und Submodul-Pointer-Konsistenz (Submodul-Push vor Parent-Push) sicherstellen.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Sync-Hook pusht keinen Branch mit ungeprüften/unreviewed Commits automatisch (Opt-in statt Opt-out)
- [x] #2 Beim Pushen eines Parent-Commits mit geändertem Submodul-Gitlink wird verifiziert, dass der referenzierte Submodul-Commit auf dem Submodul-Remote existiert (sonst Abbruch + Hinweis)
- [x] #3 Auto-Commit substanzieller Artefakte (z.B. neue Backlog-Milestones) nur mit explizitem Signal, nicht stillschweigend bei jedem Stop
- [x] #4 pkm-sync-stop.sh + stop-workflow.sh aus ~/.claude/hooks/ als managed source ins Repo vendored (hooks/), gehaertet
- [x] #5 setup.sh deployt den Stop-Hook (kopiert vendored Stop-Scripts + traegt Stop-Event in settings.json ein)
- [x] #6 templates/skills/session-stop/SKILL.md: Commit-Regel Branch!=main->auto entfernt, Push nur explizit, Submodul-Pointer-Check als Anweisung
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scope-Entscheidung (User 2026-06-04): Sync-Hooks liegen aktuell NUR in ~/.claude/hooks/ (pkm-sync-stop.sh, stop-workflow.sh), nicht im Repo. Entscheidung: ins cc-setup-Repo vendoren + via setup.sh deployen (cc-setup wird Single-Source auch fuer Stop-Hook). Push-Gate-Mechanik: NIE auto-pushen (commit-only lokal); Push immer manuell/human; substanzielle Auto-Commits nur mit explizitem Signal. Live-Hooks in ~/.claude/ werden NICHT angefasst (Deploy-Grenze: nur Repo + Test-Home).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
stop-workflow.sh + pkm-sync-stop.sh als managed source nach hooks/ vendored + gehaertet: kein git push mehr (rg-Treffer 0), submodule_push_guard fuer Gitlink-Konsistenz. session-stop SKILL: Commit nur auf explizites Signal (Branch!=main-Auto entfernt), Push nie automatisch. setup.sh deployt Stop-Hook (settings.json Stop-Event, idempotent). Externe Sub-Hooks (/Users/niclasedge/.claude/...) als Follow-up notiert.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
