---
id: CCS-012
title: 'Repo voll flach: templates/* nach Root, just deploy [target], dist/ ephemer'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-06-05 07:59'
updated_date: '2026-06-05 07:59'
labels:
  - infra
  - build
  - follow-up
dependencies: []
priority: high
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Folge-Refactor nach CCS-005: die Quelle ist noch halb-flach (skills/agents/settings/contract unter templates/) mit persistiertem dist/-Build. Ziel (User): EINE flache zentrale Quelle im Repo-Root + ein Deploy-Command, der flach ins jeweilige Claude-Home updatet. hook-redactor bleibt Submodul.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Source flach im Root: skills/, agents/, settings.json, CONTRACT.md (ex templates/CLAUDE.md), BUNDLE-MANIFEST am Root; templates/ entfernt; Root-CLAUDE.md (Backlog-Regeln) bleibt unangetastet
- [ ] #2 just deploy [target_home] deployt flach ins ueberschreibbare Claude-Home (default ~/.claude); just setup entfernt oder auf deploy aliased
- [ ] #3 dist/ wird NICHT mehr persistiert: Build laeuft in ephemerem Temp-Dir (oder inline), danach Cleanup
- [ ] #4 Assembly erhalten: hooks-merge mit redactor, redactor-CLAUDE-Appendix, session_analyze single-source ins audit-Skill, CLAUDE_PLUGIN_ROOT->Flat-Patch, Skill-De-Namespace
- [ ] #5 Isolierter just deploy gegen temp Claude-Home erfolgreich (12 Skills, keine Dubletten); just test gruen; README/doc-002/BUNDLE-MANIFEST aktualisiert
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just test passes
<!-- DOD:END -->
