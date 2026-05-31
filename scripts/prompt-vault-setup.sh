#!/usr/bin/env bash
# prompt-vault-setup.sh — ask to run setup.sh when vault/deps not ready
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="$ROOT/dist/cc-setup"
SETUP="$PLUGIN/scripts/setup.sh"
NONINTERACTIVE="${CC_SETUP_NONINTERACTIVE:-0}"

detect_vault() {
  if [[ -n "${OBSIDIAN_VAULT_PATH:-}" && -d "${OBSIDIAN_VAULT_PATH}" ]]; then
    echo "${OBSIDIAN_VAULT_PATH}"
    return 0
  fi
  if [[ -n "${TASKNOTES_VAULT:-}" && -d "${TASKNOTES_VAULT}" ]]; then
    echo "${TASKNOTES_VAULT}"
    return 0
  fi
  local c
  for c in \
    "${OBSIDIANPKM_ROOT:-}" \
    "$HOME/GITHUB/ObsidianPKM" \
    "$HOME/git/ObsidianPKM" \
    "$HOME/GITHUB/ObsidianPKM"; do
    [[ -n "$c" && -d "$c/Efforts" ]] || continue
    echo "$c"
    return 0
  done
  return 1
}

env_configured() {
  local f
  for f in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
    [[ -f "$f" ]] || continue
    if grep -qE 'OBSIDIAN_VAULT_PATH|TASKNOTES_VAULT' "$f" 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

deps_ok() {
  [[ -x "$SETUP" ]] || return 1
  bash "$SETUP" --check >/dev/null 2>&1
}

vault="$(detect_vault || true)"

if [[ -n "$vault" ]] && deps_ok && env_configured; then
  echo "Vault: bereit ($vault, Dependencies OK, Env gesetzt)"
  exit 0
fi

if [[ -n "$vault" ]] && deps_ok; then
  echo "Vault: $vault — Dependencies OK, Env evtl. erst nach Shell-Neustart aktiv"
  exit 0
fi

if [[ "$NONINTERACTIVE" == "1" ]] || [[ ! -t 0 ]]; then
  echo ""
  echo "Vault-Setup übersprungen (non-interactive)."
  [[ -n "$vault" ]] && echo "  Vault erkannt: $vault"
  echo "  Später: bash $SETUP --vault <pfad>"
  exit 0
fi

default_vault="${vault:-$HOME/GITHUB/ObsidianPKM}"
echo ""
if [[ -n "$vault" ]]; then
  echo "Vault gefunden: $vault"
  echo "Dependencies (uv/jq/qmd/redactor) fehlen noch oder Setup wurde nicht ausgeführt."
else
  echo "Kein ObsidianPKM-Vault erkannt unter üblichen Pfaden."
fi
echo ""
printf "Vault-Dependencies einrichten (setup.sh: uv, jq, qmd, Env)? [y/N] "
read -r ans || ans=n
if [[ ! "$ans" =~ ^[yY]([eE][sS])?$ ]]; then
  echo "Übersprungen. Später: just install-vault  oder  bash $SETUP --vault <pfad>"
  exit 0
fi

printf "Vault-Pfad [%s]: " "$default_vault"
read -r vault_input || true
vault_input="${vault_input:-$default_vault}"

if [[ ! -d "$vault_input" ]]; then
  echo "Pfad existiert nicht: $vault_input" >&2
  exit 1
fi

[[ -x "$SETUP" ]] || { echo "setup.sh fehlt — zuerst just install (bundle) ausführen" >&2; exit 1; }
bash "$SETUP" --vault "$vault_input"
echo ""
echo "Vault-Setup fertig. Neue Shell öffnen oder: source ~/.zshrc"
