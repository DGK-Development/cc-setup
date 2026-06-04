#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""sprint_bridge.py — read-only bridge between Backlog.md milestones and tn.

Minimal scope (CCS-003): three read-only subcommands consumed by context-load
Layer 1.5. Nothing here writes to ``backlog/`` or the vault — ``backlog`` and
``tasknotes_cli.py`` are invoked as subprocesses and only their output is parsed.
The full design (bind / sync-finish / /sprint-start) is intentionally out of
scope.

Subcommands (all emit JSON on stdout, exit 0 even without a ``backlog/`` dir):

  resolve-repo [--repo DIR]   -> {repo, prefix, initialized}
  survey       [--repo DIR]   -> {repo, prefix, initialized,
                                  open_milestones[], candidate_tns[], tn_available}
  status       [--repo DIR]   -> {repo, initialized,
                                  active: {milestone, done, total, next_open_task} | null}

``backlog``'s ``--plain`` milestone renderer duplicates the name as
``<name>: <name> (done/total done)`` — :func:`dedup_name` undoes that.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path
from typing import Any

# A milestone-list entry: "  <disp> (5/6 done)" (leading indent, trailing count).
_MILESTONE_RE = re.compile(r"^\s+(?P<disp>.*\S)\s+\((?P<done>\d+)/(?P<total>\d+) done\)\s*$")
# A task-list entry: "  CCS-002 - [Spec] session-analyser Skill".
_TASK_RE = re.compile(r"^\s+(?P<id>[A-Za-z][\w.]*-[\d.]+)\s+-\s+(?P<title>.*\S)\s*$")
# Status group headers backlog prints when grouping tasks.
_OPEN_GROUPS = {"to do", "in progress"}


# --- repo / config -------------------------------------------------------

