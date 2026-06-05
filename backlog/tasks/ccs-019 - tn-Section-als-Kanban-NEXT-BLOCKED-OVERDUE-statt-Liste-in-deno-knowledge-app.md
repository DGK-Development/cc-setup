---
id: CCS-019
title: tn-Section als Kanban (NEXT/BLOCKED/OVERDUE) statt Liste in deno-knowledge-app
status: In Progress
assignee:
  - '@niclasedge'
created_date: '2026-06-05 20:38'
updated_date: '2026-06-05 20:38'
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
- [ ] #1 tn-Section im Projekt-View rendert als 3-Spalten-Kanban NEXT/BLOCKED/OVERDUE statt flacher Liste; Backlog-Board und alle anderen Sections unveraendert
- [ ] #2 OVERDUE ist projekt-scoped (scheduled<heute, nicht done, nicht bereits in BLOCKED); KEINE cross-project tn-Aggregation
- [ ] #3 Collector whitelistet weiterhin nur title/status/scheduled (kein kunde-Feld, kein project.path, keine volle Frontmatter) in window.DATA
- [ ] #4 Kanban ist read-only: keine Drag&Drop-/Schreibaktion fuer tn
- [ ] #5 Spalten zeigen Count im Header; leere Spalte zeigt Platzhalter; OVERDUE-Card zeigt scheduled-Datum
- [ ] #6 deno task test / just test gruen; neue Tests nutzen ausschliesslich synthetische Fixtures, keine echten tn-Daten
- [ ] #7 Statusline (sumTn) und buildData parity-contract bleiben intakt
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

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just test passes
<!-- DOD:END -->
