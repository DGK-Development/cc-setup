#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "fastapi>=0.110",
#     "uvicorn>=0.29",
#     "python-multipart>=0.0.9",
# ]
# ///
"""knowledge.py — single-pane, server-rendered status dashboard for a cc-setup repo.

One uv-inline FastAPI script. ``GET /`` renders ONE server-side HTML page
(no SPA, no JS framework) showing eight cards — seven read-only plus a Git card
with localhost-only, gated mutating actions (``POST /action/*``). A browser
refresh re-runs every collector live — there is no cache and no database.

Run:
  uv run --script scripts/knowledge.py [--cwd .] [--port 8765] [--no-open]

Design constraints (deliberate):
  * Every card is produced by an isolated ``collect_*`` function returning a
    plain dict. Each collector wraps its own work in try/except and degrades to
    ``{"available": False, "reason": "..."}`` instead of raising — so a missing
    tool or unreadable file yields a grey "not available" card, never a 500.
  * The collectors import NOTHING from FastAPI, so ``import knowledge`` works in
    a plain test environment. FastAPI/uvicorn are imported lazily inside
    :func:`build_app` / :func:`main`.
  * settings.json values are NEVER rendered — only hook event names and the
    per-event hook *type* keys. No env values, no command strings leak out.

Reused tooling (invoked read-only as subprocesses or sibling modules):
  * session_analyze.py  -> token_stats (input/output/cache + per-session)
  * sprint_bridge.py    -> survey (open milestones + open tasks)
  * tasknotes_cli.py    -> tn next / blocked (best-effort)
  * lib.sh resolve_vault-> Vault CHANGELOG (best-effort)
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

SCRIPTS_DIR = Path(__file__).resolve().parent

# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------


def _unavailable(reason: str) -> dict[str, Any]:
    """Uniform shape for a degraded card."""
    return {"available": False, "reason": reason}


def _run(cmd: list[str], cwd: Path | None = None, timeout: int = 30) -> str | None:
    """Run a subprocess read-only; return stdout or None on any failure."""
    try:
        r = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (FileNotFoundError, subprocess.SubprocessError, OSError):
        return None
    if r.returncode != 0:
        return None
    return r.stdout


def _md_headers(text: str, levels: tuple[int, ...] = (1, 2)) -> list[str]:
    """Return markdown ATX headers of the given levels, in document order.

    Skips fenced code blocks so ``# DON'T DO THIS`` inside a ``` block is not
    mistaken for a real heading.
    """
    out: list[str] = []
    in_fence = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = re.match(r"^(#{1,6})\s+(.*\S)\s*$", line)
        if not m:
            continue
        if len(m.group(1)) in levels:
            out.append(m.group(2).strip())
    return out


def _est_tokens(text: str) -> int:
    """Rough token estimate (~chars/4). A budget gauge, not a real tokenizer."""
    return (len(text) + 3) // 4


def _frontmatter_field(text: str, field: str) -> str:
    """Return a single-line YAML frontmatter value from a leading ``---`` block."""
    lead = text.lstrip("﻿")
    if not lead.startswith("---"):
        return ""
    end = lead.find("\n---", 3)
    block = lead[3:end] if end != -1 else lead[3:]
    m = re.search(rf"^{re.escape(field)}\s*:\s*(.+\S)\s*$", block, re.MULTILINE)
    if not m:
        return ""
    val = m.group(1).strip()
    if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
        val = val[1:-1]
    return val


_SCRIPT_EXTS = {
    ".py",
    ".sh",
    ".bash",
    ".zsh",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".rb",
    ".pl",
    ".lua",
}


def _scan_scripts(root: Path, limit: int = 40) -> list[dict[str, Any]]:
    """List script files (by extension) under ``root``, relative paths + size."""
    out: list[dict[str, Any]] = []
    if not root.is_dir():
        return out
    try:
        for f in sorted(root.rglob("*")):
            if not f.is_file() or f.suffix.lower() not in _SCRIPT_EXTS:
                continue
            try:
                rel = f.relative_to(root).as_posix()
                size = f.stat().st_size
            except (ValueError, OSError):
                continue
            out.append({"path": rel, "size": size, "lang": f.suffix.lstrip(".")})
            if len(out) >= limit:
                break
    except OSError:
        pass
    return out


def _skill_meta(skill_dir: Path) -> dict[str, Any]:
    """Read a skill's SKILL.md: description, token estimate, referenced scripts."""
    md = skill_dir / "SKILL.md"
    name = skill_dir.name
    scripts = _scan_scripts(skill_dir)
    base = {
        "name": name,
        "description": "",
        "tokens": 0,
        "size_bytes": 0,
        "has_md": False,
        "scripts": scripts,
    }
    if not md.is_file():
        return base
    try:
        text = md.read_text(encoding="utf-8", errors="replace")
        size = md.stat().st_size
    except OSError:
        return base
    return {
        "name": name,
        "description": _frontmatter_field(text, "description"),
        "tokens": _est_tokens(text),
        "size_bytes": size,
        "has_md": True,
        "scripts": scripts,
    }


def _agent_meta(agent_md: Path) -> dict[str, Any]:
    """Read an agent .md: token estimate + size (content shown via /read)."""
    name = agent_md.stem
    try:
        text = agent_md.read_text(encoding="utf-8", errors="replace")
        size = agent_md.stat().st_size
    except OSError:
        return {"name": name, "tokens": 0, "size_bytes": 0, "description": ""}
    return {
        "name": name,
        "tokens": _est_tokens(text),
        "size_bytes": size,
        "description": _frontmatter_field(text, "description"),
    }


def _fmt_mtime(mt: float | None) -> str:
    """Format an epoch mtime as a local ``YYYY-MM-DD HH:MM`` string ('' if unknown)."""
    if not mt:
        return ""
    try:
        return datetime.fromtimestamp(mt).strftime("%Y-%m-%d %H:%M")
    except (OverflowError, OSError, ValueError):
        return ""


# Rough per-MTok USD rates for a token->$ ESTIMATE (Claude Sonnet-4 tier). Real
# spend lives in the Cost card (ccusage); this is only a per-session gauge so the
# user sees relative weight. Labelled "≈" everywhere it surfaces.
_RATE_INPUT = 3.0
_RATE_OUTPUT = 15.0
_RATE_CACHE_WRITE = 3.75
_RATE_CACHE_READ = 0.30


def _est_cost(inp: int, out: int, cache_read: int, cache_creation: int) -> float:
    """Estimate USD for one session from its token counts (Sonnet-4 rates)."""
    return (
        inp * _RATE_INPUT
        + out * _RATE_OUTPUT
        + cache_creation * _RATE_CACHE_WRITE
        + cache_read * _RATE_CACHE_READ
    ) / 1_000_000.0


def _task_description(text: str) -> str:
    """Extract a task's Description: SECTION marker if present, else under ## Description."""
    m = re.search(
        r"SECTION:DESCRIPTION:BEGIN\s*-->\s*(.*?)\s*<!--\s*SECTION:DESCRIPTION:END",
        text,
        re.DOTALL,
    )
    if m:
        return m.group(1).strip()
    m = re.search(
        r"^##\s+Description\s*$(.*?)(?=^##\s|\Z)", text, re.DOTALL | re.MULTILINE
    )
    return m.group(1).strip() if m else ""


# ---------------------------------------------------------------------------
# 1. Global — ~/.claude/
# ---------------------------------------------------------------------------


def collect_global(claude_home: Path) -> dict[str, Any]:
    """Inspect the global ~/.claude install: CLAUDE.md, skills/, settings, agents/."""
    try:
        if not claude_home.is_dir():
            return _unavailable(f"~/.claude not found: {claude_home}")

        data: dict[str, Any] = {"available": True, "home": str(claude_home)}

        # --- CLAUDE.md ---
        claude_md = claude_home / "CLAUDE.md"
        if claude_md.is_file():
            text = claude_md.read_text(encoding="utf-8", errors="replace")
            managed = bool(
                re.search(r"<!--\s*BEGIN cc-setup\s*-->", text)
                and re.search(r"<!--\s*END cc-setup\s*-->", text)
            )
            data["claude_md"] = {
                "size_bytes": claude_md.stat().st_size,
                "tokens": _est_tokens(text),
                "headers": _md_headers(text, levels=(2,)),
                "managed_block": managed,
            }
        else:
            data["claude_md"] = None

        # --- skills/ — name + description (frontmatter) + token estimate ---
        skills_dir = claude_home / "skills"
        if skills_dir.is_dir():
            dirs = sorted(
                (
                    p
                    for p in skills_dir.iterdir()
                    if p.is_dir()
                    and not p.name.startswith(".")
                    and not p.name.startswith("_")
                ),
                key=lambda p: p.name,
            )
            items = [_skill_meta(d) for d in dirs]
            names = [d.name for d in dirs]
            data["skills"] = {"count": len(names), "names": names, "items": items}
        else:
            data["skills"] = {"count": 0, "names": [], "items": []}

        # --- settings.json hooks — event names, matcher, type, command.
        #     settings.env is NEVER read here, so env VALUES (likely to hold
        #     tokens/secrets) can never leak; hook COMMANDS are shown by request.
        settings = claude_home / "settings.json"
        if settings.is_file():
            try:
                raw = json.loads(settings.read_text(encoding="utf-8", errors="replace"))
                hooks = raw.get("hooks", {}) if isinstance(raw, dict) else {}
                events: dict[str, int] = {}
                detail: dict[str, list[dict[str, str]]] = {}
                if isinstance(hooks, dict):
                    for event_name, matchers in hooks.items():
                        n = 0
                        entries: list[dict[str, str]] = []
                        if isinstance(matchers, list):
                            for matcher in matchers:
                                if not isinstance(matcher, dict):
                                    continue
                                pattern = str(matcher.get("matcher", ""))
                                inner = matcher.get("hooks", [])
                                if not isinstance(inner, list):
                                    continue
                                for h in inner:
                                    if not isinstance(h, dict):
                                        continue
                                    n += 1
                                    entries.append(
                                        {
                                            "matcher": pattern,
                                            "type": str(h.get("type", "")),
                                            "command": str(h.get("command", "")),
                                        }
                                    )
                        events[str(event_name)] = n
                        detail[str(event_name)] = entries
                data["settings"] = {"hook_events": events, "hook_detail": detail}
            except (json.JSONDecodeError, ValueError):
                data["settings"] = {
                    "hook_events": {},
                    "hook_detail": {},
                    "parse_error": True,
                }
        else:
            data["settings"] = None

        # --- agents/*.md — names (compat) + items with token estimate ---
        agents_dir = claude_home / "agents"
        if agents_dir.is_dir():
            agent_files = sorted(agents_dir.glob("*.md"), key=lambda p: p.stem)
            data["agents"] = [p.stem for p in agent_files]
            data["agent_items"] = [_agent_meta(p) for p in agent_files]
        else:
            data["agents"] = []
            data["agent_items"] = []

        return data
    except Exception as exc:  # noqa: BLE001 — card must never crash the page
        return _unavailable(f"collect_global failed: {exc}")


