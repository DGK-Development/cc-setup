---
id: CCS-010
title: >-
  Externe Stop-Sub-Hooks vendoren oder sauber degradieren (cleanup-dispatch-stop
  + sync-sessions-to-vault)
status: To Do
assignee: []
created_date: '2026-06-05 05:13'
labels:
  - infra
  - hooks
  - follow-up
dependencies: []
priority: medium
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Folge aus CCS-008: stop-workflow.sh (jetzt repo-lokal) ruft best-effort zwei weitere Live-Sub-Hooks aus $PAI_DIR/hooks/ auf: cleanup-dispatch-stop.sh und sync-sessions-to-vault.sh. Die liegen NICHT im cc-setup-Repo, dadurch ist der Stop-Workflow noch nicht vollstaendig self-contained. Entscheiden: vendoren oder bewusst extern belassen.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Entscheidung dokumentiert (vendoren vs. extern belassen) mit Begruendung
- [ ] #2 Falls vendoren: beide Sub-Hooks nach hooks/, von stop-workflow.sh repo-lokal aufgerufen, via setup.sh deployed
- [ ] #3 Falls extern: stop-workflow.sh degradiert sauber (no-op + Hinweis) wenn die Sub-Hooks fehlen, keine Fehler
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just test passes
<!-- DOD:END -->
