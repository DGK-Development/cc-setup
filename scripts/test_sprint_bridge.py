"""Unit tests for sprint_bridge.py — pure parsers + resolve-repo.

Hermetic by design: no ``backlog`` / ``tn`` subprocesses are invoked, so the
suite runs fast and needs no Backlog.md install. survey/status are thin
compositions over the parsers tested here plus subprocess plumbing.

Run: cd scripts &&
     uv run --with pytest --with pyyaml pytest test_sprint_bridge.py -v
"""

from __future__ import annotations

import sprint_bridge as sb

# --- fixtures (verbatim from real `backlog … --plain` output) ------------

MILESTONE_LIST = """Active milestones (1):
  session-analyser: session-analyser (5/6 done)

Completed milestones (1):
  (collapsed, use --show-completed to list)
"""

MILESTONE_LIST_COMPLETED = """Active milestones (1):
  session-analyser: session-analyser (5/6 done)

Completed milestones (1):
  ccs-sprint: tn→Milestone Workflow: ccs-sprint: tn→Milestone Workflow (10/10 done)
"""

TASK_LIST_M = """To Do:
  CCS-002 - [Spec] session-analyser Skill

Done:
  CCS-002.01 - Session-JSONL-Parser + Metrik-Extraktor (session_analyze.py)
  CCS-002.02 - Token-Waste-Heuristiken
"""

TASK_LIST_TWO_OPEN = """To Do:
  CCS-002 - [Spec] session-analyser Skill

In Progress:
  CCS-003 - Minimal: context-load Layer 1.5 Sprint-Anzeige

Done:
  CCS-001 - [Spec] tn→Milestone Sprint-Workflow
"""


# --- dedup_name ----------------------------------------------------------

def test_dedup_simple_name():
    assert sb.dedup_name("session-analyser: session-analyser") == "session-analyser"


def test_dedup_name_with_colons():
    disp = "ccs-sprint: tn→Milestone Workflow: ccs-sprint: tn→Milestone Workflow"
    assert sb.dedup_name(disp) == "ccs-sprint: tn→Milestone Workflow"


def test_dedup_non_duplicated_name_is_unchanged():
    assert sb.dedup_name("a single milestone") == "a single milestone"


# --- parse_milestones ----------------------------------------------------

def test_parse_milestones_active_only():
    out = sb.parse_milestones(MILESTONE_LIST)
    assert out == [{"name": "session-analyser", "done": 5, "total": 6}]


def test_parse_milestones_excludes_completed_section():
    out = sb.parse_milestones(MILESTONE_LIST_COMPLETED)
    # Only the active milestone — the completed one must not leak in.
    assert [m["name"] for m in out] == ["session-analyser"]


def test_parse_milestones_empty():
    assert sb.parse_milestones("Active milestones (0):\n") == []


# --- parse_open_tasks ----------------------------------------------------

def test_parse_open_tasks_excludes_done():
    out = sb.parse_open_tasks(TASK_LIST_M)
    assert out == [{"id": "CCS-002", "title": "[Spec] session-analyser Skill"}]


def test_parse_open_tasks_todo_and_in_progress():
    out = sb.parse_open_tasks(TASK_LIST_TWO_OPEN)
    assert [t["id"] for t in out] == ["CCS-002", "CCS-003"]


def test_parse_open_tasks_title_may_contain_dash():
    text = "To Do:\n  CCS-009 - Foo - Bar baz\n"
    assert sb.parse_open_tasks(text) == [{"id": "CCS-009", "title": "Foo - Bar baz"}]


def test_parse_open_tasks_no_tasks():
    assert sb.parse_open_tasks("No tasks found.\n") == []


# --- resolve-repo / config ----------------------------------------------

def test_resolve_repo_uninitialized(tmp_path):
    res = sb.cmd_resolve_repo(tmp_path)
    assert res["initialized"] is False
    assert res["prefix"] is None


def test_resolve_repo_initialized(tmp_path):
    bl = tmp_path / "backlog"
    bl.mkdir()
    (bl / "config.yml").write_text('task_prefix: "xyz"\n', encoding="utf-8")
    res = sb.cmd_resolve_repo(tmp_path)
    assert res["initialized"] is True
    assert res["prefix"] == "xyz"


def test_backlog_initialized_false_for_plain_dir(tmp_path):
    assert sb.backlog_initialized(tmp_path) is False


def test_read_prefix_handles_single_quotes(tmp_path):
    bl = tmp_path / "backlog"
    bl.mkdir()
    (bl / "config.yml").write_text("task_prefix: 'abc'\n", encoding="utf-8")
    assert sb.read_prefix(tmp_path) == "abc"