# ---------------------------------------------------------------------------
# 2. Project — cwd
# ---------------------------------------------------------------------------


def _git(cwd: Path, *args: str) -> str | None:
    return _run(["git", "-C", str(cwd), *args])


def _repo_root(cwd: Path) -> Path:
    out = _git(cwd, "rev-parse", "--show-toplevel")
    if out and out.strip():
        return Path(out.strip())
    return cwd


def _knowledge_index(repo: Path) -> list[dict[str, str]]:
    """Parse the index lines from knowledge/README.md (``- [Title](path) — desc``)."""
    readme = repo / "knowledge" / "README.md"
    if not readme.is_file():
        return []
    entries: list[dict[str, str]] = []
    link_re = re.compile(r"^\s*-\s*\[([^\]]+)\]\(([^)]+)\)\s*(?:—|--)?\s*(.*)$")
    for line in readme.read_text(encoding="utf-8", errors="replace").splitlines():
        m = link_re.match(line)
        if not m:
            continue
        path = m.group(2).strip()
        # skip template/placeholder rows (e.g. "knowledge/<slug>.md") + external links
        if "<" in path or ">" in path or "://" in path:
            continue
        entries.append(
            {
                "title": m.group(1).strip(),
                "path": path,
                "desc": m.group(3).strip(),
            }
        )
    return entries


def collect_project(cwd: Path) -> dict[str, Any]:
    """Inspect the current repo: name+branch, CLAUDE.md headers, knowledge index."""
    try:
        repo = _repo_root(cwd)
        branch = _git(cwd, "rev-parse", "--abbrev-ref", "HEAD")
        data: dict[str, Any] = {
            "available": True,
            "repo": repo.name,
            "repo_path": str(repo),
            "branch": branch.strip() if branch else None,
        }

        claude_md = repo / "CLAUDE.md"
        if claude_md.is_file():
            text = claude_md.read_text(encoding="utf-8", errors="replace")
            data["claude_md_headers"] = _md_headers(text, levels=(1, 2))[:20]
            data["claude_md_tokens"] = _est_tokens(text)
            data["claude_md_size"] = claude_md.stat().st_size
        else:
            data["claude_md_headers"] = []
            data["claude_md_tokens"] = 0
            data["claude_md_size"] = 0

        data["knowledge_index"] = _knowledge_index(repo)
        return data
    except Exception as exc:  # noqa: BLE001
        return _unavailable(f"collect_project failed: {exc}")


# ---------------------------------------------------------------------------
# 3. Knowledge — knowledge/ + vault CHANGELOG
# ---------------------------------------------------------------------------

_DECISION_LINE_RE = re.compile(
    r"^\s*##\s+(?P<id>\d+)\s*(?:—|-{1,2})\s*(?P<title>.*\S)\s*$"
)


def _parse_decisions_md(text: str) -> list[dict[str, str]]:
    """Parse ``## NNN — Titel`` decision entries + Status line + the section body."""
    out: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    body: list[str] = []

    def _flush() -> None:
        if current is not None:
            current["body"] = "\n".join(body).strip()

    for line in text.splitlines():
        m = _DECISION_LINE_RE.match(line)
        if m:
            _flush()
            body = []
            current = {
                "id": m.group("id"),
                "title": m.group("title"),
                "status": "",
                "body": "",
            }
            out.append(current)
            continue
        if current is not None:
            sm = re.match(
                r"^\s*(?:[-*]\s*)?\**\s*Status\s*\**\s*[:=]\s*(.+\S)\s*$",
                line,
                re.IGNORECASE,
            )
            if sm and not current["status"]:
                # Strip surrounding markdown bold markers from the value.
                current["status"] = sm.group(1).strip().strip("*").strip()
            body.append(line)
    _flush()
    return out


def _backlog_decisions(repo: Path) -> list[dict[str, str]]:
    """Best-effort: list backlog/decisions/decision-NNN files: status + body."""
    ddir = repo / "backlog" / "decisions"
    if not ddir.is_dir():
        return []
    out: list[dict[str, str]] = []
    for f in sorted(ddir.glob("decision-*.md")):
        m = re.match(r"decision-(\d+)", f.name)
        did = m.group(1) if m else f.stem
        title = f.stem
        status = ""
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            text = ""
        # title from first '# ' header, status from frontmatter or '## Status'
        for line in text.splitlines():
            hm = re.match(r"^#\s+(.*\S)\s*$", line)
            if hm:
                title = hm.group(1).strip()
                break
        sm = re.search(r"^status:\s*(.+\S)\s*$", text, re.IGNORECASE | re.MULTILINE)
        if sm:
            status = sm.group(1).strip()
        # body = everything after the leading frontmatter block (capped)
        body = text
        if text.lstrip().startswith("---"):
            parts = text.split("---", 2)
            if len(parts) == 3:
                body = parts[2]
        out.append(
            {"id": did, "title": title, "status": status, "body": body.strip()[:8000]}
        )
    return out


def _vault_changelog(repo_name: str, vault: Path | None, limit: int = 5) -> list[str]:
    """Best-effort: last `limit` non-empty lines of the repo's vault CHANGELOG."""
    if vault is None or not vault.is_dir():
        return []
    changelog = vault / "Efforts" / "Work" / "dgk" / repo_name / "CHANGELOG.md"
    if not changelog.is_file():
        return []
    lines = [
        ln.strip()
        for ln in changelog.read_text(encoding="utf-8", errors="replace").splitlines()
        if ln.strip() and not ln.strip().startswith("#")
    ]
    return lines[-limit:][::-1]


def _resolve_vault() -> Path | None:
    for env in ("OBSIDIAN_VAULT_PATH", "TASKNOTES_VAULT"):
        v = os.environ.get(env)
        if v:
            return Path(v)
    default = Path.home() / "GITHUB" / "ObsidianPKM"
    return default if default.is_dir() else None


def collect_knowledge(cwd: Path, vault: Path | None = None) -> dict[str, Any]:
    """Inspect knowledge/: decisions, lektion-*, memory/*, vault CHANGELOG tail."""
    try:
        repo = _repo_root(cwd)
        kdir = repo / "knowledge"
        data: dict[str, Any] = {"available": True}

        # Decisions: prefer knowledge/decisions.md, else backlog/decisions/*.
        decisions: list[dict[str, str]] = []
        dec_md = kdir / "decisions.md"
        if dec_md.is_file():
            decisions = _parse_decisions_md(
                dec_md.read_text(encoding="utf-8", errors="replace")
            )
        if not decisions:
            decisions = _backlog_decisions(repo)
        data["decisions"] = decisions

        # lektion-*.md
        lektionen = (
            sorted(p.name for p in kdir.glob("lektion-*.md")) if kdir.is_dir() else []
        )
        data["lektionen"] = lektionen

        # knowledge/memory/*.md (best-effort — dir may not exist)
        mem_dir = kdir / "memory"
        memory = (
            sorted(p.name for p in mem_dir.glob("*.md")) if mem_dir.is_dir() else []
        )
        data["memory"] = memory

        # Vault CHANGELOG tail (best-effort)
        data["changelog"] = _vault_changelog(repo.name, vault or _resolve_vault())

        return data
    except Exception as exc:  # noqa: BLE001
        return _unavailable(f"collect_knowledge failed: {exc}")


# ---------------------------------------------------------------------------
# 4. Backlog — open milestones + in-progress
# ---------------------------------------------------------------------------


def _sprint_survey(repo: Path) -> dict[str, Any] | None:
    """Call sprint_bridge.py survey (read-only); return parsed JSON or None."""
    sb = SCRIPTS_DIR / "sprint_bridge.py"
    if not sb.is_file():
        return None
    out = _run(["uv", "run", "--script", str(sb), "survey", "--repo", str(repo)], repo)
    if out is None:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return None


def _backlog_in_progress(repo: Path) -> list[dict[str, str]]:
    """Parse In Progress tasks from `backlog task list -s 'In Progress' --plain`."""
    out = _run(["backlog", "task", "list", "-s", "In Progress", "--plain"], repo)
    if out is None:
        return []
    tasks: list[dict[str, str]] = []
    task_re = re.compile(
        r"^\s+(?:\[[^\]]+\]\s*)?([A-Za-z][\w.]*-[\d.]+)\s+-\s+(.*\S)\s*$"
    )
    for line in out.splitlines():
        m = task_re.match(line)
        if m:
            tasks.append({"id": m.group(1), "title": m.group(2)})
    return tasks


