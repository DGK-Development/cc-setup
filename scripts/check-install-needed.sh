#!/usr/bin/env bash
# check-install-needed.sh — compare repo templates vs ~/.claude/skills/cc-setup
# Exit 0 = run install; 1 = already up to date; 2 = installed newer than repo
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib-version.sh
source "$ROOT/scripts/lib-version.sh"

SOURCE_PLUGIN="$ROOT/templates/.claude-plugin/plugin.json"
INSTALLED_PLUGIN="${CLAUDE_SKILLS:-$HOME/.claude/skills}/cc-setup/.claude-plugin/plugin.json"
FORCE="${CC_SETUP_FORCE:-0}"

if [[ "$FORCE" == "1" ]]; then
  echo "force: CC_SETUP_FORCE=1 — install ausführen"
  exit 0
fi

status=""
code=0
set +e
status="$(install_needed "$SOURCE_PLUGIN" "$INSTALLED_PLUGIN")"
code=$?
set -e

case "$code" in
  0)
    case "$status" in
      not-installed)
        echo "Install: noch nicht installiert"
        ;;
      update:*)
        from_to="${status#update:}"
        echo "Update: v${from_to/->/ → v}"
        ;;
      *)
        echo "Install: $status"
        ;;
    esac
    exit 0
    ;;
  1)
    ver="${status#current:}"
    echo "Bereits installiert: v${ver} (aktuell — kein Update nötig)"
    echo "  Neu installieren: CC_SETUP_FORCE=1 just install"
    exit 1
    ;;
  2)
    rest="${status#installed-newer:}"
    inst="${rest%%>*}"
    src="${rest#*>}"
    echo "Installiert: v${inst} — Repo-Templates: v${src} (lokal neuer als Repo)"
    echo "  Überspringe Downgrade. Neu installieren: CC_SETUP_FORCE=1 just install"
    exit 2
    ;;
  *)
    exit 0
    ;;
esac
