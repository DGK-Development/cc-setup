#!/usr/bin/env bash
# sync-from-sources.sh — refresh templates/ from ObsidianPKM agents + core skills
# Part of `just install` step 1. Safe to skip sections when sources are missing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib-sync.sh
source "$ROOT/scripts/lib-sync.sh"

VAULT="${OBSIDIANPKM_ROOT:-$HOME/GITHUB/ObsidianPKM}"
CURSOR_SKILLS="${CURSOR_SKILLS:-$HOME/.cursor/skills}"

warn() { echo "  ⚠ $*" >&2; }

if [[ -d "$VAULT/.claude/agents" ]]; then
  echo "  ObsidianPKM agents: $VAULT/.claude/agents → templates/agents/"
  mkdir -p "$ROOT/templates/agents"
  for f in "$VAULT/.claude/agents"/*.md; do
    [[ -f "$f" ]] || continue
    cp -f "$f" "$ROOT/templates/agents/$(basename "$f")"
  done
else
  warn "Vault agents nicht gefunden ($VAULT) — nutze committed templates/agents/"
fi

if [[ -d "$VAULT/.claude/skills" ]]; then
  echo "  Vault skills (tier 1):"
  VAULT_SKILLS=(review qmd recall opensrc check-links daily-review)
  for name in "${VAULT_SKILLS[@]}"; do
    src="$VAULT/.claude/skills/$name"
    if [[ -d "$src" ]]; then
      sync_dir "$src" "$ROOT/templates/skills/$name" 1
      echo "    ✓ $name"
    else
      echo "    − $name (skip)"
    fi
  done
else
  warn "Vault skills nicht gefunden — nutze committed templates/skills/"
fi

if [[ -d "$CURSOR_SKILLS" ]]; then
  echo "  Cursor skills (session):"
  for name in session-init session-stop knowledge; do
    src="$CURSOR_SKILLS/$name"
    if [[ -d "$src" ]]; then
      sync_dir "$src" "$ROOT/templates/skills/$name" 1
      echo "    ✓ $name"
    else
      echo "    − $name (skip)"
    fi
  done
else
  warn "Cursor skills nicht unter $CURSOR_SKILLS — skip session-init/stop/knowledge"
fi

echo "  fertig (Templates aktualisiert oder committed Stand beibehalten)"
