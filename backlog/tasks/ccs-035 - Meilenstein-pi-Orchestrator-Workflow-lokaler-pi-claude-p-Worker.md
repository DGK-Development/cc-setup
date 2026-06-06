---
id: CCS-035
title: '[Meilenstein] pi-Orchestrator-Workflow (lokaler pi -> claude -p Worker)'
status: To Do
assignee: []
created_date: '2026-06-06 18:47'
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
- [ ] #2 Org-Compliance verifiziert: kein Auto-Push, Dev!=Review als getrennte claude -p Sessions, redactor im Worker aktiv
- [ ] #3 Safety-Caps greifen: Retry-Ueberschreitung -> intervention (kein Done), damage-control blockt destruktive pi-Bash, single-flight verhindert Doppel-Worker
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just test passes
<!-- DOD:END -->
