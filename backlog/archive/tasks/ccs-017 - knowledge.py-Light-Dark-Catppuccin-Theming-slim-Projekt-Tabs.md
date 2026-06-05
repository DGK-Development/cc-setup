---
id: CCS-017
title: 'knowledge.py: Light/Dark Catppuccin-Theming + slim Projekt-Tabs'
status: In Progress
assignee:
  - '@niclasedge'
created_date: '2026-06-05 16:14'
updated_date: '2026-06-05 16:17'
labels: []
dependencies: []
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
knowledge.py um Theming und Projekt-Navigation erweitern. (1) Catppuccin Mocha (dark, neuer Default) + Latte (light) als CSS-Custom-Property-Paletten in dash.css; Theme-Toggle in der Tab-Bar, Default folgt prefers-color-scheme, Wahl persistiert in localStorage. (2) Slim Tab-Bar (~30px, horizontaler Scroll) oben: alle ~/GITHUB-Projekte mit backlog/-Ordner + immer das aktive Start-Repo; Klick wechselt das inspizierte Projekt server-seitig via GET /?project=NAME. project wird gegen eine Server-Whitelist (Name->bekannter Pfad) aufgeloest, /read, /gitdiff, /action/* respektieren das aktive Projekt. Begruendung: aktuelles Dark ist schwer lesbar; schneller Wechsel zwischen Projekten mit Backlog erspart Server-Neustarts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 dash.css enthaelt Catppuccin Mocha (dark) und Latte (light) als CSS-Custom-Properties; alle Karten/Panes sind in beiden Modi lesbar
- [ ] #2 Theme-Toggle in der Tab-Bar; Default folgt prefers-color-scheme; Wahl persistiert in localStorage und ueberlebt Reload
- [ ] #3 Slim Tab-Bar (~30px) mit horizontalem Scroll zeigt alle ~/GITHUB-Projekte mit backlog/-Ordner plus immer das aktive Start-Repo; aktives Projekt ist hervorgehoben
- [ ] #4 Klick auf einen Tab laedt das Dashboard fuer dieses Projekt (GET /?project=NAME); Collectors laufen live fuer dessen cwd
- [ ] #5 project= wird gegen eine Server-Whitelist aufgeloest (kein freier Pfad/Traversal); /read, /gitdiff und /action/* operieren auf dem aktiven Projekt
- [ ] #6 Keine hartkodierten Farben mehr, die in Light unlesbar sind (#fff aktive Zeilen, Body-Glow) -> Tokens --fg-strong/--bg-glow
- [ ] #7 test_knowledge.py deckt discover_projects und resolve_cwd ab; gesamte Test-Suite gruen
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. dash.css: :root -> Catppuccin Mocha; :root[data-theme=light] + prefers-color-scheme -> Latte; Tokens --fg-strong/--bg-glow; #fff/#10141a ersetzen
2. browser.css: slim .kn-shell/.kn-tabs/.kn-tab/.kn-theme + .mp height-Override; #fff -> --fg-strong
3. knowledge.py: discover_projects + resolve_project_cwd (pur); build_context/build_data tragen projects+active_project; render_html rendert Tab-Bar + Toggle + Theme-Init; build_app-Endpoints nehmen project= und loesen cwd auf; _RESULT_CSS light-Fallback
4. browser.js: ACTIVE in /read + /gitdiff + Git-Forms; Theme-Toggle-Wiring
5. test_knowledge.py: discover_projects + resolve_project_cwd + render_html-Tabs/Theme
6. just test gruen; Server starten, Light/Dark + Tab-Wechsel verifizieren (curl + Screenshot)
<!-- SECTION:PLAN:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just test passes
<!-- DOD:END -->