def _parse_task_file(path: Path) -> dict[str, Any] | None:
    """Read one backlog/tasks/*.md: id, title, status, milestone, parent, desc."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    fid = _frontmatter_field(text, "id") or path.stem
    title = _frontmatter_field(text, "title") or fid
    status = _frontmatter_field(text, "status")
    milestone = _frontmatter_field(text, "milestone")
    parent = _frontmatter_field(text, "parent_task_id")
    return {
        "id": fid,
        "title": title,
        "status": status,
        "milestone": milestone,
        "parent": parent,
        "desc": _task_description(text)[:2000],
        "file": path.name,
    }


def collect_backlog(cwd: Path) -> dict[str, Any]:
    """All backlog tasks (read from files): grouped per milestone + done/total counts.

    Reads ``backlog/tasks/*.md`` directly (read-only). Some backlog.md layouts
    move finished tasks into ``backlog/completed/`` — those are folded in as Done
    (deduped by id; a task present in tasks/ wins), so the done/total counts are
    correct whether a project keeps Done tasks in tasks/ or in completed/.
    """
    try:
        repo = _repo_root(cwd)
        tasks_dir = repo / "backlog" / "tasks"
        if not tasks_dir.is_dir():
            return _unavailable("backlog not initialized (no backlog/tasks)")

        tasks: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for f in sorted(tasks_dir.glob("*.md")):
            t = _parse_task_file(f)
            if t:
                tasks.append(t)
                seen_ids.add(t["id"])

        # completed/ — finished tasks not already in tasks/ (folder => Done)
        completed_dir = repo / "backlog" / "completed"
        if completed_dir.is_dir():
            for f in sorted(completed_dir.glob("*.md")):
                t = _parse_task_file(f)
                if t and t["id"] not in seen_ids:
                    t["status"] = "Done"  # the completed/ folder is the truth
                    tasks.append(t)
                    seen_ids.add(t["id"])

        # done/total per milestone (incl. an "—" bucket for unassigned tasks)
        agg: dict[str, dict[str, int]] = {}
        for t in tasks:
            name = t.get("milestone") or "—"
            slot = agg.setdefault(name, {"done": 0, "total": 0})
            slot["total"] += 1
            if (t.get("status") or "").strip().lower() == "done":
                slot["done"] += 1
        milestones = [
            {"name": name, "done": v["done"], "total": v["total"]}
            for name, v in sorted(agg.items())
        ]
        in_progress = [
            t for t in tasks if (t.get("status") or "").strip().lower() == "in progress"
        ]
        return {
            "available": True,
            "tasks": tasks,
            "milestones": milestones,
            "in_progress_count": len(in_progress),
        }
    except Exception as exc:  # noqa: BLE001
        return _unavailable(f"collect_backlog failed: {exc}")


# ---------------------------------------------------------------------------
# 5. tn — next + blocked (best-effort)
# ---------------------------------------------------------------------------


def _tn_json(repo: Path, *cli_args: str) -> dict[str, Any] | None:
    tn = SCRIPTS_DIR / "tasknotes_cli.py"
    if not tn.is_file():
        return None
    out = _run(["uv", "run", "--script", str(tn), *cli_args], repo)
    if out is None:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return None


def _tn_tasks(payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not payload:
        return []
    tasks = []
    for t in payload.get("tasks", []):
        proj = t.get("project") or {}
        meta = t.get("metadata") or {}
        tasks.append(
            {
                "id": t.get("id"),
                "title": t.get("title"),
                "status": t.get("status"),
                "project": proj.get("name"),
                "next_action": meta.get("nextAction"),
            }
        )
    return tasks


def collect_tn(cwd: Path) -> dict[str, Any]:
    """tn next (top 5) + blocked (best-effort). Degrades cleanly if tn/vault absent."""
    try:
        repo = _repo_root(cwd)
        nxt = _tn_json(repo, "next", "--format", "json", "--limit", "5")
        if nxt is None:
            return _unavailable("tn unavailable (no tasknotes_cli.py or no vault)")
        blocked = _tn_json(repo, "list", "--status", "blocked", "--format", "json")
        return {
            "available": True,
            "next": _tn_tasks(nxt),
            "blocked": _tn_tasks(blocked),
        }
    except Exception as exc:  # noqa: BLE001
        return _unavailable(f"collect_tn failed: {exc}")


# ---------------------------------------------------------------------------
# 6. Tokens — last session + rolling 7-day sum
# ---------------------------------------------------------------------------


def _session_analyze_json(cwd: Path) -> dict[str, Any] | None:
    sa = SCRIPTS_DIR / "session_analyze.py"
    if not sa.is_file():
        return None
    out = _run(
        ["uv", "run", "--script", str(sa), "--output-json", "--cwd", str(cwd)], cwd
    )
    if out is None:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return None


def _encode_cwd(cwd: str) -> str:
    """Mirror session_analyze's CWD->project-dir encoding (non-alnum -> '-')."""
    return re.sub(r"[^A-Za-z0-9]", "-", cwd)


def _session_mtimes(cwd: Path) -> dict[str, float]:
    """Map session_id (jsonl stem) -> mtime, for dating per-session token stats."""
    projects_dir = os.environ.get("CLAUDE_PROJECTS_DIR")
    base = Path(projects_dir) if projects_dir else Path.home() / ".claude" / "projects"
    sess_dir = base / _encode_cwd(str(cwd))
    if not sess_dir.is_dir():
        return {}
    out: dict[str, float] = {}
    for jf in sess_dir.glob("*.jsonl"):
        try:
            out[jf.stem] = jf.stat().st_mtime
        except OSError:
            continue
    return out


def collect_tokens(cwd: Path, now: datetime | None = None) -> dict[str, Any]:
    """Last finished session (in/out/cache) + rolling 7-day sum (total + count)."""
    try:
        agg = _session_analyze_json(cwd)
        if agg is None:
            return _unavailable("session_analyze.py unavailable")
        per_session = agg.get("token_stats", {}).get("per_session", [])
        if not per_session:
            return {
                "available": True,
                "last_session": None,
                "week": None,
                "sessions": [],
            }

        mtimes = _session_mtimes(cwd)
        now = now or datetime.now(timezone.utc)
        cutoff = (now - timedelta(days=7)).timestamp()

        # Last session = highest mtime; fall back to last in list order.
        def _mtime(s: dict[str, Any]) -> float:
            return mtimes.get(s.get("session_id", ""), 0.0)

        last = max(per_session, key=_mtime) if mtimes else per_session[-1]
        last_session = {
            "session_id": (last.get("session_id") or "")[:8],
            "turns": last.get("turns", 0),
            "input": last.get("total_input_tokens", 0),
            "output": last.get("total_output_tokens", 0),
            "cache_read": last.get("total_cache_read_tokens", 0),
            "cache_creation": last.get("total_cache_creation_tokens", 0),
            "cost": round(
                _est_cost(
                    last.get("total_input_tokens", 0),
                    last.get("total_output_tokens", 0),
                    last.get("total_cache_read_tokens", 0),
                    last.get("total_cache_creation_tokens", 0),
                ),
                4,
            ),
        }

        # Clustering inputs (errors + repeated commands), indexed by full session id.
        failed_all = agg.get("failed_commands", []) or []
        repeated_all = (agg.get("waste_signals") or {}).get(
            "repeated_commands", []
        ) or []
        failed_by_sess: dict[str, list[dict[str, Any]]] = {}
        for fc in failed_all:
            failed_by_sess.setdefault(fc.get("session_id", ""), []).append(fc)

        # Rolling 7-day window over sessions whose mtime is within cutoff.
        wk_in = wk_out = wk_cr = wk_cc = 0
        wk_count = 0
        for s in per_session:
            mt = mtimes.get(s.get("session_id", ""))
            if mt is None or mt < cutoff:
                continue
            wk_count += 1
            wk_in += s.get("total_input_tokens", 0)
            wk_out += s.get("total_output_tokens", 0)
            wk_cr += s.get("total_cache_read_tokens", 0)
            wk_cc += s.get("total_cache_creation_tokens", 0)

        week = {
            "session_count": wk_count,
            "input": wk_in,
            "output": wk_out,
            "cache_read": wk_cr,
            "cache_creation": wk_cc,
            "total": wk_in + wk_out + wk_cr + wk_cc,
        }

        # Full session list (newest first), dated via jsonl mtime, capped at 30.
        sessions: list[dict[str, Any]] = []
        for s in per_session:
            sid = s.get("session_id", "") or ""
            mt = mtimes.get(sid)
            inp = s.get("total_input_tokens", 0)
            out = s.get("total_output_tokens", 0)
            cr = s.get("total_cache_read_tokens", 0)
            cc = s.get("total_cache_creation_tokens", 0)
            errs = failed_by_sess.get(sid, [])
            reps = [r for r in repeated_all if sid in (r.get("sessions") or [])]
            reps.sort(key=lambda x: -x.get("count", 0))
            sessions.append(
                {
                    "session_id": sid[:8],
                    "turns": s.get("turns", 0),
                    "input": inp,
                    "output": out,
                    "cache_read": cr,
                    "cache_creation": cc,
                    "total": inp + out + cr + cc,
                    "cost": round(_est_cost(inp, out, cr, cc), 4),
                    "date": _fmt_mtime(mt),
                    "error_count": len(errs),
                    "errors": [
                        {
                            "tool": e.get("tool", ""),
                            "command": (e.get("command", "") or "")[:200],
                            "preview": (e.get("error_preview", "") or "")[:240],
                        }
                        for e in errs[:12]
                    ],
                    "repeat_count": len(reps),
                    "repeats": [
                        {
                            "command": (r.get("command", "") or "")[:200],
                            "count": r.get("count", 0),
                        }
                        for r in reps[:12]
                    ],
                    "_mt": mt or 0.0,
                }
            )
        sessions.sort(key=lambda x: x["_mt"], reverse=True)
        for s in sessions:
            s.pop("_mt", None)
        sessions = sessions[:30]

        return {
            "available": True,
            "last_session": last_session,
            "week": week,
            "sessions": sessions,
            "errors_total": len(failed_all),
            "repeats_total": len(repeated_all),
            "tool_freq": agg.get("tool_frequencies", {}),
        }
    except Exception as exc:  # noqa: BLE001
        return _unavailable(f"collect_tokens failed: {exc}")


# ---------------------------------------------------------------------------
# 7. Cost — account-wide $ (same source as claude-watch-tui.py fetch_cost_stats)
# ---------------------------------------------------------------------------
#
# Reads the per-day ccusage JSON written by ccusage-sync.py into PKM_USAGE_DIR
# (default ~/GITHUB/ObsidianPKM/skripte/usage). Each per-day file carries
# {date, machine, ccusage:{total_cost}}; *_rl.json files carry rate-limit
# snapshots {ts, five_hour_pct, five_hour_resets_at, seven_day_pct,
# seven_day_resets_at}. NOTE: this is ACCOUNT-WIDE across all machines — it is
# NOT scoped to the current repo (unlike the per-project Tokens card).


def _usage_dir() -> Path:
    env = os.environ.get("PKM_USAGE_DIR")
    if env:
        return Path(env)
    return Path.home() / "GITHUB" / "ObsidianPKM" / "skripte" / "usage"


def _load_daily_costs(usage_dir: Path) -> list[dict[str, Any]]:
    """Per-day rows {date, cost}. Skips *_rl.json / *.migrated / old combined format."""
    rows: list[dict[str, Any]] = []
    for f in usage_dir.glob("*.json"):
        n = f.name
        if n.endswith("_rl.json") or n.endswith(".migrated"):
            continue
        try:
            data = json.loads(f.read_text(encoding="utf-8", errors="replace"))
        except (json.JSONDecodeError, OSError, ValueError):
            continue
        if not isinstance(data, dict) or "ccusage_daily" in data:
            continue
        d = data.get("date", "")
        if not d:
            continue
        cost = float((data.get("ccusage") or {}).get("total_cost", 0) or 0)
        rows.append({"date": d, "cost": cost})
    return rows


def _latest_rl_snapshot(usage_dir: Path) -> dict[str, Any]:
    """Read all *_rl.json, return the snapshot with the newest ``ts``."""
    best_ts, best = "", {}
    for f in usage_dir.glob("*_rl.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8", errors="replace"))
        except (json.JSONDecodeError, OSError, ValueError):
            continue
        if not isinstance(data, dict):
            continue
        ts = str(data.get("ts", ""))
        if ts > best_ts:
            best_ts, best = ts, data
    return best


def _rate_limit_from_snapshot(
    pct: Any, resets_at: Any, window_secs: int, now_ts: int
) -> dict[str, Any] | None:
    """Build a rate-limit dict from raw pct + resets_at epoch (ported from the TUI)."""
    if pct is None or resets_at is None:
        return None
    try:
        remaining = int(resets_at) - now_ts
    except (TypeError, ValueError):
        return None
    if remaining <= 0 or remaining > window_secs:
        return None
    elapsed = window_secs - remaining
    if elapsed <= 0:
        return None
    frac = elapsed / window_secs
    projected = pct / frac if frac > 0 else 0.0
    d, rem = divmod(remaining, 86400)
    h, rem = divmod(rem, 3600)
    m = rem // 60
    countdown = f"{d}d{h}h" if d else (f"{h}h{m}m" if h else f"{m}m")
    return {
        "used_pct": round(float(pct), 1),
        "elapsed_pct": round(frac * 100, 1),
        "projected_pct": round(projected, 1),
        "resets_in": countdown,
    }


def collect_cost(
    usage_dir: Path | None = None, now: datetime | None = None
) -> dict[str, Any]:
    """Account-wide cost (today/yesterday/week/month/total) + 5h/7d rate limits.

    Same source as claude-watch-tui.py. Week starts Friday (Claude 7d reset
    Thu->Fri). Spans all machines — NOT scoped to the current repo. NOTE: "total"
    is all-time over every per-day file (the TUI caps its chart at 90 days; here
    there is no chart, so total means the full history).
    """
    try:
        udir = usage_dir or _usage_dir()
        if not udir.is_dir():
            return _unavailable(f"usage/ nicht gefunden: {udir}")
        rows = _load_daily_costs(udir)
        if not rows:
            return _unavailable(f"keine ccusage-JSON in {udir}")

        now = now or datetime.now()
        today = now.date()
        # Woche startet Freitag (Mo=0..So=6, Fr=4).
        week_start = today - timedelta(days=(today.weekday() - 4) % 7)
        month_start = today.replace(day=1)
        today_s = today.isoformat()
        yest_s = (today - timedelta(days=1)).isoformat()
        week_s = week_start.isoformat()
        month_s = month_start.isoformat()

        today_c = yest_c = week_c = month_c = total_c = 0.0
        for r in rows:
            d, c = r["date"], r["cost"]
            total_c += c
            if d == today_s:
                today_c += c
            if d == yest_s:
                yest_c += c
            if d >= week_s:
                week_c += c
            if d >= month_s:
                month_c += c

        result: dict[str, Any] = {
            "available": True,
            "today": today_c,
            "yesterday": yest_c,
            "week": week_c,
            "month": month_c,
            "total": total_c,
            "five_hour": None,
            "seven_day": None,
        }

        rl = _latest_rl_snapshot(udir)
        if rl:
            now_ts = int(now.timestamp())
            result["five_hour"] = _rate_limit_from_snapshot(
                rl.get("five_hour_pct"), rl.get("five_hour_resets_at"), 5 * 3600, now_ts
            )
            result["seven_day"] = _rate_limit_from_snapshot(
                rl.get("seven_day_pct"),
                rl.get("seven_day_resets_at"),
                7 * 24 * 3600,
                now_ts,
            )
        return result
    except Exception as exc:  # noqa: BLE001
        return _unavailable(f"collect_cost failed: {exc}")


# ---------------------------------------------------------------------------
# 8. Git — read-only status + gated mutating actions
# ---------------------------------------------------------------------------
#
# collect_git() is read-only (branch, branches, status, diff stat, a recommended
# next action). The state-mutating actions live as POST endpoints in build_app()
# and call the FastAPI-free helpers below (testable in isolation). Guardrails:
#   * localhost-only + Origin check (see _csrf_ok in build_app).
#   * commit + delete run locally; delete uses safe `-d` (refuses unmerged).
#   * push and merge->main require a typed confirmation token (PUSH / MERGE);
#     delete requires the exact branch name. The real git output is shown — no
#     blind "success".


def _git_lines(cwd: Path, *args: str) -> list[str]:
    out = _git(cwd, *args)
    return [ln.strip() for ln in (out or "").splitlines() if ln.strip()]


def _ahead_behind(cwd: Path, base: str, ref: str) -> tuple[int, int] | None:
    """(ahead, behind) of ref vs base via rev-list --left-right --count base...ref."""
    out = _git(cwd, "rev-list", "--left-right", "--count", f"{base}...{ref}")
    if not out:
        return None
    parts = out.split()
    if len(parts) != 2:
        return None
    try:
        behind, ahead = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    return ahead, behind


def _git_recommend(
    branch: str, dirty: bool, ahead_origin: int | None, ahead_main: int | None
) -> str:
    if dirty:
        return "Uncommittete Änderungen → erst committen (dann nach Review push/merge)."
    if branch != "main" and (ahead_main or 0) > 0:
        return f"'{branch}' ist {ahead_main} Commit(s) vor main → nach Review nach main mergen."
    if branch != "main" and ahead_main == 0:
        return f"'{branch}' ist vollständig in main → Branch kann gelöscht werden."
    if (ahead_origin or 0) > 0:
        return f"{ahead_origin} Commit(s) vor origin → nach Review pushen."
    return "Clean & in sync — nichts zu tun."


def collect_git(cwd: Path) -> dict[str, Any]:
    """Read-only git state: branch, local branches, status, diff stat, recommendation."""
    try:
        repo = _repo_root(cwd)
        branch = _git(repo, "rev-parse", "--abbrev-ref", "HEAD")
        if branch is None:
            return _unavailable("kein git-Repo")
        branch = branch.strip()

        branches = _git_lines(repo, "branch", "--format=%(refname:short)")

        # Per-file added/deleted line counts (numstat) for the file-list column.
        numstat: dict[str, tuple[int | None, int | None]] = {}
        for ln in (_git(repo, "diff", "--numstat", "HEAD") or "").splitlines():
            parts = ln.split("\t")
            if len(parts) != 3:
                continue
            a, d, pth = parts
            ai = int(a) if a.isdigit() else None  # "-" for binary
            di = int(d) if d.isdigit() else None
            numstat[pth.strip()] = (ai, di)

        status = _git(repo, "status", "--porcelain") or ""
        staged = unstaged = untracked = 0
        files: list[str] = []
        files_struct: list[dict[str, Any]] = []
        for ln in status.splitlines():
            if not ln:
                continue
            is_untracked = ln.startswith("??")
            if is_untracked:
                untracked += 1
            else:
                if ln[0] != " ":
                    staged += 1
                if len(ln) > 1 and ln[1] != " ":
                    unstaged += 1
            files.append(ln.rstrip())
            xy = ln[:2]
            path = ln[3:].strip()
            if " -> " in path:  # rename/copy: keep the new path
                path = path.split(" -> ")[-1].strip()
            path = path.strip('"')
            added, deleted = numstat.get(path, (None, None))
            files_struct.append(
                {
                    "xy": xy,
                    "path": path,
                    "untracked": is_untracked,
                    "added": added,
                    "deleted": deleted,
                }
            )
        dirty = bool(status.strip())

        shortstat = (_git(repo, "diff", "--shortstat", "HEAD") or "").strip()

        ahead_origin = behind_origin = None
        ab_o = _ahead_behind(repo, f"origin/{branch}", branch)
        if ab_o:
            ahead_origin, behind_origin = ab_o
        ahead_main = None
        if branch != "main":
            ab_m = _ahead_behind(repo, "main", branch)
            if ab_m:
                ahead_main = ab_m[0]

        return {
            "available": True,
            "branch": branch,
            "branches": branches,
            "staged": staged,
            "unstaged": unstaged,
            "untracked": untracked,
            "files": files[:40],
            "files_struct": files_struct[:60],
            "dirty": dirty,
            "shortstat": shortstat,
            "ahead_origin": ahead_origin,
            "behind_origin": behind_origin,
            "ahead_main": ahead_main,
            "recommend": _git_recommend(branch, dirty, ahead_origin, ahead_main),
        }
    except Exception as exc:  # noqa: BLE001
        return _unavailable(f"collect_git failed: {exc}")


_GIT_DIFF_MAX = 200000


def _git_diff(cwd: Path, relpath: str) -> dict[str, Any]:
    """Read-only diff for one path (or whole worktree if empty). Guards traversal.

    Tries ``git diff HEAD -- <path>``; if that is empty (e.g. an untracked file)
    falls back to ``git diff --no-index /dev/null <path>`` so new files show as
    additions. ``relpath`` is resolved and must stay inside the repo.
    """
    try:
        repo = _repo_root(cwd)
        if relpath:
            cand = (repo / relpath).resolve()
            try:
                cand.relative_to(repo.resolve())
            except ValueError:
                return {"ok": False, "error": "Pfad ausserhalb des Repos"}
            args = ["git", "-C", str(repo), "diff", "HEAD", "--", relpath]
        else:
            args = ["git", "-C", str(repo), "diff", "HEAD"]

        def _capture(a: list[str]) -> str:
            r = subprocess.run(a, capture_output=True, text=True, timeout=30)
            return (r.stdout or "") + (r.stderr or "")

        out = _capture(args)
        if relpath and not out.strip():  # untracked → show full file as additions
            out = _capture(
                [
                    "git",
                    "-C",
                    str(repo),
                    "diff",
                    "--no-index",
                    "--",
                    "/dev/null",
                    relpath,
                ]
            )
        out = out or "(keine Änderungen)"
        return {
            "ok": True,
            "path": relpath or "(gesamt)",
            "truncated": len(out) > _GIT_DIFF_MAX,
            "diff": out[:_GIT_DIFF_MAX],
        }
    except (FileNotFoundError, subprocess.SubprocessError, OSError) as exc:
        return {"ok": False, "error": str(exc)}


def _git_action(cwd: Path, *args: str, timeout: int = 120) -> dict[str, Any]:
    """Run a mutating git command; return {ok, cmd, output} with the REAL output."""
    cmd = "git " + " ".join(args)
    try:
        r = subprocess.run(
            ["git", "-C", str(cwd), *args],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (FileNotFoundError, subprocess.SubprocessError, OSError) as exc:
        return {"ok": False, "cmd": cmd, "output": str(exc)}
    output = ((r.stdout or "") + (r.stderr or "")).strip()
    return {"ok": r.returncode == 0, "cmd": cmd, "output": output or "(kein Output)"}


def git_commit(cwd: Path, message: str) -> dict[str, Any]:
    message = (message or "").strip()
    if not message:
        return {"ok": False, "cmd": "git commit", "output": "leere Commit-Message"}
    add = _git_action(cwd, "add", "-A")
    if not add["ok"]:
        return add
    return _git_action(cwd, "commit", "-m", message)


def git_delete(cwd: Path, branch: str) -> dict[str, Any]:
    branch = (branch or "").strip()
    if not branch:
        return {"ok": False, "cmd": "git branch -d", "output": "kein Branch angegeben"}
    return _git_action(cwd, "branch", "-d", branch)


def git_merge(cwd: Path, branch: str) -> dict[str, Any]:
    branch = (branch or "").strip()
    if not branch:
        return {"ok": False, "cmd": "git merge", "output": "kein Branch angegeben"}
    sw = _git_action(cwd, "switch", "main")
    if not sw["ok"]:
        return sw
    return _git_action(cwd, "merge", "--no-ff", branch)


def git_push(cwd: Path, branch: str) -> dict[str, Any]:
    branch = (branch or "").strip() or "HEAD"
    return _git_action(cwd, "push", "origin", branch)


# ---------------------------------------------------------------------------
# Project discovery — sibling repos with a backlog/ folder (for the tab bar)
# ---------------------------------------------------------------------------

_PROJECTS_BASE = Path.home() / "GITHUB"


def discover_projects(
    active_repo: Path, base: Path | None = None
) -> list[dict[str, str]]:
    """List sibling projects that have a ``backlog/`` folder — for the tab bar.

    Scans ``base`` (default ~/GITHUB) for immediate child dirs containing a
    ``backlog/`` subfolder. The ``active_repo`` (the repo the dashboard was
    launched for) is ALWAYS included, even if it lives outside ``base`` — so the
    project you started from is always a tab. Returns ``[{name, path}]`` sorted
    by name. Read-only and cheap (no git, no task parsing) so it can run per
    request to mirror the live, no-cache design of the collectors.
    """
    base = base or _PROJECTS_BASE
    found: dict[str, Path] = {}
    try:
        if base.is_dir():
            for d in sorted(base.iterdir()):
                try:
                    if d.is_dir() and (d / "backlog").is_dir():
                        found[d.name] = d
                except OSError:
                    continue
    except OSError:
        pass
    found.setdefault(active_repo.name, active_repo)
    return [{"name": n, "path": str(found[n])} for n in sorted(found)]


def resolve_project_cwd(
    project: str, projects: list[dict[str, str]], default_cwd: Path
) -> Path:
    """Map a ``project`` name to its discovered path (whitelist); else default.

    Only names present in ``projects`` (the server-built discovery list) resolve
    to a path — an unknown or empty name falls back to ``default_cwd``. This is
    the guard that stops ``?project=`` from pointing the dashboard at an
    arbitrary filesystem path (no traversal: the name must match a known repo).
    """
    if project:
        for p in projects:
            if p.get("name") == project:
                return Path(p["path"])
    return default_cwd


# ---------------------------------------------------------------------------
# Context assembly
# ---------------------------------------------------------------------------


def build_context(
    cwd: Path,
    claude_home: Path | None = None,
    projects: list[dict[str, str]] | None = None,
    active_project: str | None = None,
) -> dict[str, Any]:
    """Run all eight collectors sequentially (no cache) and return one context dict.

    ``projects`` + ``active_project`` (optional) carry the tab-bar discovery list
    and the currently inspected project name through to ``build_data``.
    """
    home = claude_home or (Path.home() / ".claude")
    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "cwd": str(cwd),
        "projects": projects or [],
        "active_project": active_project or "",
        "cards": {
            "global": collect_global(home),
            "project": collect_project(cwd),
            "git": collect_git(cwd),
            "knowledge": collect_knowledge(cwd),
            "backlog": collect_backlog(cwd),
            "tn": collect_tn(cwd),
            "tokens": collect_tokens(cwd),
            "cost": collect_cost(),
        },
    }


# ---------------------------------------------------------------------------
# HTML rendering (server-side, no JS framework)
# ---------------------------------------------------------------------------

_ASSETS_DIR = SCRIPTS_DIR / "knowledge_assets"


def _read_asset(name: str) -> str:
    """Read a sibling design asset (dash.css / browser.css / browser.js)."""
    try:
        return (_ASSETS_DIR / name).read_text(encoding="utf-8")
    except OSError:
        return ""


# Extra CSS layered on top of the design assets: git-action forms in the Git
# detail pane. Uses the dash.css design tokens so it matches the terminal theme.
_EXTRA_CSS = """
.gitforms{ display:grid; gap:9px; }
.gf{ display:flex; flex-wrap:wrap; gap:7px; align-items:center; }
.gf input{ font:inherit; font-size:12px; padding:5px 9px; border:1px solid var(--line-2);
  border-radius:6px; background:var(--inset); color:var(--fg); flex:1; min-width:120px; }
.gf input::placeholder{ color:var(--faint); }
.gf button{ font:inherit; font-size:11.5px; font-weight:700; padding:6px 12px; border-radius:6px;
  border:1px solid color-mix(in oklch,var(--green) 40%,var(--line-2)); background:var(--green-d);
  color:var(--green); cursor:pointer; white-space:nowrap; }
.gf button.danger{ border-color:color-mix(in oklch,var(--red) 45%,var(--line-2));
  background:var(--red-d); color:var(--red); }
.gf .gn{ font-size:10px; color:var(--red); }

/* inline file reader (skills / CLAUDE.md) */
.filebody{ background:var(--inset); border:1px solid var(--line); border-radius:8px;
  padding:13px 15px; font-size:11.5px; line-height:1.6; color:var(--fg-2);
  white-space:pre-wrap; word-break:break-word; max-height:62vh; overflow:auto; margin:0; }
