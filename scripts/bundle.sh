#!/usr/bin/env bash
# bundle.sh — pull submodules, assemble dist/cc-setup plugin for @skills-dir install.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_CTX="$ROOT/vendor/cc-plugin-project-context"
VENDOR_REDACTOR="$ROOT/vendor/hook-redactor"
OUT="$ROOT/dist/cc-setup"
TEMPLATES="$ROOT/templates"

die() { echo "bundle: $*" >&2; exit 1; }

echo "==> submodule update (pull latest)"
git -C "$ROOT" submodule update --init --remote

[[ -d "$VENDOR_CTX" ]] || die "missing $VENDOR_CTX — run: git submodule update --init"
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
mkdir -p "$OUT/.claude-plugin"

echo "==> copy cc-plugin-project-context assets"
for dir in hooks skills commands scripts; do
  if [[ -d "$VENDOR_CTX/$dir" ]]; then
    rsync -a --exclude '__pycache__' --exclude '*.pyc' \
      "$VENDOR_CTX/$dir/" "$OUT/$dir/"
  fi
done

echo "==> plugin manifest + docs"
cp "$TEMPLATES/.claude-plugin/plugin.json" "$OUT/.claude-plugin/plugin.json"
mkdir -p "$OUT/bootstrap"
cp "$TEMPLATES/CLAUDE.md" "$OUT/bootstrap/CLAUDE.md"
# Slim contract (no redactor appendix) — source for the global ~/.claude/CLAUDE.md.
cp "$TEMPLATES/CLAUDE.md" "$OUT/bootstrap/CONTRACT.md"
if [[ -d "$TEMPLATES/agents" ]]; then
  rsync -a "$TEMPLATES/agents/" "$OUT/agents/"
fi
echo "==> copy bundled template skills (cc-setup, local-ci, …)"
if [[ -d "$TEMPLATES/skills" ]]; then
  rsync -a "$TEMPLATES/skills/" "$OUT/skills/"
fi

echo "==> bundle session-analyser script (single source of truth: scripts/)"
if [[ -f "$ROOT/scripts/session_analyze.py" ]]; then
  mkdir -p "$OUT/skills/session-analyser/scripts"
  cp "$ROOT/scripts/session_analyze.py" "$OUT/skills/session-analyser/scripts/session_analyze.py"
fi

if [[ -f "$TEMPLATES/settings.json" ]]; then
  cp "$TEMPLATES/settings.json" "$OUT/settings.json"
fi

echo "==> merge hooks (project-context + redactor)"
python3 "$ROOT/scripts/merge_hooks.py" \
  "$VENDOR_CTX/hooks/hooks.json" \
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

if command -v claude >/dev/null 2>&1; then
  echo "==> claude plugin validate"
  claude plugin validate "$OUT" || echo "warn: plugin validate reported issues (check manually)"
fi

echo "==> done: $OUT"
echo "    install: rsync -a --delete dist/cc-setup/ ~/.claude/skills/cc-setup/"
echo "    or:      just install"
