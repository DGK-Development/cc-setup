#!/usr/bin/env bash
# prompt-sync.sh — ask whether to refresh templates/ from Vault/Cursor before bundle
set -euo pipefail

NONINTERACTIVE="${CC_SETUP_NONINTERACTIVE:-0}"
FORCE_SYNC="${CC_SETUP_SYNC:-}"  # 1 = always, 0 = never

VAULT="${OBSIDIANPKM_ROOT:-$HOME/GITHUB/ObsidianPKM}"
CURSOR_SKILLS="${CURSOR_SKILLS:-$HOME/.cursor/skills}"

sources_available() {
  [[ -d "$VAULT/.claude/agents" ]] || [[ -d "$VAULT/.claude/skills" ]] || \
    [[ -d "$CURSOR_SKILLS/session-init" ]]
}

if [[ "$FORCE_SYNC" == "0" ]]; then
  echo "Sync: übersprungen (CC_SETUP_SYNC=0) — nutze templates/ aus dem Repo"
  exit 1
fi

if [[ "$FORCE_SYNC" == "1" ]]; then
  echo "Sync: erzwungen (CC_SETUP_SYNC=1)"
  exit 0
fi

if [[ "$NONINTERACTIVE" == "1" ]] || [[ ! -t 0 ]]; then
  echo "Sync: übersprungen (non-interactive) — nutze templates/ aus dem Repo"
  echo "  Erzwingen: CC_SETUP_SYNC=1 just install"
  exit 1
fi

if ! sources_available; then
  echo "Sync: keine Quellen (Vault/Cursor) — nutze templates/ aus dem Repo"
  exit 1
fi

echo ""
echo "Quellen verfügbar:"
[[ -d "$VAULT/.claude/agents" ]] && echo "  • $VAULT/.claude/agents/"
[[ -d "$VAULT/.claude/skills" ]] && echo "  • $VAULT/.claude/skills/ (tier 1)"
[[ -d "$CURSOR_SKILLS" ]] && echo "  • $CURSOR_SKILLS/ (session-init, …)"
echo ""
echo "Sync überschreibt templates/ im cc-setup-Repo (nicht ~/.claude/skills)."
printf "Jetzt synchronisieren? [Y/n] "
read -r ans || ans=y
if [[ "$ans" =~ ^[nN]([oO])?$ ]]; then
  echo "Sync übersprungen — bundle nutzt committed templates/"
  exit 1
fi
echo "Sync: ja"
exit 0
