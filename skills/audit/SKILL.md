---
name: audit
description: >
  Audit a Claude Code project from two angles — session LOGS (token waste, repeated
  failures, workflow inefficiencies from JSONL) and live CONFIG (MCP servers, CLAUDE.md
  rules, skills, settings, permissions). Produces a structured report and proposes
  knowledge-file additions and CLAUDE.md trims as diffs — never auto-applies.
  USE WHEN: audit, audit my context, audit sessions, session report, token waste,
  context audit, why is claude slow, token optimization, check my settings,
  repeated errors, session patterns, what is wasting tokens, improve my workflow,
  analyse jsonl logs.
user-invocable: true
---

# audit Skill

Two complementary modes — pick one or run both:

- **logs** — analyse session JSONL for the current project (what actually happened).
- **config** — audit the live Claude Code setup (what is loaded into context every turn).

If the user's intent is unclear, ask which mode (or run both).

## Human-Oversight Gate

**This skill NEVER auto-applies a change.** All CLAUDE.md edits, knowledge-file writes
and config patches are shown as diffs / proposed text. The user decides what to apply.

---

## Mode: logs (session analysis)

```
CWD → session dir → session_analyze.py (deterministic) → aggregate JSON
     → LLM synthesis → report + patch proposals → knowledge/<lesson>.md
```

### Step 1 — Run the extractor

```bash
SA="$HOME/.claude/skills/audit/scripts/session_analyze.py"
[ -f "$SA" ] || SA="$HOME/.claude/skills/session-analyser/scripts/session_analyze.py"   # legacy
[ -f "$SA" ] || SA="${CLAUDE_PLUGIN_ROOT}/skills/audit/scripts/session_analyze.py"
redactor wrap -- uv run --script "$SA" --output-json \
  --projects-dir "$HOME/.claude/projects" --cwd "$PWD" > /tmp/session-agg.json
```

Output JSON aggregate: `failed_commands`, `tool_frequencies`, `token_stats`,
`repeated_sequences`, `waste_signals` (redundant_reads / oversized_outputs / repeated_commands).

### Step 2 — Read the aggregate

```bash
redactor wrap -- bash -c 'cat /tmp/session-agg.json'
```

Parse key metrics. Do NOT load the raw `*.jsonl` files — the aggregate is already condensed.

### Step 3 — Synthesise report

```
## Session Analysis Report — <project> (<date>)
### Token Summary       (input / output / cache-read / cache-creation; sessions; turns)
### Top Waste Signals   (category: description — impact)
### Repeated Failures   (tool: command — failed Nx; likely cause)
### Repeated Patterns   (sequence appeared Nx — consider extracting to skill/script)
### Lessons             (proposed knowledge entries)
### Proposed CLAUDE.md Trimming (redundant/outdated lines — diff in Step 4)
```

### Step 4 — Propose patches (NEVER auto-apply)

- Per lesson: propose `knowledge/<slug>.md` as a code block → ask "write? (yes/no/edit)" → write only on confirm.
- Per CLAUDE.md trim: show a unified diff (`--- a/CLAUDE.md +++ b/CLAUDE.md`) → apply only on explicit yes.

---

## Mode: config (setup audit)

Bloated context costs more and produces worse output. This mode finds the waste.

### Step 1 — Get /context data

Use the `/context` output if the user already ran it this session. Otherwise ask them to
run `/context` and **STOP** until they reply — the breakdown determines what to audit and
in what order. Without it the audit is guessing.

### Step 2 — Audit largest → smallest

- **MCP servers** (~15-20k tokens each, every turn): count configured servers; flag any
  with CLI alternatives (Playwright, Google Workspace, GitHub).
- **CLAUDE.md** (project / `.claude/` / `~/.claude/`): test every rule against five filters —
  Default (Claude already does it) · Contradiction · Redundancy · Bandaid · Vague.
  >200 lines → look for progressive-disclosure moves (task-specific rules → reference files).
- **Skills** (`.claude/skills/*/SKILL.md`): flag >200 lines (critical >500); same five filters;
  catch restated goals, hedging, synonymous instructions.
- **Settings**: `autocompact_percentage_override` (≤80, recommend 75) · `BASH_MAX_OUTPUT_LENGTH` (150000).
- **File permissions**: `permissions.deny` for build-artifact dirs that exist
  (node_modules/dist/.next, target, vendor, __pycache__/.venv).

### Step 3 — Score & report

Start at 100, deduct per issue (CLAUDE.md >200 −10 / >500 −20; per 5 flagged rules −5;
contradictions −10; missing autocompact −10; missing bash override −5; skill >200 −5 / >500 −10;
per MCP server −3; no deny + bloat dirs −10). Floor 0.
Labels: 90-100 CLEAN · 70-89 NEEDS WORK · 50-69 BLOATED · 0-49 CRITICAL.

### Step 4 — Offer to fix

Auto-apply only `settings.json` + `permissions.deny` (safe, reversible). Show diffs for
CLAUDE.md and skills — confirm before modifying instruction files.

---

## Notes

- Session logs live at `~/.claude/projects/<encoded-cwd>/*.jsonl` — every `/` in the absolute
  CWD path becomes `-` (leading `/` → leading `-`).
- `session_analyze.py` is cheap (pure Python, no LLM). Only the synthesis step uses the LLM,
  keeping cost proportional to session count, not byte size.
- Single source of truth for the script: `scripts/session_analyze.py` in the cc-setup repo,
  copied into this skill at bundle time.
