---
id: CCS-030
title: >-
  deno-knowledge-app: Wissen-Listen Datum+Sort, tn-Board in Projekt-Ansicht,
  Boards-Nav-Counts, Projekt-Settings-Karte
status: Done
assignee:
  - '@claude'
created_date: '2026-06-06 06:06'
updated_date: '2026-06-06 14:05'
labels:
  - deno-knowledge-app
  - ui
dependencies: []
priority: high
ordinal: 73000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Vier UI-Refinements in deno-knowledge-app (User-Feedback 2026-06-06, Entscheidungen via AskUserQuestion): (1) Wissen-Listen Memory/Lektionen/Decisions/Docs zeigen Aenderungsdatum + neueste-oben sortiert. (2) tn-Kanban als eigener prominenter Nav-Eintrag in Projekt-Ansicht (lokal, NICHT cross-project - Org-Regel). (3) Boards-Nav-Eintrag zeigt offene Counts 'backlog / tn'. (4) Projekt-Uebersicht bekommt Projekt-Settings-Karte (projekt-lokale .claude/ Skills/Hooks/Agents + geschaetzte Initial-Context-Tokens/Session).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Memory/Lektionen/Decisions/Docs-Listen zeigen je Eintrag das Aenderungsdatum und sind absteigend nach mtime sortiert (neueste oben)
- [x] #2 Projekt-Ansicht hat eigenen 'tn-Board'-Nav-Eintrag (tn-Kanban NEXT/BLOCKED/OVERDUE fuer dieses Projekt); keine cross-project tn-Inhalte
- [x] #3 'Boards'-Nav-Eintrag zeigt offene Counts im Format 'backlog / tn' (z.B. 5 / 3)
- [x] #4 Projekt-Uebersicht zeigt Projekt-Settings-Karte: Anzahl projekt-lokaler Skills/Hooks/Agents + geschaetzte Initial-Context-Tokens/Session (transparent global+projekt CLAUDE.md)
- [x] #5 Keine zusaetzlichen Python-Spawns (Runaway-Hazard); Init-Tokens rein dateibasiert geschaetzt
- [x] #6 deno test Suite gruen; betroffene Tests an neues Verhalten angepasst
- [x] #7 Org-Compliance: keine kunden-/personenbezogenen tn-Inhalte cross-project
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. knowledge.ts: memory/lektionen -> Objekte mit mtime, decisions/docs mtime ergaenzen, alle nach mtime DESC sortieren (neueste oben)
2. context.ts buildData: date-Feld (fmtMtime) auf memory/lessons/decisions/docs-Items; backlog_open/tn_open vor nav berechnen; boards-Nav cnt='$backlog / $tn'; Projekt-Nav um dediz. tn-Board-Eintrag; overview proj_skills/proj_hooks/proj_agents/proj_init_tok
3. project.ts: collectProject liest <repo>/.claude/ skills|agents|settings(.local).json-hooks (file-only, KEIN Python)
4. browser.js: nav cnt-Feld rendern; renderOverview Projekt-Settings-Tile (nur bei ACTIVE); list zeigt date in sub-Zeile (schon via r.it.date)
5. Tests anpassen (collectors/parity/render/sidebar) + neue Tests; deno test gruen
6. Verifikation durch separaten Reviewer-Subagent (Org: Dev!=Review)
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Umgesetzt via Developer-Subagent, unabhaengig verifiziert (deno test -A: 108 passed/0 failed, deno check sauber), Code-Review via separatem Reviewer-Subagent (Org-Regel Dev!=Review): APPROVE-WITH-NITS, keine Blocker, Org-Compliance CLEAR (kein cross-project tn-Inhalt), keine Python-Spawns ergaenzt.

Geaendert: knowledge.ts, project.ts, context.ts, assets/browser.js + Tests (collectors/parity). 2 optionale Nits offen (psections-Nav-Kommentar, proj_init_tok-Test-Praezision) - nicht blockierend.

OFFEN: Human-Oversight (Org-Pflicht) - User prueft visuell in laufender App + entscheidet ueber Commit/Deploy. Noch NICHT committed/gepusht.

Cross-Task-Unblock aus der CCS-031-Session: countHooksInSettings (proj_hooks_count) lag als inner-declaration im try-Block von collectProject -> no-inner-declarations Lint, blockte das Lint/DoD-Gate. Auf Funktions-Root hochgezogen (0 Verhaltensaenderung), deno lint jetzt gruen.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Vier UI-Refinements geliefert: (1) Wissen-Listen (Memory/Lektionen/Decisions/Docs) mit Änderungsdatum + Sortierung neueste-oben (mtime DESC); (2) tn-Kanban als eigener Projekt-Nav-Eintrag (projekt-lokal, kein cross-project, Org-Regel); (3) Boards-Nav-Counts im Format backlog/tn; (4) Projekt-Settings-Karte (.claude/ Skills/Hooks/Agents + geschätzte Init-Context-Tokens, rein dateibasiert, kein Python-Spawn). Implementierung und Review in getrennten Subagent-Sessions (Org-Regel Dev getrennt von Review): APPROVE. 124 Tests grün. HINWEIS: Der dedizierte tn-Board-Nav-Eintrag (AC 2) wurde in einer späteren Layout-Redesign-Session auf User-Entscheidung wieder entfernt — redundant, tn ist nun im kombinierten Eintrag Boards (tn+backlog) erreichbar.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
