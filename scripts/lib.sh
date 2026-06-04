#!/usr/bin/env bash
# lib.sh — shared helpers for the project-context plugin hooks/scripts.
#
# Source this, don't execute it:
#   source "$(dirname "$0")/../scripts/lib.sh"
#
# Provides:
#   resolve_vault            -> echoes the resolved ObsidianPKM vault path
#   require_cmd <cmd> ...     -> returns 1 if any command is missing (logs to stderr)

# Resolve the vault root. Precedence:
#   1. $OBSIDIAN_VAULT_PATH
#   2. $TASKNOTES_VAULT
#   3. ~/GITHUB/ObsidianPKM (home-relative default)
resolve_vault() {
  if [ -n "${OBSIDIAN_VAULT_PATH:-}" ]; then
    printf '%s\n' "$OBSIDIAN_VAULT_PATH"
  elif [ -n "${TASKNOTES_VAULT:-}" ]; then
    printf '%s\n' "$TASKNOTES_VAULT"
  else
    printf '%s\n' "$HOME/GITHUB/ObsidianPKM"
  fi
}

# require_cmd cmd1 cmd2 ... — returns non-zero and lists any missing commands.
require_cmd() {
  local missing=0 c
  for c in "$@"; do
    if ! command -v "$c" >/dev/null 2>&1; then
      echo "missing-cmd: $c" >&2
      missing=1
    fi
  done
  return $missing
}
