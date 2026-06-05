"""Unit + smoke tests for knowledge.py — the single-pane status dashboard.

Hermetic by design: collectors are pure functions over injected paths and
subprocess outputs, so the bulk of the suite needs no FastAPI, no backlog/tn
install, and no vault. The FastAPI route is exercised by a single smoke test
that is skipped if fastapi/httpx are not importable (so `just test` stays green
on a minimal interpreter; the test recipe adds the deps so it actually runs).

Run:
  cd scripts &&
  uv run --with pytest --with fastapi --with httpx pytest test_knowledge.py -v
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

import knowledge as k


# ---------------------------------------------------------------------------
# helpers / pure parsers
# ---------------------------------------------------------------------------


def test_md_headers_skips_code_fences():
    text = "# Top\n## Real\n```\n# fake-in-fence\n```\n## Also Real\n"
    assert k._md_headers(text, levels=(1, 2)) == ["Top", "Real", "Also Real"]


def test_md_headers_level_filter():
    text = "# H1\n## H2\n### H3\n"
    assert k._md_headers(text, levels=(2,)) == ["H2"]


def test_parse_decisions_md_extracts_id_title_status():
    text = (
        "## 001 — First decision\nStatus: accepted\nrationale line\n\n"
        "## 002 -- Second\n- **Status:** rejected\n"
    )
    out = k._parse_decisions_md(text)
    assert [(d["id"], d["title"], d["status"]) for d in out] == [
        ("001", "First decision", "accepted"),
        ("002", "Second", "rejected"),
    ]
    # body now captured per section
    assert "rationale line" in out[0]["body"]


def test_encode_cwd_matches_session_analyze_rule():
    assert k._encode_cwd("/Users/x/GITHUB_DG/cc-setup") == "-Users-x-GITHUB-DG-cc-setup"


def test_est_tokens_rough_quarter_chars():
    assert k._est_tokens("") == 0
    assert k._est_tokens("abcd") == 1
    assert k._est_tokens("a" * 400) == 100


def test_frontmatter_field_parses_description():
    text = (
        "---\nname: audit\ndescription: Audit a project from two angles.\n---\n# Body\n"
    )
    assert (
        k._frontmatter_field(text, "description") == "Audit a project from two angles."
    )
    assert k._frontmatter_field(text, "name") == "audit"
    assert (
        k._frontmatter_field('---\ndescription: "quoted val"\n---\n', "description")
        == "quoted val"
    )
    assert k._frontmatter_field("no frontmatter here", "description") == ""


# ---------------------------------------------------------------------------
# collect_global
# ---------------------------------------------------------------------------


def _write(p, content):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")


def test_collect_global_missing_home(tmp_path):
    res = k.collect_global(tmp_path / "nope")
    assert res["available"] is False
    assert "not found" in res["reason"]


def test_collect_global_managed_block_detected(tmp_path):
    _write(
        tmp_path / "CLAUDE.md",
        "## A\nx\n<!-- BEGIN cc-setup -->\ny\n<!-- END cc-setup -->\n",
    )
    res = k.collect_global(tmp_path)
    assert res["available"] is True
    assert res["claude_md"]["managed_block"] is True
    assert res["claude_md"]["headers"] == ["A"]
    assert res["claude_md"]["size_bytes"] > 0


def test_collect_global_no_managed_block(tmp_path):
    _write(tmp_path / "CLAUDE.md", "## Only\n")
    res = k.collect_global(tmp_path)
    assert res["claude_md"]["managed_block"] is False


def test_collect_global_skills_and_agents(tmp_path):
    (tmp_path / "skills" / "audit").mkdir(parents=True)
    (tmp_path / "skills" / "qmd").mkdir(parents=True)
    (tmp_path / "skills" / "_old").mkdir(parents=True)  # excluded
    _write(
        tmp_path / "skills" / "audit" / "SKILL.md",
        "---\nname: audit\ndescription: Audit a project.\n---\n# Audit\nbody\n",
    )
    (tmp_path / "agents").mkdir()
    _write(tmp_path / "agents" / "Engineer.md", "x")
    _write(tmp_path / "agents" / "Architect.md", "x")
    res = k.collect_global(tmp_path)
    assert res["skills"]["names"] == ["audit", "qmd"]
    assert res["skills"]["count"] == 2
    items = {i["name"]: i for i in res["skills"]["items"]}
    assert items["audit"]["description"] == "Audit a project."
    assert items["audit"]["tokens"] > 0 and items["audit"]["has_md"] is True
    assert items["qmd"]["has_md"] is False  # no SKILL.md -> degrades, no crash
    assert res["agents"] == ["Architect", "Engineer"]


def test_collect_global_settings_shows_commands_not_env(tmp_path):
    # Hook COMMANDS are shown by design (localhost dashboard); settings.env is
    # NEVER read, so env values (likely to hold tokens/secrets) cannot leak.
    env_secret = "/secret/env/value --token=ENVABC"
    cmd = "/Users/x/.claude/hooks/redactor.py wrap"
    settings = {
        "env": {"OBSIDIAN_VAULT_PATH": env_secret},
        "hooks": {
            "SessionStart": [
                {"matcher": "*", "hooks": [{"type": "command", "command": cmd}]}
            ],
            "PreToolUse": [
                {"matcher": "Bash", "hooks": [{"type": "command", "command": cmd}]},
                {"matcher": "Write", "hooks": [{"type": "command", "command": cmd}]},
            ],
        },
    }
    _write(tmp_path / "settings.json", json.dumps(settings))
    res = k.collect_global(tmp_path)
    events = res["settings"]["hook_events"]
    assert events == {"SessionStart": 1, "PreToolUse": 2}
    detail = res["settings"]["hook_detail"]
    assert detail["PreToolUse"][0] == {
        "matcher": "Bash",
        "type": "command",
        "command": cmd,
    }
    assert detail["PreToolUse"][1]["matcher"] == "Write"
    # env VALUES must never appear anywhere in the output (env is never read).
    assert env_secret not in json.dumps(res)
    assert "ENVABC" not in json.dumps(res)


# ---------------------------------------------------------------------------
# collect_project (repo root injected via tmp git-less dir -> falls back to cwd)
# ---------------------------------------------------------------------------


def test_collect_project_knowledge_index(tmp_path, monkeypatch):
    monkeypatch.setattr(k, "_repo_root", lambda c: tmp_path)
    monkeypatch.setattr(k, "_git", lambda c, *a: "feat/x\n")
    _write(tmp_path / "CLAUDE.md", "# Project\n## Rules\n")
    _write(
        tmp_path / "knowledge" / "README.md",
        "## Index\n- [Lektion A](a.md) — desc\n- [HTML B](b.html) — more\n",
    )
    res = k.collect_project(tmp_path)
    assert res["available"] is True
    assert res["branch"] == "feat/x"
    assert res["claude_md_headers"] == ["Project", "Rules"]
    assert [e["title"] for e in res["knowledge_index"]] == ["Lektion A", "HTML B"]


# ---------------------------------------------------------------------------
# collect_knowledge
# ---------------------------------------------------------------------------


def test_collect_knowledge_backlog_decisions_fallback(tmp_path, monkeypatch):
    monkeypatch.setattr(k, "_repo_root", lambda c: tmp_path)
    dec = tmp_path / "backlog" / "decisions"
    dec.mkdir(parents=True)
    _write(
        dec / "decision-001 - Foo.md", "---\nstatus: accepted\n---\n# Foo decision\n"
    )
    _write(tmp_path / "knowledge" / "lektion-x.md", "x")
    res = k.collect_knowledge(tmp_path, vault=tmp_path / "no-vault")
    assert res["available"] is True
    d0 = res["decisions"][0]
    assert (d0["id"], d0["title"], d0["status"]) == ("001", "Foo decision", "accepted")
    assert "body" in d0  # body now captured for inline display
    assert res["lektionen"] == ["lektion-x.md"]
    assert res["changelog"] == []  # vault missing -> clean empty


def test_collect_knowledge_vault_changelog(tmp_path, monkeypatch):
    repo = tmp_path / "cc-setup"
    repo.mkdir()
    monkeypatch.setattr(k, "_repo_root", lambda c: repo)
    vault = tmp_path / "vault"
    cl = vault / "Efforts" / "Work" / "dgk" / "cc-setup"
    cl.mkdir(parents=True)
    _write(cl / "CHANGELOG.md", "# CHANGELOG\n\n- line1\n- line2\n- line3\n")
    res = k.collect_knowledge(repo, vault=vault)
    # newest-first, headers dropped
    assert res["changelog"] == ["- line3", "- line2", "- line1"]


# ---------------------------------------------------------------------------
# collect_backlog (reads backlog/tasks/*.md directly)
# ---------------------------------------------------------------------------


def test_collect_backlog_uninitialized(tmp_path, monkeypatch):
    monkeypatch.setattr(k, "_repo_root", lambda c: tmp_path)
    res = k.collect_backlog(tmp_path)  # no backlog/tasks dir
    assert res["available"] is False
    assert "not initialized" in res["reason"]


def _write_task(tasks_dir, fid, title, status, milestone, desc=""):
    body = (
        f"---\nid: {fid}\ntitle: '{title}'\nstatus: {status}\n"
        f"milestone: {milestone}\n---\n\n## Description\n\n"
        f"<!-- SECTION:DESCRIPTION:BEGIN -->\n{desc}\n<!-- SECTION:DESCRIPTION:END -->\n"
    )
    _write(tasks_dir / f"{fid.lower()} - {title}.md", body)


def test_collect_backlog_reads_tasks_grouped(tmp_path, monkeypatch):
    monkeypatch.setattr(k, "_repo_root", lambda c: tmp_path)
    td = tmp_path / "backlog" / "tasks"
    td.mkdir(parents=True)
    _write_task(
        td,
        "CCS-013.03",
        "Collectors",
        "In Progress",
        "knowledge-dashboard",
        "do collectors",
    )
    _write_task(td, "CCS-013.04", "Tn", "To Do", "knowledge-dashboard")
    _write_task(td, "CCS-001", "Spec", "Done", "sprint")
    res = k.collect_backlog(tmp_path)
    assert res["available"] is True
    by_id = {t["id"]: t for t in res["tasks"]}
    # every task appears exactly once (no duplication)
    assert len(res["tasks"]) == 3
    assert by_id["CCS-013.03"]["status"] == "In Progress"
    assert by_id["CCS-013.03"]["milestone"] == "knowledge-dashboard"
    assert by_id["CCS-013.03"]["desc"] == "do collectors"
    assert res["in_progress_count"] == 1
    ms = {m["name"]: m for m in res["milestones"]}
    assert (
        ms["knowledge-dashboard"]["total"] == 2
        and ms["knowledge-dashboard"]["done"] == 0
    )
    assert ms["sprint"]["done"] == 1


def test_collect_backlog_folds_in_completed(tmp_path, monkeypatch):
    monkeypatch.setattr(k, "_repo_root", lambda c: tmp_path)
    td = tmp_path / "backlog" / "tasks"
    td.mkdir(parents=True)
    cd = tmp_path / "backlog" / "completed"
    cd.mkdir(parents=True)
    _write_task(td, "T-1", "Active", "In Progress", "m")
    # completed/ task with stale frontmatter status -> folder makes it Done
    _write_task(cd, "T-2", "Finished", "In Progress", "m")
    # duplicate id in completed/ must NOT double-count (tasks/ wins)
    _write_task(cd, "T-1", "Active dup", "In Progress", "m")
    res = k.collect_backlog(tmp_path)
    by_id = {t["id"]: t for t in res["tasks"]}
    assert len(res["tasks"]) == 2  # T-1 once + T-2
    assert by_id["T-2"]["status"] == "Done"
    assert by_id["T-1"]["status"] == "In Progress"
    ms = {m["name"]: m for m in res["milestones"]}
    assert ms["m"]["total"] == 2 and ms["m"]["done"] == 1


def test_backlog_in_progress_parser(monkeypatch):
    plain = "In Progress:\n  CCS-003 - Minimal context-load - Layer 1.5\n  [HIGH] CCS-009 - Foo\n"
    monkeypatch.setattr(k, "_run", lambda cmd, cwd=None, timeout=30: plain)
    out = k._backlog_in_progress(k.Path("/tmp"))
    assert out == [
        {"id": "CCS-003", "title": "Minimal context-load - Layer 1.5"},
        {"id": "CCS-009", "title": "Foo"},
    ]


# ---------------------------------------------------------------------------
# collect_tn (tn json mocked)
# ---------------------------------------------------------------------------


def test_collect_tn_unavailable(tmp_path, monkeypatch):
    monkeypatch.setattr(k, "_repo_root", lambda c: tmp_path)
    monkeypatch.setattr(k, "_tn_json", lambda r, *a: None)
    res = k.collect_tn(tmp_path)
    assert res["available"] is False
    assert "tn unavailable" in res["reason"]


def test_collect_tn_next_and_blocked(tmp_path, monkeypatch):
    monkeypatch.setattr(k, "_repo_root", lambda c: tmp_path)
    next_payload = {
        "tasks": [
            {
                "id": "t1",
                "title": "Do A",
                "status": "action",
                "project": {"name": "cc-setup"},
                "metadata": {"nextAction": "go"},
            }
        ]
    }
    blocked_payload = {"tasks": [{"id": "t2", "title": "Wait B", "status": "blocked"}]}

    def fake(repo, *args):
        return next_payload if args and args[0] == "next" else blocked_payload

    monkeypatch.setattr(k, "_tn_json", fake)
    res = k.collect_tn(tmp_path)
    assert res["available"] is True
    assert res["next"][0]["title"] == "Do A"
    assert res["next"][0]["project"] == "cc-setup"
    assert res["blocked"][0]["title"] == "Wait B"


# ---------------------------------------------------------------------------
# collect_tokens (session_analyze + mtimes mocked)
# ---------------------------------------------------------------------------


def test_collect_tokens_unavailable(tmp_path, monkeypatch):
    monkeypatch.setattr(k, "_session_analyze_json", lambda c: None)
    res = k.collect_tokens(tmp_path)
    assert res["available"] is False


def test_collect_tokens_last_and_week(tmp_path, monkeypatch):
    now = datetime(2026, 6, 5, tzinfo=timezone.utc)
    recent = (now - timedelta(days=1)).timestamp()
    old = (now - timedelta(days=20)).timestamp()
    agg = {
        "token_stats": {
            "per_session": [
                {
                    "session_id": "old1",
                    "turns": 5,
                    "total_input_tokens": 100,
                    "total_output_tokens": 200,
                    "total_cache_read_tokens": 10,
                    "total_cache_creation_tokens": 5,
                },
                {
                    "session_id": "new1",
                    "turns": 9,
                    "total_input_tokens": 1000,
                    "total_output_tokens": 2000,
                    "total_cache_read_tokens": 50,
                    "total_cache_creation_tokens": 25,
                },
            ]
        }
    }
    monkeypatch.setattr(k, "_session_analyze_json", lambda c: agg)
    monkeypatch.setattr(k, "_session_mtimes", lambda c: {"old1": old, "new1": recent})
    res = k.collect_tokens(tmp_path, now=now)
    assert res["available"] is True
    # newest mtime -> last session is new1
    assert res["last_session"]["session_id"] == "new1"
    assert res["last_session"]["input"] == 1000
    # only new1 within the 7-day window
    assert res["week"]["session_count"] == 1
    assert res["week"]["input"] == 1000
    assert res["week"]["total"] == 1000 + 2000 + 50 + 25
    # full session list: both sessions, newest (new1) first
    assert len(res["sessions"]) == 2
    assert res["sessions"][0]["session_id"] == "new1"
    assert res["sessions"][1]["session_id"] == "old1"
    assert res["sessions"][0]["date"]  # dated from the (mocked) mtime
    # per-session est. cost + total; no waste data -> empty clusters
    assert res["sessions"][0]["total"] == 1000 + 2000 + 50 + 25
    assert res["sessions"][0]["cost"] > 0
    assert res["sessions"][0]["errors"] == [] and res["sessions"][0]["repeats"] == []
    assert res["last_session"]["cost"] > 0


def test_collect_tokens_clustering_from_waste(tmp_path, monkeypatch):
    now = datetime(2026, 6, 5, tzinfo=timezone.utc)
    agg = {
        "token_stats": {
            "per_session": [
                {
                    "session_id": "sessA",
                    "turns": 3,
                    "total_input_tokens": 10,
                    "total_output_tokens": 20,
                    "total_cache_read_tokens": 0,
                    "total_cache_creation_tokens": 0,
                }
            ]
        },
        "failed_commands": [
            {
                "tool": "Bash",
                "command": "git push",
                "session_id": "sessA",
                "error_preview": "rejected",
            }
        ],
        "waste_signals": {
            "repeated_commands": [
                {"command": "ls", "count": 4, "sessions": ["sessA", "sessB"]},
                {"command": "pwd", "count": 2, "sessions": ["sessB"]},
            ]
        },
    }
    monkeypatch.setattr(k, "_session_analyze_json", lambda c: agg)
    monkeypatch.setattr(k, "_session_mtimes", lambda c: {"sessA": now.timestamp()})
    res = k.collect_tokens(tmp_path, now=now)
    s = res["sessions"][0]
    assert s["error_count"] == 1 and s["errors"][0]["command"] == "git push"
    # only repeats whose sessions include this session are attached
    assert [r["command"] for r in s["repeats"]] == ["ls"]
    assert s["repeats"][0]["count"] == 4


def test_collect_tokens_empty_sessions(tmp_path, monkeypatch):
    monkeypatch.setattr(
        k, "_session_analyze_json", lambda c: {"token_stats": {"per_session": []}}
    )
    res = k.collect_tokens(tmp_path)
    assert res["available"] is True
    assert res["last_session"] is None


# ---------------------------------------------------------------------------
# collect_cost (usage/ ccusage JSON fixtures — same source as the TUI)
# ---------------------------------------------------------------------------


def test_collect_cost_unavailable_missing_dir(tmp_path):
    res = k.collect_cost(usage_dir=tmp_path / "nope")
    assert res["available"] is False
    assert "nicht gefunden" in res["reason"]


def test_collect_cost_windows_and_total(tmp_path):
    # now = Sunday 2026-06-07 -> week starts Friday 2026-06-05
    now = datetime(2026, 6, 7, 12, 0, 0)

    def day(name, d, cost):
        _write(
            tmp_path / name,
            json.dumps({"date": d, "ccusage": {"total_cost": cost}}),
        )

    day("m1_2026-06-07.json", "2026-06-07", 1.0)  # today
    day("m1_2026-06-06.json", "2026-06-06", 2.0)  # yesterday
    day("m2_2026-06-06.json", "2026-06-06", 0.5)  # yesterday, other machine -> sums
    day("m1_2026-06-04.json", "2026-06-04", 4.0)  # before week start, in month
    day("m1_2026-05-30.json", "2026-05-30", 8.0)  # last month
    # old combined format + rl snapshot must be ignored by the cost loader
    _write(tmp_path / "old.json", json.dumps({"ccusage_daily": [1, 2, 3]}))
    _write(tmp_path / "x_rl.json", json.dumps({"ts": "z", "five_hour_pct": 1}))

    res = k.collect_cost(usage_dir=tmp_path, now=now)
    assert res["available"] is True
    assert res["today"] == 1.0
    assert res["yesterday"] == 2.5
    assert res["week"] == 3.5  # 06-06 (2.5) + 06-07 (1.0); 06-04 excluded
    assert res["month"] == 7.5  # June: 1 + 2.5 + 4; May excluded
    assert res["total"] == 15.5


def test_collect_cost_rate_limits(tmp_path):
    now = datetime(2026, 6, 7, 12, 0, 0)
    now_ts = int(now.timestamp())
    _write(
        tmp_path / "m1_2026-06-07.json",
        json.dumps({"date": "2026-06-07", "ccusage": {"total_cost": 1.0}}),
    )
    _write(
        tmp_path / "machine_rl.json",
        json.dumps(
            {
                "ts": "2026-06-07T11:59:00",
                "five_hour_pct": 50.0,
                "five_hour_resets_at": now_ts
                + 2 * 3600,  # 2h left of 5h -> 60% elapsed
                "seven_day_pct": 20.0,
                "seven_day_resets_at": now_ts + 3 * 24 * 3600,
            }
        ),
    )
    res = k.collect_cost(usage_dir=tmp_path, now=now)
    fh = res["five_hour"]
    assert fh is not None
    assert fh["used_pct"] == 50.0
    assert fh["elapsed_pct"] == 60.0
    assert fh["projected_pct"] == 83.3  # 50 / 0.6
    assert fh["resets_in"] == "2h0m"
    assert res["seven_day"]["resets_in"] == "3d0h"


# ---------------------------------------------------------------------------
# collect_git + git actions
# ---------------------------------------------------------------------------


def test_git_recommend_states():
    assert "committen" in k._git_recommend("feat", True, 0, 3)
    assert "mergen" in k._git_recommend("feat", False, 0, 2)
    assert "gelöscht" in k._git_recommend("feat", False, 0, 0)
    assert "pushen" in k._git_recommend("main", False, 4, None)
    assert "nichts zu tun" in k._git_recommend("main", False, 0, None)


def test_collect_git_parses_status(tmp_path, monkeypatch):
    monkeypatch.setattr(k, "_repo_root", lambda c: tmp_path)

    def fake_git(cwd, *args):
        if args[:2] == ("rev-parse", "--abbrev-ref"):
            return "feat/x\n"
        if args[0] == "branch":
            return "feat/x\nmain\n"
        if args[0] == "status":
            return " M file_a.py\n?? new.py\nA  staged.py\n"
        if args[:2] == ("diff", "--shortstat"):
            return " 2 files changed, 5 insertions(+), 1 deletion(-)\n"
        if args[0] == "rev-list":
            return "0\t3\n"  # behind 0, ahead 3
        return ""

    monkeypatch.setattr(k, "_git", fake_git)
    res = k.collect_git(tmp_path)
    assert res["available"] is True
    assert res["branch"] == "feat/x"
    assert res["branches"] == ["feat/x", "main"]
    assert (res["staged"], res["unstaged"], res["untracked"]) == (1, 1, 1)
    assert res["dirty"] is True
    assert res["ahead_main"] == 3
    assert "5 insertions" in res["shortstat"]
    # structured per-file list for the clickable diff view
    fs = {f["path"]: f for f in res["files_struct"]}
    assert fs["new.py"]["untracked"] is True
    assert fs["file_a.py"]["untracked"] is False and fs["file_a.py"]["xy"] == " M"
    assert fs["staged.py"]["xy"] == "A "


def test_git_diff_path_guard(tmp_path, monkeypatch):
    monkeypatch.setattr(k, "_repo_root", lambda c: tmp_path)
    # a path escaping the repo is rejected before any git call
    bad = k._git_diff(tmp_path, "../../etc/passwd")
    assert bad["ok"] is False and "ausserhalb" in bad["error"]


def test_scan_scripts_lists_code_files(tmp_path):
    _write(tmp_path / "SKILL.md", "x")
    _write(tmp_path / "run.py", "print(1)\n")
    _write(tmp_path / "bin" / "do.sh", "echo hi\n")
    _write(tmp_path / "notes.txt", "ignored")
    scripts = {s["path"]: s for s in k._scan_scripts(tmp_path)}
    assert "run.py" in scripts and "bin/do.sh" in scripts
    assert "notes.txt" not in scripts
    assert scripts["run.py"]["lang"] == "py"


def test_agent_meta_reads_tokens(tmp_path):
    _write(
        tmp_path / "Engineer.md", "---\ndescription: Builds things.\n---\n# Engineer\n"
    )
    m = k._agent_meta(tmp_path / "Engineer.md")
    assert m["name"] == "Engineer" and m["tokens"] > 0
    assert m["description"] == "Builds things."


def _git_init(repo):
    import subprocess

    repo.mkdir(parents=True, exist_ok=True)
    for args in (
        ["init", "-q"],
        ["config", "user.email", "t@t"],
        ["config", "user.name", "t"],
        ["commit", "--allow-empty", "-q", "-m", "root"],
    ):
        subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)


def test_git_commit_and_delete_roundtrip(tmp_path):
    import subprocess

    repo = tmp_path / "r"
    _git_init(repo)
    _write(repo / "f.txt", "hello")
    assert k.git_commit(repo, "add f")["ok"] is True
    subprocess.run(
        ["git", "-C", str(repo), "branch", "tmpbranch"], check=True, capture_output=True
    )
    assert k.git_delete(repo, "tmpbranch")["ok"] is True
    assert k.git_commit(repo, "   ")["ok"] is False  # empty message rejected


def test_read_doc_skill_traversal_and_kinds(tmp_path, monkeypatch):
    home = tmp_path / ".claude"
    sdir = home / "skills" / "audit"
    sdir.mkdir(parents=True)
    _write(sdir / "SKILL.md", "---\ndescription: x\n---\n# Audit\nbody text\n")

    ok = k._read_doc(tmp_path, home, "skill", "audit")
    assert ok["ok"] is True and "Audit" in ok["content"] and ok["tokens"] > 0

    # path traversal / bad names rejected before any read
    assert k._read_doc(tmp_path, home, "skill", "../../etc/passwd")["ok"] is False
    assert k._read_doc(tmp_path, home, "bogus", "")["ok"] is False
    assert k._read_doc(tmp_path, home, "skill", "missing")["ok"] is False

    # claude-project reads <repo>/CLAUDE.md (repo root mocked)
    repo = tmp_path / "repo"
    (repo).mkdir()
    _write(repo / "CLAUDE.md", "# Project rules\n")
    monkeypatch.setattr(k, "_repo_root", lambda c: repo)
    proj = k._read_doc(tmp_path, home, "claude-project", "")
    assert proj["ok"] is True and "Project rules" in proj["content"]


def test_read_doc_agent_skillfile_homefile(tmp_path):
    home = tmp_path / ".claude"
    # agent
    _write(home / "agents" / "Engineer.md", "# Engineer\nrole text\n")
    ag = k._read_doc(tmp_path, home, "agent", "Engineer")
    assert ag["ok"] is True and "role text" in ag["content"]
    assert k._read_doc(tmp_path, home, "agent", "../secret")["ok"] is False

    # skillfile (referenced script inside the skill dir)
    _write(home / "skills" / "audit" / "scripts" / "run.py", "print('x')\n")
    sf = k._read_doc(tmp_path, home, "skillfile", "audit", "scripts/run.py")
    assert sf["ok"] is True and "print" in sf["content"]
    esc = k._read_doc(tmp_path, home, "skillfile", "audit", "../../../etc/passwd")
    assert esc["ok"] is False

    # homefile: inside ~/.claude ok, outside rejected
    _write(home / "hooks" / "redactor.py", "# hook\n")
    hf = k._read_doc(tmp_path, home, "homefile", "", "hooks/redactor.py")
    assert hf["ok"] is True and "hook" in hf["content"]
    out = k._read_doc(tmp_path, home, "homefile", "", "/etc/passwd")
    assert out["ok"] is False and "ausserhalb" in out["error"]


def test_read_doc_memory(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    _write(repo / "knowledge" / "memory" / "MEMORY.md", "# index\nentry\n")
    monkeypatch.setattr(k, "_repo_root", lambda c: repo)
    ok = k._read_doc(tmp_path, tmp_path / ".claude", "memory", "MEMORY.md")
    assert ok["ok"] is True and "index" in ok["content"]
    bad = k._read_doc(tmp_path, tmp_path / ".claude", "memory", "../../etc/passwd")
    assert bad["ok"] is False


def test_read_doc_lektion(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    _write(repo / "knowledge" / "lektion-x.md", "# Lektion X\nlearned\n")
    monkeypatch.setattr(k, "_repo_root", lambda c: repo)
    ok = k._read_doc(tmp_path, tmp_path / ".claude", "lektion", "lektion-x.md")
    assert ok["ok"] is True and "learned" in ok["content"]
    bad = k._read_doc(tmp_path, tmp_path / ".claude", "lektion", "../secret")
    assert bad["ok"] is False


def test_read_doc_knowfile_and_taskfile(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    _write(repo / "knowledge" / "decisions.md", "## 1 — Foo\nbody\n")
    _write(
        repo / "backlog" / "tasks" / "ccs-099 - Demo.md",
        "---\nid: CCS-099\n---\n## Description\nfull task\n",
    )
    monkeypatch.setattr(k, "_repo_root", lambda c: repo)
    kf = k._read_doc(tmp_path, tmp_path / ".claude", "knowfile", "", "decisions.md")
    assert kf["ok"] is True and "body" in kf["content"]
    tf = k._read_doc(tmp_path, tmp_path / ".claude", "taskfile", "ccs-099 - Demo.md")
    assert tf["ok"] is True and "full task" in tf["content"]
    # traversal rejected for both
    assert (
        k._read_doc(tmp_path, tmp_path / ".claude", "knowfile", "", "../etc")["ok"]
        is False
    )
    assert (
        k._read_doc(tmp_path, tmp_path / ".claude", "taskfile", "../../etc")["ok"]
        is False
    )


def test_knowledge_index_captures_path_and_desc(tmp_path, monkeypatch):
    monkeypatch.setattr(k, "_repo_root", lambda c: tmp_path)
    monkeypatch.setattr(k, "_git", lambda c, *a: "main\n")
    _write(tmp_path / "CLAUDE.md", "# P\n")
    _write(
        tmp_path / "knowledge" / "README.md",
        "## Index\n- [Decisions](decisions.md) — ADR log\n",
    )
    res = k.collect_project(tmp_path)
    e = res["knowledge_index"][0]
    assert e["path"] == "decisions.md" and e["desc"] == "ADR log"


def test_collect_git_numstat_per_file(tmp_path, monkeypatch):
    monkeypatch.setattr(k, "_repo_root", lambda c: tmp_path)

    def fake_git(cwd, *args):
        if args[:2] == ("rev-parse", "--abbrev-ref"):
            return "main\n"
        if args[0] == "branch":
            return "main\n"
        if args[:2] == ("diff", "--numstat"):
            return "5\t1\tfile_a.py\n"
        if args[0] == "status":
            return " M file_a.py\n?? new.py\n"
        if args[:2] == ("diff", "--shortstat"):
            return " 1 file changed\n"
        if args[0] == "rev-list":
            return "0\t0\n"
        return ""

    monkeypatch.setattr(k, "_git", fake_git)
    res = k.collect_git(tmp_path)
    fs = {f["path"]: f for f in res["files_struct"]}
    assert fs["file_a.py"]["added"] == 5 and fs["file_a.py"]["deleted"] == 1
    assert fs["new.py"]["untracked"] is True and fs["new.py"]["added"] is None


def test_task_description_section_and_fallback():
    section = "## Description\n<!-- SECTION:DESCRIPTION:BEGIN -->\nhello world\n<!-- SECTION:DESCRIPTION:END -->\n"
    assert k._task_description(section) == "hello world"
    fallback = "## Description\nplain desc here\n\n## Acceptance\n- x\n"
    assert "plain desc here" in k._task_description(fallback)


def test_est_cost_positive_and_ordered():
    # output tokens cost more than the same count of cache reads
    assert k._est_cost(0, 1_000_000, 0, 0) > k._est_cost(0, 0, 1_000_000, 0)
    assert k._est_cost(0, 0, 0, 0) == 0.0


def test_csrf_ok():
    assert k._csrf_ok(None) is True
    assert k._csrf_ok("http://127.0.0.1:8765") is True
    assert k._csrf_ok("http://localhost:8765") is True
    assert k._csrf_ok("http://evil.example") is False


def test_result_page_escapes_output():
    out = k._result_page(
        "commit", {"ok": False, "cmd": "git x", "output": "<script>boom</script>"}
    )
    assert "<script>boom" not in out
    assert "&lt;script&gt;" in out
    assert "Fehler" in out


def test_action_push_requires_token(tmp_path, monkeypatch):
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    calls = []

    def fake_push(cwd, branch):
        calls.append(branch)
        return {"ok": True, "cmd": "git push origin " + branch, "output": "done"}

    monkeypatch.setattr(k, "git_push", fake_push)
    client = TestClient(k.build_app(tmp_path))

    r = client.post("/action/push", data={"branch": "feat", "confirm": "nope"})
    assert r.status_code == 200 and "tippe PUSH" in r.text
    assert calls == []  # NOT pushed without the token

    r = client.post("/action/push", data={"branch": "feat", "confirm": "PUSH"})
    assert calls == ["feat"] and "done" in r.text


def test_action_merge_and_delete_gates(tmp_path, monkeypatch):
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    merged, deleted = [], []

    def fake_merge(cwd, branch):
        merged.append(branch)
        return {"ok": True, "cmd": "m", "output": "ok"}

    def fake_delete(cwd, branch):
        deleted.append(branch)
        return {"ok": True, "cmd": "d", "output": "ok"}

    monkeypatch.setattr(k, "git_merge", fake_merge)
    monkeypatch.setattr(k, "git_delete", fake_delete)
    client = TestClient(k.build_app(tmp_path))

    assert (
        "tippe MERGE"
        in client.post("/action/merge", data={"branch": "feat", "confirm": "x"}).text
    )
    assert merged == []
    client.post("/action/merge", data={"branch": "feat", "confirm": "MERGE"})
    assert merged == ["feat"]

    # delete needs the exact branch name as confirmation
    assert (
        "exakten Branch-Namen"
        in client.post(
            "/action/delete", data={"branch": "feat", "confirm": "wrong"}
        ).text
    )
    assert deleted == []
    client.post("/action/delete", data={"branch": "feat", "confirm": "feat"})
    assert deleted == ["feat"]


# ---------------------------------------------------------------------------
# build_data (collectors -> browser DATA) + browser render
# ---------------------------------------------------------------------------


def _ctx(cards):
    return {"generated_at": "now", "cwd": "/x", "cards": cards}


def test_build_data_maps_collectors():
    cards = {
        "global": {
            "available": True,
            "skills": {"names": ["audit", "qmd"]},
            "agents": ["Engineer"],
            "settings": {"hook_events": {"Stop": 1, "PreToolUse": 2}},
        },
        "project": {
            "available": True,
            "repo": "cc-setup",
            "branch": "feat/x",
            "claude_md_headers": ["Rules"],
            "knowledge_index": [{"title": "Decisions"}],
        },
        "knowledge": {
            "available": True,
            "decisions": [
                {"id": "003", "title": "Konsolidieren", "status": "accepted"}
            ],
            "memory": ["MEMORY.md"],
            "lektionen": ["lektion-x.md"],
            "changelog": ["- a"],
        },
        "backlog": {
            "available": True,
            "tasks": [
                {
                    "id": "CCS-013",
                    "title": "Dash",
                    "status": "In Progress",
                    "milestone": "m",
                    "desc": "d1",
                },
                {
                    "id": "CCS-013.02",
                    "title": "Sub",
                    "status": "To Do",
                    "milestone": "m",
                    "desc": "",
                },
                {
                    "id": "CCS-001",
                    "title": "Old",
                    "status": "Done",
                    "milestone": "m",
                    "desc": "",
                },
            ],
            "milestones": [{"name": "m", "done": 1, "total": 3}],
            "in_progress_count": 1,
        },
        "tn": {
            "available": True,
            "next": [{"title": "Do A", "status": "action", "project": "p"}],
            "blocked": [],
        },
        "tokens": {
            "available": True,
            "last_session": {
                "session_id": "abc",
                "turns": 9,
                "input": 100,
                "output": 200,
                "cache_read": 50,
                "cache_creation": 25,
            },
            "week": {"total": 375, "session_count": 1},
        },
        "git": {
            "available": True,
            "branch": "feat/x",
            "branches": ["feat/x", "main"],
            "dirty": True,
            "recommend": "commit",
            "staged": 1,
            "unstaged": 0,
            "untracked": 0,
            "ahead_origin": 3,
            "behind_origin": 0,
            "ahead_main": 2,
            "shortstat": "",
        },
        "cost": {
            "available": True,
            "today": 1.0,
            "week": 3.5,
            "month": 7.5,
            "total": 15.5,
            "five_hour": None,
            "seven_day": None,
        },
    }
    d = k.build_data(_ctx(cards))
    assert d["coll"]["skills"]["items"][0]["name"] == "audit"  # names-only fallback
    assert d["coll"]["hooks"]["items"][0]["name"] == "Stop"
    assert d["coll"]["hooks"]["items"][0]["entries"] == []  # no hook_detail -> empty
    assert d["coll"]["decisions"]["items"][0]["id"] == "003"
    bk = d["coll"]["backlog"]["items"]
    ids = [t["name"] for t in bk]
    # each task exactly once, no duplication
    assert ids.count("CCS-013") == 1 and ids.count("CCS-013.02") == 1
    # Done task is flagged + grouped as Done (collapsed in UI)
    done_item = next(t for t in bk if t["name"] == "CCS-001")
    assert done_item["done"] is True and done_item["group"] == "Done"
    assert d["overview"]["backlog_inprogress"] == 1
    # sessions: backward-compat synthesis from last_session (no sessions key here)
    assert d["coll"]["sessions"]["items"][0]["cr"] == 50
    assert d["git"]["branch"] == "feat/x"
    assert d["cost"]["total"] == 15.5
    assert d["overview"]["skills"] == 2 and d["overview"]["hooks"] == 3
    assert "cost_5h" in d["overview"] and "cost_7d" in d["overview"]
    assert "gclaude" in d["coll"]  # global CLAUDE.md section present
    # enriched overview: knowledge counts + tn counts present
    assert d["overview"]["know_counts"]["decisions"] == 1
    assert d["overview"]["tn_next"] == 1 and d["overview"]["tn_available"] is True
    # backlog progress: 3 tasks, 1 done; milestone "m" 1/3 -> not fully done
    assert d["overview"]["tasks_total"] == 3 and d["overview"]["tasks_done"] == 1
    assert d["overview"]["ms_total"] == 1 and d["overview"]["ms_done"] == 0
    assert d["meta"]["branch"] == "feat/x"


def test_build_data_degrades_on_unavailable():
    keys = ("global", "project", "knowledge", "backlog", "tn", "tokens", "git", "cost")
    d = k.build_data(_ctx({key: k._unavailable("x") for key in keys}))
    assert d["coll"]["skills"]["items"] == []
    assert d["git"].get("available") is False
    assert d["overview"]["skills"] == 0


def test_safe_script_json_escapes_script_breakout():
    out = k._safe_script_json({"x": "</script><b>", "y": "a & b"})
    assert "</script>" not in out
    assert "\\u003c/script\\u003e" in out
    assert "\\u0026" in out
    assert "a \\u0026 b" in out  # spaces preserved, only & escaped


def test_render_html_browser_shell_and_safe_data():
    cards = {
        "project": {
            "available": True,
            "repo": "cc-setup",
            "branch": "<b>main",
            "claude_md_headers": [],
            "knowledge_index": [],
        }
    }
    out = k.render_html(_ctx(cards))
    assert "<!DOCTYPE html>" in out
    assert "mp-nav" in out and "mp-detail" in out  # bare #mp shell, no chrome
    assert "<header" not in out and "<footer" not in out  # no surrounding chrome
    assert "window.DATA = " in out
    assert (
        "<b>main" not in out
    )  # hostile branch value never raw (shell esc + DATA escape)


def test_browser_js_escapes_desc():
    # Regression guard for the DOM-XSS fix: raw desc (task title / tn nextAction)
    # is rendered via innerHTML in browser.js (client-side, not unit-testable here),
    # so assert the source escapes it (esc(desc)) and dropped the raw concatenation.
    js = (k.SCRIPTS_DIR / "knowledge_assets" / "browser.js").read_text(encoding="utf-8")
    assert "esc(desc)" in js
    assert '+ desc + "</p>"' not in js


# ---------------------------------------------------------------------------
# smoke test of the FastAPI route (skipped if fastapi/httpx missing)
# ---------------------------------------------------------------------------


def test_route_returns_200_html(tmp_path, monkeypatch):
    fastapi = pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    # Make every collector cheap + offline so the smoke test is hermetic.
    monkeypatch.setattr(k, "collect_global", lambda home: k._unavailable("test"))
    monkeypatch.setattr(
        k,
        "collect_project",
        lambda cwd: {
            "available": True,
            "repo": "r",
            "branch": "b",
            "claude_md_headers": [],
            "knowledge_index": [],
        },
    )
    monkeypatch.setattr(
        k, "collect_knowledge", lambda cwd, vault=None: k._unavailable("test")
    )
    monkeypatch.setattr(k, "collect_backlog", lambda cwd: k._unavailable("test"))
    monkeypatch.setattr(k, "collect_tn", lambda cwd: k._unavailable("test"))
    monkeypatch.setattr(
        k, "collect_tokens", lambda cwd, now=None: k._unavailable("test")
    )
    monkeypatch.setattr(
        k, "collect_cost", lambda usage_dir=None, now=None: k._unavailable("test")
    )
    monkeypatch.setattr(k, "collect_git", lambda cwd: k._unavailable("test"))

    app = k.build_app(tmp_path)
    client = TestClient(app)
    resp = client.get("/")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    assert "<!DOCTYPE html>" in resp.text
    assert "mp-nav" in resp.text  # bare #mp 3-pane shell
    assert "window.DATA" in resp.text
    _ = fastapi  # silence unused


# ---------------------------------------------------------------------------
# discover_projects + resolve_project_cwd (project tab bar)
# ---------------------------------------------------------------------------


def test_discover_projects_finds_backlog_and_includes_active(tmp_path):
    base = tmp_path / "GITHUB"
    (base / "proj_a" / "backlog").mkdir(parents=True)
    (base / "proj_b").mkdir(parents=True)  # no backlog/ -> excluded
    (base / "proj_c" / "backlog").mkdir(parents=True)
    active = tmp_path / "elsewhere" / "cc-setup"  # outside base
    active.mkdir(parents=True)
    out = k.discover_projects(active, base=base)
    # only dirs with backlog/ + always the active repo, sorted by name
    assert [p["name"] for p in out] == ["cc-setup", "proj_a", "proj_c"]
    by = {p["name"]: p["path"] for p in out}
    assert by["proj_a"] == str(base / "proj_a")
    assert by["cc-setup"] == str(active)  # active included even outside base


def test_discover_projects_active_inside_base_not_duplicated(tmp_path):
    base = tmp_path / "GITHUB"
    (base / "cc" / "backlog").mkdir(parents=True)
    out = k.discover_projects(base / "cc", base=base)
    assert [p["name"] for p in out] == ["cc"]  # listed exactly once


def test_discover_projects_missing_base_keeps_active(tmp_path):
    active = tmp_path / "repo"
    active.mkdir()
    out = k.discover_projects(active, base=tmp_path / "nope")
    assert [p["name"] for p in out] == ["repo"]


def test_resolve_project_cwd_whitelist_and_fallback(tmp_path):
    projects = [
        {"name": "a", "path": str(tmp_path / "a")},
        {"name": "b", "path": str(tmp_path / "b")},
    ]
    default = tmp_path / "home"
    assert k.resolve_project_cwd("a", projects, default) == tmp_path / "a"
    # unknown / hostile / empty name -> default cwd (no arbitrary path)
    assert k.resolve_project_cwd("../../etc/passwd", projects, default) == default
    assert k.resolve_project_cwd("", projects, default) == default


def test_build_data_passes_projects_through():
    ctx = _ctx({})
    ctx["projects"] = [{"name": "p1", "path": "/p1"}]
    ctx["active_project"] = "p1"
    d = k.build_data(ctx)
    assert d["projects"] == [{"name": "p1", "path": "/p1"}]
    assert d["active_project"] == "p1"


def test_render_html_has_project_tabs_and_theme_toggle():
    ctx = _ctx(
        {
            "project": {
                "available": True,
                "repo": "cc-setup",
                "branch": "main",
                "claude_md_headers": [],
                "knowledge_index": [],
            }
        }
    )
    ctx["projects"] = [
        {"name": "cc-setup", "path": "/x/cc-setup"},
        {"name": "bujo-notes-ios", "path": "/y/bujo-notes-ios"},
    ]
    ctx["active_project"] = "cc-setup"
    out = k.render_html(ctx)
    # slim tab bar with both projects; the active one flagged
    assert 'class="kn-tabs"' in out
    assert 'href="/?project=cc-setup"' in out
    assert 'href="/?project=bujo-notes-ios"' in out
    assert "kn-tab is-active" in out
    # theme toggle + pre-paint init + both Catppuccin palettes embedded
    assert 'id="kn-theme-toggle"' in out
    assert "data-theme" in out
    assert "#cdd6f4" in out  # Catppuccin Mocha text (dark)
    assert "#eff1f5" in out  # Catppuccin Latte base (light)
    # active project carried into DATA so /read & /gitdiff target the right repo
    assert '"active_project"' in out


def test_route_project_switch_resolves_whitelisted_cwd(tmp_path, monkeypatch):
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    other = tmp_path / "GITHUB" / "bujo-notes-ios"
    (other / "backlog").mkdir(parents=True)

    seen: dict[str, str] = {}

    def fake_ctx(cwd, home, projects=None, active_project=None):
        seen["cwd"] = str(cwd)
        seen["active"] = active_project or ""
        return {
            "generated_at": "now",
            "cwd": str(cwd),
            "projects": projects or [],
            "active_project": active_project or "",
            "cards": {},
        }

    monkeypatch.setattr(
        k,
        "discover_projects",
        lambda active_repo, base=None: [
            {"name": "bujo-notes-ios", "path": str(other)},
            {"name": tmp_path.name, "path": str(tmp_path)},
        ],
    )
    monkeypatch.setattr(k, "build_context", fake_ctx)
    client = TestClient(k.build_app(tmp_path))

    r = client.get("/?project=bujo-notes-ios")
    assert r.status_code == 200
    assert seen["cwd"] == str(other) and seen["active"] == "bujo-notes-ios"

    # unknown project -> falls back to launch cwd (whitelist guard, no traversal)
    seen.clear()
    client.get("/?project=/etc/passwd")
    assert seen["cwd"] == str(tmp_path)
