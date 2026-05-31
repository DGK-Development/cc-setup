#!/usr/bin/env bash
# install-to-claude-home.sh — deploy bundled cc-setup plugin + flat local-ci skill
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib-sync.sh
source "$ROOT/scripts/lib-sync.sh"
SRC="$ROOT/dist/cc-setup"
CLAUDE_SKILLS="${CLAUDE_SKILLS:-$HOME/.claude/skills}"
PLUGIN_DEST="${CC_SETUP_DEST:-$CLAUDE_SKILLS/cc-setup}"
LOCAL_CI_DEST="$CLAUDE_SKILLS/local-ci"

die() { echo "install: $*" >&2; exit 1; }

[[ -d "$SRC" ]] || die "missing $SRC — run: just bundle"

echo "==> Claude skills home: $CLAUDE_SKILLS"
mkdir -p "$CLAUDE_SKILLS"

echo "==> plugin cc-setup (hooks + context-load + scripts + bundled skills)"
mkdir -p "$(dirname "$PLUGIN_DEST")"
sync_dir "$SRC" "$PLUGIN_DEST" 1

if [[ -d "$PLUGIN_DEST/skills/local-ci" ]]; then
  echo "==> flat skill local-ci (optional /local-ci without plugin prefix)"
  sync_dir "$PLUGIN_DEST/skills/local-ci" "$LOCAL_CI_DEST" 1
fi

AGENT_COUNT=0
if [[ -d "$PLUGIN_DEST/agents" ]]; then
  AGENT_COUNT=$(find "$PLUGIN_DEST/agents" -maxdepth 1 -name '*.md' ! -name 'agent-index.md' 2>/dev/null | wc -l | tr -d ' ')
fi
SKILL_COUNT=0
if [[ -d "$PLUGIN_DEST/skills" ]]; then
  SKILL_COUNT=$(find "$PLUGIN_DEST/skills" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
fi

echo ""
echo "Installed / updated (global — user-level, all projects):"
echo "  Plugin:  $PLUGIN_DEST"
echo "             @skills-dir auto-load in every repo after trust/restart"
echo "  Agents:  plugin agents/ → Agent tool in any project (not per-repo .claude/agents/)"
echo ""
echo "  Skills via plugin (namespaced): $SKILL_COUNT dirs under skills/"
echo "    /cc-setup:context-load   /cc-setup:review   /cc-setup:qmd   …"
echo "    /cc-setup:local-ci       CI templates"
echo "    /cc-setup:cc-setup       SPOC routing"
echo ""
echo "  Agents (subagents): $AGENT_COUNT under agents/"
if [[ -d "$PLUGIN_DEST/agents" ]]; then
  for f in "$PLUGIN_DEST/agents"/*.md; do
    [[ -f "$f" ]] || continue
    base=$(basename "$f" .md)
    [[ "$base" == "agent-index" ]] && continue
    echo "    Agent tool → $base"
  done
fi
echo ""
if [[ -f "$LOCAL_CI_DEST/SKILL.md" ]]; then
  echo "  Flat skill: $LOCAL_CI_DEST"
  echo "    /local-ci                same local-ci skill, short name"
  echo ""
fi
echo "  Hooks (in plugin): SessionStart context + redactor strict mode"
echo ""
echo "Restart Claude Code or run /reload-plugins"
echo ""
echo "Requires: redactor on PATH (hooks), uv + jq + qmd (context-load — vault step above)"
echo "Platforms: macOS, Linux, Windows via Git Bash or WSL (hooks are bash)"
