#!/usr/bin/env bash
# qmd-ensure.sh — Idempotent qmd collection bootstrap + freshness check.
#
# Usage (as library):
#   source scripts/qmd-ensure.sh
#   ensure_collection <name> <path> [stale_days]
#
# Usage (as script):
#   scripts/qmd-ensure.sh <name> <path> [stale_days]
#   scripts/qmd-ensure.sh --all              # nightly: re-index + embed all
#
# Behavior:
#   - Missing collection -> qmd collection add + qmd embed
#   - Stale (> stale_days) -> qmd update (incremental) + qmd embed
#   - Default stale_days: 7
#
# Plugin-portable: qmd is resolved from $QMD_BIN, else from PATH. No hardcoded
# Homebrew path — qmd ships as the npm package @tobilu/qmd and lands wherever
# the global npm/bun prefix puts it.

set -euo pipefail

# Resolve qmd: explicit override -> PATH lookup. Fail loud if absent.
QMD_BIN="${QMD_BIN:-$(command -v qmd 2>/dev/null || true)}"
if [ -z "$QMD_BIN" ]; then
  echo "qmd-ensure: 'qmd' not found in PATH and \$QMD_BIN unset." >&2
  echo "            Install with: npm install -g @tobilu/qmd" >&2
  exit 127
fi

ensure_collection() {
  local name="$1" path="$2" stale="${3:-7}"

  if [ ! -d "$path" ]; then
    echo "qmd-ensure: skip '$name' — path '$path' missing" >&2
    return 1
  fi

  local exists
  exists=$("$QMD_BIN" collection list 2>/dev/null | grep -cE "^${name} \(" || true)

  if [ "$exists" -eq 0 ]; then
    echo "qmd-ensure: collection '$name' missing — adding + embedding"
    "$QMD_BIN" collection add "$path" --name "$name"
    "$QMD_BIN" embed
    return
  fi

  # qmd collection list emits per-collection blocks with an "Updated:  Xd ago" line.
  # Extract the days for this collection's block via awk (state machine on header).
  local days
  days=$("$QMD_BIN" collection list 2>/dev/null \
    | awk -v n="$name" '
        $0 ~ "^"n" \\(" { in_block=1; next }
        in_block && /^[^ ]/ { in_block=0 }
        in_block && /Updated:/ {
          for (i=1; i<=NF; i++) if ($i ~ /^[0-9]+d$/) { gsub(/d/, "", $i); print $i; exit }
        }')
  days=${days:-0}

  if [ "$days" -gt "$stale" ]; then
    echo "qmd-ensure: '$name' is ${days}d old (> ${stale}d) — updating + embedding"
    "$QMD_BIN" update
    "$QMD_BIN" embed
  fi
}

update_all() {
  echo "qmd-ensure: nightly update of all collections"
  "$QMD_BIN" update
  "$QMD_BIN" embed
}

# CLI dispatch
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  case "${1:-}" in
    --all) update_all ;;
    "")    echo "usage: $0 <name> <path> [stale_days] | --all" >&2; exit 1 ;;
    *)     ensure_collection "$@" ;;
  esac
fi
