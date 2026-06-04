#!/usr/bin/env bash
# userprompt-context-match.sh — UserPromptSubmit hook (plugin port)
#
# Trigger /context-load on the FIRST user prompt of a session. Subsequent
# prompts pass through silently (marker file per session).
#
# Input (stdin JSON): { session_id, transcript_path, cwd, prompt }
# Output: first prompt -> additionalContext instructing /context-load; else silent.
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
First user prompt of this session detected. Before responding to the user, invoke the /project-context:context-load skill with the user's prompt as input. This will:
1. Run a qmd-wiki search against the user's prompt
2. List active TaskNotes via the bundled tasknotes_cli.py
3. Score matches between prompt and active tasks
4. If clear match: load task with dependencies recursively (Question-Body voll, Task-Body voll, transitive Blocker)
5. If ambiguous: ask user via AskUserQuestion which task to load
6. If no match: ask user (Neuer Task / Freie Session / Anderes Projekt)
7. If blocker present: ask user (Blocker loesen / Haupt-Task forcen)
8. Auto-invoke any Suggested-Skills from the loaded task's Resume State block

User prompt for the match:
$PROMPT

Skill: /project-context:context-load (plugin)
Plugin root: $PLUGIN_ROOT
Vault: $VAULT_PATH (skill ist no-op wenn dieser Pfad nicht existiert)
TaskNotes CLI: $PLUGIN_ROOT/scripts/tasknotes_cli.py

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
