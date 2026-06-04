#!/usr/bin/env bash
# inject-project-context.sh — SessionStart hook (plugin port)
#
# Emits a minimal project header: project id, 2-level tree, active TaskNotes.
# Falls back silently when no knowledge/ folder and no matching vault project.
#
# Plugin-portable changes vs. the original ~/.claude/hooks version:
#   - PLUGIN_ROOT is derived from this script's location (no hardcoded path).
#   - Vault path resolved via scripts/lib.sh (env-driven).
#   - TaskNotes CLI is the plugin-bundled copy, invoked with --vault.

set -u

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../scripts/lib.sh
source "$PLUGIN_ROOT/scripts/lib.sh"

VAULT_PATH="$(resolve_vault)"
GITHUB_PATH="${GITHUB_PATH:-$HOME/GITHUB}"
PROJECT_DIR="$(pwd)"

# Log setup — overwrite each session, only if logs/ dir is creatable
LOG_FILE="$PROJECT_DIR/logs/hook-session-start.log"
if mkdir -p "$PROJECT_DIR/logs" 2>/dev/null; then
    exec > >(tee "$LOG_FILE") 2>&1
fi
echo "=== SESSION START HOOK $(date '+%Y-%m-%d %H:%M:%S') ==="
echo "CWD: $PROJECT_DIR"
echo "Vault: $VAULT_PATH"
echo ""

# --- Backlog-Sprint (auto): naechster Task + Milestone-Fortschritt ---
# Schnell (sprint_bridge status: read-only backlog-parse, kein tn-Call), few-token,
# greift in JEDEM Repo mit backlog/ — unabhaengig vom Vault-Projekt-Match unten.
SB_SCRIPT="$PLUGIN_ROOT/scripts/sprint_bridge.py"
if [ -d "$PROJECT_DIR/backlog" ] && [ -f "$SB_SCRIPT" ] && command -v uv >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
    SB_JSON=$(uv run --script "$SB_SCRIPT" status --repo "$PROJECT_DIR" 2>/dev/null)
    MS=$(echo "$SB_JSON" | jq -r '.active | select(.) | "\(.milestone) (\(.done)/\(.total))"' 2>/dev/null)
    NEXT=$(echo "$SB_JSON" | jq -r '.active.next_open_task | select(.) | "\(.id) — \(.title)"' 2>/dev/null)
    if [ -n "$MS" ]; then
        echo "Backlog-Sprint (auto): $MS"
        [ -n "$NEXT" ] && echo "  ➡ Nächster Task: $NEXT"
        echo ""
    fi
fi

# --- Locate knowledge source ---
# Priority 0: CLAUDE_PROJECT env var (explicit override, e.g. from agents)
# Priority 1: Local knowledge/ folder in project
# Priority 2: Vault project folder (ACE Efforts/, legacy Projects/)

KNOWLEDGE_DIR=""
PKM_PROJECT_NAME=""
CANDIDATE_DIR=""