.filebody.loading{ color:var(--faint); font-style:italic; white-space:normal; }
.ftrunc{ color:var(--faint); font-size:10.5px; margin-top:6px; }

/* compact rate-limit gauges inside the overview cost tile */
.rlwrap{ display:grid; gap:9px; margin-top:2px; }
.rlm-row{ display:flex; justify-content:space-between; gap:8px; margin-bottom:4px; align-items:baseline; }
.rlm-l{ font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:var(--dim); }
.rlm-v{ font-size:10px; color:var(--fg-2); font-variant-numeric:tabular-nums; }
.rlm-na{ font-size:10px; color:var(--faint); }

/* clamp long list subtitles (skill descriptions) to two lines */
.mp-list .li .li-s{ display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }

/* hook entries: matcher + type + command (command can be long → wrap) */
.hookrows{ display:grid; gap:8px; }
.hookrow{ background:var(--panel); border:1px solid var(--line); border-radius:7px; padding:9px 11px; }
.hookrow .hh{ display:flex; gap:8px; align-items:baseline; margin-bottom:5px; }
.hookrow .hh code{ color:var(--cyan); font-size:11px; }
.hookrow .hh .ht{ color:var(--faint); font-size:10px; text-transform:uppercase; letter-spacing:.08em; }
.hookrow .hc{ font-size:11px; color:var(--green); white-space:pre-wrap; word-break:break-word; line-height:1.5; }

