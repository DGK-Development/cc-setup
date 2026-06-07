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
  show       <id>
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
    # Returns the first actionable task in order.
    # Priority: "To Do" first (MODE=TODO); falls back to "In Progress" (MODE=RESUME).
    # If CC_ORCH_MILESTONE is set, filters to that milestone only.
    # Output format (one line, machine-readable):
    #   <ID>\t<title>\t<MODE>
    # where MODE is either TODO or RESUME.

    # Helper: fetch first leaf task for a given status; prints "<id>\t<title>" or nothing.
    # Returns 0 if found, 1 if not found (never exits the script on "no tasks").
    _pick_first_for_status() {
        local status="$1"
        local plain
        if [[ -n "${CC_ORCH_MILESTONE:-}" ]]; then
            plain=$(backlog task list -s "$status" -m "$CC_ORCH_MILESTONE" --plain 2>/dev/null) || return 1
        else
            plain=$(backlog task list -s "$status" --plain 2>/dev/null) || return 1
        fi

        local found_id found_title
        while IFS= read -r line; do
            local stripped
            stripped=$(echo "$line" | sed 's/^[[:space:]]*//' | sed 's/^\[[A-Z]*\][[:space:]]*//')
            if [[ "$stripped" =~ ^([A-Za-z][A-Za-z0-9._-]+-[0-9.]+)[[:space:]]+-[[:space:]]+(.+)$ ]]; then
                local cand_id="${BASH_REMATCH[1]}"
                local cand_title="${BASH_REMATCH[2]}"
                if [[ "$cand_title" == \[Meilenstein\]* ]]; then
                    continue
                fi
                found_id="$cand_id"
                found_title="$cand_title"
                break
            fi
        done <<< "$plain"

        if [[ -z "${found_id:-}" ]]; then
            return 1
        fi
        printf '%s\t%s' "$found_id" "$found_title"
        return 0
    }

    # 1. Try "To Do" first.
    local todo_result
    if todo_result=$(_pick_first_for_status "To Do"); then
        local id title
        id=$(printf '%s' "$todo_result" | cut -f1)
        title=$(printf '%s' "$todo_result" | cut -f2-)
        printf '%s\t%s\t%s\n' "$id" "$title" "TODO"
        return 0
    fi

    # 2. Fall back to "In Progress" (RESUME).
    local inprog_result
    if inprog_result=$(_pick_first_for_status "In Progress"); then
        local id title
        id=$(printf '%s' "$inprog_result" | cut -f1)
        title=$(printf '%s' "$inprog_result" | cut -f2-)
        printf '%s\t%s\t%s\n' "$id" "$title" "RESUME"
        return 0
    fi

    # 3. Neither found — report and fail.
    if [[ -n "${CC_ORCH_MILESTONE:-}" ]]; then
        echo "cc-backlog: no 'To Do' or 'In Progress' tasks in milestone ${CC_ORCH_MILESTONE}." >&2
    else
        echo "cc-backlog: no 'To Do' or 'In Progress' tasks found." >&2
    fi
    exit 1
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

cmd_show() {
    # Read-only: gibt die Task-Details (--plain) aus. Genutzt vom Orchestrator,
    # um die Beschreibung des naechsten Tasks fuer das NEXT-Gate zu holen.
    require_args "show" 1 "$#"
    backlog task "$1" --plain
}

cmd_mslist() {
    # Read-only: Task-Liste eines Milestones (--plain), nach Status gruppiert.
    # Genutzt vom Orchestrator fuer die Fortschritts-Anzeige (Statusline + Widget).
    require_args "mslist" 1 "$#"
    backlog task list -m "$1" --plain
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
    show)           cmd_show "$@" ;;
    mslist)         cmd_mslist "$@" ;;
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
