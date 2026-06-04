#!/usr/bin/env bash
# nightly-reindex.sh — re-index + re-embed all qmd collections.
# Intended for a cron job / systemd timer (replaces the macOS launchd job).
#
#   crontab:   0 1 * * *  /path/to/plugin/scripts/nightly-reindex.sh >> ~/.cache/qmd-nightly.log 2>&1
#   systemd:   see README "Nightly Re-Index"

set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$PLUGIN_ROOT/scripts/qmd-ensure.sh" --all
