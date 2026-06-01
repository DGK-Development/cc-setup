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

echo "==> global ~/.claude/CLAUDE.md (SPOC contract — managed block)"
CONTRACT_SRC="$PLUGIN_DEST/bootstrap/CONTRACT.md"
GLOBAL_CLAUDE="${CLAUDE_HOME:-$HOME/.claude}/CLAUDE.md"
BEGIN_MARK="<!-- BEGIN cc-setup (managed by 'just install' — edits inside this block are overwritten) -->"
END_MARK="<!-- END cc-setup -->"
if [[ -f "$CONTRACT_SRC" ]]; then
  TMP_BLOCK="$(mktemp)"
  { echo "$BEGIN_MARK"; cat "$CONTRACT_SRC"; echo "$END_MARK"; } > "$TMP_BLOCK"
  if [[ -f "$GLOBAL_CLAUDE" ]] && grep -qF "$BEGIN_MARK" "$GLOBAL_CLAUDE"; then
    awk -v b="$BEGIN_MARK" -v e="$END_MARK" -v f="$TMP_BLOCK" '
      function emit(){ while((getline line < f)>0) print line; close(f) }
      $0==b { emit(); skip=1; next }
      $0==e { skip=0; next }
      skip { next }
      { print }
    ' "$GLOBAL_CLAUDE" > "$GLOBAL_CLAUDE.new" && mv "$GLOBAL_CLAUDE.new" "$GLOBAL_CLAUDE"
    echo "             updated managed block in $GLOBAL_CLAUDE"
  elif [[ -f "$GLOBAL_CLAUDE" ]]; then
    { echo ""; cat "$TMP_BLOCK"; } >> "$GLOBAL_CLAUDE"
    echo "             appended managed block (kept existing content) → $GLOBAL_CLAUDE"
  else
    cp "$TMP_BLOCK" "$GLOBAL_CLAUDE"
    echo "             created $GLOBAL_CLAUDE"
  fi
  rm -f "$TMP_BLOCK"
else
  echo "             skip: $CONTRACT_SRC missing (run: just bundle)"
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
