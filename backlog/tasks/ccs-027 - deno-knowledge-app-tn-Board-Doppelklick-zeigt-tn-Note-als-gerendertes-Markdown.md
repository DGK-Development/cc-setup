---
id: CCS-027
title: >-
  deno-knowledge-app: tn-Board Doppelklick zeigt tn-Note als gerendertes
  Markdown
status: Done
assignee:
  - '@dev'
created_date: '2026-06-05 22:02'
updated_date: '2026-06-06 05:53'
labels:
  - knowledge-app
dependencies: []
ordinal: 70000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Im tn-Board (read-only) soll Doppelklick auf eine Karte die tn-Note als gerendertes Markdown im Modal zeigen (wie openTaskDetail/showModal beim backlog-Board). ORG: tn-Board ist projekt-scoped (genehmigte Variante); Note wird zur Laufzeit lokal beim User via tn-CLI (tn show id) geholt, NICHT ueber beliebigen Vault-Dateipfad. Dev/Tests nur mit synthetischen Fixtures, KEIN echter tn-Inhalt im Claude/Subagent-Kontext.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Doppelklick auf tn-Karte oeffnet Modal mit der tn-Note als gerendertes Markdown (mdToHtml, XSS-safe wie backlog-Detail)
- [x] #2 Inhalt projekt-scoped via tn-CLI (tn show id) geholt, nicht via arbitraerem Dateipfad; neue Server-Route/Kind sauber gewhitelistet
- [x] #3 Read-only bleibt (kein Schreiben); cross-project nicht betroffen
- [x] #4 Kein Inhalt/Fehler -> Modal zeigt sauberen Hinweis
- [x] #5 just deno-test gruen; synthetische Fixtures, kein echter tn-Vault-Inhalt im Kontext
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC1+2: openTnDetail(it) in browser.js — fetcht /tn-note?id=&project=, zeigt Modal via showModal+updateModal. Beide tn-Board-Renderer (renderTnBoard + renderCombinedBoard tn-Teil) erhalten dblclick-Handler wenn it.id vorhanden.

AC3: id-Feld in tnItems in context.ts ergaenzt (CCS-027). Server-Route GET /tn-note: id whitelist /^[A-Za-z0-9_-]{1,80}$/, ruft tn show <id> --format json auf (cwd-scoped), gibt {ok,body,title} zurueck.

AC4: Fehlerfall zeigt sauberen Hinweis im Modal. updateModal() patcht offenes Modal statt es neu zu erstellen (verhindert Flackern beim async Laden).

AC5: 100 Tests gruen. tn show --format json body-Feld ist Markdown-Body ohne Frontmatter. Parity-Test: tn items tragen id-Feld.

Review-MAJOR-2: d.id entfernt (war immer undefined — /tn-note gibt kein id-Feld zurueck). Modal-Titel jetzt direkt aus it.id + d.title (beide immer verfuegbar). Review-MINOR-1: esc(d.error) im Fehlerpfad gesetzt.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
tn-Board Doppelklick oeffnet tn-Note als gerendertes Markdown (read-only Modal).

Changes:
- src/context.ts: tnItems erhalten id-Feld (aus extractTnTasks t.id).
- src/server.ts: GET /tn-note?id=&project= — id whitelist [A-Za-z0-9_-]{1,80}, ruft tn show <id> --format json (cwd-scoped) auf, gibt {ok,body,title} zurueck. Import join+run+parseJson ergaenzt.
- assets/browser.js: openTnDetail(it) — fetch /tn-note, showModal sofort (laedt...), updateModal() nach Fetch. updateModal() patcht offenes Modal (kein Flackern). dblclick-Handler in renderTnBoard() und renderCombinedBoard() tn-Sektion wenn it.id vorhanden.

Tests: +1 (tn items carry id field, parity_test.ts). 100 passed.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
