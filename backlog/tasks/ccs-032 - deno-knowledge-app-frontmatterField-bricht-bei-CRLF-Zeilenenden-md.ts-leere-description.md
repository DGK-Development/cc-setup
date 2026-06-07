---
id: CCS-032
title: >-
  deno-knowledge-app: frontmatterField bricht bei CRLF-Zeilenenden (md.ts) ->
  leere description
status: Done
assignee: []
created_date: '2026-06-06 07:22'
updated_date: '2026-06-06 19:49'
labels: []
dependencies: []
ordinal: 75000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
frontmatterField in src/md.ts liefert bei Dateien mit CRLF (\r\n) einen leeren String: Regex (.*)$ ohne m-Flag, . schliesst line-terminator aus, trailing \r bleibt -> kein Match. Betrifft ~8 Skills/Agents (qmd, check-links, daily-review, recall, goal-aligner, inbox-processor, note-organizer, weekly-reviewer) -> deren meta_tokens fallen auf ~Name-only statt ~70. Effekt ~2% auf Kontext-View. PARITY-SENSIBEL: md.ts spiegelt knowledge.py _frontmatter_field byte-faithful; vor Aenderung Python-Verhalten bei CRLF pruefen.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 frontmatterField liest description korrekt bei CRLF-Dateien (Zeilen vor Match um trailing \r bereinigt)
- [ ] #2 Parity zu knowledge.py _frontmatter_field geprueft und erhalten ODER bewusste Abweichung dokumentiert
- [ ] #3 Test mit CRLF-Fixture deckt den Fall ab
- [ ] #4 betroffene Skills/Agents liefern wieder description-basierte meta_tokens (Stichprobe qmd/check-links)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just test passes
<!-- DOD:END -->
