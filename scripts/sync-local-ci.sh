#!/usr/bin/env bash
# sync-local-ci.sh — refresh vendored local-ci from ~/.claude/skills/local-ci (if present)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib-sync.sh
source "$ROOT/scripts/lib-sync.sh"

SRC="${LOCAL_CI_SRC:-$HOME/.claude/skills/local-ci}"
DEST="$ROOT/skills/local-ci"

if [[ ! -d "$SRC" ]]; then
  echo "  local-ci upstream fehlt ($SRC) — behalte skills/local-ci"
  exit 0
fi

sync_dir "$SRC" "$DEST" 1
echo "  local-ci: $SRC → skills/local-ci"
