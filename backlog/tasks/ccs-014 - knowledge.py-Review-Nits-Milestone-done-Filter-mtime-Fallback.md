---
id: CCS-014
title: 'knowledge.py Review-Nits: Milestone-done-Filter + mtime-Fallback'
status: To Do
assignee: []
created_date: '2026-06-05 10:08'
labels: []
milestone: knowledge-dashboard
dependencies: []
priority: low
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
2 Minors aus Reviewer-Subagent (PASS-mit-Nits): (1) collect_backlog zeigt aktiven Milestone mit done==total als 100%-offen — done<total filtern oder Label Aktive-Milestones. (2) collect_tokens: wenn mtimes gefuellt aber keine session_id matcht, greift per_session[-1]-Fallback nicht — haerten.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Milestone mit done==total nicht als offen gerendert
- [ ] #2 collect_tokens faellt bei nicht-matchenden mtimes sauber auf per_session[-1] zurueck
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just test passes
<!-- DOD:END -->
