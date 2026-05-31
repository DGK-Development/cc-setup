---
name: agent-index
description: SPOC routing table — maps user intent to subagents (developer, reviewer, researcher, librarian, PM helpers).
---

# cc-setup — Agent routing (SPOC)

Subagents live in `agents/*.md`. Invoke via Claude Code **Agent** tool (SPOC dispatches — never same session for developer + reviewer).

| User pattern | Agent | File |
|---|---|---|
| implementieren, fix, Spec→PR | **developer** | `agents/developer.md` |
| PR review, verify, security | **reviewer** | `agents/reviewer.md` |
| Recherche, X vs Y, OSINT | **researcher** | `agents/researcher.md` |
| Wiki migrate, reports, links | **librarian** | `agents/librarian.md` |
| Ziele, Alignment | **goal-aligner** | `agents/goal-aligner.md` |
| Weekly review | **weekly-reviewer** | `agents/weekly-reviewer.md` |
| Inbox / GTD capture | **inbox-processor** | `agents/inbox-processor.md` |
| Vault hygiene, dedup | **note-organizer** | `agents/note-organizer.md` |

In-session roles (no subagent): Context-Engineer, PM, Teacher — see skill `/cc-setup:cc-setup`.

Refresh agents from vault: `just sync-sources` (from `ObsidianPKM/.claude/agents/`).
