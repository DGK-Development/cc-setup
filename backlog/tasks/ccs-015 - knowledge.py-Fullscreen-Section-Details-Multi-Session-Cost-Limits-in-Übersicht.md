---
id: CCS-015
title: >-
  knowledge.py: Fullscreen + Section-Details + Multi-Session + Cost-Limits in
  Übersicht
status: In Progress
assignee:
  - '@niclasedge'
created_date: '2026-06-05 11:18'
updated_date: '2026-06-05 11:48'
labels:
  - knowledge
  - dashboard
  - frontend
dependencies: []
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dashboard-UX-Ausbau: (1) Terminal fullscreen statt Card, (2) Skills/CLAUDE.md/Hooks zeigen volle Details inkl. Inline-Read + Token-Schätzung, (3) Hook-Commands sichtbar (Env bleibt redacted), (4) Übersicht zeigt 5h- und 7d-Limit als Progress-Bars, (5) Sessions-Sektion listet alle Repo-Sessions statt nur der letzten.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Terminal füllt Viewport-Höhe (kein 70vh-Card-Cap mehr)
- [x] #2 Skill-Detail lädt SKILL.md inline + zeigt Beschreibung + Token-Schätzung
- [x] #3 CLAUDE.md (global+projekt) inline lesbar + Token-Schätzung
- [x] #4 Hook-Detail zeigt Matcher+Typ+Command; Env-Werte nie gelesen
- [x] #5 Übersicht-Kachel Kosten zeigt 5h- und 7d-Progress-Bars
- [x] #6 Sessions-Sektion listet mehrere Sessions, datiert + neueste zuerst
- [x] #7 just test grün (Tests an neue Contracts angepasst)
- [x] #8 Git-Sektion: geänderte und neue Dateien klickbar, Diff inline plus Gesamt-Diff, read-only mit Pfad-Guard
- [x] #9 Sidebar zeigt Token-Summen pro Sektion (Skills, Agents, CLAUDE.md global und projekt)
- [x] #10 Skill-Detail listet referenzierte Scripts klickbar mit Inline-Inhalt
- [x] #11 Agent-Detail zeigt volle Definition inline plus Token-Schätzung
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Helpers: _est_tokens, _frontmatter_field, _skill_meta, _fmt_mtime
2. collect_global: skills items (desc+tokens), claude_md tokens, settings hook_detail (matcher+type+command), env nie lesen
3. collect_project: claude_md tokens/size
4. collect_tokens: sessions list (alle, datiert, neueste zuerst, cap 20)
5. build_data: skills(desc/tokens), hooks(entries), gclaude-Section + psections meta, sessions(alle), overview cost_5h/7d; nav +gclaude
6. build_app: GET /read (whitelist skill/claude-global/claude-project, Traversal-Guard) via _read_doc
7. _EXTRA_CSS: filebody, rlm, li-s clamp
8. dash/browser css: Fullscreen (page flex 100vh, term flex 1, mp flex 1)
9. browser js: skill/claude inline-read, session date, overview cost bars, ktok/loadFile
10. Tests anpassen + just test
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Runde 2: Git-Diff-Ansicht (klickbare files_struct + /gitdiff-Endpoint mit Pfad-Guard, Zeilen-Coloring), Sidebar-Token-Summen (skills_tok/agents_tok + CLAUDE.md), Skill-Script-Scan (_scan_scripts) + klickbares /read kind=skillfile, Agent-Inhalt inline (_agent_meta + /read kind=agent), Hook-Command-Script-Referenzen klickbar (kind=homefile, nur unter ~/.claude). 44 Tests grün; gegen echte Daten + 3 Live-Screenshots verifiziert.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Dashboard-UX-Ausbau in knowledge.py + Assets, gegen echte Repo-Daten verifiziert (Render + Live-Server + Screenshots).

Was geaendert:
- Fullscreen: .page als Flex-Spalte (min-height 100vh), .term flex:1, .mp flex:1 statt 70vh-Cap. Terminal fuellt jetzt volle Breite+Hoehe.
- Skills: collect_global liest pro Skill die SKILL.md (Frontmatter-Description + Token-Schaetzung ~chars/4). Detail-Panel laedt SKILL.md inline via neuem GET /read.
- CLAUDE.md: global (~/.claude) + projekt mit Token-Schaetzung + Inline-Read; neuer global-CLAUDE.md-Nav-Eintrag.
- Hooks: collect_global liefert Matcher+Typ+Command (volle Commands sichtbar auf Wunsch); settings.env wird bewusst NIE gelesen, Env-Werte koennen nicht leaken.
- Kosten-Uebersicht: 5h- und 7d-Limit als Progress-Bars (used->prognose + reset) in der Kachel.
- Sessions: collect_tokens liefert alle Repo-Sessions (datiert via jsonl-mtime, neueste zuerst, cap 20) statt nur der letzten.

Neu: _est_tokens, _frontmatter_field, _skill_meta, _fmt_mtime, _read_doc (whitelisted skill/claude-global/claude-project, Traversal-Guard), GET /read.

Tests: 40 passed (inkl. FastAPI-Routen). Angepasst: Settings-Test (Commands sichtbar, Env weiter nie gelesen), build_data-Skills-Assertion, Sessions-Liste, neue Tests fuer _est_tokens/_frontmatter_field/_read_doc/Skill-Items.

Risiko/Follow-up: Hook-Commands sind nun im lokalen Dashboard sichtbar (bewusste Entscheidung, hebelt fruehere Redaction-Spec aus) — Env bleibt geschuetzt. Review durch Mensch ausstehend (Human-Oversight); Status bleibt In Progress bis Freigabe.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just test passes
<!-- DOD:END -->
