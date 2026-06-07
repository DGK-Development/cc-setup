---
id: CCS-034
title: >-
  deno-knowledge-app: Kontext-View Token-Genauigkeit + Pfad-URLs je Unterseite +
  Projekt-View Performance
status: Done
assignee:
  - '@claude'
created_date: '2026-06-06 14:27'
updated_date: '2026-06-06 19:49'
labels:
  - deno-knowledge-app
  - perf
dependencies: []
ordinal: 77000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Drei Refinements (User-Feedback 2026-06-06, Entscheidungen via AskUserQuestion). (A) Pfad-URLs /projekt/unterseite fuer Deep-Link/Screenshots. (B) Projekt-View 6.7s/Request weil session_analyze.py (6.64s) live laeuft -> nativer JSONL-Reader + Per-Projekt-Cache + Boot-Prime. (C) Kontext-Token unterschaetzt ~1.9x (chars/4) und Plugin-/Built-in-Skills+Agents fehlen -> kalibrieren + Quellen vervollstaendigen, Kategorien eingeklappt, alle Items lesbar.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Pfad-Routing /<projekt> und /<projekt>/<view> served Dashboard mit project+initial-view; bestehende Routen unberuehrt; unbekanntes Projekt -> Ueberblick
- [x] #2 Client setzt URL via History-API beim Nav-Wechsel; Deep-Link laedt direkt die Unterseite; Back/Forward funktioniert
- [x] #3 collectTokens nativ (kein session_analyze.py/uv-Spawn): last_session,week,sessions,errors_total,repeats_total,tool_freq aus JSONL; DATA-Form-Paritaet
- [x] #4 Per-Projekt-Context-Cache (TTL+single-flight) + Boot-Prime des --cwd-Repos; Projekt-View < 150ms nach Prime (curl-gemessen)
- [x] #5 Kein zusaetzlicher Python-Spawn; Runaway-Schutz
- [x] #6 Kontext-Token kalibriert gegen /context (Memory ~17k; global+projekt+MEMORY getrennt); estTokens chars/4 unveraendert (Parity), Kalibrierung separat + approx gelabelt
- [x] #7 Skills = User + enabled-Plugin (+Built-in best-effort) nach Quelle gruppiert; Agents = Project + User + Plugin nach Quelle
- [x] #8 Kategorien default eingeklappt; ausgeklappt Items wie Referenz; ALLE Items inkl. Skills/Plugins/Agents inline lesbar (read-Kinds erweitert), Pfad-Sicherheit gewahrt
- [x] #9 deno task test/check/lint gruen; Tests angepasst; Org: kein cross-project tn; kein Push
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Teil A (Pfad-URLs) implementiert: src/server.ts (servePage-Funktion, Fallback-Route), src/render.ts (initialView-Prop, window.INITIAL_VIEW-Injection, href-Pfad-URLs), assets/browser.js (viewToPath, suppressPush, pushState in select, INITIAL_VIEW-Boot, popstate-Handler). Verifikation: deno test 129/0 gruen; deno check + lint clean; curl /cc-setup, /cc-setup/context, /cc-setup/boards = 200 + INITIAL_VIEW korrekt, /unknownxyz = 200 Overview. Kein Commit/Push.

Teil C: Kalibrierung CTX_CALIB=1.7 (estTokens unverändert), Plugin/Built-in/Project-Quellen, Items lesbar (project-agent kind), Kategorien eingeklappt+gruppiert (Project/User/Plugin/Built-in). Gemessene Summen: Memory 17876tok, Skills 11593tok, Agents 3499tok, measured_total 44468tok vs /context-Referenz 17.1k/10.4k/3.2k/~42k. Tests: 136 passed, 0 failed. Lint/Check clean.

Teil B: collectTokens nativ (kein session_analyze.py), Per-Projekt-Cache (TTL+single-flight)+Boot-Prime+Action-Invalidierung. Messung: /cc-setup von 6.7s auf ~3ms; kein uv/python-Spawn pro Request. Tests gruen: 149 passed | 0 failed. Parität Python vs nativ: errors_total=102/102 repeats_total=10/10 Bash-freq=1005/1005.

