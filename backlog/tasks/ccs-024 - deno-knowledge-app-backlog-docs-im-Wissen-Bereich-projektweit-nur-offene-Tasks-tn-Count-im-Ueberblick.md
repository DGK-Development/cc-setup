---
id: CCS-024
title: >-
  deno-knowledge-app: backlog/docs im Wissen-Bereich + projektweit nur offene
  Tasks + tn-Count im Ueberblick
status: Done
assignee:
  - '@dev'
created_date: '2026-06-05 21:16'
updated_date: '2026-06-05 21:57'
labels:
  - knowledge-app
dependencies: []
ordinal: 67000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Drei Teile aus Quell-Item (Obsidian) 89D76BDF-867E-42B3-AD5D-1B24E9F47B11. (a) backlog/docs wird nicht gelesen -> im Wissen-Bereich anzeigen (decisions kommen schon via backlogDecisions-Fallback). (b) Backlog-projektweit-Overview (projectLooseTasks) filtert done NICHT raus -> nur nicht-done Loose-Tasks. (c) tn projektuebergreifend: ORG-KONFORM nur als aggregierte Zahl im Ueberblick (working_dir-Match, KEINE Titel/kunde/Inhalte) - volle cross-project tn-Inhalte sind durch die Org-Regel verboten (siehe memory deno-knowledge-tn-org-block).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 backlog/docs/*.md werden gelesen und im Wissen-Bereich als eigene Sektion Docs angezeigt; Detail liest die Datei via readDoc (neues Kind, Pfad-Whitelist)
- [x] #2 backlog/decisions bleibt sichtbar (bestehender Fallback unveraendert)
- [x] #3 projectLooseTasks liefert nur Tasks mit status != done -> Backlog projektweit zeigt keine erledigten Loose-Tasks mehr
- [x] #4 Ueberblick zeigt eine projektuebergreifende tn-Gesamtzahl (aus Sidebar-Counts) - KEINE tn-Titel/kunde/Inhalte cross-project (Org-Regel)
- [x] #5 just test gruen; synthetische Tests fuer den Non-Done-Filter und den docs-Collector
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
(a) backlogDocs() liest backlog/docs/*.md, extrahiert id+title aus Frontmatter oder erstem Heading. Neue coll.docs + Nav docs in Wissen-Gruppe. readDoc kind=docfile whitelistet backlog/docs/. Fixture-Test: 2 neue Tests.

(b) projectLooseTasks() überspringt jetzt Tasks mit status.toLowerCase()==="done". Test: projectLooseTasks excludes tasks with status=done (case-insensitive) – filtert done/Done/DONE.

(c) overview.tn_total = Summe aller tn-Counts aus context.projects (dieselbe Quelle wie sumTn in statusline). Nur die Zahl – keine Titel/kunde/Inhalte (Org-Konformität). tn-Kachel zeigt jetzt tn_total.

just deno-test: 81 passed, 0 failed

Review-Fixes: docfile + taskfile: Regex-Guard vor under()-Check ergaenzt (erlaubt Leerzeichen in Dateinamen). 2 synthetische tn_total-Tests fuer Org-Compliance. just deno-test: 87 passed, 0 failed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
backlog/docs im Wissen + Non-Done-Filter + tn-Count. backlogDocs() liest backlog/docs/*.md -> coll.docs + Nav Docs; readDoc-Kind docfile mit Regex-Guard + Pfad-Whitelist. projectLooseTasks filtert status=done raus. overview.tn_total = aggregierte tn-Gesamtzahl aus Sidebar-Counts (org-konform: nur Zahl, keine Titel/kunde/Inhalte). Synthetische Tests, just deno-test gruen.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
