---
id: CCS-007
title: knowledge/skills.csv aktualisieren + cc-setup-Deployment markieren
status: In Progress
assignee:
  - '@claude'
created_date: '2026-06-04 20:45'
updated_date: '2026-06-04 22:14'
labels:
  - knowledge
  - docs
dependencies: []
priority: medium
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
skills.csv mit dem aktuellen Skill-Bestand abgleichen (konsolidierte/gemergte Skills einarbeiten, z.B. session und audit) und kennzeichnen, welche Skills via cc-setup deployt werden (Tier-1-Bundle laut templates/BUNDLE-MANIFEST.md: context-load, context-init, local-ci, cc-setup, review, qmd, recall, opensrc, check-links, daily-review, session-init, session-stop, knowledge). Reine Daten- und Doku-Pflege, kein Code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 skills.csv spiegelt den aktuellen Skill-Bestand wider (Merges und Konsolidierungen eingearbeitet)
- [x] #2 skills.csv kennzeichnet die via cc-setup deployten Skills (Tier-1 aus BUNDLE-MANIFEST.md)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
skills.csv: cc_setup_tier1-Spalte (12 deployte Skills markiert), home/projekt-Eintraege fuer cc-setup+context-load ergaenzt; session-analyser war bereits -> audit gemerged. BUNDLE-MANIFEST: audit ergaenzt, session-init gestrichen (Abgleich templates/skills/).
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
