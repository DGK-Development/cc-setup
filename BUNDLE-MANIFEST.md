# cc-setup bundle manifest

What gets installed to `~/.claude/skills/` via `just deploy` (flat install, no plugin).
Sources are flat in the repo root (`skills/`, `agents/`, `CONTRACT.md`, `settings.json`,
`hooks/`, `commands/`, runtime `scripts/`). The build runs in an ephemeral temp dir —
`dist/` is not persisted (`just bundle` only for debug inspection).

## cc-setup skill dir (`~/.claude/skills/cc-setup/`)

Hosts the SPOC contract skill plus shared hooks + runtime scripts.

| Component | Source | Notes |
|---|---|---|
| Hooks | repo-local `hooks/` + redactor merge | SessionStart, UserPromptSubmit, Stop, Pre/PostToolUse |
| Scripts | repo-local `scripts/` (whitelist) | context-resolve, sprint_bridge, tasknotes_cli, qmd-ensure, context-deps |
| **Agents** | repo-local `agents/` (synced from ObsidianPKM) | SPOC subagents for `Agent` tool → `~/.claude/agents/` |
| Skills | see below | flat `/<name>` (no plugin namespace) |

## Agents (synced — `just sync-sources`)

| Agent | SPOC role |
|---|---|
| `developer` | Implementation (isolated session) |
| `reviewer` | PR/code review (never same session as developer) |
| `researcher` | Multi-source research |
| `librarian` | Wiki, reports, links |
| `goal-aligner` | Goal audit |
| `weekly-reviewer` | Weekly review |
| `inbox-processor` | GTD inbox |
| `note-organizer` | Vault hygiene |

Refresh: `just sync-sources` copies from `OBSIDIANPKM_ROOT` (default `~/GITHUB/ObsidianPKM`).

## Skills — tier 1 (in bundle, `just sync-sources`)

| Skill | Purpose | Vault-bound? |
|---|---|---|
| `audit` | Session log + config audit | self-contained |
| `cc-setup` | SPOC contract | self-contained |
| `check-links` | Broken wiki links | vault |
| `context-init` | Project bootstrap | command (`commands/context-init.md`) |
| `context-load` | Task + wiki context | uses cc-setup scripts + `OBSIDIAN_VAULT_PATH` |
| `daily-review` | Effort scan | vault Efforts/ |
| `knowledge` | knowledge get/finish | project knowledge/ |
| `local-ci` | Pre-push CI gate | self-contained assets |
| `opensrc` | Reference repo cache | global |
| `qmd` | Hybrid search | needs qmd + vault index |
| `recall` | Session/wiki recall | vault paths |
| `review` | PM routing `/review` | needs vault `skripte/` when run from vault |
| `session-stop` | PKM sync on stop | hooks |

## Skills — tier 2 (optional, stay in vault repo)

Install only if you work daily in ObsidianPKM — sync manually or extend `sync-from-sources.sh`:

`daily`, `weekly`, `monthly`, `learn`, `project`, `goal-tracking`, `obsidian-wiki-migrate`, `obsidian-report-writer`, `adopt`, `fit`, `context-usage`

Reason: heavy vault coupling, large script trees, or niche use.

## Flat skills (all copied by `just deploy`)

All tier-1 skills install flat to `~/.claude/skills/<name>/` and are invoked as `/<name>`
(no plugin namespace). Example:

| Path | Invoke | Why flat |
|---|---|---|
| `~/.claude/skills/local-ci/` | `/local-ci` | self-contained |
| `~/.claude/skills/cc-setup/` | `/cc-setup` | SPOC contract + hosts shared scripts/hooks |

## Platform support

| OS | Support | Requirement |
|---|---|---|
| macOS | full | bash, uv, redactor, optional rsync |
| Linux | full | same |
| Windows | partial | **Git Bash or WSL** for hooks/shell scripts; `just` via winget; redactor has `install-win` |

Hooks and cc-setup scripts are bash — native Windows CMD/PowerShell without WSL is **not** supported.

`just deploy` uses `rsync` when available, else `cp -a` (Git Bash/WSL).
