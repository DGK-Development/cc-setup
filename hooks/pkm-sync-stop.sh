#!/bin/bash
# pkm-sync-stop.sh — Stop hook: triggers Claude to sync PKM via block decision
# Collects context (last changelog, changed files, git diff) and lets Claude decide
# what is worth documenting. On second fire (stop_hook_active=true), exits silently.
#
# CCS-008 (vendored via cc-setup): KEIN Auto-Push. Der Hook weist Claude an, lokal
# zu committen (nur auf explizites User-Signal sinnvoll, siehe session-stop SKILL),
# aber NIE automatisch zu pushen. Push ist immer ein manueller, menschlicher Schritt
# nach Review (Human-Oversight-Pflicht). Submodul-Pointer-Safety vor dem manuellen
# Push: submodule_push_guard in stop-workflow.sh.

INPUT=$(cat)

# Orchestrated headless worker: skip PKM-sync / decision:block to avoid doc loops.
# redactor (PreToolUse) and no-auto-push (CCS-008) are separate concerns, unaffected.
if [ "${CC_ORCHESTRATED:-}" = "1" ]; then exit 0; fi

# Parse fields
# (logging happens below once CWD is known)
STOP_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
CWD=$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
[ -z "$CWD" ] && CWD="$(pwd)"

VAULT_PATH="${OBSIDIAN_VAULT_PATH:-$HOME/GITHUB/ObsidianPKM}"

# 1. Prevent infinite loop
if [ "$STOP_ACTIVE" = "true" ]; then
    exit 0
fi

# 1b. Detect whether CWD is inside a git repo (drives whether we ask Claude to commit)
IS_GIT_REPO=false
if git -C "$CWD" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    IS_GIT_REPO=true
fi

# 2. (Vault is no longer skipped — hooks run in ObsidianPKM too)

# 3. Detect knowledge dir and project name
KNOWLEDGE_DIR=""
PKM_PROJECT=""

if [ -d "$CWD/knowledge" ] && [ -f "$CWD/knowledge/facts.md" ]; then
    KNOWLEDGE_DIR="$CWD/knowledge"
    PKM_PROJECT=$(grep -m1 "^project:" "$KNOWLEDGE_DIR/facts.md" 2>/dev/null | sed 's/^project:[[:space:]]*//' | tr -d '"')
    [ -z "$PKM_PROJECT" ] && PKM_PROJECT=$(basename "$CWD")
