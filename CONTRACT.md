# cc-setup — PKM Claude Code contract

Bundled plugin: project-context + redactor strict mode. Copy sections into project `CLAUDE.md` or use globally via `~/.claude/CLAUDE.md`.

## Runtime-Vertrag

1. Kontext laden — der **SessionStart**-Hook druckt den **Backlog-Stand** (PRIMÄR: offene Milestones mit done/total + offenen Subtask-IDs, In-Progress-Tasks, naechste To-Dos) plus Projekt-Header; Vault-TaskNotes werden **nicht** automatisch geladen (nur on-demand). Der **UserPromptSubmit**-Hook triggert `/cc-setup:context-load` beim ersten Prompt (Backlog-zentriert; laedt selbst Wiki-/Repo-Semantik dazu). TaskNote-Match nur bei expliziter Vault-Anfrage.
2. Gate bestimmen (`/review routing` or cockpit).
3. Genau eine naechste Aktion ausfuehren.
4. Ergebnis in Task-Changelog, Daily oder Projekt-Changelog dokumentieren.

## SPOC-Routing

Claude ist **SPOC** — 6-Step-Protokoll: Verstehen → Klaeren → Rolle+Banner → Briefen → Ausfuehren → Synthetisieren.

### Rollen-Banner (Pflicht bei Task-Arbeit)

```
═══ SPOC · ROLLE: <Context|PM|Teacher|Developer|Reviewer|Researcher|Librarian> ═══
🎯 INTENT: <=8 Worte>
🔀 DISPATCH: in-session | subagent:<slug>
```

```
🗣️ SPOC: <Ergebnis + naechster Gate>
```

### Routing-Cheatsheet

| Muster | Rolle | Dispatch |
|---|---|---|
| Kontext, Recall, qmd | Context-Engineer | in-session |
| offen, Review, Daily | PM | in-session |
| implementieren, fix | Developer | subagent:developer |
| PR review | Reviewer | subagent:reviewer |
| Recherche | Researcher | subagent:researcher |
| Wiki, Reports | Librarian | in-session / subagent:librarian |

Developer und Reviewer **nie in derselben Session**.

## Redactor (Strict Mode)

- Shell: `redactor wrap -- <cmd>` or `r wrap -- <cmd>`
- Structured reads: `redactor --type json file.json`
- Grep tool disabled — use `r wrap -- rg ...`

Details follow in the redactor appendix appended by `just bundle`.

## Plugin skills

| Skill | Purpose |
|---|---|
| `/cc-setup:context-load` | Task + Wiki + Repo context |
| `/cc-setup:context-init` | Bootstrap project binding + qmd |
| `/cc-setup:local-ci` | Pre-push CI gate — copy `.localci/` templates into target repo |

See `agents/agent-index.md` for routing table.
