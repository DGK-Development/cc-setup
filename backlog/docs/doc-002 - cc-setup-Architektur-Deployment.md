---
id: doc-002
title: cc-setup Architektur & Deployment
type: guide
created_date: '2026-06-05 07:51'
---

# cc-setup — Architektur & Deployment

## Ziel des Repos

cc-setup ist das **self-contained Setup für eine PKM-orientierte Claude-Code-Umgebung**.
Es bündelt Skills, Agents, Hooks, Runtime-Scripts und Settings aus dem Repo und installiert
sie **flach** nach `~/.claude/` — ein einziger Befehl (`just setup`), kein Plugin, kein
Marketplace. Ergänzt wird das um redactor strict mode (Submodul `vendor/hook-redactor`) und
Vault-Wiring (`OBSIDIAN_VAULT_PATH`).

Kernprinzipien (s. decision-002):
- **Single Source:** alle Quellen liegen repo-lokal; kein `git submodule update --remote`.
- **Flat-only:** `just setup` ist der einzige Install-Pfad (keine Dubletten).
- **Review-Gate:** KI-Sessions committen, pushen/deployen aber nicht — der Mensch reviewt
  und aktiviert (Org-Regel: Entwicklung ≠ Review in einer Session).

## Quell-Layout (Top-Level-Dirs)

```
cc-setup/
  hooks/        inject-project-context.sh, userprompt-context-match.sh, hooks.json,
                stop-workflow.sh, pkm-sync-stop.sh
  commands/     context-init.md
  scripts/      Runtime: context-resolve.py, sprint_bridge.py, qmd-ensure.sh,
                wiki-tier-extract.py, nightly-reindex.sh, lib.sh, tasknotes_cli.py,
                context-deps.sh   (+ Build: bundle.sh, setup.sh, merge_hooks.py, session_analyze.py …)
  templates/    skills/<name>/   (cc-setup-eigene + context-load), agents/*.md,
                CLAUDE.md (SPOC-Contract), settings.json, BUNDLE-MANIFEST.md
  vendor/hook-redactor/   (Submodul, bleibt)
  justfile      setup · check · bundle · test · sync-sources · install-vault · pull · update
```

## Deployment in zwei Phasen

`just setup` → `scripts/setup.sh` → ruft `scripts/bundle.sh` → installiert flach.

### Phase 1 — `bundle.sh` baut `dist/cc-setup/`

Assembliert aus den repo-lokalen Quellen (kein Submodul-Pull):
- `hooks/` und `commands/` → `dist/cc-setup/{hooks,commands}/`
- Runtime-Scripts (**Whitelist**, keine Build-Scripts) → `dist/cc-setup/scripts/`
- `templates/skills/` → `dist/cc-setup/skills/` (inkl. context-load)
- `templates/agents/` → `dist/cc-setup/agents/`
- `scripts/session_analyze.py` → `dist/cc-setup/skills/audit/scripts/` (single source fürs audit-Skill)
- `templates/CLAUDE.md` → `bootstrap/CLAUDE.md` + `bootstrap/CONTRACT.md` (+ redactor-Appendix)
- `merge_hooks.py` (via `uv run python3`) merged `hooks/hooks.json` mit den redactor-Hooks → `dist/cc-setup/hooks/hooks.json`

### Phase 2 — `setup.sh` installiert flach nach `~/.claude/`

| Komponente | Quelle (dist) | Ziel | Patch beim Deploy |
|---|---|---|---|
| **Skills** | `dist/cc-setup/skills/<name>/` | `~/.claude/skills/<name>/` | `${CLAUDE_PLUGIN_ROOT}` → `$CC_SETUP_DIR` in SKILL.md (defensiv) |
| **Agents** | `dist/cc-setup/agents/*.md` | `~/.claude/agents/` | — |
| **Scripts** | `dist/cc-setup/scripts/` | `~/.claude/skills/cc-setup/scripts/` | — |
| **Hooks** | `dist/cc-setup/hooks/*.sh` | `~/.claude/skills/cc-setup/hooks/` | `${CLAUDE_PLUGIN_ROOT}` → `$CC_SETUP_DIR`; Skill-Refs de-namespaced (`/project-context:…` → `/…`) |
| **Settings** | programmatisch | `~/.claude/settings.json` | Hook-Events **SessionStart + UserPromptSubmit + Stop** (idempotent, alte cc-setup-Einträge ersetzt) + `env.OBSIDIAN_VAULT_PATH/TASKNOTES_VAULT` |
| **Contract** | `dist/cc-setup/bootstrap/CONTRACT.md` | `~/.claude/CLAUDE.md` | managed Block zwischen `<!-- BEGIN/END cc-setup -->`, Skill-Refs flach |
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

`uv`, `jq`, `node/npm`, `qmd` (@tobilu/qmd), `redactor`. `setup.sh --check` prüft den Status;
fehlende Deps werden best-effort installiert.

## Migration vom Plugin/Marketplace

Nach dem Flat-Install den alten Marketplace deinstallieren, um Skill-Dubletten zu vermeiden
(`claude plugin uninstall …`, `claude plugin marketplace remove niclasedge-pkm`) — Details in
`README.md`.

Verwandt: decision-002 (Architektur-Entscheidungen), BUNDLE-MANIFEST.md (was im Bundle landet).