else
    # Vault fallback: search ACE Efforts (no legacy Projects/ — removed in ACE migration).
    DIR_NAME=$(basename "$CWD")
    MAPPING_JSON="$VAULT_PATH/Efforts/_system/data/sync-mapping.json"
    for dir in \
        "$VAULT_PATH/Efforts/Work"/*/*/ \
        "$VAULT_PATH/Efforts/Private"/*/*/ ; do
        [ ! -d "$dir" ] && continue
        pname=$(basename "$dir")
        pl=$(echo "$pname" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
        dl=$(echo "$DIR_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
        if [ "$pl" = "$dl" ]; then
            PKM_PROJECT="$pname"
            # Resolve via JSON mapping: write into the canonical repo knowledge/ if mapped,
            # otherwise fall back to vault directory itself (vault-only project).
            KNOWLEDGE_DIR=""
            if [ -f "$MAPPING_JSON" ] && command -v jq >/dev/null 2>&1; then
                rel="${dir#$VAULT_PATH/}"
                rel="${rel%/}"
                repo=$(jq -r --arg v "$rel" '.mappings[] | select(.vault == $v) | .repo' "$MAPPING_JSON" 2>/dev/null)
                if [ -n "$repo" ] && [ -d "$repo" ]; then
                    KNOWLEDGE_DIR="$repo"
                fi
            fi
            [ -z "$KNOWLEDGE_DIR" ] && KNOWLEDGE_DIR="${dir%/}"
            break
        fi
    done
fi

if [ -z "$PKM_PROJECT" ] || [ -z "$KNOWLEDGE_DIR" ]; then
    exit 0
fi

# Log setup — write directly to file (avoids tee async-flush issue)
# stdout stays clean for the decision: block JSON output at the end
LOG_FILE="$CWD/logs/hook-stop.log"
mkdir -p "$CWD/logs" 2>/dev/null
: > "$LOG_FILE"
logf() { echo "$@" >> "$LOG_FILE"; }

logf "=== STOP HOOK $(date '+%Y-%m-%d %H:%M:%S') ==="
logf "PROJECT: $PKM_PROJECT"
logf "CWD: $CWD"
logf "IS_GIT_REPO: $IS_GIT_REPO"
logf ""

# 4. Debounce (15 min)
MARKER="$KNOWLEDGE_DIR/.pkm-last-sync"
if [ -f "$MARKER" ]; then
    if [ "$(uname)" = "Darwin" ]; then
        LAST_SYNC=$(stat -f %m "$MARKER" 2>/dev/null || echo 0)
    else
        LAST_SYNC=$(stat -c %Y "$MARKER" 2>/dev/null || echo 0)
    fi
    NOW=$(date +%s)
    ELAPSED=$((NOW - LAST_SYNC))
    if [ "$ELAPSED" -lt 900 ]; then
        logf "Exit: debounce (${ELAPSED}s < 900s)"
        exit 0
    fi
fi

logf "Debounce passed, gathering changes..."

# 5. Gather context for Claude's decision
# --- Last changelog entry ---
LAST_CHANGELOG=""
if [ -f "$KNOWLEDGE_DIR/CHANGELOG.md" ]; then
    LAST_CHANGELOG=$(grep -m1 "^## " "$KNOWLEDGE_DIR/CHANGELOG.md" 2>/dev/null)
fi

# --- Changed files since last sync (git or file-based) ---
CHANGES=""
if [ "$IS_GIT_REPO" = "true" ]; then
    if [ -f "$MARKER" ]; then
        if [ "$(uname)" = "Darwin" ]; then
            MARKER_DATE=$(date -r "$(stat -f %m "$MARKER" 2>/dev/null)" +"%Y-%m-%d %H:%M" 2>/dev/null || echo "8 hours ago")
        else
            MARKER_DATE=$(date -r "$MARKER" +"%Y-%m-%d %H:%M" 2>/dev/null || echo "8 hours ago")
        fi
        CHANGES=$(cd "$CWD" && git log --since="$MARKER_DATE" --oneline --no-merges 2>/dev/null | head -15)
    else
        CHANGES=$(cd "$CWD" && git log --since="8 hours ago" --oneline --no-merges 2>/dev/null | head -15)
    fi
    if [ -n "$CHANGES" ]; then
        COMMIT_COUNT=$(echo "$CHANGES" | wc -l | tr -d ' ')
        DIFF_STAT=$(cd "$CWD" && git diff --stat HEAD~${COMMIT_COUNT}..HEAD 2>/dev/null | tail -5)
        CHANGES="GIT COMMITS:\n$CHANGES\n\nDIFF STAT:\n$DIFF_STAT"
    else
        # No commits but maybe unstaged changes
        UNSTAGED=$(cd "$CWD" && git diff --name-only 2>/dev/null | head -10)
        STAGED=$(cd "$CWD" && git diff --cached --name-only 2>/dev/null | head -10)
        if [ -n "$UNSTAGED" ] || [ -n "$STAGED" ]; then
            CHANGES="UNCOMMITTED CHANGES:\n$UNSTAGED\n$STAGED"
        fi
    fi
else
    # Non-git: list recently modified files
    if [ -f "$MARKER" ]; then
        CHANGES=$(find "$CWD" -maxdepth 2 -newer "$MARKER" -type f \
            -not -path '*/\.*' -not -path '*/__pycache__/*' -not -name '*.pyc' \
            -not -path '*/node_modules/*' -not -path '*/knowledge/*' \
            \( -name '*.py' -o -name '*.md' -o -name '*.json' -o -name '*.sh' \
               -o -name '*.ts' -o -name '*.yaml' -o -name '*.toml' \) \
            2>/dev/null | head -20 | sed "s|$CWD/||g")
    fi
    if [ -n "$CHANGES" ]; then
        CHANGES="GEAENDERTE DATEIEN (seit letztem Sync):\n$CHANGES"
    fi
fi

# --- No changes detected → just touch marker and skip ---
if [ -z "$CHANGES" ]; then
    logf "Exit: no changes detected"
    touch "$MARKER"
    exit 0
fi

logf "Changes detected, filtering..."

# 5b. Filter: skip sync-only commits
if echo "$CHANGES" | grep -q "^GIT COMMITS:"; then
    COMMIT_LINES=$(echo -e "$CHANGES" | sed -n '/^GIT COMMITS:/,/^$/p' | grep -v "^GIT COMMITS:" | grep -v "^$" | head -10)
    REAL_COMMITS=$(echo "$COMMIT_LINES" | grep -v '^[a-f0-9]* sync ' | grep -v '^[a-f0-9]* Sync ')
    if [ -z "$REAL_COMMITS" ]; then
        logf "Exit: only sync commits, skipping"
        touch "$MARKER"
        exit 0
    fi
fi

# Filter: skip if only knowledge/ and logs/ files uncommitted
if echo "$CHANGES" | grep -q "^UNCOMMITTED CHANGES:"; then
    REAL_CHANGES=$(echo -e "$CHANGES" | grep -v "^UNCOMMITTED CHANGES:" | grep -v "^knowledge/" | grep -v "^logs/" | grep -v "^$")
    if [ -z "$REAL_CHANGES" ]; then
        logf "Exit: only auto-generated files uncommitted, skipping"
        touch "$MARKER"
        exit 0
    fi
fi

# 5d. Active-Task-Detection — Routing-Target fuer den Session-Eintrag
# Reihenfolge: TaskNotes (skripte/tasknotes_cli.py) -> Daily-Note -> Projekt-CHANGELOG
ACTIVE_TARGET=""
ACTIVE_KIND=""
ACTIVE_PROJECT_PATH=""
ACTIVE_PROJECT_NAME=""
OVERVIEW_FILE=""

# TaskNotes via skripte/tasknotes_cli.py (vault-wide, einziges Task-System)
TASKNOTES_CLI="$VAULT_PATH/skripte/tasknotes_cli.py"
if [ -f "$TASKNOTES_CLI" ] && command -v uv >/dev/null 2>&1; then
    TN_JSON=$(uv run python3 "$TASKNOTES_CLI" --vault "$VAULT_PATH" list --status in-progress --format json 2>/dev/null)
    if [ -n "$TN_JSON" ]; then
        # Nimm ersten in-progress Task (zukuenftig: Sortierung nach dateModified — heute first-match)
        TN_PATH=$(echo "$TN_JSON" | jq -r '.tasks[0].path // empty' 2>/dev/null)
        if [ -n "$TN_PATH" ]; then
            case "$TN_PATH" in
                /*) ACTIVE_TARGET="$TN_PATH" ;;
                *)  ACTIVE_TARGET="$VAULT_PATH/$TN_PATH" ;;
            esac
            if [ -f "$ACTIVE_TARGET" ]; then
                ACTIVE_KIND="tasknotes"
                ACTIVE_PROJECT_PATH=$(echo "$TN_JSON" | jq -r '.tasks[0].project.path // empty' 2>/dev/null)
                ACTIVE_PROJECT_NAME=$(echo "$TN_JSON" | jq -r '.tasks[0].project.name // empty' 2>/dev/null)
                if [ -n "$ACTIVE_PROJECT_PATH" ] && [ -n "$ACTIVE_PROJECT_NAME" ]; then
                    OVERVIEW_FILE="$VAULT_PATH/$ACTIVE_PROJECT_PATH/$ACTIVE_PROJECT_NAME Übersicht.md"
                    [ ! -f "$OVERVIEW_FILE" ] && OVERVIEW_FILE=""
                fi
            else
                ACTIVE_TARGET=""
            fi
        fi
    fi
fi

# Daily-Note Fallback
if [ -z "$ACTIVE_TARGET" ]; then
    TODAY=$(date +%Y-%m-%d)
    for daily_path in \
        "$VAULT_PATH/Calendar/Daily/$TODAY.md" \
        "$VAULT_PATH/Calendar/Daily/$(date +%Y)/$(date +%Y-%m)/$TODAY.md" \
        "$VAULT_PATH/Calendar/Daily/$(date +%Y-%m)/$TODAY.md" ; do
        if [ -f "$daily_path" ]; then
            ACTIVE_TARGET="$daily_path"
            ACTIVE_KIND="daily"
            break
        fi
    done
fi

# Letzter Fallback: Projekt-CHANGELOG (knowledge/CHANGELOG.md)
if [ -z "$ACTIVE_TARGET" ]; then
    ACTIVE_TARGET="$KNOWLEDGE_DIR/CHANGELOG.md"
    ACTIVE_KIND="project_changelog"
fi

# 5e. Backlog.md repo-task detection (repo-seitig, ergänzt den Vault-Eintrag aus §1)
BACKLOG_INPROGRESS=""
if [ -d "$CWD/backlog/tasks" ] && command -v backlog >/dev/null 2>&1; then
    BACKLOG_INPROGRESS=$(cd "$CWD" && backlog task list -s "In Progress" --plain 2>/dev/null | head -8)
fi

logf "ACTIVE_TARGET: $ACTIVE_TARGET"
logf "BACKLOG_INPROGRESS: ${BACKLOG_INPROGRESS:-none}"
logf "ACTIVE_KIND: $ACTIVE_KIND"
logf "OVERVIEW_FILE: $OVERVIEW_FILE"

# 6. Touch marker and hand off to inline Claude via decision: block
touch "$MARKER"
logf "Handing off to inline Claude for CHANGELOG + lessons/decisions..."

TIMESTAMP=$(date +"%Y-%m-%d %H:%M")
CHANGES_TEXT=$(echo -e "$CHANGES")

# Relative paths (kürzer im Hook-Output)
ACTIVE_REL="${ACTIVE_TARGET#$VAULT_PATH/}"
OVERVIEW_REL="${OVERVIEW_FILE#$VAULT_PATH/}"
PROTOCOL_REL="$VAULT_PATH/.claude/PKM_SYNC_PROTOCOL.md"  # absolut: liegt im Vault, nicht im Projekt-CWD

# Git-conditional Tag + Commit-Anweisung
# CCS-008: NIE auto-push. Commit nur lokal (auf User-Signal). Push = manuell nach Review.
if [ "$IS_GIT_REPO" = "true" ]; then
    GIT_TAG="git"
    GIT_LINE="Git: NUR auf explizites User-Signal lokal add/commit (KEIN push — Push macht der Mensch nach Review). Bei Konflikt siehe Protocol §5 · Antwort: 'OK' + SHA. Submodul-Pointer vor manuellem Push prüfen (submodule_push_guard)."
else
    GIT_TAG="no-git"
    GIT_LINE="Git: CWD kein Repo — kein Commit. Antwort: 'OK'."
fi

# Section-Hint per ACTIVE_KIND (was zu tun ist, ohne Format-Beispiel)
case "$ACTIVE_KIND" in
    tasknotes)  SECTION_HINT="Append ## Task-Changelog (Protocol §1). cc_last_event_at setzen falls cc_workflow:true." ;;
    daily)      SECTION_HINT="Append ## Sessions in Daily-Note (Protocol §1, daily-Variante). Kein Resume State." ;;
    *)          SECTION_HINT="Append nach Titel in $ACTIVE_REL. Kein Resume State." ;;
esac

# Overview-Hint nur wenn vorhanden
OVERVIEW_LINE=""
if [ -n "$OVERVIEW_REL" ]; then
    OVERVIEW_LINE="Project-Overview: $OVERVIEW_REL"
fi

# Backlog-Task-Doku (Repo) — nur wenn In-Progress-Tasks vorhanden; schiebt Git auf Task 5
if [ -n "$BACKLOG_INPROGRESS" ]; then
    BACKLOG_TASK="4. Backlog-Task-Doku (Repo, Protocol §6) — pro In-Progress-Task: Implementation Notes anhängen (was diese Session getan wurde), nächste Schritte sichern (--plan / --check-ac) + Referenzen verknüpfen (--ref Plan/Spec, --doc). NIE status=Done. NIE Refs erfinden. Nichts Substanzielles → Task skip.
   In-Progress:
$BACKLOG_INPROGRESS
"
    GIT_TASK_NUM=5
else
    BACKLOG_TASK=""
    GIT_TASK_NUM=4
fi

REASON="PKM-SYNC ($GIT_TAG) · $TIMESTAMP · $PKM_PROJECT
Active ($ACTIVE_KIND): $ACTIVE_REL
$OVERVIEW_LINE
Protocol: $PROTOCOL_REL

Changes:
$CHANGES_TEXT

Tasks:
1. Session-Eintrag: $SECTION_HINT — max 3 Zeilen / 300 chars.
2. Resume State: NUR bei echtem Re-entry-Punkt — sonst SKIP (Protocol §2).
3. Lessons/Decisions: NUR bei NEUER Erkenntnis — Scope-Routing per Protocol §3-4.
${BACKLOG_TASK}${GIT_TASK_NUM}. $GIT_LINE"

# Use jq for safe JSON encoding of the reason string
echo "{\"decision\":\"block\",\"reason\":$(echo "$REASON" | jq -Rs .)}"
