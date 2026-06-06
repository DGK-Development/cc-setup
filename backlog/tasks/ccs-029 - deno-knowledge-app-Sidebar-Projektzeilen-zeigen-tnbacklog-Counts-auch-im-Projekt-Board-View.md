---
id: CCS-029
title: >-
  deno-knowledge-app: Sidebar-Projektzeilen zeigen tn+backlog-Counts auch im
  Projekt-Board-View
status: Done
assignee:
  - '@dev'
created_date: '2026-06-05 22:02'
updated_date: '2026-06-06 05:53'
labels:
  - knowledge-app
dependencies: []
ordinal: 72000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bug: Im Projekt-(Board-)View zeigt die Sidebar in der Stats-Zeile der Projektzeile (kn-proj-s, 2. Zeile/Spalte des Eintrags) die tn- und Backlog-Task-Zahlen NICHT. Im Ueberblick erscheinen sie. Ursache finden (Cache-Aggregat vs. Fallback in server.ts, oder Render-Pfad) und fixen, sodass die Zahlen in BEIDEN Views konsistent erscheinen.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Sidebar-Projektzeilen zeigen offene Backlog-Tasks + tn-Count in beiden Views (Ueberblick UND Projekt-Board-View)
- [x] #2 Ursache der fehlenden Zahl im Projekt-View identifiziert und behoben (in Notes dokumentiert)
- [x] #3 Zahlen konsistent mit Boards-Header (CCS-025) und Ueberblick
- [x] #4 just deno-test gruen
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Ursache: Die Sidebar-HTML wird serverseitig aus opts.sidebar gerendert. opts.sidebar kommt aus agg?.projects ?? fallback. Beim allerersten Request (Cache nicht geprimt) hat der Fallback open_tasks:0, tn:0. Da buildData(ctx,project) collectBacklog+collectTn live ausfuehrt, weiss die Seite die korrekten Zahlen — aber nur in DATA.overview, nicht im statischen Sidebar-HTML.

Fix (render.ts): Im Projekt-View wird fuer die aktive Projektzeile open_tasks durch Number(ov.backlog_open) ersetzt (ov = data.overview aus buildData), ebenso tn durch ov.tn_open. Beide kommen aus den live Collectors. Andere Projekte bleiben auf sidebar-Zahlen.

Konsistenz: overview-Kacheln zeigen dieselben Werte (aus DATA.overview), Boards-Header zeigt dieselben (OV.backlog_open/OV.tn_open). Sidebar-Zeile des aktiven Projekts jetzt gleich. AC4: 100 Tests gruen.

Review-MAJOR-1: || Falsy-Fallback durch != null Null-Coalescing ersetzt. Verhindert dass 0 auf Cache-Wert faellt (0 offene Tasks bei allem Done ist valider Zustand). Neuer Test bestaetigt.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Bug: Sidebar-Projektzeile zeigt 0 fuer offene Tasks + tn im Projekt-View wenn Cache nicht geprimt.

Ursache: opts.sidebar = agg?.projects ?? fallback; Fallback hat open_tasks:0/tn:0. Im Projekt-View laufen collectBacklog+collectTn live, aber nur in DATA.overview -- statisches Sidebar-HTML nutzte weiterhin den Fallback.

Fix (src/render.ts): Im Projekt-View wird fuer die AKTIVE Projektzeile open_tasks durch Number(ov.backlog_open) ersetzt (ov = data.overview aus buildData), tn durch Number(ov.tn_open). Andere Projekte weiterhin aus sidebar. Selbe Zahlen wie Boards-Header.

Tests: +1 (renderPage project-view active row live counts, render_test.ts). 100 passed.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
