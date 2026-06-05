---
id: CCS-013
title: '[Spec] knowledge.py — Single-Pane-Status-Dashboard'
status: In Progress
assignee:
  - '@developer'
created_date: '2026-06-05 09:46'
updated_date: '2026-06-05 11:04'
labels: []
milestone: knowledge-dashboard
dependencies: []
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On-demand FastAPI (uv-inline) Dashboard, das den gesamten Setup-Status auf einer Seite zeigt: globale Schicht (~/.claude CLAUDE.md/skills/hooks/settings/agents), Projekt-Schicht (cwd-Repo+Branch, knowledge-Index), knowledge/ (decisions.md, lektion-*, memory/, CHANGELOG), Backlog (Milestones + In-Progress), tn (next/blocked), Tokens (letzte Session + 7-Tage via session_analyze.py). Start: uv run --script scripts/knowledge.py, bind 127.0.0.1, just overview. Read-only, single-user, keine Auth/Persistenz. Reuse von sprint_bridge.py, session_analyze.py, tasknotes_cli.py. Entscheidung: nur Dashboard, kein SessionStart-Hook-Change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 uv run --script scripts/knowledge.py startet FastAPI auf 127.0.0.1 und rendert eine Single-Page mit 6 Karten
- [x] #2 Jede Karte degradiert einzeln (try/except): fehlendes Tool/Repo -> graue nicht-verfuegbar-Karte, kein Seiten-Crash
- [x] #3 settings.json-Werte werden redacted (nur Keys/Event-Namen sichtbar)
- [x] #4 just test gruen (Collector-Fixtures + Smoke-Test Route 200)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementiert via Dev-Subagent (TDD, isolierter Worktree), reviewed via separatem Reviewer-Subagent (Org-Regel dev!=review): PASS-mit-Nits, human-review-ready, 0 Blocker/Major. just test 74 gruen (inkl. Route-Smoke 200). In Haupt-Tree integriert. Nicht committet/gepusht.

Cost-Section (7. Karte) ergaenzt als CCS-013.07: account-weite $ aus ccusage usage/ (gleiche Quelle wie claude-watch-tui.py). Karten jetzt 7 statt 6. Reviewed PASS-mit-Nits, 77 Tests gruen.

Git-Actions (CCS-013.08) + Browser-Redesign (CCS-013.09, Terminal-3-Pane aus Claude-Design-Handoff) ergaenzt. Design-Assets unter scripts/knowledge_assets/ (dash.css/browser.css pristine + adaptierte browser.js). 37 Tests gruen.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
knowledge.py Single-Pane-Status-Dashboard (uv-inline FastAPI, 127.0.0.1, just overview). 6 read-only Karten: Global, Projekt, Knowledge, Backlog, tn, Tokens (letzte Session + 7-Tage). Reuse von session_analyze/sprint_bridge/tasknotes_cli. Sicherheit: localhost-bind, settings-Werte redacted, HTML-escaped (durch Tests + Live-curl belegt). 74 Tests gruen. Nicht deployed (Dev-Tool). 2 Minor-Nits als Follow-up.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just test passes
<!-- DOD:END -->
