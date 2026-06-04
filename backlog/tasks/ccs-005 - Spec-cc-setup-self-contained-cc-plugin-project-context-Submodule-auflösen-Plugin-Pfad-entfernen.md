---
id: CCS-005
title: >-
  [Spec] cc-setup self-contained: cc-plugin-project-context-Submodule auflösen +
  Plugin-Pfad entfernen
status: In Progress
assignee:
  - '@claude'
created_date: '2026-06-04 20:26'
updated_date: '2026-06-04 22:13'
labels: []
milestone: 'ccs-flat: Submodule auflösen → self-contained Flat-Install'
dependencies: []
priority: high
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ziel: cc-setup wird ein self-contained Repo ohne Submodule-Abhängigkeit und ohne Legacy-Plugin-Pfad. Das Submodule vendor/cc-plugin-project-context (Quelle aller gebundelten Skills/Scripts/Hooks) wird aufgelöst und sein Inhalt direkt ins Repo vendored. Damit entfällt das git submodule update --remote in bundle.sh (Zeile 14), das bei jedem Build lokale Submodule-Commits wie d55c6c3 verwirft. Gleichzeitig wird der Plugin-/Marketplace-Pfad (niclasedge-pkm, just install) entfernt, sodass der Flat-Install (just setup) der einzige Weg ist und die Skill-Dubletten verschwinden. Scope: nur cc-plugin-project-context. Das hook-redactor-Submodule bleibt unverändert (eigener Upstream).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Repo baut und installiert ohne vendor/cc-plugin-project-context-Submodule (git submodule status zeigt es nicht mehr)
- [x] #2 bundle.sh enthält kein git submodule update --remote mehr; Quellen sind repo-lokal
- [x] #3 Flat-Install (just setup) ist der einzige Install-Pfad; Legacy-Plugin-Pfad (just install + niclasedge-pkm Marketplace) entfernt
- [x] #4 Nach frischem Install + Restart: context-load + sprint_bridge laufen ohne Plugin, keine Skill-Dubletten, just test grün
- [x] #5 hook-redactor-Submodule bleibt unangetastet
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
cc-setup ist self-contained: Submodul cc-plugin-project-context aufgeloest, Inhalt repo-lokal vendored (scripts/, hooks/, commands/, templates/skills/context-load/). bundle.sh ohne submodule update --remote; Flat-Install (just setup) ist einziger Pfad (Legacy-Plugin/Marketplace entfernt). hook-redactor unangetastet. Clean-Install gegen leeres CLAUDE_HOME verifiziert (12 Skills, keine Dubletten, kein Plugin), 49 Tests gruen. 9 Subtasks abgeschlossen.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
