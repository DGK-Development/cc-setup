---
id: CCS-003
title: 'Minimal: context-load Layer 1.5 Sprint-Anzeige + read-only sprint_bridge'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-06-03 22:29'
updated_date: '2026-06-04 20:43'
labels: []
dependencies: []
references:
  - /Users/niclasedge/cc-ctxtest
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Minimal-Scope-Teil aus Design ccs-001: Bei jeder Repo-Session zeigt context-load (Layer 1.5) den Backlog-Sprint-Stand (Milestones done/total + offene Task-IDs) und tn next, und bietet beim Einstieg die Wahl Milestone fortsetzen vs. tn. Ohne Dekomposition/Finish/Git (das bleibt im vollen ccs-001-Scope).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 sprint_bridge.py mit resolve-repo/survey/status (read-only); survey liefert open_milestones[]+candidate_tns[]; no-op ohne backlog/
- [x] #2 test_sprint_bridge.py vorhanden; just test passes
- [x] #3 context-load SKILL.md hat Layer 1.5: additive Anzeige, no-op ausserhalb Repos, Frage nur bei echtem Einstieg ohne Layer-1-Match
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. sprint_bridge.py in vendor/cc-plugin-project-context/scripts/ (uv-script header wie tasknotes_cli.py): resolve-repo, survey, status — nur backlog --plain parsen + tn next --format json, kein Schreibzugriff
2. test_sprint_bridge.py: pytest (resolve-repo ohne backlog/, survey-Parser gegen Fixtures, status). just test gruen
3. context-load SKILL.md: Layer 1.5 zwischen Layer 1 und 2 einfuegen, additive Anzeige + bedingte AskUserQuestion, Output-Block ## Aktiver Sprint
4. Verify: just test, survey aus cc-setup-CWD, resolve-repo in /tmp; dann just bundle + install
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
sprint_bridge.py (read-only, stdlib): resolve-repo/survey/status. Parser-Trick dedup_name() korrigiert backlogs doppelten <name>: <name>-Plain-Output. tn via uv run tasknotes_cli.py (tn ist shell-func, kein binary).

14 pytest-Tests gruen (just test, 0.01s, hermetisch ohne backlog/tn). Live: survey aus cc-setup -> session-analyser 5/6 + offen CCS-002; resolve-repo /tmp -> initialized:false.

context-load SKILL.md: Layer 1.5 zwischen Layer 1/2; SPRINT-Pfadvar; Output-Block ### Aktiver Sprint. Frage nur bei !clear_match + echter Wahl (kein Nagging).

2026-06-04 Folge-Session: Layer 1.5 erweitert — rendert jetzt explizit 'Nächster Task in Reihenfolge' (= open_tasks[0] des ersten offenen Milestones = sprint_bridge status.next_open_task) zusätzlich zu Milestones-in-Reihenfolge. Reproduzierbarer Test-Harness ~/cc-ctxtest (Git-Repo + backlog-Kopie, bench.sh: claude -p --permission-mode auto + git reset --hard/clean nach jedem Run). Verifiziert: context-load-Output zeigt Milestones (CCS-001 10/10, session-analyser 5/6) + Nächster Task CCS-002. Plus status-Intent in context-resolve.py (stages:[1]) lässt Status/Todo-Queries qmd skippen. Edits LIVE in ~/.claude/skills/context-load/SKILL.md + context-resolve.py; Source-Propagation ins vendor-Submodul weiterhin offen (s. Final Summary).

### Progress (Stand 2026-06-04)

| Komponente | Status |
|---|---|
| sprint_bridge.py (resolve-repo/survey/status, read-only) | ✅ |
| test_sprint_bridge.py (14 Tests, just test grün) | ✅ |
| Layer 1.5 additive Anzeige (Milestones + offene IDs) | ✅ |
| Layer 1.5 'Nächster Task in Reihenfolge' explizit | ✅ live (~/.claude) |
| status-Intent → qmd-Skip (speed/few-token) | ✅ live (~/.claude) |
| SessionStart auto next-task (inject-project-context.sh) | ✅ live (~/.claude) |
| Reproduzierbarer Test-Harness ~/cc-ctxtest (git-reset/run) | ✅ |
| Source-Propagation vendor-Submodul (commit+push) | ⬜ offen — Human-Review |
| just bundle + install (durable) | ⬜ offen |

2026-06-04 21:35: Layer-1.5-Arbeit lokal committet — Submodul cc-plugin-project-context main=7b0f6b3 (next-task-in-order + status-Intent + SessionStart-Backlog-Block), Parent feat/session-analyser-flat-install=b3b64b6 (Pointer). Beide UNGEPUSHT (Org-Regel: Push/Review erst in separater Session). SessionStart (inject-project-context.sh) zeigt jetzt auto Milestone + Nächsten Task via sprint_bridge status. Follow-up CCS-004 (Wiki-Topic-Notes + qmd-Verify) angelegt.

2026-06-04 21:57 (aus CCS-004 entdeckt): status-Intent-Skip ist REGRESSED/dormant. SKILL.md (Zeile 127) dokumentiert type:status -> stages:[1] (qmd-Layer-2-Skip), aber classify() in context-resolve.py emittiert in KEINER Source-Kopie (vendor-Submodul, Plugin-Cache, Marketplace) einen status-Typ -> alle Intents enthalten Stage 2 -> Skip greift nie. Wurde laut CHANGELOG 20:59 live in ~/.claude gebaut+gebenchmarkt (-42% Turns), aber Source-Propagation fehlt. Follow-up: status-Intent in classify() verdrahten + bundle.

2026-06-04 Review-Session (Org-konform, isolierter Subagent): Code-Review der ungeprueften Branch-Aenderungen durchgefuehrt. CCS-003-Kern (sprint_bridge.py read-only, Layer 1.5, status-intent in vendor 7b0f6b3) = sauber, 41 Tests gruen (14 just test + 27 Parent). status-Intent-Gap war KEIN Source-Bug (Fix in vendor 7b0f6b3 gepusht), nur Bundle/Install zu plugin-cache+marketplace offen. => CCS-003 VERIFY-READY (wartet auf User-Done). Offen ausserhalb CCS-003-Scope: Submodul d55c6c3 ungepusht (kaputter Remote-Pointer), bundle/install.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Minimal-Scope von ccs-001: Backlog-Sprint-Stand in context-load (Layer 1.5).

Was: read-only scripts/sprint_bridge.py (resolve-repo/survey/status) + test_sprint_bridge.py (14 Tests) + Layer 1.5 in context-load SKILL.md. Alle 3 Dateien im Submodul vendor/cc-plugin-project-context/ (von dort bundelt bundle.sh ins Plugin).

Verhalten: jede Repo-Session mit backlog/ zeigt Milestones (done/total + offene IDs) + tn next; beim Einstieg (kein Layer-1-clear_match) Wahl Milestone-Task vs tn. No-op ausserhalb Repos / ohne backlog/.

Bewusst draussen (YAGNI): /sprint-start, /sprint-finish, bind, sync-finish, Git.

Verify: just test gruen; survey/resolve-repo/status live ok. Keine Hook-Aenderung noetig (UserPromptSubmit-Hook triggert context-load bereits).

Offen: Install via Pipeline braucht Submodul-Commit+Push (just bundle macht submodule update --remote -> wuerde lokale Submodul-Aenderungen verwerfen). Review in separater Session (Org-Regel).
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just test passes
<!-- DOD:END -->
