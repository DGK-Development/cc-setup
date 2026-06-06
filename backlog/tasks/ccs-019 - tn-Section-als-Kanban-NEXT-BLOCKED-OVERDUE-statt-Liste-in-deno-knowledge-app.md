---
id: CCS-019
title: tn-Section als Kanban (NEXT/BLOCKED/OVERDUE) statt Liste in deno-knowledge-app
status: Done
assignee:
  - '@niclasedge'
created_date: '2026-06-05 20:38'
updated_date: '2026-06-06 05:53'
labels:
  - deno-knowledge-app
  - tn
  - ui
dependencies: []
priority: medium
ordinal: 62000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Im Projekt-View der deno-knowledge-app wird die tn-Section aktuell als flache Liste (coll.tn = next+blocked) gerendert. Sie soll als 3-Spalten-Kanban erscheinen, analog zur globalen Statusline (skripte/statusline.py): NEXT / BLOCKED / OVERDUE. Wiederverwendung des bestehenden Board-Patterns (renderBoard + .kn-board/.kn-col/.kn-card). Org-Regel (Memory deno-knowledge-tn-org-block): tn-Daten sind kunden-/personenbezogen -> OVERDUE strikt projekt-scoped (KEINE cross-project Aggregation), Collector whitelistet nur unbedenkliche Felder, read-only (keine Schreibaktion). Verifikation NUR mit synthetischen Fixtures, keine echten tn-Inhalte.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 tn-Section im Projekt-View rendert als 3-Spalten-Kanban NEXT/BLOCKED/OVERDUE statt flacher Liste; Backlog-Board und alle anderen Sections unveraendert
- [x] #2 OVERDUE ist projekt-scoped (scheduled<heute, nicht done, nicht bereits in BLOCKED); KEINE cross-project tn-Aggregation
- [x] #3 Collector whitelistet weiterhin nur title/status/scheduled (kein kunde-Feld, kein project.path, keine volle Frontmatter) in window.DATA
- [x] #4 Kanban ist read-only: keine Drag&Drop-/Schreibaktion fuer tn
- [x] #5 Spalten zeigen Count im Header; leere Spalte zeigt Platzhalter; OVERDUE-Card zeigt scheduled-Datum
- [x] #6 deno task test / just test gruen; neue Tests nutzen ausschliesslich synthetische Fixtures, keine echten tn-Daten
- [x] #7 Statusline (sumTn) und buildData parity-contract bleiben intakt
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Collector (src/collectors/tn.ts): collectTn um projekt-scoped OVERDUE erweitern. extractTnTasks zusaetzlich 'scheduled' whitelisten. tn list (projekt-scoped via cwd) holen, filter: nicht done, scheduled<heute, nicht in blocked-Set. Nur title/status/scheduled extrahieren (kein kunde/path/metadata).
2. buildData (src/context.ts): coll.tn-Items mit Spalten-Zuordnung (col: next|blocked|overdue) anreichern; overdue-Items ergaenzen; flat-list-Kompat fuer parity beibehalten.
3. browser.js (assets/browser.js): in select(id) bei id==='tn' read-only Kanban triggern (renderTnBoard): 3 feste Spalten NEXT/BLOCKED/OVERDUE, Count im Header, Platzhalter bei leer, OVERDUE-Card mit scheduled-Tag. Kein draggable, keine /action-Posts.
4. CSS: .kn-board/.kn-col/.kn-card wiederverwenden; ggf. read-only-Variante (Cursor default, kein drag-hint).
5. Tests (synthetisch): collectTn overdue-Filter (Fixture), buildData tn-col-Zuordnung, render/board-Markup. KEINE echten tn-Daten.
6. just test gruen. Dev via Subagent, danach Review-Subagent (Org: dev!=review eine Session). Human-Oversight: User reviewt vor Produktiv.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Direkt im Haupt-Checkout umgesetzt (kein Worktree). Geaenderte Dateien:
- src/collectors/tn.ts: extractTnTasks whitelistet zusaetzlich 'scheduled'; neue pure exportierte Funktion pickOverdue(tasks, todayIso, blockedIds); collectTn holt projekt-scoped 'tn list' und berechnet overdue mit Cross-Project-Guard (projNames.size>1 -> overdue=[], nie cross-project aggregieren).
- src/context.ts: tnItems bekommen col-Feld (next|blocked|overdue); overdue-Items ergaenzt (desc=scheduled); nav-Label 'tn next/blocked/overdue'.
- assets/browser.js: select(id==='tn') triggert is-board + renderTnBoard; read-only 3-Spalten-Board (NEXT/BLOCKED/OVERDUE), Count im Header, Platzhalter bei leer, OVERDUE-Card mit scheduled-Tag; kein draggable/keine /action-Posts.
- src/render.ts: KANBAN_CSS um .kn-card.ro (cursor default) + .kn-col-empty ergaenzt.
- test/tn_test.ts (neu): 3 synthetische pickOverdue-Tests. test/parity_test.ts: +1 buildData tn-col-Test.

Verifikation (synthetisch, KEINE echten tn-Daten): deno task check ok; deno lint 29 files ok; deno fmt ok; just test = 49 pytest + 71 deno passed, 0 failed.

Org-Compliance: OVERDUE projekt-scoped (kein cross-project), Collector-Whitelist unveraendert (kein kunde/path/volle Frontmatter in window.DATA), read-only. Sidebar-tn-Count war bereits implementiert (collectSidebar.tn via parseTnProjects working_dir-Match, render.ts rendert 'N tn' pro Projektzeile) — nicht doppelt gebaut.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
tn-Section im Projekt-View der deno-knowledge-app rendert jetzt als read-only 3-Spalten-Kanban (NEXT/BLOCKED/OVERDUE) statt flacher Liste, analog zur globalen Statusline.

Was geaendert:
- Collector (tn.ts): neue pure Funktion pickOverdue + projekt-scoped OVERDUE in collectTn, mit Guard gegen versehentliche cross-project Aggregation. 'scheduled' wird whitelisted.
- buildData (context.ts): tn-Items tragen ein col-Feld; OVERDUE-Items ergaenzt.
- Client (browser.js): renderTnBoard (read-only, kein Drag&Drop), getriggert ueber select('tn'); reuse des bestehenden Board-Patterns/CSS.
- CSS (render.ts): read-only Card + leere-Spalte-Platzhalter.

Org-Compliance (Memory deno-knowledge-tn-org-block): OVERDUE strikt projekt-scoped, keine cross-project tn-Aggregation; Collector leakt weiterhin kein kunde-Feld/project.path/volle Frontmatter; Anzeige ist read-only. Sidebar zeigt den per-Projekt tn-Count bereits (war schon implementiert).

Tests/Risiken: deno check/lint/fmt sauber; just test = 49 pytest + 71 deno, 0 failed. Alle neuen Tests rein synthetisch (keine echten tn-Inhalte). Live-UI-Verifikation (Dashboard gegen echten Vault) steht beim User aus, da Claude keine echten tn-Daten ziehen darf. Status absichtlich In Progress: Human-Oversight-Review (Org-Pflicht) durch User vor Done/Produktiv.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
