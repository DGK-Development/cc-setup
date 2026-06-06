---
id: CCS-021
title: >-
  deno-knowledge-app: CHANGELOG-Quelle robust machen + Detail-Rendering
  verbessern
status: Done
assignee:
  - '@dev'
created_date: '2026-06-05 21:16'
updated_date: '2026-06-05 21:57'
labels:
  - knowledge-app
dependencies: []
ordinal: 64000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Quelle ist hartkodiert auf Vault/Efforts/Work/dgk/REPO/CHANGELOG.md (knowledge.ts vaultChangelog) und damit fuer private/nicht-dgk Repos fragil. Im Detail wird nur 1 Zeile pro Eintrag ohne Kontext gezeigt (browser.js changelog-type), der Collector nimmt nur die letzten 5 Zeilen. Quell-Item (Obsidian): 55CECCA6-EBD1-4441-AB32-E6A46A57FA13.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Dokumentiert (in Task-Notes), woher die CHANGELOG-Daten kommen und warum bisher wenig im Detail steht
- [x] #2 CHANGELOG-Quelle robust: nutzt repo-lokales knowledge/CHANGELOG.md falls vorhanden, sonst Vault-Pfad; funktioniert auch fuer nicht-dgk/private Repos
- [x] #3 Detail-Ansicht eines CHANGELOG-Eintrags zeigt mehr Kontext (zugehoeriger Block / mehr Zeilen statt nur 1 Zeile)
- [x] #4 Mehr als 5 Eintraege verfuegbar (oder konfigurierbares Limit), sinnvoll sortiert (neueste zuerst)
- [x] #5 just test gruen; synthetischer Test fuer die neue Quellenauswahl
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
BEFUND: vaultChangelog() las hartkodiert Vault/Efforts/Work/dgk/REPONAME/CHANGELOG.md, last 5 Zeilen reversed, ohne #-Zeilen. Im Detail zeigte browser.js nur it.name (eine Zeile) ohne Body.

IMPLEMENTIERT: parseChangelogBlocks() parsed CHANGELOG in heading+body Blöcke. vaultChangelog() bevorzugt jetzt knowledge/CHANGELOG.md, fällt auf Vault-Pfad zurück. Limit von 5 auf 20 erhöht.

browser.js changelog-Detail: zeigt jetzt Heading-Text als Titel + filebody mit Body. Neue exports: parseChangelogBlocks, ChangelogEntry (knowledge.ts)

9 neue Tests für parseChangelogBlocks + collectKnowledge CHANGELOG-Quelle. just deno-test: 81 passed, 0 failed

Review-Fixes: parseChangelogBlocks: H1 als Dokument-Titel uebersprungen (nur ## und ###). Bloecke mit leerem Body herausgefiltert. Aeltester-zuerst-Changelogs per ISO-Datum-Heuristik erkannt und umgekehrt. 4 neue Regressions-Tests.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
CHANGELOG-Quelle robust + Detail. knowledge.ts: parseChangelogBlocks() parst heading+body-Bloecke; vaultChangelog bevorzugt repo-lokales knowledge/CHANGELOG.md vor Vault-dgk-Pfad; Limit 5->20; neueste-zuerst per ISO-Datum-Heuristik; H1- und Leer-Bloecke gefiltert. browser.js: Detail zeigt vollen Block statt 1 Zeile. 13 neue Tests, just deno-test gruen.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
