---
title: cc-setup Architektur & Deployment
slug: architektur-deployment
type: guide
created: '2026-06-05'
tags: [architektur, deployment, hooks]
---

# cc-setup — Architektur & Deployment

> Verschoben aus `backlog/docs/doc-002` (decision-003: Wissen lebt in `knowledge/`).
> Entscheidungs-Rationale: `knowledge/decisions.md` #002.

## Ziel des Repos

cc-setup ist das **self-contained Setup für eine PKM-orientierte Claude-Code-Umgebung**.
Es bündelt Skills, Agents, Hooks, Runtime-Scripts und Settings aus dem Repo und installiert
sie **flach** nach `~/.claude/` — ein einziger Befehl (`just deploy`), kein Plugin, kein
Marketplace. Ergänzt wird das um redactor strict mode (Submodul `vendor/hook-redactor`) und
Vault-Wiring (`OBSIDIAN_VAULT_PATH`).

Kernprinzipien (s. decision-002):
- **Single Source:** alle Quellen liegen **flach im Repo-Root**; kein `git submodule update --remote`.
- **Flat-only:** `just deploy` ist der einzige Install-Pfad (keine Dubletten).
- **Ephemerer Build:** `dist/` wird nicht mehr persistiert — der Build läuft in einem
  Temp-Dir und wird nach dem Deploy aufgeräumt (`just bundle` nur optional für Debug).
- **Review-Gate:** KI-Sessions committen, pushen/deployen aber nicht — der Mensch reviewt
  und aktiviert (Org-Regel: Entwicklung ≠ Review in einer Session).

## Quell-Layout (Top-Level-Dirs, flach im Root)

```
cc-setup/
  skills/       <name>/   (cc-setup-eigene + context-load + gesyncte tier-1-Skills)
  agents/       *.md      (SPOC-Subagenten: developer, reviewer, …)
  settings.json           (Basis-Settings-Stub)
  CONTRACT.md             (SPOC-Contract — Quelle für ~/.claude/CLAUDE.md; NICHT das Root-CLAUDE.md = Backlog-Regeln)
  BUNDLE-MANIFEST.md      (was im Bundle landet)
  hooks/        inject-project-context.sh, userprompt-context-match.sh, hooks.json,
                stop-workflow.sh, pkm-sync-stop.sh
  commands/     context-init.md
  scripts/      Runtime: context-resolve.py, sprint_bridge.py, qmd-ensure.sh,
                wiki-tier-extract.py, nightly-reindex.sh, lib.sh, tasknotes_cli.py,
                context-deps.sh   (+ Build: bundle.sh, deploy.sh, merge_hooks.py, session_analyze.py …)
  vendor/hook-redactor/   (Submodul, bleibt)
  justfile      deploy · setup(alias) · check · bundle · test · sync-sources · install-vault · pull · update
```

## Deployment in zwei Phasen

`just deploy [target]` → `scripts/deploy.sh` → baut via `scripts/bundle.sh` in ein
ephemeres Temp-Dir → installiert flach ins Ziel-Home (default `~/.claude`).

### Phase 1 — `bundle.sh` baut `$OUT/cc-setup/` (Temp-Dir beim Deploy)

`bundle.sh [OUT]` assembliert aus den flachen Repo-Root-Quellen (kein Submodul-Pull).
`OUT` ist beim Deploy ein `mktemp -d` (nach Cleanup weg); ohne Arg `dist/cc-setup` (Debug):
- `hooks/` und `commands/` → `$OUT/cc-setup/{hooks,commands}/`
- Runtime-Scripts (**Whitelist**, keine Build-Scripts) → `$OUT/cc-setup/scripts/`
- `skills/` → `$OUT/cc-setup/skills/` (inkl. context-load)
- `agents/` → `$OUT/cc-setup/agents/`
- `scripts/session_analyze.py` → `$OUT/cc-setup/skills/audit/scripts/` (single source fürs audit-Skill)
- `CONTRACT.md` → `bootstrap/CLAUDE.md` + `bootstrap/CONTRACT.md` (+ redactor-Appendix)
- `merge_hooks.py` (via `uv run python3`) merged `hooks/hooks.json` mit den redactor-Hooks → `$OUT/cc-setup/hooks/hooks.json`

