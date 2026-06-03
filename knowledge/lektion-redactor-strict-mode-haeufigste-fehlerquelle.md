---
title: "Lektion: Redactor Strict Mode — Haeufigste Fehlerquelle in Sessions"
slug: lektion-redactor-strict-mode-haeufigste-fehlerquelle
type: lesson
source: session-analysis
created: 2026-06-03
tags: [redactor, bash, strict-mode, fehler, session-analyse]
---

# Lektion: Redactor Strict Mode — Haeufigste Fehlerquelle

> Die mit Abstand haeufigste Fehlerursache in cc-setup-Sessions ist ein Bash-Call
> ohne `redactor wrap --` Prefix. Zweithaeufigste: `redactor wrap -- cat <json-file>`
> statt `redactor --type json <file>`.

## Evidenz (Session-Analyse 2026-06-03)

Analyse von 9 Sessions (ac71e79f, 3c1cdfbe, 0a1b4af7, 10b49f2e, ...):

- **43 Fehler insgesamt** (is_error=true tool_results)
- **~15 davon** sind `redactor strict mode: every shell command must go through redactor`
- **~5 davon** sind `redactor strict mode: structured file referenced inside redactor wrap`
  (falsche Verwendung: `redactor wrap -- cat file.json` statt `redactor --type json file.json`)
- **2 davon** sind fehlgeschlagene Script-Pfade via `${CLAUDE_PLUGIN_ROOT}` (Env-Var nicht gesetzt)

## Muster der Fehler

### Fehler 1: Kein Wrapper
```bash
# FALSCH — wird geblockt
task info && echo "---" && task next
ls -la && find . -name "*.md"

# RICHTIG
redactor wrap -- bash -c 'task info && echo "---" && task next'
redactor wrap -- bash -c 'ls -la && find . -name "*.md"'
```

### Fehler 2: Strukturierte Datei via wrap lesen
```bash
# FALSCH — wrap macht nur Pattern-Redaktion, keine Struktur-Sanitisierung
redactor wrap -- cat /path/to/hooks.json

# RICHTIG — strukturelle Sanitisierung
redactor --type json /path/to/hooks.json
```

### Fehler 3: CLAUDE_PLUGIN_ROOT ist nicht gesetzt
```bash
# FALSCH — Variable undefiniert in Agent-Sessions
uv run --script "${CLAUDE_PLUGIN_ROOT}/scripts/context-resolve.py" ...

# RICHTIG — absoluten Pfad nutzen oder via cc-setup Skill-Pfad
uv run --script "/home/nedge/.claude/skills/cc-setup/scripts/context-resolve.py" ...
```

## Wiederholter Befehl (6 Sessions)

Vault-Path-Check wird in 6 verschiedenen Sessions neu ausgefuehrt:
```bash
V="${OBSIDIAN_VAULT_PATH:-${TASKNOTES_VAULT:-$HOME/GITHUB/ObsidianPKM}}"
test -d "$V" && echo "vault-ok: $V" || echo "vault-missing: $V"
```
Dieser Check landet im Context-Load-Overhead ohne Mehrwert sobald der Pfad bekannt ist.
Empfehlung: Vault-Pfad einmalig in `.env` oder `~/.claude/settings.json` hinterlegen
(z.B. als `env.OBSIDIAN_VAULT_PATH`), statt ihn jede Session zu re-detektieren.

## Redundante Reads (1 Session)

`hooks.json` wurde in Session `3c1cdfbe` **3x gelesen** — jedes Mal mit redactor-Fehler geblockt.
Muster: Retry nach Fehler ohne Strategie-Wechsel. Korrekte Strategie beim ersten Fehler:
Sofort auf `redactor --type json <datei>` umstellen, nicht nochmal Read/Bash versuchen.

## Token-Profil (alle 9 Sessions)

| Metrik | Wert |
|--------|------|
| Gesamt Input-Tokens | 224.606 |
| Gesamt Output-Tokens | 853.212 |
| Cache-Read-Tokens | 58.148.736 |
| Cache-Creation-Tokens | 2.045.073 |
| Cache-Effizienz | ~99.6% (fast alles aus Cache) |

Langste Session (`ac71e79f`): 246 Turns, 33.6M Cache-Read — kein Problem, aber Zeichen
dass laengere Sessions stark von Cache profitieren. Cache-Invalidierungen vermeiden.

## Verwandte Dateien

- `scripts/session_analyze.py` — erzeugt das Aggregat, das diese Lektion begruendet
- `templates/skills/session-analyser/SKILL.md` — Skill zum Wiederholen dieser Analyse

## CLAUDE.md Referenz-Eintrag (copy this line)

```
- [Redactor-Fehler: Top-3-Muster](knowledge/lektion-redactor-strict-mode-haeufigste-fehlerquelle.md) — wrap-Vergessen, json-via-wrap, CLAUDE_PLUGIN_ROOT undefined.
```
