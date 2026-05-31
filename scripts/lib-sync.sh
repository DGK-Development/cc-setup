#!/usr/bin/env bash
# lib-sync.sh — cross-platform directory sync (macOS, Linux, Git Bash/WSL on Windows)
# shellcheck shell=bash
sync_dir() {
  local src="$1"
  local dest="$2"
  local delete="${3:-1}"

  [[ -d "$src" ]] || { echo "sync_dir: missing source $src" >&2; return 1; }
  mkdir -p "$dest"

  if command -v rsync >/dev/null 2>&1; then
    if [[ "$delete" == "1" ]]; then
      rsync -a --delete "${src%/}/" "${dest%/}/"
    else
      rsync -a "${src%/}/" "${dest%/}/"
    fi
    return 0
  fi

  # Fallback: no rsync (typical minimal Windows without cwRsync)
  if [[ "$delete" == "1" && -d "$dest" ]]; then
    rm -rf "${dest:?}/"*
  fi
  mkdir -p "$dest"
  # cp -a works in Git Bash/WSL; macOS/Linux OK
  cp -a "${src}/." "$dest/"
}
