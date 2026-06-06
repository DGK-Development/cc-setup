---
id: CCS-031
title: >-
  deno-knowledge-app: Kontext-View pro Projekt (statischer Initial-Kontext,
  /context-Style, ausklappbar)
status: Done
assignee:
  - '@claude'
created_date: '2026-06-06 06:26'
updated_date: '2026-06-06 14:05'
labels: []
dependencies: []
ordinal: 74000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pro Projekt eine virtualisierte /context-artige Anzeige des statischen Initial-Session-Kontextes als ausklappbare Kategorien-Liste — analog zu Claude Codes /context-Befehl. Zeigt, welchen Initial-Kontext jede neue Session in diesem Projekt laedt (System+Tools als Fix-Konstanten, Agents, Memory/CLAUDE.md, Skills) plus die LIVE ausgefuehrte SessionStart-Hook-Injektion. Balken/Chart gegen 1M-Fenster, alle Werte als geschaetzt (approx) gelabelt.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Neuer Nav-Eintrag Kontext im Projekt-View als Spezial-View (wie boards/git/cost), nicht im Ueberblick
- [x] #2 Kategorien-Aufschluesselung mit Token-Schaetzung + Prozent gegen 1M-Fenster: System prompt (approx fix), System tools (approx fix), Custom agents, Memory files (global+projekt CLAUDE.md + MEMORY.md), Skills, Hook-Injektion, Free space
- [x] #3 Jede Kategorie ist ausklappbar und zeigt ihre Einzel-Items (Skills mit Tokens/Desc, Agents mit Tokens, Memory-Dateien einzeln, Hook-Output im Wortlaut)
- [x] #4 Hook-Injektion wird on-demand LIVE ausgefuehrt (inject-project-context.sh) mit single-flight + TTL-Cache + Timeout; kein Subprozess bei jedem Request, kein Runaway, canonical hook-session-start.log wird nicht versehentlich ueberschrieben
- [x] #5 Balken/Chart-Visualisierung + Summenzeile X / 1M (Y%); Fix-Konstanten klar als fix markiert, Rest als approx
- [x] #6 Tests: buildData liefert coll.context-Struktur; Hook-Collector parst Output zu Tokens; Render/Browser zeigt Kategorien + Free-space
- [x] #7 Org-Regel: keine tn-Inhalte cross-project aggregiert; Hook-Output enthaelt keine tn-Inhalte
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. context_view.ts: SYS_PROMPT 3700, SYS_TOOLS 6800, CTX_WINDOW 1M (approx-fix); memoryMdTokens(cwd) best-effort via CLAUDE_MEMORY_DIR/encodeCwd; buildContextCategories(cards) assembles category list.
2. hook_inject.ts: collectHookInject(cwd, runner?) runs inject-project-context.sh via bash, timeout 5s, CC_HOOK_LOG_FILE=/dev/null, estTokens(stdout+stderr); per-cwd single-flight + TTL 60s; injectable runner for tests.
3. buildContext: collect memory_md card (only when !skipProject).
4. buildData: coll.context (categories + window + measured_total) + nav group 'Kontext' (project-view only).
5. inject-project-context.sh: 1-line LOG_FILE override via CC_HOOK_LOG_FILE.
6. server.ts: GET /hook-inject?project=X (Whitelist via getTarget); deno.json allow-run += bash.
7. browser.js: SPECIAL.context + renderContext() (stacked bar, details per category, live hook fetch, free space).
8. render.ts: CONTEXT_CSS block.
9. Tests: context_view_test, hook_inject_test, render/parity extension. deno task test green; deno check; e2e curl.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Plan freigegeben durch User (via SPOC). Start Implementierung als Dev-Subagent.

Implementiert (Dev-Subagent, isolierte Session).
- context_view.ts: SYS_PROMPT_TOK=3700, SYS_TOOLS_TOK=6800, CTX_WINDOW=1M (approx-fix); memoryMdTokens(cwd) best-effort via CLAUDE_MEMORY_DIR/encodeCwd.
- hook_inject.ts: collectHookInject(cwd,runner?) — bash inject-project-context.sh, timeout 5s, CC_HOOK_LOG_FILE=/dev/null, estTokens; per-cwd single-flight + TTL 60s; injizierbarer runner.
- context.ts: buildContext sammelt memory_md-Card (nur !skipProject); buildData baut coll.context (6 Kategorien + window + measured_total) + nav-Gruppe Kontext (project-view only).
- inject-project-context.sh: 1-Zeile LOG_FILE-Override via CC_HOOK_LOG_FILE.
- server.ts: GET /hook-inject?project=X (Whitelist via getTarget). deno.json dev+start allow-run += bash.
- browser.js: SPECIAL.context, renderContext() (stacked bar, details je Kategorie, live /hook-inject fetch, free space). Nav-Count-Branch fuer context gefixt (Kategorie hat categories statt items — verhinderte Nav-Render).
- render.ts: CONTEXT_CSS-Block angehaengt.

