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
                "headers": _md_headers(text, levels=(2,)),
                "managed_block": managed,
            }
        else:
            data["claude_md"] = None

        # --- skills/ ---
        skills_dir = claude_home / "skills"
        if skills_dir.is_dir():
            names = sorted(
                p.name
                for p in skills_dir.iterdir()
                if p.is_dir()
                and not p.name.startswith(".")
                and not p.name.startswith("_")
            )
            data["skills"] = {"count": len(names), "names": names}
        else:
            data["skills"] = {"count": 0, "names": []}

        # --- settings.json — REDACTED: event names + hook type keys only ---
        settings = claude_home / "settings.json"
        if settings.is_file():
            try:
                raw = json.loads(settings.read_text(encoding="utf-8", errors="replace"))
                hooks = raw.get("hooks", {}) if isinstance(raw, dict) else {}
                events: dict[str, int] = {}
                if isinstance(hooks, dict):
                    for event_name, matchers in hooks.items():
                        # Count hook entries per event WITHOUT exposing command/env.
                        n = 0
                        if isinstance(matchers, list):
                            for matcher in matchers:
                                inner = (
                                    matcher.get("hooks", [])
                                    if isinstance(matcher, dict)
                                    else []
                                )
                                if isinstance(inner, list):
                                    n += len(inner)
                        events[str(event_name)] = n
                data["settings"] = {"hook_events": events}
            except (json.JSONDecodeError, ValueError):
                data["settings"] = {"hook_events": {}, "parse_error": True}
        else:
            data["settings"] = None

        # --- agents/*.md ---
        agents_dir = claude_home / "agents"
        if agents_dir.is_dir():
            agents = sorted(p.stem for p in agents_dir.glob("*.md"))
            data["agents"] = agents
        else:
            data["agents"] = []

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
        if m:
            entries.append({"title": m.group(1).strip(), "path": m.group(2).strip()})
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
        else:
            data["claude_md_headers"] = []

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
    """Parse ``## NNN — Titel`` decision entries + a Status: line if present."""
    out: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    for line in text.splitlines():
        m = _DECISION_LINE_RE.match(line)
        if m:
            current = {"id": m.group("id"), "title": m.group("title"), "status": ""}
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
    return out


def _backlog_decisions(repo: Path) -> list[dict[str, str]]:
    """Best-effort: list backlog/decisions/decision-NNN files with their status."""
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
        out.append({"id": did, "title": title, "status": status})
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


def collect_backlog(cwd: Path) -> dict[str, Any]:
    """Open milestones (done/total + open task ids) + global in-progress tasks."""
    try:
        repo = _repo_root(cwd)
        survey = _sprint_survey(repo)
        if survey is None:
            return _unavailable("sprint_bridge/backlog unavailable")
        if not survey.get("initialized"):
            return _unavailable("backlog not initialized (no backlog/config.yml)")

        milestones = []
        for ms in survey.get("open_milestones", []):
            open_ids = [t.get("id") for t in ms.get("open_tasks", []) if t.get("id")]
            milestones.append(
                {
                    "name": ms.get("name"),
                    "done": ms.get("done"),
                    "total": ms.get("total"),
                    "open_ids": open_ids,
                }
            )
        return {
            "available": True,
            "prefix": survey.get("prefix"),
            "open_milestones": milestones,
            "in_progress": _backlog_in_progress(repo),
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
            return {"available": True, "last_session": None, "week": None}

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
        }

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
        return {"available": True, "last_session": last_session, "week": week}
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

        status = _git(repo, "status", "--porcelain") or ""
        staged = unstaged = untracked = 0
        files: list[str] = []
        for ln in status.splitlines():
            if not ln:
                continue
            if ln.startswith("??"):
                untracked += 1
            else:
                if ln[0] != " ":
                    staged += 1
                if len(ln) > 1 and ln[1] != " ":
                    unstaged += 1
            files.append(ln.rstrip())
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
            "dirty": dirty,
            "shortstat": shortstat,
            "ahead_origin": ahead_origin,
            "behind_origin": behind_origin,
            "ahead_main": ahead_main,
            "recommend": _git_recommend(branch, dirty, ahead_origin, ahead_main),
        }
    except Exception as exc:  # noqa: BLE001
        return _unavailable(f"collect_git failed: {exc}")


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
# Context assembly
# ---------------------------------------------------------------------------


