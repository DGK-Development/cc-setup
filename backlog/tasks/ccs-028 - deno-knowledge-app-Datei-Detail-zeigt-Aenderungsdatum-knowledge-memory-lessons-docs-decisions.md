---
id: CCS-028
title: >-
  deno-knowledge-app: Datei-Detail zeigt Aenderungsdatum
  (knowledge/memory/lessons/docs/decisions)
status: Done
assignee:
  - '@dev'
created_date: '2026-06-05 22:02'
updated_date: '2026-06-06 05:53'
labels:
  - knowledge-app
dependencies: []
ordinal: 71000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Beim Lesen von Dateien (readDoc in render.ts) wird aktuell nur ~tok + Groesse gezeigt. Zusaetzlich das Aenderungsdatum (mtime) anzeigen. Betrifft alle readDoc-basierten Datei-Detail-Ansichten: knowledge-Dateien, memory, lessons/lektionen, docs, decisions. fmtMtime existiert bereits in md.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 readDoc gibt das Aenderungsdatum zurueck (Deno.stat mtime)
- [x] #2 Datei-Detail-Meta (fmeta-Zeile bzw. metaCell) zeigt das Aenderungsdatum fuer knowledge/memory/lessons/docs/decisions
- [x] #3 Format konsistent (fmtMtime o.ae.); fehlt mtime -> kein Fehler
- [x] #4 just deno-test gruen
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC1: render.ts readDoc() ergaenzt um mtime via Deno.stat().mtime?.getTime()/1000 (Unix epoch in Sekunden), dann fmtMtime() formatiert als String. Abdeckung: alle readDoc-Kinds (skill/agent/memory/lektion/knowfile/taskfile/docfile/claude-*).

AC2: browser.js loadFile() zeigt mtimeSeg = geaendert <datum> in fmeta-Zeile wenn d.mtime vorhanden. Nicht-readDoc-Pfade (decisions/changelog/sessions) sind nicht betroffen (kein readDoc-Aufruf).

AC3: fehlt mtime → leerer String, keine Anzeige, kein Fehler. AC4: 100 Tests gruen.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Datei-Detail zeigt Aenderungsdatum fuer alle readDoc-basierten Ansichten.

Changes:
- src/render.ts: fmtMtime import ergaenzt. readDoc() stat-Block erweitert: mtime = fmtMtime(st.mtime.getTime()/1000). Response enthaelt mtime-Feld.
- assets/browser.js: loadFile() zeigt mtimeSeg = geaendert <datum> in fmeta-Zeile wenn d.mtime vorhanden.

Abdeckung: skill, agent, memory, lektion, knowfile, taskfile, docfile, claude-global, claude-project. Nicht abgedeckt: decisions/changelog/sessions (kein readDoc-Aufruf, direkt aus DATA). In Notes dokumentiert.

Tests: +2 (readDoc mtime in render_test.ts). 100 passed.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
