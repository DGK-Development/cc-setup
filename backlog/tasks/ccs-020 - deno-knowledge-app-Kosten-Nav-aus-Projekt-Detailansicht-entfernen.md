---
id: CCS-020
title: 'deno-knowledge-app: Kosten-Nav aus Projekt-Detailansicht entfernen'
status: Done
assignee:
  - '@dev'
created_date: '2026-06-05 21:15'
updated_date: '2026-06-05 21:57'
labels:
  - knowledge-app
dependencies: []
ordinal: 63000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Kosten sind account-weit (nicht projekt-scoped) und in der Projektansicht irrefuehrend. Quell-Item (Obsidian): 2A4803EB-ECD3-4D71-9DD3-22CE4EBF9B6D. User-Entscheidung: NUR den Nav-Eintrag Kosten im Projekt-View entfernen; Sidebar-Kosten, Cross-Project-Statusline und Ueberblick-Kachel bleiben.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Der Nav-Eintrag Kosten (Usage-Gruppe) erscheint nicht mehr im Projekt-View (context.ts projectGroups)
- [x] #2 Sidebar-Projektzeilen, Cross-Project-Statusline und Ueberblick-Kachel zeigen weiterhin Kosten
- [x] #3 cost-Collector und renderCost bleiben unangetastet (Ueberblick nutzt sie weiter)
- [x] #4 just test bleibt gruen
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Entfernt: { id: "cost", label: "Kosten", dot: "m" } aus projectGroups Usage-Gruppe in src/context.ts (Zeile ~449)

sessions-Eintrag, Sidebar-Projektzeilen, Statusline und Überblick-Kachel bleiben unverändert (nur Nav-Eintrag im Projekt-View entfernt)

just deno-test: 81 passed, 0 failed
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Kosten-Nav aus Projekt-View entfernt. context.ts: Eintrag { id: cost } aus projectGroups Usage-Gruppe raus. Sidebar-Zeilen, Cross-Project-Statusline, Ueberblick-Kachel und cost-Collector/renderCost unveraendert. just deno-test gruen.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