def find_repo_root(start: Path) -> Path:
    """Git toplevel for ``start``; falls back to ``start`` outside a repo."""
    try:
        out = subprocess.run(
            ["git", "-C", str(start), "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        if out:
            return Path(out)
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    return start


def backlog_initialized(repo: Path) -> bool:
    return (repo / "backlog" / "config.yml").is_file()


def read_prefix(repo: Path) -> str | None:
    """Read ``task_prefix`` from backlog/config.yml without a YAML dep."""
    cfg = repo / "backlog" / "config.yml"
    if not cfg.is_file():
        return None
    for line in cfg.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("task_prefix:"):
            return line.split(":", 1)[1].strip().strip('"').strip("'") or None
    return None


# --- plain-output parsers (pure, unit-tested) ----------------------------

def dedup_name(disp: str) -> str:
    """Undo backlog's ``<name>: <name>`` duplication in milestone --plain output."""
    sep = ": "
    if (len(disp) - len(sep)) % 2 == 0:
        half = (len(disp) - len(sep)) // 2
        if disp[half:half + len(sep)] == sep and disp[:half] == disp[half + len(sep):]:
            return disp[:half]
    return disp


def parse_milestones(plain: str) -> list[dict[str, Any]]:
    """Active milestones from ``backlog milestone list --plain``.

    Only the "Active milestones" section is returned; completed milestones are
    irrelevant to an in-progress sprint view.
    """
    out: list[dict[str, Any]] = []
    in_active = False
    for line in plain.splitlines():
        low = line.strip().lower()
        if low.startswith("active milestones"):
            in_active = True
            continue
        if low.startswith("completed milestones"):
            in_active = False
            continue
        if not in_active:
            continue
        m = _MILESTONE_RE.match(line)
        if m:
            out.append({
                "name": dedup_name(m.group("disp")),
                "done": int(m.group("done")),
                "total": int(m.group("total")),
            })
    return out


def parse_open_tasks(plain: str) -> list[dict[str, str]]:
    """Open tasks (To Do + In Progress) from ``backlog task list -m … --plain``."""
    out: list[dict[str, str]] = []
    group_open = False
    for line in plain.splitlines():
        stripped = line.strip()
        if stripped.endswith(":") and not line.startswith(" "):
            group_open = stripped[:-1].lower() in _OPEN_GROUPS
            continue
        if not group_open:
            continue
        m = _TASK_RE.match(line)
        if m:
            out.append({"id": m.group("id"), "title": m.group("title")})
    return out


# --- subprocess helpers --------------------------------------------------

def _run(cmd: list[str], cwd: Path) -> str | None:
    try:
        r = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True)
    except FileNotFoundError:
        return None
    if r.returncode != 0:
        return None
    return r.stdout


def get_milestones(repo: Path) -> list[dict[str, Any]]:
    out = _run(["backlog", "milestone", "list", "--plain"], repo)
    return parse_milestones(out) if out is not None else []


def get_open_tasks(repo: Path, milestone: str) -> list[dict[str, str]]:
    out = _run(["backlog", "task", "list", "-m", milestone, "--plain"], repo)
    return parse_open_tasks(out) if out is not None else []


def get_candidate_tns(repo: Path) -> tuple[bool, list[dict[str, Any]]]:
    """Top tn 'next' tasks for the project bound to ``repo`` (CWD auto-detect).

    Calls the sibling ``tasknotes_cli.py`` via ``uv run`` so its own deps resolve
    regardless of this script's environment. ``tn`` itself is a shell function,
    not a binary, so it cannot be called directly.
    """
    tn_path = Path(__file__).resolve().parent / "tasknotes_cli.py"
    if not tn_path.is_file():
        return False, []
    out = _run(
        ["uv", "run", "--script", str(tn_path), "next", "--format", "json", "--limit", "5"],
        repo,
    )
    if out is None:
        return False, []
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        return False, []
    tns: list[dict[str, Any]] = []
    for t in data.get("tasks", []):
        proj = t.get("project") or {}
        meta = t.get("metadata") or {}
        tns.append({
            "id": t.get("id"),
            "title": t.get("title"),
            "status": t.get("status"),
            "project": proj.get("name"),
            "next_action": meta.get("nextAction"),
        })
    return True, tns


# --- subcommands ---------------------------------------------------------

def cmd_resolve_repo(repo: Path) -> dict[str, Any]:
    return {
        "repo": str(repo),
        "prefix": read_prefix(repo),
        "initialized": backlog_initialized(repo),
    }


def cmd_survey(repo: Path) -> dict[str, Any]:
    initialized = backlog_initialized(repo)
    open_milestones: list[dict[str, Any]] = []
    if initialized:
        for ms in get_milestones(repo):
            open_milestones.append({
                **ms,
                "open_tasks": get_open_tasks(repo, ms["name"]),
            })
    tn_available, candidate_tns = get_candidate_tns(repo)
    return {
        "repo": str(repo),
        "prefix": read_prefix(repo),
        "initialized": initialized,
        "open_milestones": open_milestones,
        "candidate_tns": candidate_tns,
        "tn_available": tn_available,
    }


def cmd_status(repo: Path) -> dict[str, Any]:
    initialized = backlog_initialized(repo)
    active: dict[str, Any] | None = None
    if initialized:
        milestones = get_milestones(repo)
        # Prefer a milestone with open work; fall back to the first active one.
        chosen = next((m for m in milestones if m["done"] < m["total"]), None)
        if chosen is None and milestones:
            chosen = milestones[0]
        if chosen is not None:
            open_tasks = get_open_tasks(repo, chosen["name"])
            active = {
                "milestone": chosen["name"],
                "done": chosen["done"],
                "total": chosen["total"],
                "next_open_task": open_tasks[0] if open_tasks else None,
            }
    return {"repo": str(repo), "initialized": initialized, "active": active}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only Backlog.md <-> tn bridge.")
    parser.add_argument(
        "command", choices=["resolve-repo", "survey", "status"],
    )
    parser.add_argument("--repo", default=".", help="repo dir (default: CWD)")
    args = parser.parse_args(argv)

    repo = find_repo_root(Path(args.repo).expanduser().resolve())
    dispatch = {
        "resolve-repo": cmd_resolve_repo,
        "survey": cmd_survey,
        "status": cmd_status,
    }
    print(json.dumps(dispatch[args.command](repo), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