if [ -n "${CLAUDE_PROJECT:-}" ]; then
    OVERRIDE_NAME="$CLAUDE_PROJECT"
    if [ -d "$GITHUB_PATH/$OVERRIDE_NAME/knowledge" ] && [ -f "$GITHUB_PATH/$OVERRIDE_NAME/knowledge/facts.md" ]; then
        KNOWLEDGE_DIR="$GITHUB_PATH/$OVERRIDE_NAME/knowledge"
        PKM_PROJECT_NAME=$(grep -m1 "^project:" "$KNOWLEDGE_DIR/facts.md" 2>/dev/null | sed 's/^project:[[:space:]]*//' | tr -d '"')
        [ -z "$PKM_PROJECT_NAME" ] && PKM_PROJECT_NAME="$OVERRIDE_NAME"
    else
        override_lower=$(echo "$OVERRIDE_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr '_' '-')
        for dir in \
            "$VAULT_PATH/Efforts/Work"/*/*/ \
            "$VAULT_PATH/Efforts/Private"/*/*/ \
            "$VAULT_PATH/Projects"/*/ \
            "$VAULT_PATH/Projects Privat"/*/ ; do
            [ ! -d "$dir" ] && continue
            dir_name=$(basename "$dir")
            dir_lower=$(echo "$dir_name" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr '_' '-')
            if [ "$dir_lower" = "$override_lower" ]; then
                PKM_PROJECT_NAME="$dir_name"
                KNOWLEDGE_DIR="$dir"
                break
            fi
        done
    fi
elif [ -d "$PROJECT_DIR/knowledge" ] && [ -f "$PROJECT_DIR/knowledge/facts.md" ]; then
    KNOWLEDGE_DIR="$PROJECT_DIR/knowledge"
    PKM_PROJECT_NAME=$(grep -m1 "^project:" "$KNOWLEDGE_DIR/facts.md" 2>/dev/null | sed 's/^project:[[:space:]]*//' | tr -d '"')
    [ -z "$PKM_PROJECT_NAME" ] && PKM_PROJECT_NAME=$(basename "$PROJECT_DIR")
else
    if [ -f "$PROJECT_DIR/.pkm-project" ]; then
        PKM_PROJECT_NAME=$(cat "$PROJECT_DIR/.pkm-project" | tr -d '\n')
    else
        REPO_NAME=$(basename "$PROJECT_DIR")
        for dir in \
            "$VAULT_PATH/Efforts/Work"/*/*/ \
            "$VAULT_PATH/Efforts/Private"/*/*/ \
            "$VAULT_PATH/Projects"/*/ \
            "$VAULT_PATH/Projects Privat"/*/ ; do
            [ ! -d "$dir" ] && continue
            dir_name=$(basename "$dir")
            dir_lower=$(echo "$dir_name" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
            repo_lower=$(echo "$REPO_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
            if [ "$dir_lower" = "$repo_lower" ]; then
                PKM_PROJECT_NAME="$dir_name"
                CANDIDATE_DIR="${dir%/}"
                break
            fi
        done
    fi
    if [ -n "$PKM_PROJECT_NAME" ] && [ -n "$CANDIDATE_DIR" ] && [ -f "$CANDIDATE_DIR/CLAUDE.md" ]; then
        KNOWLEDGE_DIR="$CANDIDATE_DIR"
    fi
fi

# No knowledge found — exit silently
if [ -z "$KNOWLEDGE_DIR" ] || [ ! -f "$KNOWLEDGE_DIR/facts.md" ]; then
    exit 0
fi

# --- Minimal Output: Projekt-ID + Project-Tree + Active TaskNotes ---
echo ""
echo "=== Project: $PKM_PROJECT_NAME ==="
echo "Knowledge: $KNOWLEDGE_DIR"
echo ""

# Project Tree (2 levels)
echo "Project Tree (2 levels):"
find "$PROJECT_DIR" -maxdepth 2 -mindepth 1 -type d \
    -not -path '*/\.*' \
    -not -name 'node_modules' \
    -not -name '__pycache__' \
    -not -name 'venv' \
    -not -name '.venv' \
    -not -name 'dist' \
    -not -name 'build' \
    -not -name '.git' \
    -not -name 'knowledge' \
    2>/dev/null | sort | while read -r path; do
    rel_path="${path#$PROJECT_DIR/}"
    depth=$(echo "$rel_path" | tr -cd '/' | wc -c | tr -d ' ')
    name=$(basename "$path")
    indent=""
    for ((i=0; i<depth; i++)); do indent="  $indent"; done
    echo "  ${indent}${name}/"
done | head -30
find "$PROJECT_DIR" -maxdepth 1 -mindepth 1 -type f \
    -not -name '.*' \
    2>/dev/null | sort | while read -r path; do
    echo "  $(basename "$path")"
done | head -15
echo ""

# Active TaskNotes via plugin-bundled tasknotes_cli.py
TASKNOTES_CLI="$PLUGIN_ROOT/scripts/tasknotes_cli.py"
if [ -f "$TASKNOTES_CLI" ] && command -v uv >/dev/null 2>&1; then
    TN_JSON=$(uv run --script "$TASKNOTES_CLI" --vault "$VAULT_PATH" list --status in-progress --format json 2>/dev/null)
    if command -v jq >/dev/null 2>&1; then
        TN_COUNT=$(echo "$TN_JSON" | jq -r '.count // 0' 2>/dev/null)
        if [ -n "$TN_COUNT" ] && [ "$TN_COUNT" != "0" ]; then
            echo "Active Tasks ($TN_COUNT in-progress):"
            echo "$TN_JSON" | jq -r '.tasks[] | "  - [\(.id)] \(.title) (\(.project.name))\(if .metadata.cc_workflow_status then " · cc:" + .metadata.cc_workflow_status else "" end)"' 2>/dev/null
            echo ""
        fi
    fi
fi

echo "Context-Load: /context-load wird beim ersten User-Prompt getriggert (matcht Anfrage gegen Wiki + aktive Tasks, laedt Dependencies)."
echo ""

exit 0
