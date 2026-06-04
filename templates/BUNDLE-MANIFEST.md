# cc-setup bundle manifest

What gets installed to `~/.claude/skills/` via `just install`.

## Plugin (`~/.claude/skills/cc-setup/`)

Single `@skills-dir` plugin — hooks, scripts, agents, skills.

| Component | Source | Notes |
|---|---|---|
| Hooks | cc-plugin + redactor merge | SessionStart, UserPromptSubmit, Pre/PostToolUse |
| Scripts | cc-plugin-project-context | context-resolve, tasknotes_cli, qmd-ensure, setup.sh |
| **Agents** | ObsidianPKM `.claude/agents/` | SPOC subagents for `Agent` tool |
| Skills | see below | namespaced `/cc-setup:<name>` |

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
| `context-init` | Project bootstrap | command in plugin |
| `context-load` | Task + wiki context | uses plugin scripts + `OBSIDIAN_VAULT_PATH` |
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

## Flat skills (also copied by `just install`)

| Path | Invoke | Why flat |
|---|---|---|
| `~/.claude/skills/local-ci/` | `/local-ci` | backward compatible, self-contained |

Other skills: use `/cc-setup:<skill>` after plugin install.

## Platform support

| OS | Support | Requirement |
|---|---|---|
| macOS | full | bash, uv, redactor, optional rsync |
| Linux | full | same |
| Windows | partial | **Git Bash or WSL** for hooks/shell scripts; `just` via winget; redactor has `install-win` |

Hooks and cc-plugin scripts are bash — native Windows CMD/PowerShell without WSL is **not** supported.

`just install` uses `rsync` when available, else `cp -a` (Git Bash/WSL).
