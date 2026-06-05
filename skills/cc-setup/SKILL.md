---
description: SPOC routing and PKM runtime contract for cc-setup plugin. Use at session start and when dispatching roles.
---

# cc-setup — SPOC contract

See also `bootstrap/CLAUDE.md` for full copy-paste project guidance.

## Runtime-Vertrag

1. Kontext laden — `/cc-setup:context-load` or SessionStart hook.
2. Gate bestimmen — review routing or cockpit.
3. Eine naechste Aktion ausfuehren.
4. In Task-Changelog / Daily dokumentieren.

## SPOC 6-Step

Verstehen → Klaeren → Rolle+Banner → Briefen → Ausfuehren → Synthetisieren (`🗣️ SPOC:`).

## Routing

| Muster | Rolle | Dispatch |
|---|---|---|
| Kontext, qmd, Recall | Context-Engineer | in-session |
| offen, Review, Daily | PM | in-session |
| implementieren, fix | Developer | subagent:developer |
| PR review | Reviewer | subagent:reviewer |
| Recherche | Researcher | subagent:researcher |
| Wiki, Reports | Librarian | subagent:librarian |

Developer + Reviewer never in the same session.

## Redactor

- `r wrap -- <cmd>` for all shell
- `r --type json <file>` for structured reads
- No raw Grep tool — use `r wrap -- rg`
