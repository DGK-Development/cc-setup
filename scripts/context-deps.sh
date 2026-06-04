#!/usr/bin/env bash
# setup.sh — Dependency bootstrap for the project-context plugin.
#
# Usage:
#   bash scripts/setup.sh            # check + attempt installs + wire up env
#   bash scripts/setup.sh --check    # report dependency status only, no changes
#   bash scripts/setup.sh --vault /path/to/ObsidianPKM   # set vault explicitly
#
# Hard dependencies (all required for full function):
#   uv        — runs the bundled uv-script Python tools
#   jq        — parses hook payloads + tasknotes JSON
#   node/npm  — needed to install qmd
#   qmd       — @tobilu/qmd, hybrid markdown search (Layer 2/3)
#   redactor  — strict-mode bash wrapper (the skill wraps every call)
#
# Cross-platform: Linux (apt/dnf/pacman) + macOS (brew). Windows: run under WSL.

set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CHECK_ONLY=0
VAULT_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK_ONLY=1 ;;
    --vault) shift; VAULT_ARG="${1:-}" ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

# ---- helpers ---------------------------------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }

os_pkg_install() {
  # os_pkg_install <pkg> — best-effort install via the detected package manager.
  local pkg="$1"
  if have brew;   then brew install "$pkg"; return $?; fi
  if have apt-get; then sudo apt-get update -qq && sudo apt-get install -y "$pkg"; return $?; fi
  if have dnf;    then sudo dnf install -y "$pkg"; return $?; fi
  if have pacman; then sudo pacman -S --noconfirm "$pkg"; return $?; fi
  echo "  ! kein bekannter Paketmanager (brew/apt/dnf/pacman) — '$pkg' bitte manuell installieren" >&2
  return 1
}

status_line() {
  # status_line <name> <cmd-or-empty> — prints OK/MISSING with resolved path.
  local name="$1" cmd="$2"
  if have "$cmd"; then
    printf '  [ok]      %-10s %s\n' "$name" "$(command -v "$cmd")"
  else
    printf '  [MISSING] %-10s\n' "$name"
  fi
}

echo "== project-context plugin setup =="
echo "Plugin: $PLUGIN_ROOT"
echo ""
echo "Dependency-Status:"
status_line uv uv
status_line jq jq
status_line node node
status_line qmd qmd
status_line redactor redactor
echo ""

if [ "$CHECK_ONLY" -eq 1 ]; then
  MISSING=0
  for c in uv jq qmd redactor; do have "$c" || MISSING=1; done
  [ "$MISSING" -eq 1 ] && { echo "Fehlende harte Dependencies — 'bash scripts/setup.sh' (ohne --check) ausfuehren."; exit 1; }
  echo "Alle harten Dependencies vorhanden."
  exit 0
fi

# ---- installs --------------------------------------------------------------
echo "-- Installation fehlender Dependencies --"

if ! have uv; then
  echo "uv: installiere via astral.sh installer ..."
  curl -LsSf https://astral.sh/uv/install.sh | sh || echo "  ! uv-Install fehlgeschlagen — manuell: https://docs.astral.sh/uv/"
  # shellcheck disable=SC1090
  [ -f "$HOME/.local/bin/env" ] && source "$HOME/.local/bin/env" 2>/dev/null || true
fi

if ! have jq; then
  echo "jq: installiere via Paketmanager ..."
  os_pkg_install jq || true
fi

if ! have node; then
  echo "node: installiere via Paketmanager ..."
  os_pkg_install nodejs || os_pkg_install node || true
fi

if ! have qmd; then
  if have npm; then
    echo "qmd: installiere @tobilu/qmd global via npm ..."
    npm install -g @tobilu/qmd || echo "  ! qmd-Install fehlgeschlagen — manuell: npm install -g @tobilu/qmd"
  else
    echo "  ! npm fehlt — node/npm zuerst installieren, dann: npm install -g @tobilu/qmd" >&2
  fi
fi

if ! have redactor; then
  cat >&2 <<'EOF'
  ! redactor fehlt. Es ist ein eigenstaendiges Tool mit GitHub-Releases und
    installiert sich selbst als Claude-Code-Plugin. Schritte:
      1. redactor-Binary aus dem GitHub-Release nach ~/.cargo/bin (oder ~/.local/bin) legen
         und ausfuehrbar machen (chmod +x).
      2. redactor install-plugin --global    # deployt strict-mode Hooks + CLAUDE.md
    Ohne redactor blockt der strict-mode-Workflow der context-load Skill nicht,
    aber die im Skill verdrahteten 'redactor wrap --' Aufrufe schlagen fehl.
EOF
fi

# ---- chmod plugin scripts/hooks -------------------------------------------
echo ""
echo "-- chmod +x auf Hooks/Skripte --"
chmod +x "$PLUGIN_ROOT"/hooks/*.sh "$PLUGIN_ROOT"/scripts/*.sh "$PLUGIN_ROOT"/scripts/*.py 2>/dev/null || true
echo "  ok"

# ---- vault env persistence -------------------------------------------------
echo ""
echo "-- Vault-Pfad --"
VAULT="${VAULT_ARG:-${OBSIDIAN_VAULT_PATH:-${TASKNOTES_VAULT:-$HOME/GITHUB/ObsidianPKM}}}"
echo "  Vault: $VAULT $( [ -d "$VAULT" ] && echo '(existiert)' || echo '(nicht gefunden — ggf. --vault setzen)')"

# Determine shell profile
PROFILE=""
case "${SHELL:-}" in
  *zsh)  PROFILE="$HOME/.zshrc" ;;
  *bash) PROFILE="$HOME/.bashrc" ;;
  *)     PROFILE="$HOME/.profile" ;;
esac

MARKER="# >>> project-context plugin vault >>>"
if [ -n "$PROFILE" ] && ! grep -qF "$MARKER" "$PROFILE" 2>/dev/null; then
  {
    echo ""
    echo "$MARKER"
    echo "export OBSIDIAN_VAULT_PATH=\"$VAULT\""
    echo "export TASKNOTES_VAULT=\"\$OBSIDIAN_VAULT_PATH\""
    echo "# <<< project-context plugin vault <<<"
  } >> "$PROFILE"
  echo "  -> OBSIDIAN_VAULT_PATH/TASKNOTES_VAULT nach $PROFILE geschrieben (neue Shell oeffnen oder sourcen)"
else
  echo "  -> Profil-Eintrag existiert bereits oder kein Profil — uebersprungen"
fi

echo ""
echo "== Setup fertig =="
echo "Naechste Schritte:"
echo "  1. Neue Shell oeffnen (oder: source $PROFILE)"
echo "  2. Plugin laden:  claude --plugin-dir \"$PLUGIN_ROOT\""
echo "     oder Marketplace:  claude plugin marketplace add \"$PLUGIN_ROOT\" && claude plugin install project-context@niclasedge-pkm"
echo "  3. Pro Repo einmal:  /project-context:context-init"
echo "  4. Nightly Re-Index optional einrichten — siehe README (cron/systemd)."
