#!/usr/bin/env bash
# userprompt-context-match.sh — UserPromptSubmit hook (plugin port)
#
# Trigger /context-load on the FIRST user prompt of a session. Subsequent
# prompts pass through silently (marker file per session).
#
# Input (stdin JSON): { session_id, transcript_path, cwd, prompt }
# Output: first prompt -> additionalContext instructing /context-load (Backlog-
#         zentriert: Backlog-Tasks/Milestones primär, Vault-TaskNotes nur on-demand);
#         else silent.
#
# Plugin-portable changes:
#   - PLUGIN_ROOT derived from script location.
#   - sha256sum fallback when shasum (macOS) is absent (Linux).
#   - Skill reference uses the namespaced plugin skill + bundled scripts.

set -u

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../scripts/lib.sh
source "$PLUGIN_ROOT/scripts/lib.sh"
VAULT_PATH="$(resolve_vault)"

INPUT=$(cat)

# jq is required to parse the hook payload; degrade silently if missing.
if ! command -v jq >/dev/null 2>&1; then
    exit 0
fi

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)

# Fall back to transcript_path hash if no session_id
if [ -z "$SESSION_ID" ]; then
    TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
    if [ -n "$TRANSCRIPT" ]; then
        if command -v shasum >/dev/null 2>&1; then
            SESSION_ID=$(echo -n "$TRANSCRIPT" | shasum -a 256 | cut -c1-12)
        elif command -v sha256sum >/dev/null 2>&1; then
            SESSION_ID=$(echo -n "$TRANSCRIPT" | sha256sum | cut -c1-12)
        fi
    fi
fi

[ -z "$SESSION_ID" ] && exit 0

MARKER="${TMPDIR:-/tmp}/claude-context-match.${SESSION_ID}.marker"

# Already triggered this session → silent
[ -f "$MARKER" ] && exit 0
touch "$MARKER"

# Skip trivially short prompts
PROMPT_LEN=${#PROMPT}
if [ "$PROMPT_LEN" -lt 10 ]; then
    exit 0
fi

INSTRUCTION="<context-load-trigger>
First user prompt of this session detected. Before responding to the user, invoke the /project-context:context-load skill with the user's prompt as input. Backlog.md-Tasks/Milestones im CWD-Repo sind die PRIMÄRE Arbeits-Quelle. The skill will:
1. Backlog-Sprint (AUTO, primär): repo-lokalen Sprint-Stand via sprint_bridge laden — offene Milestones (name, done/total, offene Subtask-IDs), In-Progress-Tasks und empfohlene nächste To-Dos. Diese als aktiven Arbeitskontext führen.
2. qmd-Wiki-Suche gegen den Prompt (verwandtes Wissen) und ggf. Repo-qmd (Repo-Kontext).
3. Bei echtem Einstieg ohne klaren Bezug: User fragen (welcher Backlog-Task / Milestone-Task weitermachen).
4. Suggested-Skills aus dem geladenen Backlog-Task/Resume-State invoken, wenn passend.

Vault-TaskNotes werden NICHT automatisch geladen. Nur bei EXPLIZITER TaskNote-/Vault-Anfrage (z.B. 'tn next', konkrete TaskNote-ID, 'aktive TaskNotes', Vault-Projekt) den on-demand TaskNote-Match (context-load Layer 1) ziehen.

User prompt for the match:
$PROMPT

Skill: /project-context:context-load (plugin)
Plugin root: $PLUGIN_ROOT
Vault: $VAULT_PATH (TaskNote-Layer ist no-op wenn dieser Pfad nicht existiert; nur on-demand)
sprint_bridge: $PLUGIN_ROOT/scripts/sprint_bridge.py (read-only)

WICHTIG: redactor strict mode ist aktiv — jeder Bash-Call MUSS mit 'redactor wrap --' prefixed werden. Der Skill enthaelt die korrekten Befehle bereits inkl. Wrapper; nutze sie 1:1.

After context-load completes, then respond to the user's actual prompt with the loaded context in mind.
</context-load-trigger>"

jq -n --arg ctx "$INSTRUCTION" '{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": $ctx
  }
}'

exit 0