/* sidebar token sub-line (Skills/Agents/CLAUDE.md totals) */
.nav-i .nc{ text-align:right; line-height:1.25; }
.nav-i .nc small{ display:block; font-size:8.5px; color:var(--faint); font-weight:500; letter-spacing:.02em; }

/* file-meta line above an inline file body */
.fmeta{ font-size:10px; color:var(--faint); margin-bottom:5px; font-variant-numeric:tabular-nums; }

/* clickable file/script chips (skills scripts, hook scripts) */
.fchips{ display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
.fchip{ font:inherit; font-size:10.5px; color:var(--fg-2); background:var(--panel-3);
  border:1px solid var(--line-2); border-radius:6px; padding:4px 9px; cursor:pointer;
  display:inline-flex; align-items:center; gap:7px; white-space:nowrap; }
.fchip:hover{ background:var(--panel-2); border-color:var(--line-3); }
.fchip.is-active{ border-color:color-mix(in oklch,var(--cyan) 45%,var(--line-2)); color:var(--cyan); }
.fchip .fl{ font-size:8.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--amber); }
.fchip .fz{ color:var(--faint); font-size:9.5px; }
.fchip.diffall{ color:var(--cyan); }
.filehost2{ margin-top:4px; }

/* git changed-files list (clickable -> diff) */
.gfiles{ display:grid; gap:4px; margin-bottom:10px; }
.gfile{ font:inherit; font-size:11.5px; text-align:left; background:var(--panel);
  border:1px solid var(--line); border-radius:6px; padding:6px 10px; cursor:pointer;
  display:flex; align-items:center; gap:9px; color:var(--fg-2); }
.gfile:hover{ background:var(--panel-2); }
.gfile.is-active{ box-shadow:inset 2px 0 0 var(--cyan); background:var(--panel-3); }
.gfile .gfp{ word-break:break-all; }

/* diff coloring */
.filebody.diff{ padding:0; }
.filebody.diff .dl{ display:block; padding:0 13px; }
.filebody.diff .dp{ color:var(--green); background:color-mix(in oklch,var(--green) 9%,transparent); }
.filebody.diff .dm{ color:var(--red); background:color-mix(in oklch,var(--red) 9%,transparent); }
.filebody.diff .dh{ color:var(--cyan); }
.filebody.diff .df{ color:var(--dim); }

/* backlog: milestone group headers + collapsible Done group */
.mp-list .li-group{ position:sticky; top:0; z-index:1; font-size:9.5px; letter-spacing:.12em;
  text-transform:uppercase; color:var(--amber); background:var(--panel);
  padding:9px 13px 5px; border-bottom:1px solid var(--line); }
.mp-list details.done-grp{ border-top:1px solid var(--line-2); }
.mp-list details.done-grp > summary{ list-style:none; cursor:pointer; font-size:9.5px;
  letter-spacing:.12em; text-transform:uppercase; color:var(--dim);
  padding:10px 13px; user-select:none; }
.mp-list details.done-grp > summary::-webkit-details-marker{ display:none; }
.mp-list details.done-grp > summary:hover{ background:var(--panel-2); color:var(--fg-2); }
.mp-list details.done-grp[open] > summary{ color:var(--green); }
.mp-list details.done-grp .ct{ color:var(--faint); }

/* clustering rows (errors + repeated commands) in the session detail */
.clrows{ display:grid; gap:7px; }
.clrow{ background:var(--panel); border:1px solid var(--line); border-radius:7px; padding:8px 11px; }
.clrow.cl-err{ border-color:color-mix(in oklch,var(--red) 30%,var(--line)); }
.clrow .clh{ display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; }
.clrow .clh code{ color:var(--green); font-size:11px; word-break:break-all; }
.clrow .clt{ font-size:10px; font-weight:700; padding:1px 6px; border-radius:5px;
  background:var(--panel-3); color:var(--dim); white-space:nowrap; }
.clrow .clt.r{ color:var(--red); } .clrow .clt.a{ color:var(--amber); }
.clrow .clp{ margin-top:6px; font-size:10.5px; color:var(--fg-2); white-space:pre-wrap;
  word-break:break-word; max-height:120px; overflow:auto; }

/* Git: changed-files list (col 2) — lean rows, no boxes */
.list-head .gss{ font-size:10px; color:var(--dim); margin-top:7px; font-variant-numeric:tabular-nums; }
.mp-list .gfile{ width:100%; font:inherit; font-size:12px; text-align:left; background:none;
  border:0; border-bottom:1px solid var(--line); padding:7px 13px; cursor:pointer;
  display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:9px; color:var(--fg-2); }
.mp-list .gfile:hover{ background:var(--panel-2); }
.mp-list .gfile.is-active{ background:var(--panel-3); box-shadow:inset 2px 0 0 var(--cyan); color:var(--fg-strong); }
.mp-list .gfile .gfp{ word-break:break-all; line-height:1.3; }
.mp-list .gfile .gdelta{ font-size:10px; font-variant-numeric:tabular-nums; white-space:nowrap; }
.gd-add{ color:var(--green); } .gd-del{ color:var(--red); margin-left:5px; } .gd-new{ color:var(--amber); }
.git-actions{ border-top:1px solid var(--line-2); margin-top:4px; }
.git-actions > summary{ list-style:none; cursor:pointer; font-size:9.5px; letter-spacing:.1em;
  text-transform:uppercase; color:var(--dim); padding:11px 13px; user-select:none; }
.git-actions > summary::-webkit-details-marker{ display:none; }
.git-actions > summary:hover{ color:var(--fg-2); }
.git-actions > summary .ct{ color:var(--faint); text-transform:none; letter-spacing:0; }
.git-actions .gitforms{ padding:2px 13px 14px; }

