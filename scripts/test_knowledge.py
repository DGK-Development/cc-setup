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
    text = "## 001 — First decision\nStatus: accepted\n\n## 002 -- Second\n- **Status:** rejected\n"
    out = k._parse_decisions_md(text)
    assert out == [
        {"id": "001", "title": "First decision", "status": "accepted"},
        {"id": "002", "title": "Second", "status": "rejected"},
    ]


def test_encode_cwd_matches_session_analyze_rule():
    assert k._encode_cwd("/Users/x/GITHUB_DG/cc-setup") == "-Users-x-GITHUB-DG-cc-setup"


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
    (tmp_path / "agents").mkdir()
    _write(tmp_path / "agents" / "Engineer.md", "x")
    _write(tmp_path / "agents" / "Architect.md", "x")
    res = k.collect_global(tmp_path)
    assert res["skills"]["names"] == ["audit", "qmd"]
    assert res["skills"]["count"] == 2
    assert res["agents"] == ["Architect", "Engineer"]


def test_collect_global_settings_redacts_values(tmp_path):
    secret = "/secret/path/to/command --token=ABC123"
    settings = {
        "env": {"OBSIDIAN_VAULT_PATH": secret},
        "hooks": {
            "SessionStart": [{"hooks": [{"type": "command", "command": secret}]}],
            "Stop": [{"hooks": [{"type": "command", "command": secret}]}],
            "PreToolUse": [
                {"hooks": [{"type": "command", "command": secret}]},
                {"hooks": [{"type": "command", "command": secret}]},
            ],
        },
    }
    _write(tmp_path / "settings.json", json.dumps(settings))
    res = k.collect_global(tmp_path)
    events = res["settings"]["hook_events"]
    assert events == {"SessionStart": 1, "Stop": 1, "PreToolUse": 2}
    # The secret command/env values must never appear anywhere in the output.
    assert secret not in json.dumps(res)
    assert "ABC123" not in json.dumps(res)


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
    assert res["decisions"] == [
        {"id": "001", "title": "Foo decision", "status": "accepted"}
    ]
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
# collect_backlog (sprint_bridge survey mocked)
# ---------------------------------------------------------------------------


def test_collect_backlog_uninitialized(tmp_path, monkeypatch):
    monkeypatch.setattr(k, "_repo_root", lambda c: tmp_path)
    monkeypatch.setattr(k, "_sprint_survey", lambda r: {"initialized": False})
    res = k.collect_backlog(tmp_path)
    assert res["available"] is False
    assert "not initialized" in res["reason"]


def test_collect_backlog_unavailable_when_survey_none(tmp_path, monkeypatch):
    monkeypatch.setattr(k, "_repo_root", lambda c: tmp_path)
    monkeypatch.setattr(k, "_sprint_survey", lambda r: None)
    res = k.collect_backlog(tmp_path)
    assert res["available"] is False


def test_collect_backlog_open_milestones(tmp_path, monkeypatch):
    monkeypatch.setattr(k, "_repo_root", lambda c: tmp_path)
    survey = {
        "initialized": True,
        "prefix": "CCS",
        "open_milestones": [
            {
                "name": "knowledge-dashboard",
                "done": 2,
                "total": 6,
                "open_tasks": [{"id": "CCS-013.03"}, {"id": "CCS-013.04"}],
            }
        ],
    }
    monkeypatch.setattr(k, "_sprint_survey", lambda r: survey)
    monkeypatch.setattr(
        k, "_backlog_in_progress", lambda r: [{"id": "CCS-003", "title": "X"}]
    )
    res = k.collect_backlog(tmp_path)
    assert res["available"] is True
    assert res["open_milestones"][0]["open_ids"] == ["CCS-013.03", "CCS-013.04"]
    assert res["in_progress"] == [{"id": "CCS-003", "title": "X"}]


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
            "in_progress": [{"id": "CCS-013", "title": "Dash"}],
            "open_milestones": [
                {"name": "m", "done": 1, "total": 3, "open_ids": ["CCS-013.02"]}
            ],
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
    assert d["coll"]["skills"]["items"][0] == {"name": "audit", "cat": "", "desc": ""}
    assert d["coll"]["hooks"]["items"][0]["name"] == "Stop"
    assert d["coll"]["decisions"]["items"][0]["id"] == "003"
    ids = [t["name"] for t in d["coll"]["backlog"]["items"]]
    assert "CCS-013" in ids and "CCS-013.02" in ids
    assert d["coll"]["sessions"]["items"][0]["cr"] == 50
    assert d["git"]["branch"] == "feat/x"
    assert d["cost"]["total"] == 15.5
    assert d["overview"]["skills"] == 2 and d["overview"]["hooks"] == 3
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
    assert "mp-nav" in out and "READ-ONLY" in out
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
    assert "READ-ONLY" in resp.text  # terminal browser shell
    assert "mp-nav" in resp.text
    assert "window.DATA" in resp.text
    _ = fastapi  # silence unused
