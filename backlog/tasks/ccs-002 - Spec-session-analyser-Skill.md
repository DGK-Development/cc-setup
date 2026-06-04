---
id: CCS-002
title: '[Spec] session-analyser Skill'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-06-03 20:24'
updated_date: '2026-06-04 20:13'
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
- [x] #1 Skill session-analyser laeuft redactor-strict-konform gegen aktuelles Projekt
- [x] #2 Report + Lessons landen in knowledge/, CLAUDE.md verweist schlank darauf
- [x] #3 Aenderungen werden nur vorgeschlagen, nicht auto-applied (Human-Oversight)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-06-04 22:0x verify (CCS-002 Roll-up): alle 5 Subtasks (.01-.05) Done. Verifiziert real:
- just test -> 14 passed (DoD).
- Engine scripts/session_analyze.py laeuft redactor-strict gegen cc-setup: exit=0, valides Aggregat (session_count=5, waste_signals=thresholds/redundant_reads/oversized_outputs/repeated_commands, 26 failed_commands) -> AC#1.
- audit-Skill (hat session-analyser absorbiert) hat Human-Oversight-Gate ("NEVER auto-applies") + knowledge/<lesson>.md-Proposals + CLAUDE.md-Trim-Diffs -> AC#2/#3.
RESTRUCTURE-HINWEIS: session-analyser wurde extern in neues audit-Skill ueberfuehrt (templates/skills/audit/ + ~/.claude/skills/audit/; session-analyser/session-init-Templates geloescht, bundle.sh/skills.csv/vendor modifiziert) - diese Changes liegen UNCOMMITTED und gehoeren zu keinem Task. session_analyze.py-Engine unveraendert.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
session-analyser Skill: Spec + Implementierung komplett (alle 5 Subtasks Done, verifiziert).

Was: 2-stufige Hybrid-Engine — scripts/session_analyze.py (deterministischer JSONL-Parser + Token-Waste-Heuristiken: redundant_reads >=2, oversized_outputs >50k, repeated_commands >=3, repeated_sequences) erzeugt JSON-Aggregat; LLM-Synthese -> Report + knowledge/<lesson>.md-Proposals + CLAUDE.md-Trim-Diffs. Human-Oversight-Gate: nie Auto-Apply.

Verify (real, nicht nur Done-Flags): just test 14 passed; Engine laeuft redactor-strict gegen cc-setup (exit=0, 5 Sessions, 26 failed_commands, alle waste-Kategorien); Skill-Gate + knowledge/CLAUDE.md-Konvention vorhanden.

Restructure: session-analyser wurde nachgelagert ins breitere audit-Skill (LOGS + CONFIG) ueberfuehrt; Engine identisch. Diese Restructure-Changes sind UNCOMMITTED und ausserhalb dieses Tasks zu reviewen.

Status: verify-ready (Human setzt Done). Wiki-Doku: [[AI-coding-agenten-session-analyser]] (CCS-004).
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
