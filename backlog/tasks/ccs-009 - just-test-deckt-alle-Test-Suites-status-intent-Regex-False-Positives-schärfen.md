---
id: CCS-009
title: >-
  just test deckt alle Test-Suites + status-intent-Regex False-Positives
  schärfen
status: In Progress
assignee:
  - '@claude'
created_date: '2026-06-04 20:57'
updated_date: '2026-06-04 22:14'
labels:
  - tests
  - context-load
dependencies: []
priority: medium
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Zwei Review-Funde (CCS-003-Review-Session). (1) just test läuft nur test_sprint_bridge.py (14 Tests); die Parent-Suites scripts/test_session_analyze.py + test_session_waste.py (27 Tests) laufen NICHT mit → CI gibt falsche Sicherheit (41 Tests existieren, 14 gated). (2) status-intent classify()-Regex (\b(status|stand|offene|...)) matcht False-Positives wie status-Intent-Gap, die offene Frage, wie funktioniert der status-intent code → unnötiger qmd-Layer-2-Skip bei erklärungsbedürftigen Fragen. Niedrige Priorität (heuristisch, nur Latenz-Opt).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 just test (bzw. das Test-Recipe) führt sprint_bridge + session_analyze + session_waste Suites aus (alle 41 Tests grün)
- [x] #2 status-intent-Regex unterscheidet Status-Intent von erklärungsbedürftigen Code-Fragen (status-Intent-Gap matcht nicht mehr fälschlich als type:status)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
just test laeuft repo-lokal alle 4 Suites (49 gruen, vorher 14 gegen Submodul). context-resolve.py EXPLAIN_MARKER_RE-Negativguard verhindert status-FP bei erklaerungsbeduerftigen Fragen; neue test_context_resolve.py (8 Regressionstests).
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
