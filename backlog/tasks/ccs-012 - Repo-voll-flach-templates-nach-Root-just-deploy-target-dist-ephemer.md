---
id: CCS-012
title: 'Repo voll flach: templates/* nach Root, just deploy [target], dist/ ephemer'
status: Done
assignee:
  - '@claude'
created_date: '2026-06-05 07:59'
updated_date: '2026-06-05 08:13'
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
- [x] #1 Source flach im Root: skills/, agents/, settings.json, CONTRACT.md (ex templates/CLAUDE.md), BUNDLE-MANIFEST am Root; templates/ entfernt; Root-CLAUDE.md (Backlog-Regeln) bleibt unangetastet
- [x] #2 just deploy [target_home] deployt flach ins ueberschreibbare Claude-Home (default ~/.claude); just setup entfernt oder auf deploy aliased
- [x] #3 dist/ wird NICHT mehr persistiert: Build laeuft in ephemerem Temp-Dir (oder inline), danach Cleanup
- [x] #4 Assembly erhalten: hooks-merge mit redactor, redactor-CLAUDE-Appendix, session_analyze single-source ins audit-Skill, CLAUDE_PLUGIN_ROOT->Flat-Patch, Skill-De-Namespace
- [x] #5 Isolierter just deploy gegen temp Claude-Home erfolgreich (12 Skills, keine Dubletten); just test gruen; README/doc-002/BUNDLE-MANIFEST aktualisiert
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Repo voll flach: templates/* via git mv in den Root (skills/, agents/, settings.json, CONTRACT.md, BUNDLE-MANIFEST.md; Root-CLAUDE.md=Backlog-Regeln unberuehrt). setup.sh->deploy.sh: just deploy [target] baut in mktemp-Temp (trap-Cleanup, dist/ nicht mehr persistiert) und deployt flach ins ueberschreibbare Home. bundle.sh liest flache Quellen; Assembly erhalten (merge_hooks uv run python3, redactor-Appendix, session_analyze single-source ins audit, CLAUDE_PLUGIN_ROOT->Flat-Patch, De-Namespace). README/doc-002/BUNDLE-MANIFEST aktualisiert. Reviewer PASS (Idempotenz 2x Deploy ok), isolierter Deploy 12 Skills ohne Dubletten, 49 Tests gruen. hook-redactor bleibt Submodul.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
