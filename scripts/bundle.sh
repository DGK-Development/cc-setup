#!/usr/bin/env bash
# bundle.sh — assemble the cc-setup install tree from the flat repo sources.
#
# Usage:
#   bash scripts/bundle.sh [OUT]
#
# OUT defaults to $ROOT/dist/cc-setup for ad-hoc debug inspection. deploy.sh
# calls this with an ephemeral temp dir so dist/ is never persisted by a deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_REDACTOR="$ROOT/vendor/hook-redactor"
OUT="${1:-$ROOT/dist/cc-setup}"

die() { echo "bundle: $*" >&2; exit 1; }

[[ -d "$VENDOR_REDACTOR" ]] || die "missing $VENDOR_REDACTOR — run: git submodule update --init"

if ! command -v redactor >/dev/null 2>&1; then
  echo "==> redactor not on PATH — building from vendor/hook-redactor"
  if command -v cargo >/dev/null 2>&1; then
    cargo build --release --manifest-path "$VENDOR_REDACTOR/Cargo.toml"
    export PATH="$VENDOR_REDACTOR/target/release:$PATH"
  else
    echo "warn: cargo missing — install redactor manually (cargo install --path vendor/hook-redactor)"
  fi
fi

echo "==> clean $OUT"
rm -rf "$OUT"
mkdir -p "$OUT"

echo "==> copy project-context assets (repo-local)"
# hooks + commands: vollständig repo-lokal kopieren.
for dir in hooks commands; do
  if [[ -d "$ROOT/$dir" ]]; then
    rsync -a --exclude '__pycache__' --exclude '*.pyc' \
      "$ROOT/$dir/" "$OUT/$dir/"
  fi
done

# scripts: NUR Runtime-Scripts (Whitelist) — keine Build-Scripts (bundle.sh, deploy.sh, …).
# Bewusst NICHT in der Whitelist: knowledge.py (Single-Pane-Dashboard). Es ist ein
# Developer-Tool fuer die Arbeit *am* Repo (`just overview`), kein Runtime-Asset fuer
# das deployte ~/.claude. Es zieht zudem fastapi/uvicorn als schwere Deps und haengt von
# Sibling-Scripts ab, die teils nicht deployed werden. Aus dem Repo heraus genutzt, nicht aus ~/.claude.
mkdir -p "$OUT/scripts"
RUNTIME_SCRIPTS=(
  context-resolve.py
  sprint_bridge.py
  qmd-ensure.sh
  wiki-tier-extract.py
  nightly-reindex.sh
  lib.sh
  tasknotes_cli.py
  context-deps.sh
)
for f in "${RUNTIME_SCRIPTS[@]}"; do
  if [[ -f "$ROOT/scripts/$f" ]]; then
    cp "$ROOT/scripts/$f" "$OUT/scripts/$f"
  fi
done

echo "==> docs + contract"
mkdir -p "$OUT/bootstrap"
cp "$ROOT/CONTRACT.md" "$OUT/bootstrap/CLAUDE.md"
# Slim contract (no redactor appendix) — source for the global ~/.claude/CLAUDE.md.
cp "$ROOT/CONTRACT.md" "$OUT/bootstrap/CONTRACT.md"
if [[ -d "$ROOT/agents" ]]; then
  rsync -a "$ROOT/agents/" "$OUT/agents/"
fi
echo "==> copy bundled skills (cc-setup, local-ci, context-load, …)"
if [[ -d "$ROOT/skills" ]]; then
  rsync -a "$ROOT/skills/" "$OUT/skills/"
fi

echo "==> bundle audit script (single source of truth: scripts/session_analyze.py)"
if [[ -f "$ROOT/scripts/session_analyze.py" ]]; then
  mkdir -p "$OUT/skills/audit/scripts"
  cp "$ROOT/scripts/session_analyze.py" "$OUT/skills/audit/scripts/session_analyze.py"
fi

if [[ -f "$ROOT/settings.json" ]]; then
  cp "$ROOT/settings.json" "$OUT/settings.json"
fi

echo "==> merge hooks (project-context + redactor)"
uv run python3 "$ROOT/scripts/merge_hooks.py" \
  "$ROOT/hooks/hooks.json" \
  "$OUT/hooks/hooks.json" \
  merged

echo "==> append redactor strict-mode section to bootstrap/CLAUDE.md"
REDACTOR_CLAUDE="$VENDOR_REDACTOR/examples/strict-redaction/claude/CLAUDE.md"
if [[ -f "$REDACTOR_CLAUDE" ]]; then
  {
    echo ""
    echo "---"
    echo ""
    cat "$REDACTOR_CLAUDE"
  } >> "$OUT/bootstrap/CLAUDE.md"
fi

echo "==> copy bootstrap helpers"
mkdir -p "$OUT/bootstrap"
cp "$ROOT/README.md" "$OUT/bootstrap/INSTALL.md"
cat > "$OUT/bootstrap/install-to-skills-dir.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
DEST="${1:-$HOME/.claude/skills/cc-setup}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$(dirname "$DEST")"
rsync -a --delete "$SRC/" "$DEST/"
echo "installed -> $DEST"
echo "restart Claude Code or run /reload-plugins"
EOF
chmod +x "$OUT/bootstrap/install-to-skills-dir.sh"

echo "==> chmod +x shell scripts"
find "$OUT" -type f \( -name '*.sh' -o -name '*.py' \) -exec chmod +x {} + 2>/dev/null || true

if command -v redactor >/dev/null 2>&1; then
  echo "==> redactor $(redactor --version 2>/dev/null || redactor -V 2>/dev/null || echo ok)"
else
  echo "warn: redactor still not on PATH — hooks require redactor binary at runtime"
fi

echo "==> done: $OUT"
echo "    install: just deploy   (deploys skills/agents/scripts/hooks flat into ~/.claude/)"
