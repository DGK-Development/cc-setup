#!/usr/bin/env bash
# configure-claude-plugin.sh — set cc-setup@skills-dir userConfig in ~/.claude/settings.json
set -euo pipefail

PLUGIN_ID="${CC_SETUP_PLUGIN_ID:-cc-setup@skills-dir}"
SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
VAULT="${1:-${OBSIDIAN_VAULT_PATH:-${TASKNOTES_VAULT:-${OBSIDIANPKM_ROOT:-$HOME/GITHUB/ObsidianPKM}}}}"
if [[ ! -d "$VAULT" ]]; then
  echo "warn: vault path missing, skipping plugin config: $VAULT" >&2
  exit 0
fi

python3 - "$SETTINGS" "$PLUGIN_ID" "$VAULT" <<'PY'
import json
import sys
from pathlib import Path

settings_path = Path(sys.argv[1]).expanduser()
plugin_id = sys.argv[2]
vault = sys.argv[3]

data: dict = {}
if settings_path.is_file():
    data = json.loads(settings_path.read_text(encoding="utf-8"))

plugin_configs = data.setdefault("pluginConfigs", {})
entry = plugin_configs.setdefault(plugin_id, {})
options = entry.setdefault("options", {})
options["obsidian_vault_path"] = vault

settings_path.parent.mkdir(parents=True, exist_ok=True)
settings_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"plugin config: {plugin_id} obsidian_vault_path={vault}")
PY
