---
name: recall
description: Durchsuche vergangene Sessions, Wiki und Projects nach Themen oder Datum
user-invocable: true
---

# /recall — Vault-weite Suche mit Temporal Decay

Wrapper um die `r search` CLI (Rust-Binary, Symlink `r` → `redactor`). Ranked Full-Text-Search über Markdown + Code mit sanitierten Snippets, Temporal Decay (`e^(-0.05 × days_old)`), 4 Sektionen: **project knowledge · tasks · code · wiki**.

## Wann automatisch nutzen

**Immer zuerst suchen wenn:**
- User fragt nach Wissen, Setup, Architektur, Entscheidungen
- Neue Session in bekanntem Projekt (Kontext holen)
- Suche nach Implementierungen oder Script-Dateien im Projekt
- "Erinnere dich an…" / "Letztes Mal haben wir…"

## Implementierung

### Standard-Suche

```bash
r search "<suchbegriff>"
```

Liefert bis zu 4 Sektionen, je 5 Hits (Override mit `--limit N`).

### Output-Format wählen

```bash
r search "<query>" --format text   # default, mit Snippets
r search "<query>" --format json   # für Pipelines
r search "<query>" --format yml    # kompakt
```

### Sektionen filtern

| Flag | Effekt |
|------|--------|
| `--knowledge-only` | nur project knowledge |
| `--tasks-only` | nur Tasks |
| `--code-only` | nur Code-Dateien |
| `--wiki-only` | nur Wiki |
| `--no-wiki` | alle Sektionen außer Wiki (schneller) |

### Decay-Steuerung

```bash
r search "<query>" --no-decay              # alle Hits gleich gewichten
r search "<query>" --decay 0.02            # langsamer Decay (alte Sachen relevant halten)
r search "<query>" --decay 0.10            # aggressiver Decay (nur Frisches)
```

Default-Decay-Rate: `0.05` (Halbwertszeit ~14 Tage).

## Beispiele

```bash
r search "task cli" --limit 3                    # kompakter Quick-Look
r search "ansible deploy" --code-only            # nur Code-Treffer
r search "MEMORY system" --wiki-only --format json
r search "fitness" --knowledge-only --no-decay   # alles, egal wie alt
```

## Migration-Hinweis

Ersetzt vollständig `~/.claude/scripts/search_decay.py` (Python+Node+MiniSearch). Alte Aufrufe `q "query"`, `qc`, `qw`, `qp` wurden außer Dienst gestellt — `r search` ist der Nachfolger.
