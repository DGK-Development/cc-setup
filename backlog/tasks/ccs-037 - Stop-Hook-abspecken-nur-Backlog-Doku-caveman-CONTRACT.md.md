---
id: CCS-037
title: 'Stop-Hook abspecken: nur Backlog-Doku + caveman CONTRACT.md'
status: In Progress
assignee: []
created_date: '2026-06-10 18:27'
updated_date: '2026-06-10 19:08'
labels: []
dependencies: []
ordinal: 111000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
pkm-sync-stop.sh auf reinen Backlog-Gate reduziert (kein TaskNotes/Daily/CHANGELOG mehr). CONTRACT.md caveman-komprimiert + 3 neue Sektionen (caveman, Skill-Selbstheilung, Unklarheit-fragen). ObsidianPKM CLAUDE.md Hooks-Abschnitt aktualisiert.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 pkm-sync-stop.sh feuert nur bei backlog/tasks + In-Progress-Tasks + echten Aenderungen|CONTRACT.md enthaelt alle 3 neuen Sektionen und ist token-reduziert|ObsidianPKM CLAUDE.md Hooks-Abschnitt beschreibt neues Verhalten
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Session 2026-06-10: pkm-sync-stop.sh auf Backlog-Gate reduziert (entfernt: KNOWLEDGE_DIR/PKM_PROJECT-Detection, Active-Task-Detection inkl. uv-run-tasknotes, Daily-Note-Fallback, Projekt-CHANGELOG-Fallback, Non-Git-find-Pfad, LAST_CHANGELOG, SECTION_HINT/OVERVIEW_FILE). Neues Gate: backlog/tasks + backlog-CLI + In-Progress-Tasks + echte Git-Änderungen. Marker neu: CWD/logs/.pkm-last-sync. REASON-Block kurz + self-contained. CONTRACT.md caveman-komprimiert + 3 neue Sektionen (caveman, Skill-Selbstheilung, Unklarheit->fragen). ObsidianPKM CLAUDE.md Hooks-Abschnitt aktualisiert. Altlast ~/.claude/hooks/pkm-sync-stop.sh nach _archive/ verschoben.

REASON minimiert: Changes-Block entfernt (inline Claude kennt eigene Session), Instruktion komprimiert auf 1 Satz. CLI-Header-Dublette gefixt: backlog task list -Ausgabe filtert jetzt ^In Progress: raus, damit REASON nicht doppelten Header produziert.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just test passes
<!-- DOD:END -->
