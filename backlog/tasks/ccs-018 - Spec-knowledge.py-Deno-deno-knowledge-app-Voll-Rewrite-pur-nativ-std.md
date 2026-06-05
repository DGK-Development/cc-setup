---
id: CCS-018
title: >-
  [Spec] knowledge.py -> Deno: deno-knowledge-app (Voll-Rewrite, pur nativ +
  @std)
status: To Do
assignee: []
created_date: '2026-06-05 16:42'
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
- [ ] #1 deno-knowledge-app laeuft via deno task overview auf 127.0.0.1:8765 und rendert die Single-Page mit Feature-Paritaet zu knowledge.py (alle Karten + browser-View)
- [ ] #2 Keine Web-Framework-Dependency: ausschliesslich Deno-native APIs + offizielle @std-Module (JSR)
- [ ] #3 Alle 7 Collectors liefern struktur-gleichen Output wie knowledge.py (Output-Paritaet-Tests gegen Fixtures gruen)
- [ ] #4 Routen GET /, GET /read, GET /gitdiff und POST /action/{commit,delete,merge,push} funktional aequivalent zur FastAPI-Variante
- [ ] #5 Nach Cutover: just overview startet die Deno-App, knowledge.py + uv-inline-Deps entfernt, README/justfile aktualisiert
- [ ] #6 deno test gruen; deno fmt + deno lint ohne Fehler
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just test passes
<!-- DOD:END -->
