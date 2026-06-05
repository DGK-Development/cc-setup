---
name: knowledge
description: Load project context or finish a session with knowledge sync. USE WHEN knowledge get, knowledge finish, load context, project context, session finish, sync knowledge, end session, close session, was wurde gemacht, context laden.
---

# Knowledge Skill

Load project context from any directory, or finish a session with knowledge sync (Paperclip + cost logging).

## Commands

### `/knowledge get <project>`

Load full project context by folder name. Works from any directory.

```bash
uv run ~/.claude/hooks/knowledge-bridge.py get <project>
```

**Example:**
```bash
uv run ~/.claude/hooks/knowledge-bridge.py get affiliate-hub-sites
```

**Output includes:**
- Phase, Progress, Status from knowledge/CLAUDE.md
- Last 5 changelog entries
- Open Tasks (Paperclip + manual)
- Session History from CHANGELOG.md
- Lessons Learned titles
- Paperclip Issues (if project has mapping)

**Project name** = folder name under `~/GITHUB/` (e.g., `affiliate-hub-sites`, `deinelistings.de`, `YT Gen Pipeline`). Case-insensitive matching with hyphen/space normalization.

### `/knowledge finish <project>`

Finish a session: sync Paperclip issues, update changelog, log costs.

```bash
uv run ~/.claude/hooks/knowledge-bridge.py finish <project> --summary "Deutsche Zusammenfassung" --cost 0.42
```

**What it does:**
1. **Paperclip Sync** — pulls new issues into Open Tasks as `- [ ] [AFF-7] P1 — Title (status) <!-- paperclip:UUID -->`, pushes completed tasks back
2. **CHANGELOG.md** — adds new entry with summary
3. **CLAUDE.md** — updates changelog section + Last Updated
4. **Cost Logging** — writes to `~/.claude/logs/knowledge/YYYY-MM-DD-knowledge.log`
5. **Touch marker** — prevents debounce re-fire

**Parameters:**
- `--summary` / `-s` — Session summary in German (1-2 sentences). Optional — skip if no substantive work.
- `--cost` — Session cost in USD. Optional.

## Paperclip Integration

Not every project has a Paperclip company. Mapping is in `~/.claude/hooks/paperclip-mapping.json`:

```json
{
  "company_id": "f168eb03-...",
  "company_name": "aff-hub",
  "issue_prefix": "AFF",
  "project_name": "affiliate-hub-sites"
}
```

If no mapping exists for the project, Paperclip sync is silently skipped.

**Issue format in CLAUDE.md Open Tasks:**
```markdown
### Paperclip (aff-hub)
- [ ] [AFF-7] P1 — Implement Pillar Page template architecture (todo) <!-- paperclip:UUID -->
- [x] [AFF-3] P2 — Setup CI pipeline (done) <!-- paperclip:UUID -->
```

## Logs

All actions are logged to `~/.claude/logs/knowledge/YYYY-MM-DD-knowledge.log`:

```
[2026-04-03 14:30:00] GET | project=affiliate-hub-sites | OK | source=/path/to/knowledge | paperclip=yes
[2026-04-03 15:45:00] FINISH | project=affiliate-hub-sites | Paperclip: +2 / done:1 | cost=$0.42
```

## Usage in Paperclip Agent Sessions

Paperclip agents start in arbitrary directories. At session start, call:

```bash
uv run ~/.claude/hooks/knowledge-bridge.py get <project>
```

Before session end, call:

```bash
uv run ~/.claude/hooks/knowledge-bridge.py finish <project> --summary "Was wurde gemacht" --cost 0.35
```

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `OBSIDIAN_VAULT_PATH` | `~/GITHUB/ObsidianPKM` | Vault location |
| `GITHUB_PATH` | `~/GITHUB` | Parent dir of project repos |
| `PAI_DIR` | `~/.claude` | Hooks directory parent |
| `CLAUDE_PROJECT` | — | Override project name for hooks |
