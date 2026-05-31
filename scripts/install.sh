#!/usr/bin/env bash
# install.sh — full install: optional sync → bundle → ~/.claude/skills → optional vault setup
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export CC_SETUP_NONINTERACTIVE="${CC_SETUP_NONINTERACTIVE:-0}"

cd "$ROOT"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  cc-setup install                                            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

echo "▶ Schritt 1/4 — Quellen synchronisieren? (optional)"
echo "  Würde Agenten/Skills aus ObsidianPKM + Cursor nach templates/ kopieren."
echo ""

if bash "$ROOT/scripts/prompt-sync.sh"; then
  bash "$ROOT/scripts/sync-from-sources.sh"
  if [[ -d "${LOCAL_CI_SRC:-$HOME/.claude/skills/local-ci}" ]]; then
    bash "$ROOT/scripts/sync-local-ci.sh" || true
    bash "$ROOT/scripts/patch-local-ci-paths.sh" || true
  fi
else
  echo "  → templates/ unverändert (committed Stand im Repo)"
fi
echo ""

echo "▶ Schritt 2/4 — Bundle bauen (submodules + dist/cc-setup/)"
bash "$ROOT/scripts/bundle.sh"
echo ""

echo "▶ Schritt 3/4 — Claude Home installieren (global, alle Projekte)"
echo "  Ziel: ~/.claude/skills/cc-setup/  (+ ~/.claude/skills/local-ci/)"
bash "$ROOT/scripts/install-to-claude-home.sh"
echo ""

echo "▶ Schritt 4/4 — Vault / Dependencies"
bash "$ROOT/scripts/prompt-vault-setup.sh"
