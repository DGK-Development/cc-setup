"""Tests for scripts/cc-backlog.sh cmd_next() — RESUME fallback behaviour.

Strategy:
  - Create a tmp-dir with a fake `backlog` executable that returns controlled output.
  - Override PATH so the fake `backlog` is found first.
  - Set CC_ORCH_MILESTONE to simulate milestone-scoped queries.
  - Assert stdout format: "<id>\t<title>\t<MODE>", exit-code, and stderr messages.

Run: cd scripts && uv run -q pytest test_cc_backlog_next.py -q
"""

from __future__ import annotations

import os
import subprocess
import textwrap
from pathlib import Path

SCRIPT = Path(__file__).parent / "cc-backlog.sh"


def make_fake_backlog(tmp_path: Path, todo_output: str, inprog_output: str) -> Path:
    """Write a fake `backlog` script that responds to task-list queries.

    The shell expands -s "To Do" into two separate argv entries: "-s" and "To Do"
    (no literal quotes).  We match by scanning argv for a known status word.
    """
    fake = tmp_path / "backlog"
    # Embed outputs safely; we use Python's repr for single-quoted strings,
    # but need to emit them as shell strings.  Use a temp file approach instead
    # so multi-line outputs and special chars don't need escaping in the here-doc.
    todo_file = tmp_path / "_fake_todo.txt"
    todo_file.write_text(todo_output)
    inprog_file = tmp_path / "_fake_inprog.txt"
    inprog_file.write_text(inprog_output)

    fake.write_text(
        textwrap.dedent(
            f"""\
            #!/usr/bin/env bash
            # Fake backlog for testing.
            # argv scan: detect -s <status> by looking at positional arguments one by one.
            STATUS=""
            for arg in "$@"; do
                if [[ "$STATUS_NEXT" == "1" ]]; then
                    STATUS="$arg"
                    STATUS_NEXT=0
                fi
                if [[ "$arg" == "-s" ]]; then
                    STATUS_NEXT=1
                fi
            done
            if [[ "$STATUS" == "To Do" ]]; then
                cat {str(todo_file)!r}
                exit 0
            fi
            if [[ "$STATUS" == "In Progress" ]]; then
                cat {str(inprog_file)!r}
                exit 0
            fi
            # Passthrough for other commands (not expected in these tests).
            exit 0
            """
        )
    )
    fake.chmod(0o755)
    return tmp_path


def run_next(tmp_path: Path, *, milestone: str = "erstelle büch.md") -> subprocess.CompletedProcess:
    """Run cc-backlog.sh next with the fake backlog in PATH."""
    env = os.environ.copy()
    env["PATH"] = str(tmp_path) + ":" + env.get("PATH", "")
    env["CC_ORCH_MILESTONE"] = milestone
    return subprocess.run(
        ["bash", str(SCRIPT), "next"],
        capture_output=True,
        text=True,
        env=env,
    )


# ---------------------------------------------------------------------------
# Test 1: No To-Do tasks → fall back to In Progress (RESUME)
# ---------------------------------------------------------------------------

def test_resume_when_no_todo(tmp_path: Path) -> None:
    """When To Do is empty and In Progress has tasks, output MODE=RESUME."""
    # To Do: empty (only header, no tasks)
    todo_out = "No tasks found."
    # In Progress: one [Meilenstein] container (skipped) + one real task
    inprog_out = (
        "In Progress:\n"
        "  PIT-1 - [Meilenstein] erstelle büch.md\n"
        "  PIT-5 - Erstelle büch.md mit Titelzeile und Grundstruktur\n"
    )

    make_fake_backlog(tmp_path, todo_out, inprog_out)
    result = run_next(tmp_path)

    assert result.returncode == 0, f"Expected exit 0, got {result.returncode}. stderr={result.stderr!r}"
    out = result.stdout.strip()
    parts = out.split("\t")
    assert len(parts) == 3, f"Expected 3 tab-separated fields, got: {out!r}"
    assert parts[0] == "PIT-5", f"Wrong id: {parts[0]!r}"
    assert parts[1] == "Erstelle büch.md mit Titelzeile und Grundstruktur", f"Wrong title: {parts[1]!r}"
    assert parts[2] == "RESUME", f"Expected MODE=RESUME, got: {parts[2]!r}"


# ---------------------------------------------------------------------------
# Test 2: To-Do tasks exist → pick first, MODE=TODO
# ---------------------------------------------------------------------------

def test_todo_when_todo_exists(tmp_path: Path) -> None:
    """When To Do tasks exist, output MODE=TODO (no In Progress query needed)."""
    todo_out = (
        "To Do:\n"
        "  [HIGH] PIT-7 - [Meilenstein] something\n"
        "  PIT-8 - Finalize documentation\n"
    )
    inprog_out = "In Progress:\n  PIT-5 - Should NOT appear\n"

    make_fake_backlog(tmp_path, todo_out, inprog_out)
    result = run_next(tmp_path)

    assert result.returncode == 0, f"Expected exit 0, got {result.returncode}. stderr={result.stderr!r}"
    out = result.stdout.strip()
    parts = out.split("\t")
    assert len(parts) == 3, f"Expected 3 tab-separated fields, got: {out!r}"
    assert parts[0] == "PIT-8", f"Wrong id: {parts[0]!r}"
    assert parts[1] == "Finalize documentation", f"Wrong title: {parts[1]!r}"
    assert parts[2] == "TODO", f"Expected MODE=TODO, got: {parts[2]!r}"


# ---------------------------------------------------------------------------
# Test 3: Neither To-Do nor In-Progress → exit non-zero, stderr message
# ---------------------------------------------------------------------------

def test_error_when_no_tasks(tmp_path: Path) -> None:
    """When both To Do and In Progress are empty, exit != 0 and stderr has expected message."""
    empty_out = "No tasks found."

    make_fake_backlog(tmp_path, empty_out, empty_out)
    result = run_next(tmp_path)

    assert result.returncode != 0, f"Expected non-zero exit, got {result.returncode}. stdout={result.stdout!r}"
    assert "no 'To Do' or 'In Progress'" in result.stderr, (
        f"Expected error message in stderr, got: {result.stderr!r}"
    )
