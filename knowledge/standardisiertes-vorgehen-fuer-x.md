---
title: "Standardisiertes Vorgehen fuer <Thema>"
slug: standardisiertes-vorgehen-fuer-x
type: procedure          # procedure | lesson | decision | reference
source: template         # template | session-analysis | code-review | retro
created: YYYY-MM-DD
tags: []                 # e.g. [bash, redactor, testing]
---

# Standardisiertes Vorgehen fuer <Thema>

> One-sentence summary of what this file is about and when to read it.

## Kontext (Warum)

Why does this procedure/pattern exist? What problem does it solve?
What went wrong before this was standardised?

## Vorgehen (Wie)

Step-by-step description of the standardised approach.

1. Step one — brief explanation.
2. Step two — with example if needed.
3. Step three.

### Beispiel

```bash
# Concrete example command or code snippet
redactor wrap -- uv run --script scripts/example.py --flag value
```

## Schwellwerte / Grenzen

If this procedure has thresholds or limits (e.g. "only if file > 50 kB"), document them here.

| Parameter | Wert | Begruendung |
|-----------|------|-------------|
| example_threshold | 50 000 chars | Empirisch: groesser = messbarer Context-Overhead |

## Ausnahmen

When does this procedure NOT apply? What are the known edge cases?

## Verwandte Dateien

- `scripts/example.py` — the script this procedure relies on
- `knowledge/related-topic.md` — related lesson

## CLAUDE.md Referenz-Eintrag (copy this line)

```
- [<Titel>](knowledge/<slug>.md) — <description in ≤120 chars>.
```
