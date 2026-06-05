---
id: CCS-011
title: 'Verwaiste Legacy-Scripts aufraeumen (prompt-sync, prompt-vault-setup)'
status: To Do
assignee: []
created_date: '2026-06-05 05:13'
labels:
  - cleanup
  - follow-up
dependencies: []
priority: low
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Folge aus CCS-005.08: scripts/prompt-sync.sh + scripts/prompt-vault-setup.sh wurden nur von der entfernten install.sh aufgerufen und sind jetzt verwaist; sie enthalten noch just install-Erwaehnungen (tote Doku in totem Code, Review-NIT). Entfernen oder in den Flat-Pfad (just setup/setup.sh) reintegrieren.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 prompt-sync.sh + prompt-vault-setup.sh entweder entfernt ODER in den Flat-Setup-Pfad reintegriert
- [ ] #2 Keine just install-Referenz mehr in scripts/ (rg-Treffer 0, ausser historischer Doku)
- [ ] #3 just test bleibt gruen
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just test passes
<!-- DOD:END -->
