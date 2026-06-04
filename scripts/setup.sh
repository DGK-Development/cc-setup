#!/usr/bin/env bash
# setup.sh — cc-setup installieren: Skills + Agents + Hooks + Vault (kein Plugin)
#
# Usage:
#   bash scripts/setup.sh                    # interaktiv
#   bash scripts/setup.sh --vault /pfad/PKM  # Vault explizit setzen
#   bash scripts/setup.sh --check            # nur Dep-Status, keine Änderungen
#   CC_SETUP_NONINTERACTIVE=1 bash scripts/setup.sh
#
# Installiert:
#   ~/.claude/skills/<name>/    — Skills flach (kein Plugin-Namespace)
#   ~/.claude/agents/*.md       — Agents direkt
#   ~/.claude/skills/cc-setup/  — Scripts + Hooks (auch cc-setup SPOC-Skill)
#   ~/.claude/settings.json     — Hooks (SessionStart + UserPromptSubmit + Stop)
#   ~/.claude/CLAUDE.md         — Managed SPOC-Contract-Block
#   ~/.bashrc / ~/.zshrc        — OBSIDIAN_VAULT_PATH Export

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
SKILLS_DIR="$CLAUDE_HOME/skills"
AGENTS_DIR="$CLAUDE_HOME/agents"
CC_SETUP_DIR="$SKILLS_DIR/cc-setup"   # SKILL.md + scripts/ + hooks/
SETTINGS_JSON="$CLAUDE_HOME/settings.json"
GLOBAL_CLAUDE="$CLAUDE_HOME/CLAUDE.md"
NONINTERACTIVE="${CC_SETUP_NONINTERACTIVE:-0}"

CHECK_ONLY=0
VAULT_ARG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)  CHECK_ONLY=1 ;;
    --vault)  shift; VAULT_ARG="${1:-}" ;;
    *) echo "Unbekanntes Argument: $1" >&2; exit 2 ;;
  esac
  shift
done

# ── Hilfsfunktionen ────────────────────────────────────────────────────────────
have()  { command -v "$1" >/dev/null 2>&1; }
die()   { echo "ERROR: $*" >&2; exit 1; }
info()  { echo "  $*"; }

ask_input() {
  local prompt="$1" default="$2"
  [[ "$NONINTERACTIVE" == "1" || ! -t 0 ]] && { echo "$default"; return; }
  printf "  %s [%s]: " "$prompt" "$default"
  local ans; read -r ans || true
  echo "${ans:-$default}"
}

confirm() {
  local prompt="$1"
  [[ "$NONINTERACTIVE" == "1" || ! -t 0 ]] && return 0
  printf "  %s [Y/n]: " "$prompt"
  local ans; read -r ans || true
  [[ "${ans:-y}" =~ ^[yY] ]]
}

os_install() {
  local pkg="$1"
  if have brew;    then brew install "$pkg"; return; fi
  if have apt-get; then sudo apt-get update -qq && sudo apt-get install -y "$pkg"; return; fi
  if have dnf;     then sudo dnf install -y "$pkg"; return; fi
  if have pacman;  then sudo pacman -S --noconfirm "$pkg"; return; fi
  echo "  Kein bekannter Paketmanager — $pkg bitte manuell installieren" >&2; return 1
}

dep_status() {
  local name="$1" cmd="$2"
  if have "$cmd"; then
    printf "  [ok]     %-10s %s\n" "$name" "$(command -v "$cmd")"
  else
    printf "  [FEHLT]  %s\n" "$name"
  fi
}

# ── Banner ─────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  cc-setup — Skills & Agents installieren (kein Plugin)      ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── --check Modus ──────────────────────────────────────────────────────────────
if [[ "$CHECK_ONLY" -eq 1 ]]; then
  echo "Dependency-Status:"
  dep_status uv       uv
  dep_status jq       jq
  dep_status node     node
  dep_status qmd      qmd
  dep_status redactor redactor
  echo ""
  MISSING=0
  for c in uv jq qmd redactor; do have "$c" || MISSING=1; done
  [[ "$MISSING" -eq 1 ]] && echo "Fehlende Dependencies — setup.sh ohne --check ausführen." && exit 1
  echo "Alle Dependencies vorhanden."
  exit 0
fi

# ── 1/5  Vault-Pfad ────────────────────────────────────────────────────────────
echo "── 1/5  Vault-Pfad ──────────────────────────────────────────────"

detect_vault() {
  local c
  for c in \
    "${OBSIDIAN_VAULT_PATH:-}" \
    "${TASKNOTES_VAULT:-}" \
    "$HOME/git/ObsidianPKM" \
    "$HOME/GITHUB/ObsidianPKM" \
    "$HOME/Documents/ObsidianPKM" \
    "$HOME/ObsidianPKM"; do
    [[ -n "$c" && -d "$c" ]] && echo "$c" && return 0
  done
  return 1
}

