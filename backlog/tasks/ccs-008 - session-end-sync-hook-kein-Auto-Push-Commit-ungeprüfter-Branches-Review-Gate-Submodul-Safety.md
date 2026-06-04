---
id: CCS-008
title: >-
  session-end sync-hook: kein Auto-Push/Commit ungeprüfter Branches (Review-Gate
  + Submodul-Safety)
status: To Do
assignee: []
created_date: '2026-06-04 20:57'
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
- [ ] #1 Sync-Hook pusht keinen Branch mit ungeprüften/unreviewed Commits automatisch (Opt-in statt Opt-out)
- [ ] #2 Beim Pushen eines Parent-Commits mit geändertem Submodul-Gitlink wird verifiziert, dass der referenzierte Submodul-Commit auf dem Submodul-Remote existiert (sonst Abbruch + Hinweis)
- [ ] #3 Auto-Commit substanzieller Artefakte (z.B. neue Backlog-Milestones) nur mit explizitem Signal, nicht stillschweigend bei jedem Stop
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just test passes
<!-- DOD:END -->