def build_context(cwd: Path, claude_home: Path | None = None) -> dict[str, Any]:
    """Run all seven collectors sequentially (no cache) and return one context dict."""
    home = claude_home or (Path.home() / ".claude")
    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "cwd": str(cwd),
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

    skills = [
        {"name": n, "cat": "", "desc": ""}
        for n in (g.get("skills") or {}).get("names", [])
    ]
    agents = [{"name": a, "role": "", "tools": []} for a in g.get("agents", [])]
    hook_events = (
        (g.get("settings") or {}).get("hook_events", {}) if g.get("settings") else {}
    )
    hooks = [{"name": ev, "count": c, "scripts": []} for ev, c in hook_events.items()]

    pknow = [
        {"name": e.get("title"), "type": "", "desc": ""}
        for e in p.get("knowledge_index", [])
    ]
    psections = [
        {"name": h, "type": "section", "desc": ""}
        for h in p.get("claude_md_headers", [])
    ]

    decisions = [
        {
            "name": f"{d.get('id')} — {d.get('title')}",
            "id": d.get("id"),
            "status": d.get("status", ""),
            "ctx": "",
            "dec": "",
        }
        for d in kn.get("decisions", [])
    ]
    memory = [{"name": m, "desc": ""} for m in kn.get("memory", [])]
    lessons = [{"name": x, "desc": ""} for x in kn.get("lektionen", [])]
    changelog = [
        {"name": c, "type": "changelog", "desc": ""} for c in kn.get("changelog", [])
    ]

    tasks = [
        {
            "name": t.get("id"),
            "status": "in progress",
            "milestone": "—",
            "desc": t.get("title", ""),
        }
        for t in bl.get("in_progress", [])
    ]
    for m in bl.get("open_milestones", []):
        for tid in m.get("open_ids", []):
            tasks.append(
                {
                    "name": tid,
                    "status": "to do",
                    "milestone": m.get("name", ""),
                    "desc": "",
                }
            )

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

    sessions = []
    last = tok.get("last_session")
    if last:
        sessions.append(
            {
                "name": last.get("session_id"),
                "turns": last.get("turns", 0),
                "input": last.get("input", 0),
                "output": last.get("output", 0),
                "cc": last.get("cache_creation", 0),
                "cr": last.get("cache_read", 0),
            }
        )
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
            "type": "know",
            "accent": "c",
            "items": psections,
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
            "type": "know",
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
                {"id": "skills", "label": "Skills", "dot": "g"},
                {"id": "agents", "label": "Agents", "dot": "c"},
                {"id": "hooks", "label": "Hooks", "dot": ""},
            ],
        },
        {
            "g": "Projekt",
            "items": [
                {"id": "pknow", "label": "knowledge/", "dot": "c"},
                {"id": "psections", "label": "CLAUDE.md", "dot": "c"},
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
                {"id": "sessions", "label": "Sessions", "dot": "m"},
                {"id": "cost", "label": "Kosten", "dot": "m"},
            ],
        },
    ]

    branch = gitc.get("branch") or p.get("branch") or "?"
    ms_labels = [
        f"{m.get('name')} {m.get('done')}/{m.get('total')}"
        for m in bl.get("open_milestones", [])
    ]
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
        "branch": branch,
        "dirty": bool(gitc.get("dirty")),
        "git_recommend": gitc.get("recommend") or "",
        "backlog_inprogress": len(bl.get("in_progress", [])),
        "milestones": ms_labels,
        "cost_today": _fmt_cost(costc.get("today", 0)) if cost_av else "n/a",
        "cost_week": _fmt_cost(costc.get("week", 0)) if cost_av else "n/a",
        "cost_total": _fmt_cost(costc.get("total", 0)) if cost_av else "n/a",
        "decisions": [
            {"id": d.get("id"), "title": d.get("title")}
            for d in kn.get("decisions", [])[:3]
        ],
        "tok_last": _fmt_compact(last_total) if last else "—",
        "tok_week": _fmt_compact(week.get("total", 0)) if week else "—",
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