### Phase 2 — `deploy.sh` installiert flach nach `$CLAUDE_HOME`

`deploy.sh` nimmt das Ziel-Home als 1. Positionsarg oder via `--home <pfad>` (default
`~/.claude`), baut das Bundle in `BUILD="$(mktemp -d)"` (Cleanup via `trap EXIT`) und
deployt von dort:

| Komponente | Quelle (Temp-Build) | Ziel | Patch beim Deploy |
|---|---|---|---|
| **Skills** | `$BUILD/cc-setup/skills/<name>/` | `$CLAUDE_HOME/skills/<name>/` | `${CLAUDE_PLUGIN_ROOT}` → `$CC_SETUP_DIR` in SKILL.md (defensiv) |
| **Agents** | `$BUILD/cc-setup/agents/*.md` | `$CLAUDE_HOME/agents/` | — |
| **Scripts** | `$BUILD/cc-setup/scripts/` | `$CLAUDE_HOME/skills/cc-setup/scripts/` | — |
| **Hooks** | `$BUILD/cc-setup/hooks/*.sh` | `$CLAUDE_HOME/skills/cc-setup/hooks/` | `${CLAUDE_PLUGIN_ROOT}` → `$CC_SETUP_DIR`; Skill-Refs de-namespaced (`/project-context:…` → `/…`) |
| **Settings** | programmatisch | `$CLAUDE_HOME/settings.json` | Hook-Events **SessionStart + UserPromptSubmit + Stop** (idempotent, alte cc-setup-Einträge ersetzt) + `env.OBSIDIAN_VAULT_PATH/TASKNOTES_VAULT` |
| **Contract** | `$BUILD/cc-setup/bootstrap/CONTRACT.md` | `$CLAUDE_HOME/CLAUDE.md` | managed Block zwischen `<!-- BEGIN/END cc-setup -->`, Skill-Refs flach |
| **Shell-Profil** | — | `~/.zshrc` bzw. `~/.bashrc` | `export OBSIDIAN_VAULT_PATH` (für Hooks außerhalb der Shell) |

Portabilität: alle In-Place-Edits nutzen das `temp+mv`-Muster (kein GNU-only `sed -i`),
Python via `uv run python3` (uv-strict-tauglich). macOS + Linux; Windows nur via Git Bash/WSL.

## Laufzeit-Verhalten der Hooks

- **SessionStart** (`inject-project-context.sh`): druckt den **Backlog-Stand primär** —
  offene Milestones (done/total + offene Subtask-IDs), In-Progress-Tasks, nächste To-Dos
  (Fallback `backlog task list`). Vault-TaskNotes werden **nicht** automatisch geladen.
  no-op ohne `backlog/`.
- **UserPromptSubmit** (`userprompt-context-match.sh`): triggert `/context-load` beim ersten
  Prompt, backlog-zentriert; Wiki-/Repo-Semantik via qmd dazu. TaskNote-Match nur on-demand.
- **Stop** (`stop-workflow.sh` → `pkm-sync-stop.sh`): finalisiert die Session
  (Tests/Doku/PKM-Sync). **Pusht NIE automatisch**; Commit nur auf explizites Signal;
  Submodul-Pointer-Guard vor manuellem Push.
- **redactor** (PreToolUse/PostToolUse/Prompt/SessionStart): strict-mode-Guards, separat via
  `redactor install-plugin --global` installiert.

## Dependencies

`uv`, `jq`, `node/npm`, `qmd` (@tobilu/qmd), `redactor`. `deploy.sh --check` (bzw.
`just check`) prüft den Status; fehlende Deps werden best-effort installiert.

## Migration vom Plugin/Marketplace

Nach dem Flat-Install den alten Marketplace deinstallieren, um Skill-Dubletten zu vermeiden
(`claude plugin uninstall …`, `claude plugin marketplace remove niclasedge-pkm`) — Details in
`README.md`.

Verwandt: decision-002 (Architektur-Entscheidungen), BUNDLE-MANIFEST.md (was im Bundle landet).