/* Git: diff pane (col 3) fills, sticky filename header, single scroll */
.gitdiff{ min-height:100%; }
.gitdiff-head{ display:flex; align-items:baseline; gap:12px; flex-wrap:wrap;
  padding:12px 16px; border-bottom:1px solid var(--line);
  position:sticky; top:0; background:var(--bg-grid); z-index:2; }
.gitdiff-head code{ color:var(--green); font-size:12.5px; word-break:break-all; }
.gitdiff-head .gdh-rec{ color:var(--dim); font-size:10.5px; }
.gitdiff .filebody.diff{ border:0; border-radius:0; max-height:none; overflow:visible; }

/* side-by-side diff (left = HEAD, right = working tree) */
.splitdiff{ font-size:11.5px; line-height:1.55; font-variant-numeric:tabular-nums; }
.sd-headrow, .sd-row{ display:grid; grid-template-columns:46px minmax(0,1fr) 46px minmax(0,1fr); }
.sd-headrow{ position:sticky; top:0; z-index:1; background:var(--panel); border-bottom:1px solid var(--line-2); }
.sd-headrow .sd-h{ grid-column:span 2; padding:7px 12px; font-size:9.5px; letter-spacing:.1em;
  text-transform:uppercase; color:var(--dim); }
.sd-headrow .sd-h:nth-child(2){ border-left:1px solid var(--line-2); }
.sd-hunk{ padding:3px 12px; color:var(--cyan); background:var(--inset);
  border-top:1px solid var(--line); border-bottom:1px solid var(--line); font-size:10.5px; }
.sd-ln{ text-align:right; padding:1px 8px; color:var(--faint); font-size:10px; user-select:none;
  border-right:1px solid var(--line); background:var(--bg-grid); }
.sd-code{ padding:1px 10px; white-space:pre-wrap; word-break:break-word; color:var(--fg-2);
  border-right:1px solid var(--line); }
