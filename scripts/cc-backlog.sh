#!/usr/bin/env bash
# cc-backlog.sh — thin backlog-CLI wrapper for the pi-orchestrator pipeline.
#
# All task mutations go EXCLUSIVELY through `backlog task edit` — no direct
# file edits.  Read path uses `backlog task list --plain`.
#
# Caller contract for text arguments (plan / notes / final-summary):
#   Pass text as a single shell argument.  The pi-orchestrator builds argv
#   arrays so quoting is handled there automatically.  Direct shell callers
#   must single-quote arguments that contain $, !, spaces, or other special
#   characters, e.g.:
#     cc-backlog.sh plan CCS-042 '1. Analyze\n2. Implement'
#
# Usage:
#   cc-backlog.sh next
#   cc-backlog.sh set        <id> <status>
#   cc-backlog.sh plan       <id> <text>
#   cc-backlog.sh notes      <id> <text>
#   cc-backlog.sh check-ac   <id> <idx> [<idx> ...]
#   cc-backlog.sh final-summary <id> <text>

set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

usage() {
    cat >&2 <<'EOF'
cc-backlog.sh — thin backlog-CLI wrapper for the pi-orchestrator pipeline.

All task mutations go EXCLUSIVELY through `backlog task edit` — no direct
file edits.  Read path uses `backlog task list --plain`.

Subcommands:
  next
  set        <id> <status>
  plan       <id> <text>
  notes      <id> <text>
  check-ac   <id> <idx> [<idx> ...]
  final-summary <id> <text>
EOF
    exit 1
}

require_args() {
    local cmd="$1" need="$2" got="$3"
    if [ "$got" -lt "$need" ]; then
        echo "cc-backlog: '$cmd' requires at least $need argument(s), got $got." >&2
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

cmd_next() {
    # Returns the first "To Do" task in order.
    # Output format (one line, machine-readable):
    #   <ID>\t<title>
    local plain
    plain=$(backlog task list -s "To Do" --plain 2>/dev/null) || {
        echo "cc-backlog: 'backlog task list' failed." >&2
        exit 1
    }

    # Parse lines of the form:
    #   "  [PRIO] ID - title"   or   "  ID - title"
    # (leading whitespace, optional [PRIORITY] prefix, then ID SP-DASH-SP title)
    # Milestone/container tasks (title starts with "[Meilenstein]") are skipped
    # so that `next` always returns an actionable leaf task.
    local first_id first_title
    while IFS= read -r line; do
        # Strip leading whitespace + optional priority tag [HIGH]/[MEDIUM]/etc.
        local stripped
        stripped=$(echo "$line" | sed 's/^[[:space:]]*//' | sed 's/^\[[A-Z]*\][[:space:]]*//')
        # Match "ID - title" where ID contains only word-chars, dots, hyphens
        if [[ "$stripped" =~ ^([A-Za-z][A-Za-z0-9._-]+-[0-9.]+)[[:space:]]+-[[:space:]]+(.+)$ ]]; then
            local cand_id="${BASH_REMATCH[1]}"
            local cand_title="${BASH_REMATCH[2]}"
            # Skip milestone/container parents
            if [[ "$cand_title" == \[Meilenstein\]* ]]; then
                continue
            fi
            first_id="$cand_id"
            first_title="$cand_title"
            break
        fi
    done <<< "$plain"

    if [ -z "${first_id:-}" ]; then
        echo "cc-backlog: no 'To Do' tasks found." >&2
        exit 1
    fi

    printf '%s\t%s\n' "$first_id" "$first_title"
}

cmd_set() {
    require_args "set" 2 "$#"
    local id="$1" status="$2"
    backlog task edit "$id" -s "$status"
}

cmd_plan() {
    require_args "plan" 2 "$#"
    local id="$1"
    shift
    local text="$*"
    [ -n "$text" ] || { echo "cc-backlog: 'plan' text argument must not be empty." >&2; exit 1; }
    backlog task edit "$id" --plan "$text"
}

cmd_notes() {
    require_args "notes" 2 "$#"
    local id="$1"
    shift
    local text="$*"
    [ -n "$text" ] || { echo "cc-backlog: 'notes' text argument must not be empty." >&2; exit 1; }
    backlog task edit "$id" --append-notes "$text"
}

cmd_check_ac() {
    require_args "check-ac" 2 "$#"
    local id="$1"
    shift
    # Build --check-ac flags for each index argument
    local args=()
    for idx in "$@"; do
        args+=(--check-ac "$idx")
    done
    backlog task edit "$id" "${args[@]}"
}

cmd_final_summary() {
    require_args "final-summary" 2 "$#"
    local id="$1"
    shift
    local text="$*"
    [ -n "$text" ] || { echo "cc-backlog: 'final-summary' text argument must not be empty." >&2; exit 1; }
    backlog task edit "$id" --final-summary "$text"
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

if [ $# -lt 1 ]; then
    usage
fi

SUBCOMMAND="$1"
shift

case "$SUBCOMMAND" in
    next)           cmd_next "$@" ;;
    set)            cmd_set "$@" ;;
    plan)           cmd_plan "$@" ;;
    notes)          cmd_notes "$@" ;;
    check-ac)       cmd_check_ac "$@" ;;
    final-summary)  cmd_final_summary "$@" ;;
    *)
        echo "cc-backlog: unknown subcommand '$SUBCOMMAND'." >&2
        usage
        ;;
esac
