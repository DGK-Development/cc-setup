---
name: session-analyser
description: >
  Analyse Claude Code session logs for the current project to surface token waste,
  repeated failures, and workflow inefficiencies. Produces a structured report and
  proposes knowledge-file additions and CLAUDE.md trim patches (never auto-applies).
  USE WHEN: analyse sessions, session report, token waste, context audit from logs,
  session lessons, claude session analysis, what is wasting tokens, repeated errors,
  session patterns, improve my workflow, analyse jsonl logs.
user-invocable: true
---

# session-analyser Skill

Analyse Claude Code session logs for the active project, synthesize findings as
human-readable lessons, and propose concrete patches — always subject to human review.

## Human-Oversight Gate

**This skill NEVER auto-applies any changes.**
All CLAUDE.md edits, knowledge-file writes, and config patches are presented as diffs or
proposed text. The user decides which patches to apply and when.

## Workflow

```
CWD → session dir → session_analyze.py (deterministic) → aggregate JSON
     → LLM synthesis → Report + patch proposals → knowledge/<lesson>.md
```

### Step 1 — Run the extractor

```bash
SA="$HOME/.claude/skills/session-analyser/scripts/session_analyze.py"
[ -f "$SA" ] || SA="${CLAUDE_PLUGIN_ROOT}/skills/session-analyser/scripts/session_analyze.py"
redactor wrap -- uv run --script "$SA" --output-json \
  --projects-dir "$HOME/.claude/projects" --cwd "$PWD" > /tmp/session-agg.json
```

The analyser is bundled with this skill at `skills/session-analyser/scripts/session_analyze.py`
(single source of truth: `scripts/session_analyze.py` in the cc-setup repo, copied at bundle time).
It derives the encoded project path from CWD automatically.
Output: JSON aggregate with:
- `failed_commands` — tool calls that returned `is_error: true`
- `tool_frequencies` — count per tool name
- `token_stats` — input/output/cache totals + per-session breakdown
- `repeated_sequences` — repeating tool-call patterns (≥2 occurrences)
- `waste_signals` — redundant_reads / oversized_outputs / repeated_commands

### Step 2 — Read the aggregate

```bash
redactor wrap -- bash -c 'cat /tmp/session-agg.json'
```

Parse and summarise key metrics before synthesising. Do NOT load the raw *.jsonl
files — the aggregate is already condensed for LLM consumption.

### Step 3 — LLM synthesis

Synthesise the aggregate into a structured report:

```
## Session Analysis Report — <project> (<date>)

### Token Summary
- Total input: <n> | output: <n> | cache-read: <n> | cache-creation: <n>
- Sessions: <n> | Turns: <n>

### Top Waste Signals
1. <signal-category>: <description> — impact: <chars/tokens>
2. ...

### Repeated Failures
- <tool>: <command> — failed <n> times
  Likely cause: <hypothesis>

### Repeated Patterns (consider extracting to skill/script)
- <sequence> appeared <n>x

### Lessons (proposed knowledge entries)
1. <lesson-title>: <lesson-body>

### Proposed CLAUDE.md Trimming
Lines that appear redundant / outdated based on session evidence:
- Line ~<N>: "<text>" — reason: <why safe to remove>
  (diff shown in Step 4)
```

### Step 4 — Propose patches (NEVER auto-apply)

For each lesson:
1. Propose `knowledge/<slug>.md` content (show as code block, do NOT write it yet).
2. Ask: "Shall I write this knowledge file? (yes/no/edit)"
3. Only write after explicit confirmation.

For CLAUDE.md trimming:
1. Show unified diff (`--- a/CLAUDE.md +++ b/CLAUDE.md`) as a code block.
2. Ask: "Shall I apply this trim? (yes/no)"
3. Apply only after explicit yes.

For any confirmed knowledge file:
```bash
redactor wrap -- bash -c 'mkdir -p knowledge && cat > knowledge/<slug>.md << '"'"'HEREDOC'"'"'
<file content>
HEREDOC'
```

Then add a reference line to CLAUDE.md knowledge index (if one exists):
```
- [<title>](knowledge/<slug>.md) — <one-line description>
```

Show this reference as a proposal before writing.

## Output Format

```
Session Analysis: <n> sessions, <n> turns
- <n> waste signals | <n> repeated failures | <n> repeated patterns

[Structured report — see Step 3 template above]

Proposed patches: <n> knowledge files, <n> CLAUDE.md trims
(awaiting your confirmation before any writes)
```

## Notes

- Session logs are at `~/.claude/projects/<encoded-cwd>/*.jsonl`. The encoded form
  replaces every `/` in the absolute CWD path with `-` (leading `/` → leading `-`).
- The aggregate script is cheap (pure Python, no LLM calls). Only the synthesis step
  uses the LLM — keeping costs proportional to session count, not session byte size.
- Re-run `session_analyze.py` after adding new sessions for a fresh aggregate.
