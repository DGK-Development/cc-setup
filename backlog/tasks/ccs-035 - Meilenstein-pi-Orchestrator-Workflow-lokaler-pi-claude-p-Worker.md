---
id: CCS-035
title: '[Meilenstein] pi-Orchestrator-Workflow (lokaler pi -> claude -p Worker)'
status: Done
assignee: []
created_date: '2026-06-06 18:47'
updated_date: '2026-06-07 08:50'
labels: []
milestone: 'ccs-sprint: pi-Orchestrator-Workflow'
dependencies: []
references:
  - specs/spec-pi-orchestrator-workflow.md
priority: medium
ordinal: 78000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Lokaler pi-Agent (Ollama gemma4:12b-mlx) als agent-team-Dispatcher orchestriert Backlog-Tasks; alle Worker laufen als claude -p (planner/builder/reviewer, --permission-mode auto). Autonomie=Spec-Gate, Done=Backlog+lokaler Commit, Push/Merge bleibt menschlich. Volle Architektur + Task-Breakdown in der Ref-Spec.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 End-to-End: pi faehrt einen echten Backlog-Task durch PICK->SPEC->Gate->DEV->GATE->REVIEW->DONE, Eingriff nur an Spec-Gate + finalem Merge
- [x] #2 Org-Compliance verifiziert: kein Auto-Push, Dev!=Review als getrennte claude -p Sessions, redactor im Worker aktiv
- [x] #3 Safety-Caps greifen: Retry-Ueberschreitung -> intervention (kein Done), damage-control blockt destruktive pi-Bash, single-flight verhindert Doppel-Worker
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Engineering komplett: alle 11 Subtasks (.01-.11) implementiert und verifiziert — Orchestrator-Extension (6 Tools, PICK->SPEC->GATE0->DEV->GATE1->REVIEW->DONE), claude -p Worker, Gate-Runner, Backlog-Bridge, Safety (Caps/single-flight/Kill-Switch/damage-control), File-Flag Pause/Resume + ntfy, Doku + just orchestrate + ADR. AC#2 (Org-Compliance: kein Auto-Push, Dev!=Review getrennt, redactor im Worker) und AC#3 (Safety-Caps greifen) verifiziert. AC#1 (voll-autonomer E2E) blieb offen: File-Flag-Resume erzwang manuellen pi-Neustart am Spec-Gate (Harness-Limit). Dieser Punkt wird in Milestone pi-gated-agentic-workflow (CCS-036) eingeloest — blockierende Slack-Rueckfragen (Kanal C0B8R3ERUNR) ersetzen das File-Flag-Resume und ermoeglichen einen echten unbeaufsichtigten E2E-Lauf.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