Session-Abschluss (SPOC): Alle 3 Teile via getrennte Developer-Subagents, jeweils unabhaengig nachgemessen, dann separater Reviewer-Subagent (Org Dev!=Review) -> APPROVE-WITH-NITS; beide NITs (tote Var plugins.ts, Cache-Invalidierungs-Race) vom Dev-Subagent gefixt (Generations-Token). Final: 150 Tests/check/lint gruen, /cc-setup ~3ms (war 6.7s), Kontext-Token Memory 17.9k/Skills 11.6k/Agents 3.5k nah an /context. GIT-STAND: meine CCS-034-Arbeit komplett UNCOMMITTED (M + untracked plugins.ts/tokens_test.ts/Task-Datei); Auto-Sync-Commit 9a98e62 enthaelt NUR die vorherige CCS-030/031-Arbeit (CCS-034-Marker = 0 im Commit). Nichts gepusht. Verify-ready, wartet auf Human-Oversight (visueller Check + Commit/Deploy).

Unabhaengige Verifikation (separate Analyse-Session, NICHT die Dev-Session - Org Dev!=Review): laufender --watch-Server live gemessen: /cc-setup ~2.8ms (3 Requests), 0 session_analyze.py/python-Spawn pro Request. Bestaetigt Teil-B-Claim (6.85s->~3ms, kein Python). Nebenbefund: Pre-Fix-Baseline einer frueheren Session-Phase noch reproduziert (6.85s, session_analyze.py 6.34s CPU/432MB RSS) bevor der --watch-Reload den Fix zog. Kein Git/Commit.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Drei Refinements der deno-knowledge-app, alle per separaten Developer-Subagents implementiert + unabhaengig verifiziert + von separatem Reviewer-Subagent geprueft (Org-Regel Dev!=Review): APPROVE-WITH-NITS, beide NITs behoben.

Teil A - Pfad-URLs je Unterseite: /<projekt> und /<projekt>/<view> (z.B. /cc-setup/context). server.ts servePage-Refaktor + Fallback-Route (bestehende Routen via RESERVED_SEGMENTS unberuehrt, unbekanntes Projekt -> Overview), render.ts window.INITIAL_VIEW, browser.js History-API (pushState/replaceState/popstate, suppressPush-Guard). Deep-Links + Back/Forward funktionieren -> Screenshots/Tests je Seite moeglich.

Teil B - Performance: collectTokens komplett nativ (kein session_analyze.py/uv-Spawn mehr) - native JSONL-Analyse repliziert turns/errors/repeats/tool_freq faithful (Paritaet exakt: errors 102=102, repeats 10=10, Bash 1005=1005). Per-Projekt-Context-Cache (TTL+single-flight+Generations-Token gegen Invalidierungs-Race) + Boot-Prime des Start-Repos + Cache-Invalidierung nach mutierenden git/task-Actions. Projekt-View von 6.7s -> ~3ms (2200x), kein Python-Spawn pro Request (Runaway-Hazard beseitigt).

Teil C - Kontext-Token-Genauigkeit: Kalibrierungs-Faktor CTX_CALIB=1.7 NUR fuer die Kontext-View (estTokens chars/4 unveraendert wg. Parity). Quellen vervollstaendigt: Skills = User+enabled-Plugin+Built-in(approx), Agents = Project+User+Plugin, nach Quelle gruppiert wie /context. Alle Items inline lesbar (neuer readDoc-kind project-agent, Plugin via homefile - Pfad-Sicherheit gewahrt). Kategorien default eingeklappt. Gemessene Summen vs /context-Referenz: Memory 17.9k/17.1k, Skills 11.6k/10.4k, Agents 3.5k/3.2k, total 44.5k/~42k - alle im Korridor, als approx gelabelt.

Dateien: src/server.ts, src/render.ts, src/context.ts, src/cache.ts, src/collectors/tokens.ts, src/collectors/context_view.ts, NEU src/collectors/plugins.ts, main.ts, assets/browser.js + Tests (server/render/context_view/collectors/tokens/cache).

Tests: deno task test 150 passed/0 failed; check+lint clean. Org: kein cross-project tn-Inhalt; kein Commit/Push. Status verify-ready - wartet auf Human-Oversight (visueller Check + Commit/Deploy-Entscheidung durch User).
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
