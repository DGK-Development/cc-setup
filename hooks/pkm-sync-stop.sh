#!/bin/bash
# pkm-sync-stop.sh — Stop-Hook: verlangt Backlog-Task-Doku bei In-Progress-Tasks.
# Feuert NUR wenn: (a) backlog/tasks existiert, (b) backlog-CLI vorhanden,
# (c) In-Progress-Tasks vorhanden, (d) echte Änderungen seit letztem Sync.
# Sonst: Marker touchen, exit 0, kein Output, kein decision:block.
#
# CCS-008 (vendored via cc-setup): KEIN Auto-Push. Commit nur lokal auf explizites
# User-Signal. Push ist immer manueller Schritt nach Review (Human-Oversight-Pflicht).

INPUT=$(cat)

# Orchestrated headless worker: skip decision:block.
if [ "${CC_ORCHESTRATED:-}" = "1" ]; then exit 0; fi

# Parse fields
STOP_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
CWD=$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
[ -z "$CWD" ] && CWD="$(pwd)"

# 1. Infinite-Loop-Schutz
if [ "$STOP_ACTIVE" = "true" ]; then
    exit 0
fi

# Log setup
LOG_FILE="$CWD/logs/hook-stop.log"
mkdir -p "$CWD/logs" 2>/dev/null
: > "$LOG_FILE"
logf() { echo "$@" >> "$LOG_FILE"; }

logf "=== STOP HOOK $(date '+%Y-%m-%d %H:%M:%S') ==="
logf "CWD: $CWD"

MARKER="$CWD/logs/.pkm-last-sync"

# 2. Gate (a): backlog/tasks vorhanden?
if [ ! -d "$CWD/backlog/tasks" ]; then
    logf "Exit: no backlog/tasks dir"
    touch "$MARKER"
    exit 0
fi

# 3. Gate (b): backlog CLI vorhanden?
if ! command -v backlog >/dev/null 2>&1; then
    logf "Exit: backlog CLI not found"
    touch "$MARKER"
    exit 0
fi

# 4. Gate (c): In-Progress-Tasks vorhanden? (CLI-Header strippen, REASON setzt eigenen)
BACKLOG_INPROGRESS=$(cd "$CWD" && backlog task list -s "In Progress" --plain 2>/dev/null | grep -v '^In Progress:' | head -8)
if [ -z "$BACKLOG_INPROGRESS" ]; then
    logf "Exit: no In-Progress backlog tasks"
    touch "$MARKER"
    exit 0
fi

# 5. Debounce (15 min)
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

# 6. Gate (d): echte Änderungen seit letztem Sync?
# Nur Git-Pfad. Kein Git-Repo → exit 0 (Backlog-Repos sind Git-Repos).
if ! git -C "$CWD" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    logf "Exit: not a git repo"
    touch "$MARKER"
    exit 0
fi

CHANGES=""
if [ -f "$MARKER" ]; then
    if [ "$(uname)" = "Darwin" ]; then
        MARKER_DATE=$(date -r "$(stat -f %m "$MARKER" 2>/dev/null)" +"%Y-%m-%d %H:%M" 2>/dev/null || echo "8 hours ago")
    else
        MARKER_DATE=$(date -r "$MARKER" +"%Y-%m-%d %H:%M" 2>/dev/null || echo "8 hours ago")
    fi
    CHANGES=$(cd "$CWD" && git log --since="$MARKER_DATE" --oneline --no-merges 2>/dev/null | head -10)
else
    CHANGES=$(cd "$CWD" && git log --since="8 hours ago" --oneline --no-merges 2>/dev/null | head -10)
fi

# Filter: sync-only commits ignorieren
if [ -n "$CHANGES" ]; then
    REAL_COMMITS=$(echo "$CHANGES" | grep -v '^[a-f0-9]* [Ss]ync ')
    if [ -z "$REAL_COMMITS" ]; then
        logf "Exit: only sync commits"
        touch "$MARKER"
        exit 0
    fi
    CHANGES="$REAL_COMMITS"
else
    # Keine Commits → uncommitted changes prüfen
    UNSTAGED=$(cd "$CWD" && git diff --name-only 2>/dev/null | head -10)
    STAGED=$(cd "$CWD" && git diff --cached --name-only 2>/dev/null | head -10)
    if [ -n "$UNSTAGED" ] || [ -n "$STAGED" ]; then
        # Nur Nicht-Auto-Dateien
        REAL_CHANGES=$(printf '%s\n%s' "$UNSTAGED" "$STAGED" | grep -v "^knowledge/" | grep -v "^logs/" | grep -v "^$")
        if [ -z "$REAL_CHANGES" ]; then
            logf "Exit: only auto-generated files uncommitted"
            touch "$MARKER"
            exit 0
        fi
        CHANGES="$REAL_CHANGES"
    fi
fi

if [ -z "$CHANGES" ]; then
    logf "Exit: no real changes detected"
    touch "$MARKER"
    exit 0
fi

logf "Changes + In-Progress tasks detected, handing off to Claude..."
logf "BACKLOG_INPROGRESS: $BACKLOG_INPROGRESS"

# 7. Marker setzen + decision:block ausgeben
touch "$MARKER"

TIMESTAMP=$(date +"%Y-%m-%d %H:%M")
BASENAME=$(basename "$CWD")

REASON="PKM-SYNC · $TIMESTAMP · $BASENAME
In Progress:
$BACKLOG_INPROGRESS

Doku: pro Task mit Session-Arbeit kurze Implementation Notes (2-3 Sätze, --append-notes), Plan/AC nachziehen. NIE Done, NIE Refs erfinden, sonst skip. Git: kein add/commit/push ohne User-Signal. Antwort: 'OK'."

echo "{\"decision\":\"block\",\"reason\":$(echo "$REASON" | jq -Rs .)}"
