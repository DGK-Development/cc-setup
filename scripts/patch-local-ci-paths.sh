#!/usr/bin/env bash
# patch-local-ci-paths.sh — plugin-relative paths in vendored local-ci SKILL.md
set -euo pipefail

SKILL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/templates/skills/local-ci/SKILL.md"
[[ -f "$SKILL" ]] || exit 0

python3 - <<'PY' "$SKILL"
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text(encoding="utf-8")

plugin_block = """Referenzdateien liegen im cc-setup-Plugin unter `skills/local-ci/assets/`. Aus dem Ziel-Repo-Root:

```sh
SKILL="${CLAUDE_PLUGIN_ROOT}/skills/local-ci/assets"
mkdir -p .localci/hooks
cp "$SKILL/localci.py"            .localci/localci.py
cp "$SKILL/pre-push"             .localci/hooks/pre-push
cp "$SKILL/pipeline.example.yml" .localci/pipeline.yml   # danach anpassen!
chmod +x .localci/hooks/pre-push
printf '\\n# localci: Reports koennen Step-Output enthalten\\nreports/\\n' >> .gitignore
```

Ohne aktive Plugin-Session (manuell aus dem Skills-Dir):

```sh
SKILL="$HOME/.claude/skills/cc-setup/skills/local-ci/assets"
```"""

text = re.sub(
    r"Referenzdateien liegen.*?```\n",
    plugin_block + "\n",
    text,
    count=1,
    flags=re.DOTALL,
)

text = text.replace(
    'cp "$HOME/.claude/skills/local-ci/assets/localci-overview.py"',
    'cp "${CLAUDE_PLUGIN_ROOT}/skills/local-ci/assets/localci-overview.py"',
)
text = text.replace(
    '# oder: cp "$HOME/.claude/skills/cc-setup/skills/local-ci/assets/localci-overview.py"',
    '# oder: cp "$HOME/.claude/skills/cc-setup/skills/local-ci/assets/localci-overview.py"',
)

path.write_text(text, encoding="utf-8")
print("patched local-ci SKILL.md paths")
PY
