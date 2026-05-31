---
name: session-init
description: Session-Start in Cursor — Kontext aus Hooks und Projekt-Knowledge laden. USE WHEN neue Session, Session Start, Kontext laden, was ist das Projekt, aktive Tasks, inject-project-context, sessionStart hook.
---

# Session Init (Cursor)

Parität zu Claude Code `SessionStart` (`~/.cursor/hooks/cursor-session-start.sh`).

## Was automatisch passiert

1. **Redactor** `session-start` (Audit-Slot, allow)
2. **`inject-project-context.sh`** injiziert `additional_context`:
   - Projekt-ID, Knowledge-Pfad, 2-Level Tree
   - Aktive TaskNotes (`in-progress`) via `tasknotes_cli.py`
   - Hinweis: erster User-Prompt triggert `/context-load`

Hook-Log (falls Repo `logs/` existiert): `logs/hook-session-start.log`

## Was du danach tun sollst

1. **Injizierten Kontext lesen** — nicht blind antworten.
2. Beim **ersten User-Prompt**: Hook feuert `/context-load` (Skill `context-load`). Vor der Antwort:
   ```bash
   uv run python3 "$HOME/GITHUB/ObsidianPKM/skripte/context-resolve.py" "<user-anfrage>" --limit 5
   ```
   Dann nur relevante Notes laden (abstract → overview → full).
3. Optional manuell:
   ```bash
   uv run ~/.claude/hooks/knowledge-bridge.py get <projekt-folder-name>
   ```

## Env

| Variable | Default |
|----------|---------|
| `OBSIDIAN_VAULT_PATH` | `~/GITHUB/ObsidianPKM` |
| `GITHUB_PATH` | `~/GITHUB` |
| `CLAUDE_PROJECT` | Override Projektname |

## ObsidianPKM-Vault

Vault-Pfad wird nicht mehr übersprungen — Hooks laufen auch in ObsidianPKM.
