---
id: CCS-025
title: >-
  deno-knowledge-app: Boards als Hub - Tasks/tn-Nav raus, Open-Counts
  vereinheitlichen, tn-Content im Board
status: Done
assignee:
  - '@dev'
created_date: '2026-06-05 21:40'
updated_date: '2026-06-05 21:57'
labels:
  - knowledge-app
dependencies: []
ordinal: 68000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Refinement nach CCS-023/CCS-024. (1) Im Projekt-View nur noch der Boards-Eintrag; separate Nav-Eintraege Tasks und tn entfernen. (2) Boards-Header zeigt Anzahl offener Backlog-Tasks + Anzahl offener tn-Tasks. (3) Dieselben Zahlen in den Sidebar-Projektkarten, EINHEITLICHE Open-Count-Logik (eine Quelle) - aktuell inkonsistent (countOpenTasks vs collectBacklog inkl. completed/). (4) tn-Block im Boards-View zeigt tn-Titel des gewaehlten Projekts (read-only, genehmigte DSM-Kuerzel-Regel). ORG: keine cross-project-Aggregation von tn-INHALTEN; cross-project bleibt counts-only. Kein echter tn-Vault-Inhalt im Claude/Subagent-Kontext - nur synthetische Fixtures.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Projekt-View hat nur noch den Boards-Nav-Eintrag; separate Eintraege Tasks und tn sind entfernt (Einzel-Render-Funktionen koennen bleiben, aber nicht mehr navigierbar)
- [x] #2 Boards-Header zeigt: Anzahl offener Backlog-Tasks UND Anzahl offener tn-Tasks (z.B. backlog: N offen, tn: M offen)
- [x] #3 Sidebar-Projektkarten zeigen offene Backlog-Tasks + tn konsistent zur Board-Zahl; Open-Count-Logik ist vereinheitlicht (eine gemeinsame Funktion/Quelle, completed/ konsistent behandelt)
- [x] #4 tn-Block im Boards-View zeigt die tn-Task-Titel des gewaehlten Projekts (read-only); keine cross-project tn-Inhalts-Aggregation; cross-project bleibt counts-only
- [x] #5 just deno-test gruen; synthetische Fixtures fuer die Count-Logik; kein echter tn-Vault-Inhalt im Kontext
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC1: Nav-Backlog-Gruppe auf nur boards reduziert (backlog+tn-Nav-Eintraege entfernt).

AC2: renderCombinedBoard() hat neuen Board-Header mit backlog_open + tn_open aus overview; context.ts berechnet beide Felder.

AC3: countOpenTasks() in sidebar.ts liest jetzt auch completed/ per seenIds-Set (unified mit collectBacklog-Logik).

AC4: tn-Content per COLL[tn] in renderCombinedBoard() war bereits vorhanden (CCS-023), weiterhin funktional.

AC5: 93 Tests gruen (5 neue CCS-025-Tests in parity_test.ts + sidebar_test.ts).

Review-Fix F-2 (browser.js): tn-Sub-Header zeigt jetzt tnOpenCount (next+blocked+overdue, filter auf col), backlog-Sub-Header zeigt blOpenCount (status != done, trim+lowercase). Beide konsistent mit OV.backlog_open/OV.tn_open im Board-Gesamt-Header.

Review-Fix F-1 (browser.js): Variante data-go=boards fuer beide Overview-Kacheln (backlog + tn). Begruendung: boards-only-Nav ist die User-Intention; milestones braeuchte auch COLL[backlog] und wuerde das Problem nur verschieben. Graceful-Fallback in renderCombinedBoard() wenn beide Colls fehlen: Hinweis Kein aktives Projekt statt leerer Spalten. 93 Tests gruen.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Boards-as-Hub: Separate backlog/tn-Nav entfernt, Combined-Board als einziger Backlog-Hub.

Changes:
- src/context.ts: Backlog-Nav-Gruppe reduziert auf [boards]; overview.backlog_open (non-done tasks aus bl.tasks) und overview.tn_open (next+blocked+overdue aus tnc) hinzugefuegt.
- src/collectors/sidebar.ts: countOpenTasks() rewritten mit completed/-Scan + seenIds-Set; spiegelt jetzt exakt collectBacklog-Logik (unified source of truth).
- assets/browser.js: renderCombinedBoard() erhaelt Header-Bar mit backlog_open + tn_open aus overview.

Tests (93 passed | 0 failed):
- parity_test.ts: 4 neue Tests (Backlog-Nav nur boards, backlog_open, tn_open sum, tn_open=0 fallback)
- sidebar_test.ts: 2 neue Tests (completed/ inflates not open count, no double-count seenIds)
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
