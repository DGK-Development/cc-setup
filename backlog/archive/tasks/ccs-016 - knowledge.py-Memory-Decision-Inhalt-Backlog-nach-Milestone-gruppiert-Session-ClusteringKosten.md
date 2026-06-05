---
id: CCS-016
title: >-
  knowledge.py: Memory/Decision-Inhalt, Backlog nach Milestone gruppiert,
  Session-Clustering+Kosten
status: In Progress
assignee:
  - '@niclasedge'
created_date: '2026-06-05 14:15'
updated_date: '2026-06-05 15:40'
labels:
  - knowledge
  - dashboard
  - frontend
dependencies: []
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Folge-Ausbau Dashboard: Memory/Decisions zeigen Inhalt (nicht nur Titel); Backlog entdoppelt + nach Milestone gruppiert + Done einklappbar + mit Beschreibung; Sessions in Sidebar mit Token-Summe; pro Session geschätzte Tokens+Kosten; Session-Detail zeigt Clustering (Fehler + wiederholte Commands) aus session_analyze.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Memory-Detail laedt Datei-Inhalt inline (/read kind=memory)
- [x] #2 Decision-Detail zeigt vollen Body (knowledge/decisions oder backlog/decisions)
- [x] #3 Backlog: keine doppelten Tasks, gruppiert nach Milestone, Done unten einklappbar, mit Beschreibung im Detail
- [x] #4 Sessions-Sidebar zeigt Token-Summe
- [x] #5 Pro Session: geschaetzte Tokens + Kosten im List/Detail
- [x] #6 Session-Detail zeigt Cluster: Fehler (failed commands) + gleiche/wiederholte Commands
- [x] #7 just test grün
- [x] #8 Bare-Layout: Seite besteht nur aus #mp (kein Header/Chrome-Bar/Footer/Padding), füllt Viewport
- [x] #9 Lektionen + Changelog zeigen Inhalt (Lektion via /read kind=lektion, Changelog-Eintrag inline)
- [x] #10 Git-Status im GitLens-Stil: Datei-Liste-Spalte (Tracked/Untracked, Status + plus/minus pro Datei) und Diff daneben, Navigation links, schlank
- [x] #11 knowledge/-Einträge zeigen Inhalt inline (Template/Placeholder-Zeilen gefiltert, Pfad-Normalisierung)
- [x] #12 Task-Detail zeigt volle Task-Datei (AC/Plan/Notes/Summary) inline
- [x] #13 Übersicht erweitert: Wissen-Counts, Sessions-Health (Fehler+Repeats+Top-Tools), tn next/blocked
- [x] #14 Git-Diff als Side-by-Side: links aktuell/HEAD, rechts Änderungen/Arbeitsbaum (Zeilennummern, farbcodiert)
- [x] #15 Übersicht-Backlog-Kachel: X von Y Meilensteine fertig + Tasks done von gesamt
- [ ] #16 kn-Alias (zsh-Funktion) startet Dashboard fuers aktuelle Projekt via --cwd PWD; projektuebergreifend getestet (inspire-ios)
- [x] #17 collect_backlog faltet backlog/completed/ als Done ein (dedupe per id) — korrekte Counts bei completed/-Layout
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Umgesetzt: Decision-Body (_parse_decisions_md/_backlog_decisions liefern body) + Memory-Inhalt (/read kind=memory) inline; collect_backlog liest backlog/tasks/*.md direkt -> entdoppelt, gruppiert nach Milestone (Done unten einklappbar) + Beschreibung; pro Session geschaetzte Tokens+Kosten (_est_cost, Sonnet-Tarif, label ≈) + Cluster (Fehler via failed_commands, gleiche Commands via waste_signals.repeated_commands); Sidebar-Token-Summe Sessions. Zudem Bare-Layout: render_html nur noch #mp, Chrome/Header/Footer entfernt. 47 Tests gruen; gegen echte Daten + Live-Screenshots verifiziert.

Runde 4: Lektionen-Inhalt inline (/read kind=lektion, Pfad-Guard knowledge/), Changelog-Eintrag inline. Git komplett auf 3-Pane umgebaut (GitLens-Stil): collect_git mit per-Datei numstat (+/-); Nav|Datei-Liste(Tracked/Untracked)|Diff(farbcodiert), Git-Aktionen in einklappbarem details. 49 Tests gruen; Live-Screenshots ok.

Runde 5: knowledge/-Index liefert path+desc, Detail laedt Datei inline (/read kind=knowfile, Template-Zeilen mit <slug> + URLs gefiltert, knowledge/-Praefix normalisiert). Task-Detail laedt volle .md (/read kind=taskfile). collect_tokens liefert errors_total/repeats_total/tool_freq; Uebersicht +3 Kacheln (Wissen, Sessions-Health, tn). 51 Tests gruen; Live verifiziert.

Runde 6: Git-Diff auf Side-by-Side umgebaut (splitDiffRows/renderSplitDiff: links HEAD, rechts Arbeitsbaum, gepaarte -/+ Zeilen, Zeilennummern, leere Zellen schraffiert). Uebersicht-Backlog-Kachel: ms_done/ms_total (3/4 fertig) + tasks_done/tasks_total (31/47). Alle 12 Seiten gescreenshotet + analysiert: alle Sektionen zeigen Inhalt, keine Bugs; tn leer (0, kein aktiver TaskNote). 51 Tests gruen.

Runde 7: kn-Alias als zsh-Funktion vorbereitet (uv run knowledge.py --cwd PWD) — ~/.zshrc ist permission-geschuetzt, daher Snippet an User. Dashboard gegen inspire-ios getestet: projektspezifische Daten (Git/CLAUDE.md 17 Header/14 Sessions/54 Fehler/leerer Backlog) korrekt, Skills/Agents/Hooks/Kosten global geteilt. collect_backlog liest jetzt auch completed/ (Done, dedupe per id) -> cc-setup zaehlt damit completed-Tasks mit. AC16 (completed-fold) offen-markiert via check. 52 Tests gruen.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just test passes
<!-- DOD:END -->
