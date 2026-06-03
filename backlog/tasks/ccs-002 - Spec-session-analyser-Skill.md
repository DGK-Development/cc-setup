---
id: CCS-002
title: '[Spec] session-analyser Skill'
status: To Do
assignee: []
created_date: '2026-06-03 20:24'
labels: []
milestone: session-analyser
dependencies: []
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Neuer Skill, der vergangene Sessions des aktuellen Projekts (~/.claude/projects/<pfad>/*.jsonl) analysiert: fehlgeschlagene Befehle, Token-Waste, wiederkehrende Aktionen. Hybrid-Engine (Python-Metrik-Extraktor + LLM-Synthese). Output: Report + Patch-Vorschlaege nach knowledge/; CLAUDE.md bleibt schlank via Referenzen. Anwenden erst nach Review (Human-Oversight).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Skill session-analyser laeuft redactor-strict-konform gegen aktuelles Projekt
- [ ] #2 Report + Lessons landen in knowledge/, CLAUDE.md verweist schlank darauf
- [ ] #3 Aenderungen werden nur vorgeschlagen, nicht auto-applied (Human-Oversight)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just test passes
<!-- DOD:END -->
