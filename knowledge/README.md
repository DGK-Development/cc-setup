# knowledge/ — Distilled Project Lessons

This directory stores lessons derived from session analysis, code review, and
retrospectives. It keeps CLAUDE.md slim: instead of inline prose, CLAUDE.md
references this directory with a one-line entry.

## Purpose

- Persist non-obvious patterns, decisions, and failure modes that are not obvious
  from reading the code or git log.
- Entries here survive across sessions and are loaded on demand, not automatically
  — so they don't inflate every-turn context.

## CLAUDE.md Reference Pattern

In CLAUDE.md (or a project CLAUDE.md), reference a knowledge file like this:

```markdown
## Knowledge Index
- [Title](knowledge/<slug>.md) — one-line description of what the file covers.
```

Rules:
- One line per entry in CLAUDE.md. The description must fit in ~120 chars.
- The description should answer "when do I need to read this?".
- Full detail lives in the knowledge file, not in CLAUDE.md.

### Example entry

```markdown
## Knowledge Index
- [Redactor strict mode](knowledge/redactor-strict-mode.md) — every Bash call needs
  `redactor wrap --`; inline reads use `redactor --type json <file>`.
```

## File Naming Convention

`<slug>.md` where slug is kebab-case, descriptive, max 50 chars.

Prefer pattern `standardisiertes-vorgehen-fuer-<thema>.md` for "how we do X" guides.
Use `lektion-<thema>.md` for lessons-learned entries derived from session analysis.

## File Template

See `knowledge/standardisiertes-vorgehen-fuer-x.md` for the canonical template.

## How to Add a New Entry

1. Copy the template: `cp knowledge/standardisiertes-vorgehen-fuer-x.md knowledge/<slug>.md`
2. Fill in the frontmatter and body.
3. Add a one-line reference to CLAUDE.md knowledge index (never full text).
4. Commit both files together.

## Index

*(auto-maintained — add a line here when you create a new knowledge file)*

- [Template: standardisiertes Vorgehen](standardisiertes-vorgehen-fuer-x.md) — copy this to create a new "how we do X" knowledge file.
- [Lektion: Redactor Top-3-Fehler](lektion-redactor-strict-mode-haeufigste-fehlerquelle.md) — wrap vergessen, JSON via wrap statt --type json, CLAUDE_PLUGIN_ROOT undefiniert. Belegt durch Session-Analyse 2026-06-03.