if [[ -n "$VAULT_ARG" ]]; then
  VAULT="$VAULT_ARG"
else
  VAULT_DEFAULT="$(detect_vault 2>/dev/null || echo "$HOME/GITHUB/ObsidianPKM")"
  VAULT="$(ask_input "Obsidian Vault-Pfad" "$VAULT_DEFAULT")"
fi

if [[ -d "$VAULT" ]]; then
  info "Vault: $VAULT"
else
  echo "  WARNUNG: Pfad existiert nicht: $VAULT"
  echo "  Context-Load wird ohne Vault nicht funktionieren."
  if ! confirm "Trotzdem fortfahren?"; then
    echo "Abgebrochen."
    exit 0
  fi
fi
echo ""

# ── 2/5  Dependencies ──────────────────────────────────────────────────────────
echo "── 2/5  Dependencies ────────────────────────────────────────────"

if ! have uv; then
  info "uv fehlt — installiere via astral.sh ..."
  curl -LsSf https://astral.sh/uv/install.sh | sh || info "! uv-Install fehlgeschlagen"
  [[ -f "$HOME/.local/bin/env" ]] && source "$HOME/.local/bin/env" 2>/dev/null || true
fi
dep_status uv uv

if ! have jq; then
  info "jq fehlt — installiere ..."
  os_install jq || true
fi
dep_status jq jq

if ! have node; then
  info "node fehlt — installiere ..."
  os_install nodejs || os_install node || true
fi

if ! have qmd; then
  if have npm; then
    info "qmd fehlt — installiere @tobilu/qmd ..."
    npm install -g @tobilu/qmd || info "! qmd-Install fehlgeschlagen"
  else
    info "qmd fehlt — npm erst installieren, dann: npm install -g @tobilu/qmd"
  fi
fi
dep_status qmd qmd

if ! have redactor; then
  echo ""
  echo "  [FEHLT] redactor — Schritte nach dem cc-setup-Install:"
  echo "    1. redactor-Binary nach ~/.local/bin/ legen (chmod +x)"
  echo "    2. redactor install-plugin --global"
else
  dep_status redactor redactor
fi
echo ""

# ── 3/5  Bundle bauen ──────────────────────────────────────────────────────────
echo "── 3/5  Bundle bauen ────────────────────────────────────────────"
bash "$ROOT/scripts/bundle.sh"
DIST="$ROOT/dist/cc-setup"
[[ -d "$DIST" ]] || die "Bundle fehlgeschlagen — $DIST nicht vorhanden"
echo ""

# ── 4/5  Skills · Agents · Scripts · Hooks ─────────────────────────────────────
echo "── 4/5  Skills · Agents · Scripts · Hooks ───────────────────────"
mkdir -p "$SKILLS_DIR" "$AGENTS_DIR"

