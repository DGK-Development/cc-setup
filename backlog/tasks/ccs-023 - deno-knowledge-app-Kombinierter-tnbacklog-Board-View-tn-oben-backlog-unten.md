---
id: CCS-023
title: >-
  deno-knowledge-app: Kombinierter tn+backlog Board-View (tn oben, backlog
  unten)
status: Done
assignee:
  - '@dev'
created_date: '2026-06-05 21:16'
updated_date: '2026-06-05 21:57'
labels:
  - knowledge-app
dependencies: []
ordinal: 66000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
tn und backlog sind aktuell getrennte Nav-Boards (browser.js renderBoard/renderTnBoard, je vollhoch). Gewuenscht: EIN View auf einer Seite mit tn-Board oben und backlog-Board darunter. Quell-Item (Obsidian): 08444AF8-D1F1-4F5D-A866-AA070D07F013.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Ein Nav-Eintrag/View zeigt tn-Board (oben) und backlog-Board (darunter) auf einer Seite
- [x] #2 tn-Board bleibt read-only (NEXT/BLOCKED/OVERDUE); backlog-Board behaelt Drag-drop-Status-Persist + Doppelklick-Detail
- [x] #3 Layout funktioniert (beide Boards scrollbar, kein Ueberlappen) in Desktop-Breite
- [x] #4 Bestehendes Verhalten der Einzel-Boards nicht regressiv (oder bewusst ersetzt, im Plan begruendet)
- [x] #5 just test gruen
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Nav-Eintrag "Boards" (id: boards) in projectGroups Backlog-Gruppe hinzugefügt. SPECIAL-set enthält "boards" → kein coll-Lookup, kein renderList()

renderCombinedBoard(): baut tn-Board (read-only, TN_COLS) + backlog-Board (drag-drop+dblclick) in einem scrollbaren div untereinander. Boards-CSS: flex-wrap:wrap, height:auto für korrekte Höhe.

Einzel-Boards (id=backlog, id=tn) bleiben vollständig erhalten (keine Regression). just deno-test: 81 passed, 0 failed
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Kombinierter tn+backlog Board-View. Neuer Nav-Eintrag Boards + renderCombinedBoard(): tn-Board (read-only NEXT/BLOCKED/OVERDUE) oben, backlog-Board (drag-drop + Doppelklick-Detail) unten, scrollbar. Einzel-Render-Funktionen erhalten. just deno-test gruen.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
