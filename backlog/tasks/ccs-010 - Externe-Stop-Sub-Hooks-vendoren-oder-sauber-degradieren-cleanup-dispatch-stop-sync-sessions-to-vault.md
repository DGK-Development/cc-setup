---
id: CCS-010
title: >-
  Externe Stop-Sub-Hooks vendoren oder sauber degradieren (cleanup-dispatch-stop
  + sync-sessions-to-vault)
status: To Do
assignee:
  - '@claude'
created_date: '2026-06-05 05:13'
updated_date: '2026-06-07 11:51'
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
- [ ] #2 cleanup-dispatch-stop.sh nach hooks/ vendored und von stop-workflow.sh repo-lokal (HOOK_DIR) statt PAI_DIR aufgerufen; via deploy.sh automatisch deployed (bundle.sh rsynct hooks/)
- [ ] #3 sync-sessions-to-vault.sh bleibt extern; stop-workflow.sh no-op + ein-Zeilen-Hinweis auf stderr wenn PAI_DIR/hooks/sync-sessions-to-vault.sh fehlt, exit 0, keine Fehler
- [ ] #4 test_stop_workflow.py deckt beide Pfade ab (vendored cleanup invoked; fehlender externer sync -> Hinweis + exit 0) und ist in just test verdrahtet
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Vendor: hooks/cleanup-dispatch-stop.sh unveraendert aus ~/.claude/hooks/ ins Repo kopieren (generisch: ruff/fallow/cargo auf geaenderte Files, keine Vault-/PAI-Deps).
2. stop-workflow.sh: cleanup-Aufruf von PAI_DIR/hooks/ auf HOOK_DIR/ umstellen (repo-lokal, deployt daneben). Kein Doppel-Exec.
3. stop-workflow.sh: sync-sessions-to-vault.sh bleibt PAI_DIR-extern; fehlt der Hook -> ein-Zeilen-Hinweis auf stderr, exit 0, kein Fehler.
4. scripts/test_stop_workflow.py (pytest+subprocess): (a) vendored cleanup wird invoked, (b) fehlender sync -> Hinweis+exit0, (c) keine Fehler bei fehlenden Hooks. In justfile test-Recipe ergaenzen.
5. Verify: just test gruen; optional just bundle + grep cleanup-dispatch-stop.sh im Bundle, ohne ~/.claude zu beruehren.
6. Org-Regel: Impl via isolierten Dev-Subagent (TDD), Review via separatem Review-Subagent. Kein Auto-Commit/Push (CCS-008).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#1-Entscheidung (2026-06-05, User-bestaetigt): SPLIT statt binaer.
- cleanup-dispatch-stop.sh -> VENDOREN. Begruendung: generisch (ruff/fallow/cargo-fmt auf geaenderte Files), degradiert selbst via command -v, keine Vault-/PAI-Abhaengigkeit -> passt zum self-contained-Ziel (CCS-005/012).
- sync-sessions-to-vault.sh -> EXTERN belassen. Begruendung: PKM-spezifisch (hartkodierter ObsidianPKM-Default-Pfad, schreibt Session-Konversation in den Vault), gehoert zum privaten Setup des Users, nicht in ein generisches deploybares Repo; beruehrt zudem Org-Regel (keine personenbezogenen Daten in geteiltem Code). stop-workflow.sh degradiert no-op + Hinweis.
Deployment-Mechanik verifiziert: deploy.sh kopiert jede hooks/*.sh nach CC_SETUP_DIR/hooks/ (Z.233-237), bundle.sh rsynct hooks/ komplett (Z.35-40), stop-workflow.sh nutzt HOOK_DIR (eigenes Verzeichnis). Kein setup.sh/bundle.sh-Edit noetig.

2026-06-07: Vom pi-Orchestrator-E2E-Lauf gepickt (PICK->SPEC, gemma4:12b-mlx interaktiv). planner stellte OPEN QUESTION (Pfad cleanup-dispatch-stop.sh) -> Pipeline am GATE0_SPEC pausiert (Spec-Gate/Human-Oversight greift wie spezifiziert). ANTWORT auf die Frage: cleanup-dispatch-stop.sh + sync-sessions-to-vault.sh liegen LIVE unter ~/.claude/hooks/ (absolut, NICHT im Repo) -> Vendor-Ziel hooks/ im Repo, sonst sauber degradieren. Status: wartet auf User-Entscheidung resume/cancel. Kein Code geaendert (planner read-only).

Spec-Gate freigegeben (.pi/orchestrator-resume gesetzt). HINWEIS vor dem Build: just test ist im Working-Tree ROT wegen UNRELATED deno-knowledge-app-Refactor (export von collectTokens/collectSidebar/collectGlobal entfernt) -> GATE1 wuerde scheitern, unabhaengig von CCS-010. Empfehlung: deno-Arbeit vorher stashen (git stash push -- deno-knowledge-app/). HEAD ist gruen.

2026-06-07: Status-Korrektur To Do. Wurde beim just-pi-Test vom globalen backlog_next (vor CCS-036.07 milestone-scoped PICK) faelschlich als naechster Task gegriffen und auf In Progress gesetzt; keine Arbeit erfolgt. Inhaltlich unveraendert offen.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just test passes
<!-- DOD:END -->