.sd-code.dm{ background:color-mix(in oklch,var(--red) 13%,transparent); color:var(--red); }
.sd-code.dp{ background:color-mix(in oklch,var(--green) 13%,transparent); color:var(--green); }
.sd-code.empty{ background:repeating-linear-gradient(45deg,transparent,transparent 6px,var(--inset) 6px,var(--inset) 12px); }
"""


def _esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def _fmt_compact(n: Any) -> str:
    """Compact token/number formatting: 1.2k / 26.7M / 1.30B."""
    try:
        n = float(n)
    except (TypeError, ValueError):
        return "0"
    if n >= 1e9:
        return f"{n / 1e9:.2f}B"
    if n >= 1e6:
        return f"{n / 1e6:.1f}M"
    if n >= 1e3:
        return f"{n / 1e3:.1f}k"
    return str(int(n))


def build_data(context: dict[str, Any]) -> dict[str, Any]:
    """Map the collector ``cards`` dict into the browser DATA object.

    Shape consumed by knowledge_assets/browser.js: ``meta``, ``nav`` (groups),
    ``coll`` (list-based sections), ``git`` + ``cost`` (special panes), and
    ``overview`` (tmux tiles). Security note: hook commands and settings VALUES
    are intentionally NOT carried here — only event names/counts and what the
    collectors already redacted upstream.
    """
    cards = context.get("cards", {})

    def av(key: str) -> dict[str, Any]:
        c = cards.get(key)
        return c if isinstance(c, dict) and c.get("available") else {}

    g, p, kn = av("global"), av("project"), av("knowledge")
    bl, tnc, tok = av("backlog"), av("tn"), av("tokens")
    gitc = cards.get("git") if isinstance(cards.get("git"), dict) else {}
    costc = cards.get("cost") if isinstance(cards.get("cost"), dict) else {}

    skill_items = (g.get("skills") or {}).get("items")
    if skill_items is None:
        skill_items = [{"name": n} for n in (g.get("skills") or {}).get("names", [])]
    skills = [
        {
            "name": s.get("name"),
            "cat": "",
            "desc": s.get("description", "") or "",
            "tokens": s.get("tokens", 0),
            "size": s.get("size_bytes", 0),
            "has_md": bool(s.get("has_md")),
            "scripts": s.get("scripts", []),
        }
        for s in skill_items
    ]
    skills_tok = sum(s["tokens"] for s in skills)

    agent_items = g.get("agent_items")
    if agent_items is None:
        agent_items = [{"name": a} for a in g.get("agents", [])]
    agents = [
        {
            "name": a.get("name"),
            "role": a.get("description", "") or "",
            "tools": [],
            "tokens": a.get("tokens", 0),
            "size": a.get("size_bytes", 0),
        }
        for a in agent_items
    ]
    agents_tok = sum(a["tokens"] for a in agents)
    settings = g.get("settings") or {}
    hook_events = settings.get("hook_events", {}) if settings else {}
    hook_detail = settings.get("hook_detail", {}) if settings else {}
    hooks = [
        {"name": ev, "count": c, "entries": hook_detail.get(ev, [])}
        for ev, c in hook_events.items()
    ]

    pknow = [
        {
            "name": e.get("title"),
            "type": e.get("path", "").rsplit(".", 1)[-1] if e.get("path") else "",
            "desc": e.get("desc", ""),
            "path": e.get("path", ""),
        }
        for e in p.get("knowledge_index", [])
    ]
    # Project CLAUDE.md: section headers as items + a doc-meta for inline reading.
    psections = [
        {"name": h, "type": "section", "desc": ""}
        for h in p.get("claude_md_headers", [])
    ]
    pdoc = {
        "kind": "claude-project",
        "tokens": p.get("claude_md_tokens", 0),
        "size": p.get("claude_md_size", 0),
    }
    if not psections and (pdoc["tokens"] or pdoc["size"]):
        psections = [{"name": "(ganze Datei)", "type": "section", "desc": ""}]

    # Global CLAUDE.md: same shape, scope=global.
    gmd = g.get("claude_md") or {}
    gsections = [
        {"name": h, "type": "section", "desc": ""} for h in (gmd.get("headers") or [])
    ]
    gdoc = {
        "kind": "claude-global",
        "tokens": gmd.get("tokens", 0),
        "size": gmd.get("size_bytes", 0),
        "managed": bool(gmd.get("managed_block")),
    }
    if not gsections and (gdoc["tokens"] or gdoc["size"]):
        gsections = [{"name": "(ganze Datei)", "type": "section", "desc": ""}]

    decisions = [
        {
            "name": f"{d.get('id')} — {d.get('title')}",
            "id": d.get("id"),
            "status": d.get("status", ""),
            "ctx": "",
            "dec": "",
            "body": d.get("body", ""),
        }
        for d in kn.get("decisions", [])
    ]
    memory = [{"name": m, "desc": ""} for m in kn.get("memory", [])]
    lessons = [{"name": x, "desc": ""} for x in kn.get("lektionen", [])]
    changelog = [
        {"name": c, "type": "changelog", "desc": ""} for c in kn.get("changelog", [])
    ]

    # Tasks read from files (one entry each → no duplicates). Group by milestone;
    # Done tasks go into a separate collapsible group at the bottom of the list.
    _STATUS_ORDER = {"in progress": 0, "to do": 1, "blocked": 2, "done": 9}
    bl_tasks = bl.get("tasks", [])
    open_tasks = [
        t for t in bl_tasks if (t.get("status") or "").strip().lower() != "done"
    ]
    done_tasks = [
        t for t in bl_tasks if (t.get("status") or "").strip().lower() == "done"
    ]
    open_tasks.sort(
        key=lambda t: (
            (t.get("milestone") or "~"),
            _STATUS_ORDER.get((t.get("status") or "").strip().lower(), 5),
            t.get("id") or "",
        )
    )
    done_tasks.sort(key=lambda t: t.get("id") or "")

    def _task_item(t: dict[str, Any], group: str, done: bool = False) -> dict[str, Any]:
        return {
            "name": t.get("id"),
            "title": t.get("title", ""),
            "status": (t.get("status") or "").strip().lower(),
            "milestone": t.get("milestone") or "—",
            "group": group,
            "done": done,
            "desc": t.get("desc", ""),
            "file": t.get("file", ""),
        }

    tasks = [_task_item(t, t.get("milestone") or "—") for t in open_tasks]
    tasks += [_task_item(t, "Done", done=True) for t in done_tasks]

    tn_items = [
        {
            "name": t.get("title"),
            "status": t.get("status") or "action",
            "desc": t.get("next_action") or "",
            "project": t.get("project"),
        }
        for t in tnc.get("next", [])
    ] + [
        {
            "name": t.get("title"),
            "status": "blocked",
            "desc": "",
            "project": t.get("project"),
        }
        for t in tnc.get("blocked", [])
    ]

    last = tok.get("last_session")
    sess_src = tok.get("sessions")
    if sess_src is None:  # backward-compat: synthesize from last_session
        sess_src = [last] if last else []
    sessions = [
        {
            "name": s.get("session_id"),
            "date": s.get("date", ""),
            "turns": s.get("turns", 0),
            "input": s.get("input", 0),
            "output": s.get("output", 0),
            "cc": s.get("cache_creation", 0),
            "cr": s.get("cache_read", 0),
            "total": s.get(
                "total",
                s.get("input", 0)
                + s.get("output", 0)
                + s.get("cache_read", 0)
                + s.get("cache_creation", 0),
            ),
            "cost": s.get("cost", 0),
            "error_count": s.get("error_count", 0),
            "errors": s.get("errors", []),
            "repeat_count": s.get("repeat_count", 0),
            "repeats": s.get("repeats", []),
        }
        for s in sess_src
        if s
    ]
    sessions_tok = sum(s["total"] for s in sessions)
    sessions_cost = sum(s["cost"] for s in sessions)
    week = tok.get("week") or {}

    coll = {
        "skills": {
            "title": "Skills",
            "scope": "global",
            "type": "skill",
            "accent": "g",
            "items": skills,
        },
        "agents": {
            "title": "Agents",
            "scope": "global",
            "type": "agent",
            "accent": "c",
            "items": agents,
        },
        "hooks": {
            "title": "Hooks",
            "scope": "global",
            "type": "hook",
            "accent": "",
            "items": hooks,
        },
        "gclaude": {
            "title": "CLAUDE.md",
            "scope": "global",
            "type": "claude",
            "accent": "c",
            "items": gsections,
            "doc": gdoc,
        },
        "pknow": {
            "title": "knowledge/",
            "scope": "projekt",
            "type": "know",
            "accent": "c",
            "items": pknow,
        },
        "psections": {
            "title": "CLAUDE.md",
            "scope": "projekt",
            "type": "claude",
            "accent": "c",
            "items": psections,
            "doc": pdoc,
        },
        "decisions": {
            "title": "Decisions",
            "scope": "wissen",
            "type": "decision",
            "accent": "g",
            "items": decisions,
        },
        "memory": {
            "title": "Memory",
            "scope": "wissen",
            "type": "memory",
            "accent": "",
            "items": memory,
        },
        "lessons": {
            "title": "Lektionen",
            "scope": "wissen",
            "type": "lesson",
            "accent": "a",
            "items": lessons,
        },
        "changelog": {
            "title": "CHANGELOG",
            "scope": "wissen",
            "type": "changelog",
            "accent": "",
            "items": changelog,
        },
        "backlog": {
            "title": "Tasks",
            "scope": "backlog",
            "type": "task",
            "accent": "a",
            "items": tasks,
        },
        "tn": {
            "title": "tn",
            "scope": "backlog",
            "type": "task",
            "accent": "c",
            "items": tn_items,
        },
        "sessions": {
            "title": "Sessions",
            "scope": "usage",
            "type": "session",
            "accent": "m",
            "items": sessions,
        },
    }

    nav = [
        {"g": "Überblick", "items": [{"id": "ov", "label": "Übersicht", "dot": "g"}]},
        {
            "g": "Global",
            "items": [
                {
                    "id": "skills",
                    "label": "Skills",
                    "dot": "g",
                    "tok": _fmt_compact(skills_tok),
                },
                {
                    "id": "agents",
                    "label": "Agents",
                    "dot": "c",
                    "tok": _fmt_compact(agents_tok),
                },
                {"id": "hooks", "label": "Hooks", "dot": ""},
                {
                    "id": "gclaude",
                    "label": "CLAUDE.md",
                    "dot": "c",
                    "tok": _fmt_compact(gdoc["tokens"]),
                },
            ],
        },
        {
            "g": "Projekt",
            "items": [
                {"id": "pknow", "label": "knowledge/", "dot": "c"},
                {
                    "id": "psections",
                    "label": "CLAUDE.md",
                    "dot": "c",
                    "tok": _fmt_compact(pdoc["tokens"]),
                },
            ],
        },
        {"g": "Git", "items": [{"id": "git", "label": "Status & Actions", "dot": "g"}]},
        {
            "g": "Wissen",
            "items": [
                {"id": "decisions", "label": "Decisions", "dot": "g"},
                {"id": "memory", "label": "Memory", "dot": ""},
                {"id": "lessons", "label": "Lektionen", "dot": "a"},
                {"id": "changelog", "label": "CHANGELOG", "dot": ""},
            ],
        },
        {
            "g": "Backlog",
            "items": [
                {"id": "backlog", "label": "Tasks", "dot": "a"},
                {"id": "tn", "label": "tn next/blocked", "dot": "c"},
            ],
        },
        {
            "g": "Usage",
            "items": [
                {
                    "id": "sessions",
                    "label": "Sessions",
                    "dot": "m",
                    "tok": _fmt_compact(sessions_tok),
                },
                {"id": "cost", "label": "Kosten", "dot": "m"},
            ],
        },
    ]

    branch = gitc.get("branch") or p.get("branch") or "?"
    # Milestones (named, excl. the "—" bucket): how many are fully done.
    named_ms = [
        m for m in bl.get("milestones", []) if m.get("name") and m.get("name") != "—"
    ]
    ms_total = len(named_ms)
    ms_done = sum(
        1 for m in named_ms if m.get("total") and m.get("done") == m.get("total")
    )
    ms_labels = [
        f"{m.get('name')} {m.get('done')}/{m.get('total')}"
        for m in named_ms
        if m.get("done") != m.get("total")
    ]
    all_tasks = bl.get("tasks", [])
    tasks_total = len(all_tasks)
    tasks_done = sum(
        1 for t in all_tasks if (t.get("status") or "").strip().lower() == "done"
    )
    last_total = (
        (
            last.get("input", 0)
            + last.get("output", 0)
            + last.get("cache_read", 0)
            + last.get("cache_creation", 0)
        )
        if last
        else 0
    )
    cost_av = bool(costc.get("available"))
    overview = {
        "subtitle": f"{p.get('repo') or 'cc-setup'} · {branch} · {context.get('generated_at')}",
        "skills": len(skills),
        "agents": len(agents),
        "hooks": sum(h["count"] for h in hooks),
        "skills_tok": _fmt_compact(skills_tok),
        "agents_tok": _fmt_compact(agents_tok),
        "branch": branch,
        "dirty": bool(gitc.get("dirty")),
        "git_recommend": gitc.get("recommend") or "",
        "backlog_inprogress": bl.get("in_progress_count", 0),
        "milestones": ms_labels,
        "ms_done": ms_done,
        "ms_total": ms_total,
        "tasks_done": tasks_done,
        "tasks_total": tasks_total,
        "cost_today": _fmt_cost(costc.get("today", 0)) if cost_av else "n/a",
        "cost_week": _fmt_cost(costc.get("week", 0)) if cost_av else "n/a",
        "cost_total": _fmt_cost(costc.get("total", 0)) if cost_av else "n/a",
        "cost_5h": costc.get("five_hour") if cost_av else None,
        "cost_7d": costc.get("seven_day") if cost_av else None,
        "decisions": [
            {"id": d.get("id"), "title": d.get("title")}
            for d in kn.get("decisions", [])[:3]
        ],
        "tok_last": _fmt_compact(last_total) if last else "—",
        "tok_week": _fmt_compact(week.get("total", 0)) if week else "—",
        "cost_last": _fmt_cost(last.get("cost", 0)) if last else "—",
        "tok_sessions": _fmt_compact(sessions_tok),
        "cost_sessions": _fmt_cost(sessions_cost),
        # Wissen tile: counts across the knowledge sections
        "know_counts": {
            "decisions": len(decisions),
            "memory": len(memory),
            "lektionen": len(lessons),
            "changelog": len(changelog),
            "pknow": len(pknow),
        },
        # Sessions health: aggregate errors + repeated commands across all sessions
        "errors_total": tok.get("errors_total", 0),
        "repeats_total": tok.get("repeats_total", 0),
        "top_tools": sorted(
            (tok.get("tool_freq") or {}).items(), key=lambda kv: -kv[1]
        )[:4],
        # tn (TaskNotes) — next/blocked counts
        "tn_next": len(tnc.get("next", [])),
        "tn_blocked": len(tnc.get("blocked", [])),
        "tn_available": bool(tnc),
        # context budget: CLAUDE.md token estimates
        "claude_tok_global": _fmt_compact(gdoc["tokens"]),
        "claude_tok_project": _fmt_compact(pdoc["tokens"]),
    }

    meta = {
        "cwd": context.get("cwd"),
        "generated_at": context.get("generated_at"),
        "branch": branch,
        "turns": (last.get("turns") if last else 0),
        "tok": _fmt_compact(week.get("total", 0)) if week else "—",
    }

    return {
        "meta": meta,
        "nav": nav,
        "coll": coll,
        "git": gitc,
        "cost": costc,
        "overview": overview,
        "projects": context.get("projects", []),
        "active_project": context.get("active_project", ""),
    }


def _fmt_cost(v: Any) -> str:
    try:
        v = float(v)
    except (TypeError, ValueError):
        return "$0.00"
    if v >= 1000:
        return f"${v / 1000:.2f}k"
    return f"${v:.2f}"


_RESULT_CSS = (
    "body{margin:0;background:#0a0b0d;color:#d7dee5;"
    'font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:13px;line-height:1.55;}'
    ".wrap{max-width:900px;margin:0 auto;padding:34px 24px;}"
    "h1{font-size:16px;font-weight:700;margin:0 0 4px;}"
    ".cmd{color:#6c7682;font-size:12px;margin:0 0 14px;}"
    "pre.out{background:#0b0d10;border:1px solid #1c2229;border-radius:9px;padding:14px;"
    "font-size:12px;white-space:pre-wrap;word-break:break-word;color:#aab3bd;}"
    "a{color:oklch(0.83 0.11 215);} .ok{color:oklch(0.83 0.15 152);} .err{color:oklch(0.68 0.19 26);}"
    "@media (prefers-color-scheme: light){"
    "body{background:#eff1f5;color:#4c4f69;}"
    "pre.out{background:#e6e9ef;border-color:#ccd0da;color:#5c5f77;}"
    ".cmd{color:#8c8fa1;} a{color:#209fb5;} .ok{color:#40a02b;} .err{color:#d20f39;}"
    "}"
)


def _result_page(action: str, result: dict[str, Any]) -> str:
    """Render the outcome of a git action (real cmd + output, escaped). Dark theme."""
    ok = bool(result.get("ok"))
    badge = '<span class="ok">OK</span>' if ok else '<span class="err">Fehler</span>'
    return (
        "<!DOCTYPE html>\n<html lang='de'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width, initial-scale=1'>"
        f"<title>git {_esc(action)}</title><style>{_RESULT_CSS}</style></head>"
        "<body><div class='wrap'>"
        f"<h1>git {_esc(action)} {badge}</h1>"
        f"<p class='cmd'><code>{_esc(result.get('cmd'))}</code></p>"
        f"<pre class='out'>{_esc(result.get('output'))}</pre>"
        "<p><a href='/'>← zurück zum Dashboard</a></p>"
        "</div></body></html>"
    )


def _safe_script_json(obj: Any) -> str:
    """json.dumps escaped for safe embedding inside a <script> tag.

    Replaces <, >, & and the JS line separators with their \\uXXXX escapes so a
    string value containing ``</script>`` or ``<!--`` cannot break out of the
    script context (XSS-safe injection of the DATA object).
    """
    s = json.dumps(obj, ensure_ascii=False)
    for a, b in (
        ("<", "\\u003c"),
        (">", "\\u003e"),
        ("&", "\\u0026"),
        ("\u2028", "\\u2028"),
        ("\u2029", "\\u2029"),
    ):
        s = s.replace(a, b)
    return s


_READ_MAX_CHARS = 60000


def _under(child: Path, parent: Path) -> bool:
    """True iff resolved ``child`` is inside resolved ``parent`` (no traversal)."""
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except (ValueError, OSError):
        return False


def _read_doc(
    cwd: Path, claude_home: Path, kind: str, name: str = "", path: str = ""
) -> dict[str, Any]:
    """Read a whitelisted file for inline display (read-only, no traversal).

    Kinds:
      * ``claude-global``  -> ~/.claude/CLAUDE.md
      * ``claude-project`` -> <repo>/CLAUDE.md
      * ``skill``          -> ~/.claude/skills/<name>/SKILL.md
      * ``skillfile``      -> ~/.claude/skills/<name>/<path>  (referenced script)
      * ``agent``          -> ~/.claude/agents/<name>.md
      * ``homefile``       -> any file resolved under ~/.claude (hook scripts)

    Names are validated and every resolved path must stay inside its allowed
    root, so a crafted ``name``/``path`` cannot escape the sandbox.
    """
    try:
        skills_root = claude_home / "skills"
        if kind == "claude-global":
            fpath = claude_home / "CLAUDE.md"
        elif kind == "claude-project":
            fpath = _repo_root(cwd) / "CLAUDE.md"
        elif kind == "skill":
            if not re.fullmatch(r"[A-Za-z0-9._:-]+", name or ""):
                return {"ok": False, "error": "ungültiger Skill-Name"}
            fpath = skills_root / name / "SKILL.md"
            if not _under(fpath, skills_root):
                return {"ok": False, "error": "Pfad ausserhalb skills/"}
        elif kind == "skillfile":
            if not re.fullmatch(r"[A-Za-z0-9._:-]+", name or ""):
                return {"ok": False, "error": "ungültiger Skill-Name"}
            skill_root = skills_root / name
            fpath = skill_root / path
            if not _under(fpath, skill_root):
                return {"ok": False, "error": "Pfad ausserhalb des Skills"}
        elif kind == "agent":
            if not re.fullmatch(r"[A-Za-z0-9._-]+", name or ""):
                return {"ok": False, "error": "ungültiger Agent-Name"}
            fpath = claude_home / "agents" / (name + ".md")
            if not _under(fpath, claude_home / "agents"):
                return {"ok": False, "error": "Pfad ausserhalb agents/"}
        elif kind == "homefile":
            if not path:
                return {"ok": False, "error": "kein Pfad"}
            cand = Path(path)
            fpath = cand if cand.is_absolute() else (claude_home / cand)
            if not _under(fpath, claude_home):
                return {"ok": False, "error": "Pfad ausserhalb ~/.claude"}
        elif kind == "memory":
            if not re.fullmatch(r"[A-Za-z0-9._-]+", name or ""):
                return {"ok": False, "error": "ungültiger Memory-Name"}
            mem_root = _repo_root(cwd) / "knowledge" / "memory"
            fpath = mem_root / name
            if not _under(fpath, mem_root):
                return {"ok": False, "error": "Pfad ausserhalb knowledge/memory"}
        elif kind == "lektion":
            if not re.fullmatch(r"[A-Za-z0-9._-]+", name or ""):
                return {"ok": False, "error": "ungültiger Lektion-Name"}
            kn_root = _repo_root(cwd) / "knowledge"
            fpath = kn_root / name
            if not _under(fpath, kn_root):
                return {"ok": False, "error": "Pfad ausserhalb knowledge/"}
        elif kind == "knowfile":
            # knowledge/ index entry — relative path (may include subdirs).
            # Index links are relative to knowledge/; tolerate a leading
            # "knowledge/" prefix so both forms resolve to the same file.
            kn_root = _repo_root(cwd) / "knowledge"
            rel = path or name
            if rel.startswith("knowledge/"):
                rel = rel[len("knowledge/") :]
            fpath = kn_root / rel
            if not _under(fpath, kn_root):
                return {"ok": False, "error": "Pfad ausserhalb knowledge/"}
        elif kind == "taskfile":
            tasks_root = _repo_root(cwd) / "backlog" / "tasks"
            fpath = tasks_root / name
            if not _under(fpath, tasks_root):
                return {"ok": False, "error": "Pfad ausserhalb backlog/tasks"}
        else:
            return {"ok": False, "error": f"unbekannte Art: {kind}"}

        if not fpath.is_file():
            return {"ok": False, "error": f"nicht gefunden: {fpath.name}"}
        text = fpath.read_text(encoding="utf-8", errors="replace")
        return {
            "ok": True,
            "kind": kind,
            "name": name,
            "path": path,
            "tokens": _est_tokens(text),
            "size": len(text),
            "truncated": len(text) > _READ_MAX_CHARS,
            "content": text[:_READ_MAX_CHARS],
        }
    except Exception as exc:  # noqa: BLE001 — endpoint must degrade, not 500
        return {"ok": False, "error": str(exc)}


def render_html(context: dict[str, Any]) -> str:
    """Render the 3-pane knowledge browser as a bare full-viewport ``#mp`` shell.

    No page header, terminal chrome bar, footer or outer padding — the page IS
    the ``#mp`` 3-pane (nav · list · detail). Emits inlined CSS + a safely-escaped
    ``window.DATA`` (built from the collectors) + the browser.js controller.
    """
    data = build_data(context)
    css = "\n".join((_read_asset("dash.css"), _read_asset("browser.css"), _EXTRA_CSS))
    js = _read_asset("browser.js")
    data_json = _safe_script_json(data)

    # Slim project tabs (server-rendered <a> links → full re-query per switch).
    active = data.get("active_project", "")
    tabs = "".join(
        '<a class="kn-tab{cls}" href="/?project={q}">{label}</a>'.format(
            cls=" is-active" if p.get("name") == active else "",
            q=_esc(quote(p.get("name", ""))),
            label=_esc(p.get("name", "")),
        )
        for p in data.get("projects", [])
    )

    # Apply the saved theme before first paint to avoid a flash of the wrong mode.
    theme_init = (
        "<script>(function(){try{var t=localStorage.getItem('kn-theme');"
        "if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}"
        "catch(e){}})();</script>"
    )

    return (
        "<!DOCTYPE html>\n"
        '<html lang="de"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        "<title>knowledge — Browser</title>"
        f"{theme_init}"
        f"<style>{css}</style></head><body>"
        '<div class="kn-shell">'
        f'<div class="kn-tabs" id="kn-tabs">{tabs}'
        '<span class="kn-tabs-sp"></span>'
        '<button class="kn-theme" id="kn-theme-toggle" type="button"'
        ' aria-label="Theme wechseln">☀</button>'
        "</div>"
        "<div class='mp' id='mp'><nav class='mp-nav' id='mp-nav'></nav>"
        "<div class='mp-list' id='mp-list'></div>"
        "<div class='mp-detail' id='mp-detail'></div></div>"
        "</div>"
        f"<script>window.DATA = {data_json};</script>"
        f"<script>{js}</script>"
        "</body></html>"
    )


# ---------------------------------------------------------------------------
# FastAPI app (lazy import) + CLI
# ---------------------------------------------------------------------------


def _csrf_ok(origin: str | None) -> bool:
    """Reject cross-origin POSTs: if an Origin header is present it must be localhost."""
    if not origin:
        return True  # same-origin form posts / curl often omit Origin
    return origin.startswith("http://127.0.0.1") or origin.startswith(
        "http://localhost"
    )


def build_app(cwd: Path, claude_home: Path | None = None):
    """Build the FastAPI app. Imported lazily so collectors stay FastAPI-free.

    GET /            -> the dashboard (read-only, live re-query).
    GET /read        -> whitelisted file (skill/agent/CLAUDE.md/script) inline view.
    GET /gitdiff     -> read-only diff for one path (or the whole worktree).
    POST /action/*   -> gated mutating git actions (localhost + Origin check;
                        push/merge need a typed token, delete the branch name).
    """
    from fastapi import FastAPI, Request
    from fastapi.responses import HTMLResponse, JSONResponse

    # The POST endpoints below are nested functions; FastAPI resolves their
    # ``request: Request`` annotation against THIS module's globals (a function's
    # __globals__ is the module dict, not the enclosing scope). Expose Request
    # there so the lazy import still resolves — keeps collectors FastAPI-free.
    globals()["Request"] = Request

    home = claude_home or (Path.home() / ".claude")
    app = FastAPI(title="knowledge dashboard", docs_url=None, redoc_url=None)

    def _projects() -> list[dict[str, str]]:
        """Live discovery of sibling backlog projects (cheap, read-only)."""
        return discover_projects(_repo_root(cwd))

    def _target(project: str) -> Path:
        """Resolve a ``project`` name to its cwd via the whitelist, else launch cwd."""
        return resolve_project_cwd(project, _projects(), cwd)

    @app.get("/", response_class=HTMLResponse)
    def index(project: str = "") -> str:  # noqa: D401 — live re-query on every request
        projects = _projects()
        target = resolve_project_cwd(project, projects, cwd)
        active = (
            project
            if any(p["name"] == project for p in projects)
            else _repo_root(cwd).name
        )
        return render_html(
            build_context(target, home, projects=projects, active_project=active)
        )

    @app.get("/read")
    def read(kind: str = "", name: str = "", path: str = "", project: str = ""):  # noqa: D401
        return JSONResponse(_read_doc(_target(project), home, kind, name, path))

    @app.get("/gitdiff")
    def gitdiff(path: str = "", project: str = ""):  # noqa: D401 — read-only diff view
        return JSONResponse(_git_diff(_target(project), path))

    def _blocked() -> str:
        return _result_page(
            "blocked",
            {"ok": False, "cmd": "-", "output": "CSRF: fremde Origin blockiert"},
        )

    @app.post("/action/commit", response_class=HTMLResponse)
    async def action_commit(request: Request) -> str:
        if not _csrf_ok(request.headers.get("origin")):
            return _blocked()
        form = await request.form()
        target = _target(str(form.get("project", "")))
        return _result_page("commit", git_commit(target, str(form.get("message", ""))))

    @app.post("/action/delete", response_class=HTMLResponse)
    async def action_delete(request: Request) -> str:
        if not _csrf_ok(request.headers.get("origin")):
            return _blocked()
        form = await request.form()
        target = _target(str(form.get("project", "")))
        branch = str(form.get("branch", "")).strip()
        confirm = str(form.get("confirm", "")).strip()
        if not branch or confirm != branch:
            return _result_page(
                "delete",
                {
                    "ok": False,
                    "cmd": "git branch -d",
                    "output": "Bestätigung: tippe den exakten Branch-Namen.",
                },
            )
        return _result_page("delete", git_delete(target, branch))

    @app.post("/action/merge", response_class=HTMLResponse)
    async def action_merge(request: Request) -> str:
        if not _csrf_ok(request.headers.get("origin")):
            return _blocked()
        form = await request.form()
        target = _target(str(form.get("project", "")))
        if str(form.get("confirm", "")).strip() != "MERGE":
            return _result_page(
                "merge",
                {
                    "ok": False,
                    "cmd": "git merge",
                    "output": "Bestätigung: tippe MERGE.",
                },
            )
        return _result_page("merge", git_merge(target, str(form.get("branch", ""))))

    @app.post("/action/push", response_class=HTMLResponse)
    async def action_push(request: Request) -> str:
        if not _csrf_ok(request.headers.get("origin")):
            return _blocked()
        form = await request.form()
        target = _target(str(form.get("project", "")))
        if str(form.get("confirm", "")).strip() != "PUSH":
            return _result_page(
                "push",
                {"ok": False, "cmd": "git push", "output": "Bestätigung: tippe PUSH."},
            )
        return _result_page("push", git_push(target, str(form.get("branch", ""))))

    return app


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="cc-setup status dashboard (read-only)."
    )
    parser.add_argument("--cwd", default=".", help="repo dir to inspect (default: CWD)")
    parser.add_argument("--port", type=int, default=8765, help="port (default: 8765)")
    parser.add_argument("--no-open", action="store_true", help="do not open a browser")
    args = parser.parse_args(argv)

    cwd = Path(args.cwd).expanduser().resolve()
    url = f"http://127.0.0.1:{args.port}/"

    if not args.no_open:
        import threading
        import webbrowser

        threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    import uvicorn

    print(f"knowledge dashboard → {url}  (cwd={cwd})")
    uvicorn.run(build_app(cwd), host="127.0.0.1", port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
