---
id: CCS-006
title: 'Backlog auto-load primär, Vault-TaskNotes nur on-demand'
status: Done
assignee:
  - '@claude'
created_date: '2026-06-04 20:44'
updated_date: '2026-06-05 07:51'
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
- [x] #1 SessionStart-Hook injiziert Backlog-Stand auch ohne gebundenen Milestone: Milestones (name, done/total, offene Subtask-IDs), dann In-Progress-Tasks, dann empfohlene nächste To-Dos; Fallback auf backlog task list wenn keine Milestones
- [x] #2 TaskNotes-Auto-Block (in-progress-Liste) aus inject-project-context.sh entfernt
- [x] #3 userprompt-context-match.sh: injizierte context-load-Instruktion ist Backlog-zentriert; TaskNotes nur bei expliziter Anfrage
- [x] #4 context-load SKILL.md: Layer 1.5 (Backlog) ist primärer Auto-Layer, Layer 1 (TaskNote-Match) nur on-demand
- [x] #5 templates/CLAUDE.md Runtime-Vertrag angepasst: SessionStart druckt Backlog-Stand statt aktive TaskNotes
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
SessionStart-Hook injiziert Backlog-Stand PRIMAER (Milestones done/total + offene Subtask-IDs, In-Progress, naechste To-Dos; Fallback backlog task list); TaskNotes-Auto-Block entfernt. userprompt-Hook + context-load SKILL (Layer 1.5 primaer, Layer 1 on-demand) + templates/CLAUDE.md Backlog-zentriert. no-op ohne backlog/. 49 Tests gruen.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
