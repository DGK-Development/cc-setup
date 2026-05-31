---
name: session-stop
description: Session-Ende und PKM-Sync in Cursor. USE WHEN Session beenden, stop hook, PKM sync, Changelog schreiben, Resume State, knowledge finish, was wurde gemacht dokumentieren, stop-workflow.
---

# Session Stop (Cursor)

Parität zu Claude Code `Stop` → `~/.claude/hooks/stop-workflow.sh` (via `~/.cursor/hooks/cursor-stop.sh`).

## Hook-Kette (Reihenfolge)

1. `cleanup-dispatch-stop.sh` (stderr)
2. `pkm-sync-stop.sh` — liefert PKM-SYNC-Anweisung als `followup_message`
3. `sync-sessions-to-vault.sh` (stderr, falls kein PKM-Block)

## Wenn `followup_message` / PKM-SYNC kommt

**Pflicht:** Protocol lesen und ausführen:

`$HOME/GITHUB/ObsidianPKM/.claude/PKM_SYNC_PROTOCOL.md`

Kurz:

| Aufgabe | Regel |
|---------|--------|
| Session-Eintrag | max 3 Zeilen, 300 Zeichen; Routing nach `ACTIVE_KIND` |
| Resume State | nur bei echtem Re-entry; nur bei TaskNotes |
| Lessons/Decisions | nur NEUE Erkenntnis; Scope-Routing §3–4 |
| Git | nur wenn Repo; User merged selbst bei PRs |

**VERBOT:** Keine neuen Lessons in `knowledge/lessons-learned.md`, `knowledge/decisions.md` oder projektlokale `CLAUDE.md`.

## Manueller Abschluss (ohne Hook)

```bash
uv run ~/.claude/hooks/knowledge-bridge.py finish <projekt> --summary "Deutsche Zusammenfassung" --cost 0.42
```

## Stop-Loop

Cursor `stop`-Hook hat `loop_limit: 3`. Bei `stop_hook_active=true` ist `pkm-sync-stop` silent (kein Doppel-Fire).

## Antwort nach PKM-Sync

Wie im Protocol: kurz `OK` + ggf. Commit-SHA; keine Romane.
