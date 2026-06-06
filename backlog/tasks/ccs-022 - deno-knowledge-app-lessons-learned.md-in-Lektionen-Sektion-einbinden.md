---
id: CCS-022
title: 'deno-knowledge-app: lessons-learned.md in Lektionen-Sektion einbinden'
status: Done
assignee:
  - '@dev'
created_date: '2026-06-05 21:16'
updated_date: '2026-06-05 21:57'
labels:
  - knowledge-app
dependencies: []
ordinal: 65000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Die Lektionen-Sektion liest nur lektion-*.md (knowledge.ts collectKnowledge). Der Option-B-Standard kennt knowledge/lessons-learned.md, das aktuell ignoriert wird. Quell-Item (Obsidian): 49D4AE6D-97E2-4492-9816-81D0AF8D5AD7.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 collectKnowledge liest knowledge/lessons-learned.md, falls vorhanden
- [x] #2 Lessons-Learned-Eintraege erscheinen in der Lektionen-Sektion (zusammen mit oder klar getrennt von lektion-*.md)
- [x] #3 Detail-Ansicht zeigt den Inhalt korrekt (readDoc-Kind unterstuetzt die Datei, Pfad-Whitelist eingehalten)
- [x] #4 Fehlt die Datei, bleibt das Verhalten unveraendert (kein Fehler)
- [x] #5 just test gruen; synthetischer Test
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
collectKnowledge: nach lektion-*.md Scan wird lessons-learned.md via Deno.stat geprüft; existiert sie → lektionen.push("lessons-learned.md")

readDoc kind=lektion besteht bereits und whitelistet knowledge/ → lessons-learned.md kann direkt mit lektion-Kind gelesen werden, kein neues Kind nötig

Fehlt die Datei → unverändertes Verhalten (catch ignoriert). 2 neue Tests. just deno-test: 81 passed, 0 failed
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
lessons-learned.md in Lektionen. knowledge.ts liest knowledge/lessons-learned.md falls vorhanden (kein Fehler wenn fehlt); Detail ueber bestehendes readDoc-Kind lektion (Whitelist knowledge/). 2 neue Tests, just deno-test gruen.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
