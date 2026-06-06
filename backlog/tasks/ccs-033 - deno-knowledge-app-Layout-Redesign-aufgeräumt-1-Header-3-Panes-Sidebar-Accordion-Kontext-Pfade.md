---
id: CCS-033
title: >-
  deno-knowledge-app: Layout-Redesign aufgeräumt (1 Header, 3 Panes,
  Sidebar-Accordion, Kontext-Pfade)
status: Done
assignee: []
created_date: '2026-06-06 14:09'
updated_date: '2026-06-06 14:09'
labels:
  - deno-knowledge-app
  - ui
dependencies: []
ordinal: 76000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Claude-Design-Handoff in die Deno-App portiert: ruhigeres, klareres Terminal-/Catppuccin-Layout. Bestehende Server-Architektur + Überblick-Tiles behalten (User-Entscheidung); nur Header/Sidebar/Liste/Detail visuell umgebaut + neue Projekt-Übersichtsseite + Kontext-View-Verbesserungen.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Eine schlanke Kopfzeile statt zwei: Breadcrumb links, kompakte Global-Stats rechts (Projekte/offen/tn/7-Tage-Kosten)
- [x] #2 Drei-Pane-Layout (Sidebar · Liste · Detail) statt fünf sichtbarer Spalten
- [x] #3 Sidebar als Accordion: Projekt-Selektor getrennt vom Sektions-Nav; aktives Projekt aufgeklappt mit eingerückter, abgesetzter Unter-Nav; nur eines offen; Overview-Nav ebenfalls abgesetzt
- [x] #4 Skills/Knowledge-Liste ohne Status-Punkt, stattdessen Init-Load-Tokens rechts; Detail entdoppelt (rohes SKILL.md eingeklappt)
- [x] #5 Neue Projekt-Übersichtsseite: Header (Name/Branch/CLAUDE.md), 5 KPIs, Wissens-Reihe, Aufgaben-Reihe mit tn und Backlog als getrennte Quellen
- [x] #6 Kontext-View: leere Liste-Spalte ausgeblendet; CLAUDE.md global+projekt mit Ladepfad und ausklappbar lesbar (ctx-readable)
- [x] #7 Nav-Politur: keine Akzent-Dots, dezenter aktiver Zustand ohne Akzentbalken, Wissens-Einträge mit Wert 0 gedimmt
- [x] #8 Org-Regel eingehalten (tn-Inhalte nur aktives Projekt, cross-project nur Zahlen); 124 Tests + check/lint/fmt grün; Implementierung und Review in getrennten Subagent-Sessions
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Direkter Design-Handoff-Auftrag ohne vorab-Task; retroaktiv als CCS-033 dokumentiert. Supersedet CCS-030 AC 2 (dedizierter tn-Board-Nav-Eintrag entfernt, in Boards (tn+backlog) konsolidiert).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Claude-Design-Handoff (aufgeraeumt/Dashboard.html) visuell in die Deno-App portiert, ohne die Server-Architektur zu ändern. Geliefert: ein schlanker Header (Breadcrumb + kompakte Global-Stats) statt zwei Kopfzeilen; 3 Panes (Sidebar/Liste/Detail) statt fünf Spalten; Sidebar als Accordion (Projekt-Selektor klar vom Sektions-Nav getrennt, aktives Projekt aufgeklappt mit eingerückter, abgesetzter Unter-Nav, Overview-Nav ebenso abgesetzt); Skills/Knowledge ohne Status-Dot mit Init-Load-Tokens rechts + entdoppeltes Detail (SKILL.md eingeklappt); neue Projekt-Übersichtsseite (Header, 5 KPIs, Wissens-Reihe, Aufgaben-Reihe mit tn/Backlog getrennt); Kontext-View ohne leere Liste-Spalte, CLAUDE.md global+projekt mit Pfad + ausklappbar lesbar; Nav-Politur (keine Dots, dezenter aktiver Zustand ohne Akzentbalken, 0-Werte gedimmt). Dateien: src/render.ts, src/context.ts, src/collectors/context_view.ts, assets/browser.js, assets/browser.css, test/render_test.ts, test/parity_test.ts. Während der Verifikation gefundener Re-Bind-Bug (ctx-readable-Listener nach Hook-Repaint) gefixt und im Browser belegt. Org-Regel: tn-Inhalte nur aktives Projekt, cross-project nur Zahlen. Implementierung (Dev-Subagent) und Review (separater Reviewer-Subagent) getrennt: APPROVE. 124 Tests + check/lint/fmt grün; Screenshots verifiziert.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just test passes
<!-- DOD:END -->
