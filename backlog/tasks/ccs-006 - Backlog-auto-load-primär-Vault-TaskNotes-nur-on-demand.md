---
id: CCS-006
title: 'Backlog auto-load primär, Vault-TaskNotes nur on-demand'
status: To Do
assignee: []
created_date: '2026-06-04 20:44'
labels:
  - context-load
  - hooks
dependencies:
  - CCS-005
priority: high
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SessionStart-Hook, context-load und templates/CLAUDE.md umstellen: Backlog.md-Tasks sind die primären Arbeits-Items und werden automatisch in den Session-Kontext injiziert (Milestones mit done/total und offenen Subtask-IDs, In-Progress-Tasks, empfohlene nächste To-Dos). Vault-TaskNotes werden NICHT mehr automatisch geladen, nur on-demand bei expliziter Anfrage. Kehrt den aktuellen SessionStart-Vertrag um. Überschneidet sich mit CCS-005.04/.06 (gleiche Hook- und SKILL.md-Dateien) — daher im Flat-Layout nach dem Vendoren umsetzen, nicht im Submodule.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SessionStart-Hook injiziert Backlog-Stand auch ohne gebundenen Milestone: Milestones (name, done/total, offene Subtask-IDs), dann In-Progress-Tasks, dann empfohlene nächste To-Dos; Fallback auf backlog task list wenn keine Milestones
- [ ] #2 TaskNotes-Auto-Block (in-progress-Liste) aus inject-project-context.sh entfernt
- [ ] #3 userprompt-context-match.sh: injizierte context-load-Instruktion ist Backlog-zentriert; TaskNotes nur bei expliziter Anfrage
- [ ] #4 context-load SKILL.md: Layer 1.5 (Backlog) ist primärer Auto-Layer, Layer 1 (TaskNote-Match) nur on-demand
- [ ] #5 templates/CLAUDE.md Runtime-Vertrag angepasst: SessionStart druckt Backlog-Stand statt aktive TaskNotes
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just test passes
<!-- DOD:END -->