# Skills flach: dist/cc-setup/skills/<name>/ → ~/.claude/skills/<name>/
SKILL_NAMES=()
for skill_src in "$DIST/skills"/*/; do
  [[ -d "$skill_src" ]] || continue
  skill_name=$(basename "$skill_src")
  rsync -a --delete "$skill_src" "$SKILLS_DIR/$skill_name/"
  # Defensiv: verbleibendes ${CLAUDE_PLUGIN_ROOT} in deployter SKILL.md → absoluter Flat-Pfad
  skill_md="$SKILLS_DIR/$skill_name/SKILL.md"
  if [[ -f "$skill_md" ]] && grep -qF '${CLAUDE_PLUGIN_ROOT}' "$skill_md"; then
    sed "s|\${CLAUDE_PLUGIN_ROOT}|$CC_SETUP_DIR|g" "$skill_md" > "$skill_md.new" \
      && mv "$skill_md.new" "$skill_md"
  fi
  SKILL_NAMES+=("$skill_name")
done
info "Skills (${#SKILL_NAMES[@]}): ${SKILL_NAMES[*]}"

# Agents: dist/cc-setup/agents/*.md → ~/.claude/agents/
AGENT_NAMES=()
for agent_src in "$DIST/agents"/*.md; do
  [[ -f "$agent_src" ]] || continue
  agent_name=$(basename "$agent_src" .md)
  cp "$agent_src" "$AGENTS_DIR/"
  AGENT_NAMES+=("$agent_name")
done
info "Agents (${#AGENT_NAMES[@]}): ${AGENT_NAMES[*]}"

# Scripts → cc-setup/scripts/ (cc-setup ist auch ein Skill → SKILL.md schon oben kopiert)
mkdir -p "$CC_SETUP_DIR/scripts" "$CC_SETUP_DIR/hooks"
rsync -a "$DIST/scripts/" "$CC_SETUP_DIR/scripts/"
chmod +x "$CC_SETUP_DIR"/scripts/*.sh "$CC_SETUP_DIR"/scripts/*.py 2>/dev/null || true

# Hooks kopieren und ${CLAUDE_PLUGIN_ROOT} → absoluten Pfad patchen
for hook_src in "$DIST/hooks"/*.sh; do
  [[ -f "$hook_src" ]] || continue
  hook_name=$(basename "$hook_src")
  sed "s|\${CLAUDE_PLUGIN_ROOT}|$CC_SETUP_DIR|g" "$hook_src" > "$CC_SETUP_DIR/hooks/$hook_name"
done

# Skill-Referenz de-namespacen: /project-context:context-load → /context-load
USERPROMPT_HOOK="$CC_SETUP_DIR/hooks/userprompt-context-match.sh"
if [[ -f "$USERPROMPT_HOOK" ]]; then
  sed -i \
    -e 's|/project-context:context-load|/context-load|g' \
    -e 's|/cc-setup:context-load|/context-load|g' \
    -e 's|(plugin)|(flat install)|g' \
    "$USERPROMPT_HOOK"
fi

chmod +x "$CC_SETUP_DIR"/hooks/*.sh 2>/dev/null || true
info "Scripts + Hooks → $CC_SETUP_DIR/"
echo ""

# ── 5/5  CLAUDE.md · settings.json · Shell-Profil ─────────────────────────────
echo "── 5/5  CLAUDE.md · settings.json · Shell-Profil ───────────────"

# 5a — CLAUDE.md managed block
CONTRACT_SRC="$DIST/bootstrap/CONTRACT.md"
BEGIN_MARK="<!-- BEGIN cc-setup (managed by setup.sh) -->"
END_MARK="<!-- END cc-setup -->"

if [[ -f "$CONTRACT_SRC" ]]; then
  TMP_CONTRACT=$(mktemp)
  # De-namespace Skill-Referenzen im Contract (Plugin-Stil → flache Namen)
  sed \
    -e 's|/cc-setup:context-load|/context-load|g' \
    -e 's|/cc-setup:context-init|/context-init|g' \
    -e 's|/cc-setup:local-ci|/local-ci|g' \
    -e 's|/cc-setup:review|/review|g' \
    -e 's|/cc-setup:cc-setup|/cc-setup|g' \
    -e 's|Plugin skills|Skills|g' \
    "$CONTRACT_SRC" > "$TMP_CONTRACT"

  TMP_BLOCK=$(mktemp)
  { echo "$BEGIN_MARK"; cat "$TMP_CONTRACT"; echo "$END_MARK"; } > "$TMP_BLOCK"

  mkdir -p "$(dirname "$GLOBAL_CLAUDE")"
  # Alte Marker-Varianten (aus früheren Install-Skripten) ebenfalls entfernen
  OLD_BEGIN_MARK="<!-- BEGIN cc-setup (managed by 'just install' — edits inside this block are overwritten) -->"

  if [[ -f "$GLOBAL_CLAUDE" ]] && grep -qF "<!-- BEGIN cc-setup" "$GLOBAL_CLAUDE"; then
    # Entferne alle vorhandenen cc-setup Blöcke (egal welcher Marker)
    awk '
      /<!-- BEGIN cc-setup/ { skip=1; next }
      /<!-- END cc-setup/   { skip=0; next }
      skip { next }
      { print }
    ' "$GLOBAL_CLAUDE" > "$GLOBAL_CLAUDE.new" && mv "$GLOBAL_CLAUDE.new" "$GLOBAL_CLAUDE"
    { echo ""; cat "$TMP_BLOCK"; } >> "$GLOBAL_CLAUDE"
    info "CLAUDE.md: managed block ersetzt → $GLOBAL_CLAUDE"
  elif [[ -f "$GLOBAL_CLAUDE" ]]; then
    { echo ""; cat "$TMP_BLOCK"; } >> "$GLOBAL_CLAUDE"
    info "CLAUDE.md: managed block angehängt → $GLOBAL_CLAUDE"
  else
    cp "$TMP_BLOCK" "$GLOBAL_CLAUDE"
    info "CLAUDE.md: erstellt → $GLOBAL_CLAUDE"
  fi
  rm -f "$TMP_CONTRACT" "$TMP_BLOCK"
fi

# 5b — Hooks in ~/.claude/settings.json (cc-setup SessionStart + UserPromptSubmit + Stop)
INJECT_CMD="bash \"$CC_SETUP_DIR/hooks/inject-project-context.sh\""
USERPROMPT_CMD="bash \"$CC_SETUP_DIR/hooks/userprompt-context-match.sh\""
STOP_CMD="bash \"$CC_SETUP_DIR/hooks/stop-workflow.sh\""

python3 - "$SETTINGS_JSON" "$INJECT_CMD" "$USERPROMPT_CMD" "$VAULT" "$STOP_CMD" <<'PYEOF'
import json, sys
from pathlib import Path

settings_path  = Path(sys.argv[1])
inject_cmd     = sys.argv[2]
userprompt_cmd = sys.argv[3]
vault          = sys.argv[4]
stop_cmd       = sys.argv[5]

settings = {}
if settings_path.exists():
    try:
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        pass

# cc-setup Hooks (alte Einträge entfernen, neue vorne eintragen)
markers = ("inject-project-context", "userprompt-context-match", "stop-workflow", "CLAUDE_PLUGIN_ROOT")

def remove_cc_hooks(entries):
    return [e for e in entries if not any(m in json.dumps(e) for m in markers)]

cc_hooks = {
    "SessionStart": [
        {"hooks": [{"type": "command", "command": inject_cmd, "timeout": 20}]},
    ],
    "UserPromptSubmit": [
        {"hooks": [{"type": "command", "command": userprompt_cmd, "timeout": 10}]},
    ],
    "Stop": [
        {"hooks": [{"type": "command", "command": stop_cmd, "timeout": 60}]},
    ],
}

existing = settings.get("hooks", {})
merged = {}
for ev in sorted(set(existing) | set(cc_hooks)):
    cleaned  = remove_cc_hooks(existing.get(ev, []))
    new_ones = cc_hooks.get(ev, [])
    merged[ev] = new_ones + cleaned

settings["hooks"] = merged

# Vault als env-Variable eintragen (für Hooks die außerhalb der Shell starten)
env = settings.get("env", {})
env["OBSIDIAN_VAULT_PATH"] = vault
env["TASKNOTES_VAULT"]     = vault
settings["env"] = env

settings_path.parent.mkdir(parents=True, exist_ok=True)
settings_path.write_text(json.dumps(settings, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"  settings.json: {len(merged)} Hook-Events, env.OBSIDIAN_VAULT_PATH gesetzt")
PYEOF

# 5c — Shell-Profil: OBSIDIAN_VAULT_PATH
case "${SHELL:-}" in
  *zsh)  PROFILE="$HOME/.zshrc" ;;
  *bash) PROFILE="$HOME/.bashrc" ;;
  *)     PROFILE="$HOME/.profile" ;;
esac

MARKER="# >>> cc-setup vault >>>"
if ! grep -qF "$MARKER" "$PROFILE" 2>/dev/null; then
  {
    echo ""
    echo "$MARKER"
    echo "export OBSIDIAN_VAULT_PATH=\"$VAULT\""
    echo "export TASKNOTES_VAULT=\"\$OBSIDIAN_VAULT_PATH\""
    echo "# <<< cc-setup vault <<<"
  } >> "$PROFILE"
  info "Shell-Profil: OBSIDIAN_VAULT_PATH hinzugefügt → $PROFILE"
else
  # Vorhandenen Vault-Pfad aktualisieren
  sed -i "s|^export OBSIDIAN_VAULT_PATH=.*|export OBSIDIAN_VAULT_PATH=\"$VAULT\"|" "$PROFILE"
  info "Shell-Profil: OBSIDIAN_VAULT_PATH aktualisiert → $PROFILE"
fi

# ── Zusammenfassung ────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Setup fertig                                                ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Skills:  $SKILLS_DIR/"
printf "           "; for s in "${SKILL_NAMES[@]}"; do printf "/%s  " "$s"; done; echo ""
echo ""
echo "  Agents:  $AGENTS_DIR/"
printf "           "; for a in "${AGENT_NAMES[@]}"; do printf "%s  " "$a"; done; echo ""
echo ""
echo "  Hooks:   $SETTINGS_JSON"
echo "  Vault:   $VAULT"
echo ""
echo "Nächste Schritte:"
echo "  1.  source $PROFILE   (oder neue Shell öffnen)"
echo "  2.  Claude Code starten — Skills, Agents und Hooks sind aktiv"
echo "  3.  Pro Repo einmal:  /context-init"
echo ""
if ! have redactor; then
  echo "  HINWEIS redactor fehlt:"
  echo "    cargo install --path vendor/hook-redactor"
  echo "    redactor install-plugin --global"
  echo ""
fi
