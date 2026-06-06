---
id: CCS-026
title: >-
  deno-knowledge-app: Backlog projektweit als Kanban-Board (nur non-done,
  cross-project)
status: Done
assignee:
  - '@dev'
created_date: '2026-06-05 22:02'
updated_date: '2026-06-06 05:53'
labels:
  - knowledge-app
dependencies: []
ordinal: 69000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Die Ueberblick-Sektion Backlog projektweit (coll.milestones / context.ts msItems) ist aktuell eine gruppierte Liste. Gewuenscht: als Kanban-Board wie der projektspezifische tn+backlog-Board, und NUR Tasks die nicht done sind. Cross-project Backlog = Dev-Daten (kein tn/Kunde), org-unkritisch.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Backlog projektweit rendert als Kanban-Board (Spalten nach Status, z.B. To Do / In Progress) statt als Liste
- [x] #2 Nur nicht-done Tasks; done ausgeblendet; jede Karte zeigt das Projekt-Label
- [x] #3 Datenquelle liefert alle non-done Backlog-Tasks pro Projekt (sidebar-Collector erweitern, nicht nur loose/milestones)
- [x] #4 Layout/Verhalten konsistent zum projektspezifischen Board
- [x] #5 just deno-test gruen; synthetische Fixtures
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC1+2: renderMilestonesBoard() liest COLL[milestones], baut read-only Kanban (To Do/In Progress/Blocked), kein Done-Bucket. Jede Karte zeigt Projekt-Label + Milestone.

AC3: projectOpenTasks(repoPath, projectName) in sidebar.ts — alle non-done Tasks mit id/title/status/milestone/project/file. collectSidebar ruft es auf, SidebarProject.openTasks erweitert.

AC4: context.ts buildData nutzt pr.openTasks wenn vorhanden, sonst Fallback auf alte milestones+looseTasks. SPECIAL[milestones]=1, select()-Route.

Board-Variante read-only: Drag-drop benoetigt pro Karte den richtigen project-Pfad fuer setTaskStatus; das ist out-of-scope und braeuchte projekt-Lookup im POST. Read-only ist surgical + sicher.

AC5: 100 Tests gruen.

Review-NIT: MS_BOARD_STATUSES auf [To Do, In Progress] reduziert — Blocked ist kein Backlog.md-Standardstatus und wuerde permanent leere Spalte zeigen.

Review-MINOR-2 (context.ts): openT != null statt openT.length > 0 — leeres Array (0 offene Tasks) loest jetzt keinen Fallback mehr aus. 101 Tests gruen.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Cross-project Backlog als Kanban-Board (read-only, non-done only).

Changes:
- src/collectors/sidebar.ts: projectOpenTasks(repoPath, projectName) neu — alle non-done Tasks mit id/title/status/milestone/project/file. SidebarProject.openTasks erweiterung. collectSidebar ruft es auf.
- src/context.ts: buildData nutzt pr.openTasks wenn vorhanden fuer msItems (Kanban-Items), Fallback auf milestones+looseTasks (Cache-not-primed / alte Tests).
- assets/browser.js: SPECIAL[milestones]=1, select() route zu renderMilestonesBoard(). Neuer renderMilestonesBoard(): read-only Board mit Spalten To Do/In Progress/Blocked, Projekt-Label auf jeder Karte.

Board read-only (Begruendung): Drag-drop cross-project erfordert pro Karte Projekt-Pfad-Lookup fuer setTaskStatus-Route; das ist out-of-scope und strukturell mehr als surgical.

Tests: +2 (projectOpenTasks in sidebar_test.ts), +1 (coll.milestones openTasks in parity_test.ts). 100 passed.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
