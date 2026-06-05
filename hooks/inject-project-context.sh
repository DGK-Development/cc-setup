#!/usr/bin/env bash
# inject-project-context.sh — SessionStart hook (plugin port)
#
# Emits a minimal project header: Backlog-Stand (PRIMÄR — milestones, in-progress
# tasks, next to-dos), project id, 2-level tree. Vault-TaskNotes are NOT loaded
# automatically anymore — only on-demand via /context-load (Layer 1) or `tn next`.
# Falls back silently when no backlog/ and no knowledge/ folder / vault project.
#
# Plugin-portable changes vs. the original ~/.claude/hooks version:
#   - PLUGIN_ROOT is derived from this script's location (no hardcoded path).
#   - Vault path resolved via scripts/lib.sh (env-driven).

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

# --- Backlog-Stand (auto, PRIMÄR): Milestones + In-Progress + nächste To-Dos ---
# Backlog.md-Tasks sind die primären Arbeits-Items. Read-only, few-token, greift
# in JEDEM Repo mit backlog/ — unabhaengig vom Vault-Projekt-Match unten. No-op
# (sauberes Skip, kein Fehler), wenn kein backlog/ im Repo oder Tools fehlen.
#
# Pfadaufloesung: PLUGIN_ROOT zeigt im Flat-Install auf ~/.claude/skills/cc-setup/
# (Hook liegt unter hooks/), im Repo auf den Repo-Root — beide Male liegt
# sprint_bridge.py unter scripts/. Fallback auf den festen Flat-Pfad, falls die
# relative Aufloesung das Script nicht findet.
SB_SCRIPT="$PLUGIN_ROOT/scripts/sprint_bridge.py"
[ ! -f "$SB_SCRIPT" ] && SB_SCRIPT="$HOME/.claude/skills/cc-setup/scripts/sprint_bridge.py"

# Extrahiert offene Subtask-IDs (To Do + In Progress) aus `backlog task list -m … --plain`.
# Robust gegen das `[PRIORITY] `-Praefix, das backlog vor die Task-ID setzt.
_open_ids_for_milestone() {
    backlog task list -m "$1" --plain 2>/dev/null | awk '
        /^[A-Za-z].*:[[:space:]]*$/ {
            h = tolower($0); sub(/:[[:space:]]*$/, "", h)
            open = (h == "to do" || h == "in progress"); next
        }
        open && match($0, /[A-Za-z][A-Za-z0-9]*-[0-9][0-9.]*/) {
            ids = ids (ids ? ", " : "") substr($0, RSTART, RLENGTH)
        }
        END { if (ids) print ids }'
}

if [ -d "$PROJECT_DIR/backlog" ] && command -v backlog >/dev/null 2>&1; then
    echo "=== Backlog-Stand (PRIMÄR — Backlog.md ist die Arbeits-Quelle) ==="

    # 1) Milestones: name, done/total, offene Subtask-IDs (via sprint_bridge survey)
    HAS_MILESTONE=0
    if [ -f "$SB_SCRIPT" ] && command -v uv >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
        SB_JSON=$(uv run --script "$SB_SCRIPT" survey --repo "$PROJECT_DIR" 2>/dev/null)
        MS_NAMES=$(echo "$SB_JSON" | jq -r '.open_milestones[]?.name' 2>/dev/null)
        if [ -n "$MS_NAMES" ]; then
            HAS_MILESTONE=1
            echo "Offene Milestones:"
            echo "$SB_JSON" | jq -r '.open_milestones[]? | "\(.name)\t\(.done)\t\(.total)"' 2>/dev/null \
              | while IFS=$'\t' read -r ms_name ms_done ms_total; do
                  [ -z "$ms_name" ] && continue
                  echo "  - $ms_name ($ms_done/$ms_total done)"
                  open_ids=$(_open_ids_for_milestone "$ms_name")
                  [ -n "$open_ids" ] && echo "      offen: $open_ids"
              done
            echo ""
        fi
    fi

    # 2) In-Progress-Tasks (immer)
    IP_LIST=$(backlog task list -s "In Progress" --plain 2>/dev/null | grep -E '^\s+\S' | head -15)
    if [ -n "$IP_LIST" ]; then
        echo "In Progress:"
        echo "$IP_LIST"
        echo ""
    fi

    # 3) Empfohlene nächste To-Dos (Fallback-Quelle wenn keine Milestones existieren)
    TODO_LIST=$(backlog task list -s "To Do" --plain 2>/dev/null | grep -E '^\s+\S' | head -10)
    if [ -n "$TODO_LIST" ]; then
        echo "Nächste To-Dos:"
        echo "$TODO_LIST"
        echo ""
    elif [ "$HAS_MILESTONE" = "0" ] && [ -z "$IP_LIST" ]; then
        # Kein Milestone, nichts in Arbeit, keine To-Dos → kompletter Task-Überblick
        FULL=$(backlog task list --plain 2>/dev/null | head -20)
        [ -n "$FULL" ] && { echo "Tasks:"; echo "$FULL"; echo ""; }
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

# Vault-TaskNotes werden hier NICHT mehr automatisch geladen (Backlog-zentriert).
# Aktive TaskNotes nur on-demand: bei expliziter Vault-/TaskNote-Anfrage via
# /context-load (Layer 1, on-demand) oder direkt `tn next`.

echo "Context-Load: /context-load wird beim ersten User-Prompt getriggert (matcht Anfrage gegen Backlog-Tasks + Wiki, laedt Dependencies). Vault-TaskNotes nur auf explizite Anfrage."
echo ""

exit 0
