---
id: CCS-018
title: >-
  [Spec] knowledge.py -> Deno: deno-knowledge-app (Voll-Rewrite, pur nativ +
  @std)
status: Done
assignee:
  - '@developer'
created_date: '2026-06-05 16:42'
updated_date: '2026-06-05 18:52'
labels:
  - deno
  - rewrite
  - knowledge-dashboard
milestone: knowledge-deno-rewrite
dependencies: []
priority: medium
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Voll-Rewrite von scripts/knowledge.py (FastAPI/uvicorn, uv-inline, 2421 Zeilen) nach Deno/TypeScript als neues deno-knowledge-app/. Entscheidungen (Session 2026-06-05): (1) Scope = Collectors + Server + Frontend komplett nach Deno; (2) Libraries = pur nativ + @std, KEIN Web-Framework (kein Hono/Oak/Fresh), Routing/Templating selbst gebaut; (3) Migration = parallel bauen, Feature-Paritaet + Output-Paritaet herstellen, verifizieren, dann just overview umschalten und knowledge.py entfernen. Baustein-Mapping und Library-Research in ObsidianPKM-Wiki: Atlas/Wiki/Tools/dev/deno-native-web-stack.md. Kern-APIs: Deno.serve, URLPattern, @std/http/file-server (serveDir), Web-Standard Request.formData, Deno.Command, Deno.readTextFile, @std/fs expandGlob, Deno.env, @std/html escape, @std/cli parseArgs, @std/datetime format, Deno.test + @std/assert.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 deno-knowledge-app laeuft via deno task overview auf 127.0.0.1:8765 und rendert die Single-Page mit Feature-Paritaet zu knowledge.py (alle Karten + browser-View)
- [x] #2 Keine Web-Framework-Dependency: ausschliesslich Deno-native APIs + offizielle @std-Module (JSR)
- [x] #3 Alle 7 Collectors liefern struktur-gleichen Output wie knowledge.py (Output-Paritaet-Tests gegen Fixtures gruen)
- [x] #4 Routen GET /, GET /read, GET /gitdiff und POST /action/{commit,delete,merge,push} funktional aequivalent zur FastAPI-Variante
- [x] #5 Nach Cutover: just overview startet die Deno-App, knowledge.py + uv-inline-Deps entfernt, README/justfile aktualisiert
- [x] #6 deno test gruen; deno fmt + deno lint ohne Fehler
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fundament steht (CCS-018.01 impl, Review ausstehend): Deno-Scaffold + Live-Reload (just deno) + Helper-Layer (shared/md) portiert + getestet (14 gruen). Naechste Slices: Collectors .02-.05, dann Routing .06, Render .07.

Collectors+Routing+Render via Dev-Subagent (Engineer, isolierter Worktree) portiert, dann in Haupt-Tree integriert. WICHTIG: Subagent meldete 45/0 gruen, faktisch fehlte --allow-write in der test-Task (makeTempDir) -> korrigiert. Funktionaler Bug gefunden+gefixt: assetsDir-Pfad in render.ts ging eine Ebene zu weit (../../.. statt ../..) -> CSS/JS waren leer (tote UI); Regressions-Test ergaenzt. Stand: 46 Tests gruen, deno fmt+lint+check clean, End-to-End GET / 196KB mit inlined dash.css/browser.css/browser.js, /read+/gitdiff JSON, POST /action/* CSRF+Confirm. OFFEN: echte Output-Paritaet gegen knowledge.py (.08) und Cutover (.09). Kein Push, Review separat.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
deno-knowledge-app ersetzt knowledge.py: pur nativ + @std (kein Framework), 7 Collectors + Routing + 3-Pane-Render + Multi-Projekt-Sidebar + nativer Cost-Reader + file-Cache. just overview startet Deno. Alle 10 Subtasks done. Dev-complete + verifiziert; human code-review der 7 Commits vor Push ausstehend (Org-Regel).
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