def render_html(context: dict[str, Any]) -> str:
    """Render the terminal 3-pane knowledge browser (design: knowledge Browser.html).

    Emits the design shell + inlined dash.css/browser.css + a safely-escaped
    ``window.DATA`` (built from the collectors) + the browser.js controller.
    """
    data = build_data(context)
    meta = data["meta"]
    css = "\n".join((_read_asset("dash.css"), _read_asset("browser.css"), _EXTRA_CSS))
    js = _read_asset("browser.js")
    data_json = _safe_script_json(data)

    return (
        "<!DOCTYPE html>\n"
        '<html lang="de"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        "<title>knowledge — Browser</title>"
        f"<style>{css}</style></head><body><div class='page'>"
        "<header class='page-head'><h1><b>knowledge</b> · Browser</h1>"
        f"<span class='ph-meta'><code>{_esc(meta['cwd'])}</code> · generiert "
        f"{_esc(meta['generated_at'])} · Reload = Live-Re-Query</span></header>"
        "<div class='term' data-screen-label='knowledge browser'>"
        "<div class='bar'><div class='lights'><i></i><i></i><i></i></div>"
        f"<span class='ttl'><b>knowledge</b> ◇ cc-setup ◇ "
        f"<span style='color:var(--green)'>{_esc(meta['branch'])}</span></span>"
        "<span class='spacer'></span>"
        f"<span class='ttl'>{_esc(meta['turns'])} turns · {_esc(meta['tok'])} tok</span>"
        "<span class='ro'>READ-ONLY</span></div>"
        "<div class='mp' id='mp'><nav class='mp-nav' id='mp-nav'></nav>"
        "<div class='mp-list' id='mp-list'></div>"
        "<div class='mp-detail' id='mp-detail'></div></div></div>"
        "<footer class='foot'>"
        "<span><span class='g'>●</span> 127.0.0.1 · cc-setup knowledge.py · Git-Actions gated</span>"
        "<span>nav → liste → detail · ↑/↓ blättert · <code>/</code> filtert</span>"
        f"<span>generiert {_esc(meta['generated_at'])}</span></footer>"
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


def build_app(cwd: Path):
    """Build the FastAPI app. Imported lazily so collectors stay FastAPI-free.

    GET /            -> the dashboard (read-only, live re-query).
    POST /action/*   -> gated mutating git actions (localhost + Origin check;
                        push/merge need a typed token, delete the branch name).
    """
    from fastapi import FastAPI, Request
    from fastapi.responses import HTMLResponse

    # The POST endpoints below are nested functions; FastAPI resolves their
    # ``request: Request`` annotation against THIS module's globals (a function's
    # __globals__ is the module dict, not the enclosing scope). Expose Request
    # there so the lazy import still resolves — keeps collectors FastAPI-free.
    globals()["Request"] = Request

    app = FastAPI(title="knowledge dashboard", docs_url=None, redoc_url=None)

    @app.get("/", response_class=HTMLResponse)
    def index() -> str:  # noqa: D401 — live re-query on every request
        return render_html(build_context(cwd))

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
        return _result_page("commit", git_commit(cwd, str(form.get("message", ""))))

    @app.post("/action/delete", response_class=HTMLResponse)
    async def action_delete(request: Request) -> str:
        if not _csrf_ok(request.headers.get("origin")):
            return _blocked()
        form = await request.form()
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
        return _result_page("delete", git_delete(cwd, branch))

    @app.post("/action/merge", response_class=HTMLResponse)
    async def action_merge(request: Request) -> str:
        if not _csrf_ok(request.headers.get("origin")):
            return _blocked()
        form = await request.form()
        if str(form.get("confirm", "")).strip() != "MERGE":
            return _result_page(
                "merge",
                {
                    "ok": False,
                    "cmd": "git merge",
                    "output": "Bestätigung: tippe MERGE.",
                },
            )
        return _result_page("merge", git_merge(cwd, str(form.get("branch", ""))))

    @app.post("/action/push", response_class=HTMLResponse)
    async def action_push(request: Request) -> str:
        if not _csrf_ok(request.headers.get("origin")):
            return _blocked()
        form = await request.form()
        if str(form.get("confirm", "")).strip() != "PUSH":
            return _result_page(
                "push",
                {"ok": False, "cmd": "git push", "output": "Bestätigung: tippe PUSH."},
            )
        return _result_page("push", git_push(cwd, str(form.get("branch", ""))))

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
