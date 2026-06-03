#!/usr/bin/env python3
"""Merge cc-plugin-project-context hooks with redactor strict-mode hooks."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

# Skills-dir plugins (~/.claude/skills/<name>/) do NOT resolve ${user_config.*}
# template variables — only marketplace plugins do. The vendored
# cc-plugin-project-context hooks prefix their command with
#   OBSIDIAN_VAULT_PATH="${user_config.obsidian_vault_path}" bash ...
# which makes Claude Code abort the hook ("Plugin option ... isn't set").
# cc-setup bundles that plugin as a skills-dir plugin, so we strip the
# leading VAR="${user_config.*}" assignment. The hook script's resolve_vault()
# falls back to $OBSIDIAN_VAULT_PATH (set in settings.json env) anyway.
_USER_CONFIG_PREFIX = re.compile(r'^\w+="\$\{user_config\.[^}]+\}"\s+')

# Mirrors hook-redactor/src/install.rs GLOBAL_HOOKS
REDACTOR_HOOKS: list[tuple[str, str | None, str]] = [
    ("PreToolUse", "Bash|PowerShell", "redactor hook pre-bash"),
    ("PreToolUse", "Read", "redactor hook pre-read"),
    ("PreToolUse", "Edit|MultiEdit|Write", "redactor hook pre-edit"),
    ("PreToolUse", "Grep", "redactor hook deny-grep"),
    ("PreToolUse", "NotebookEdit", "redactor hook deny-notebook"),
    ("PreToolUse", "mcp__.*", "redactor hook deny-mcp"),
    ("PostToolUse", "Write|Edit", "redactor hook post-write"),
    ("UserPromptSubmit", None, "redactor hook prompt"),
    ("SessionStart", None, "redactor hook session-start"),
]


def hook_entry(command: str) -> dict[str, Any]:
    return {"type": "command", "command": command}


def sanitize_skillsdir_command(command: str) -> str:
    """Drop the VAR="${user_config.*}" prefix unusable in skills-dir plugins."""
    return _USER_CONFIG_PREFIX.sub("", command)


def sanitize_event(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for entry in entries:
        for hook in entry.get("hooks", []):
            cmd = hook.get("command")
            if isinstance(cmd, str):
                hook["command"] = sanitize_skillsdir_command(cmd)
    return entries


def matcher_entry(matcher: str | None, command: str) -> dict[str, Any]:
    entry: dict[str, Any] = {"hooks": [hook_entry(command)]}
    if matcher is not None:
        entry["matcher"] = matcher
    return entry


def build_redactor_hooks() -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for event, matcher, command in REDACTOR_HOOKS:
        out.setdefault(event, []).append(matcher_entry(matcher, command))
    return out


def merge_event(
    base: list[dict[str, Any]] | None,
    extra: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    return list(base or []) + list(extra or [])


def main() -> int:
    if len(sys.argv) != 4:
        print(
            "usage: merge_hooks.py <cc-plugin-hooks.json> <out-hooks.json> <note>",
            file=sys.stderr,
        )
        return 2

    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    data = json.loads(src.read_text(encoding="utf-8"))
    cc_hooks: dict[str, list[dict[str, Any]]] = data.get("hooks", {})
    for entries in cc_hooks.values():
        sanitize_event(entries)
    redactor = build_redactor_hooks()

    merged: dict[str, list[dict[str, Any]]] = {}
    for event in sorted(set(cc_hooks) | set(redactor)):
        # project-context first, then redactor guards
        merged[event] = merge_event(cc_hooks.get(event), redactor.get(event))

    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(
        json.dumps({"hooks": merged}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"merged hooks -> {dst} ({len(merged)} events)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