Verifikation (echt, nicht behauptet):
- deno task test: 124 passed, 0 failed (inkl. context_view_test 9, hook_inject_test 5, render CCS-031 1). 
- deno task check (deno check main.ts): clean, keine Type-Fehler.
- deno lint: 1 Problem in src/collectors/project.ts:90 (no-inner-declarations) — PRE-EXISTING aus Vorgaenger-Session-uncommitted-Stand, NICHT von mir veraendert. Meine 9 geaenderten/neuen Dateien linten clean.
- E2E (Server :8791/:8792, real): GET /hook-inject?project=cc-setup -> {ok:true,tokens:175,output:Backlog-Stand+kein tn}. GET /?project=cc-setup -> HTML enthaelt coll.context + renderContext. Canonical logs/hook-session-start.log NICHT clobbered (mtime 08:16:57, eigener Session-Start — Dashboard-Run ging an /dev/null). 
- Browser (rodney): Kontext-Nav rendert (13 nav-i), View zeigt Summenzeile ~128.1k/1000.0k (12.8%), 6 Kategorie-Rows mit fix/live-Badges, 77 drill-down items, Hook-Kategorie live ~175 tok, Free space ~871.9k (87.2%).

Korrektur: Der no-inner-declarations-Lint in project.ts war NICHT pre-existing, sondern neu im uncommitteten Tree (CCS-030 countHooksInSettings). Behoben durch Hochziehen auf Funktions-Root. deno lint jetzt gruen. Da der Fix CCS-030-Code (countHooksInSettings) betrifft, ist dies ein bewusster Cross-Task-Unblock zum Gruen-Machen des Lint/DoD-Gates, kein CCS-031-Scope-Creep.

Session-Abschluss (SPOC): separater Reviewer-Subagent -> PASS (alle 7 ACs real erfuellt, /hook-inject nur Whitelist, org-konform). deno lint 0 / check clean / 124 Tests gruen, E2E verifiziert (tokens 175, Log unberuehrt, kein tn). Verify-ready; Status In Progress (Human-Oversight + Merge beim User). Kein Push.

Bugfix Token-Berechnung: Kontext-View zaehlte ganze SKILL.md/Agent-Dateien (Skills 68k/Agents 39k) statt geladener Metadaten (Name+description). Neues meta_tokens-Feld in global.ts; Kontext-Kategorien nutzen meta-Summen. measured_total jetzt ~28k (vorher ~128k), nahe echtem /context (~42k static). Konstanten auf 3600/7900 (beobachtet). Tests gruen (124 passed).

Token-Fix unabhaengig reviewt (separater Reviewer-Subagent): PASS. measured_total=28032 unabhaengig nachgerechnet inkl. Cache-Roundtrip; tokens (full) unangetastet, Parity nicht gekoppelt, Tests 124/0 + lint/check gruen. Residual-Undercount vs echtem /context (~42k static): estTokens=chars/4 unterschaetzt Markdown ~40%, App sieht nur ~/.claude/skills (keine Plugin/Built-in-Skills). CRLF-Helper-Bug als Folge-Task CCS-032 erfasst.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Neue Spezial-View Kontext pro Projekt: /context-artige Token-Aufschlüsselung des statischen Initial-Session-Kontexts (System prompt + tools als Fix-Näherungen, Custom agents, Skills, Memory files; Free space gegen 1M-Fenster) plus LIVE SessionStart-Hook-Injektion via /hook-inject (single-flight + TTL + 5s-Timeout, canonical hook-log geschützt). Skills/Agents zählen nur Metadaten (name+description, progressive disclosure), nicht die volle Datei. Spätere Layout-Redesign-Erweiterungen: leere mp-list-Spalte ausgeblendet; CLAUDE.md global+projekt + MEMORY.md zeigen Ladepfad und sind ausklappbar lesbar (ctx-readable via /read, Re-Bind nach Hook-Repaint gefixt). Org-Regel: keine tn-Inhalte cross-project. Implementierung und Review getrennt (Dev/Review): APPROVE. 124 Tests + check/lint/fmt grün, im Browser verifiziert.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
