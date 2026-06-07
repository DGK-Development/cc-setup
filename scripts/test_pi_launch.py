"""Tests for scripts/pi-launch.sh — subprocess-based, uses --print-prompt dry-run mode.

Strategy:
  - Feed survey data via SURVEY_JSON_OVERRIDE env var (avoids real backlog/sprint_bridge calls).
  - Feed task-list data via TASK_LIST_OVERRIDE env var (avoids real backlog calls).
  - Pipe user selection via stdin.
  - Assert the built prompt on stdout.

Run: cd scripts && uv run --with pytest pytest test_pi_launch.py -v
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).with_name("pi-launch.sh")

# ---------------------------------------------------------------------------
# Survey fixture helpers
# ---------------------------------------------------------------------------

SURVEY_ONE_MILESTONE = json.dumps(
    {
        "open_milestones": [
            {"name": "ccs-sprint: pi-workflow", "done": 2, "total": 7},
        ],
        "candidate_tns": [],
        "tn_available": True,
    }
)

SURVEY_TWO_MILESTONES = json.dumps(
    {
        "open_milestones": [
            {"name": "ccs-sprint: alpha", "done": 1, "total": 4},
            {"name": "ccs-sprint: beta", "done": 3, "total": 5},
        ],
        "candidate_tns": [],
        "tn_available": True,
    }
)

SURVEY_EMPTY = json.dumps(
    {
        "open_milestones": [],
        "candidate_tns": [],
        "tn_available": True,
    }
)

# A minimal "backlog task list -m <ms> --plain" response with a To-Do task.
TASK_LIST_WITH_TODO = """\
To Do:
  [HIGH] CCS-036.04 - Voll-autonomer E2E-Lauf verifizieren
  [MEDIUM] CCS-036.05 - Doku + ADR

Done:
  CCS-036.01 - Slack-Ask-Modul
"""

TASK_LIST_EMPTY = """\
Done:
  CCS-036.01 - Slack-Ask-Modul
"""


# ---------------------------------------------------------------------------
# Runner helper
# ---------------------------------------------------------------------------


def run_launcher(
    stdin_text: str, survey_json: str, task_list: str = ""
) -> subprocess.CompletedProcess:
    """Run pi-launch.sh --print-prompt with injected fixtures."""
    env = os.environ.copy()
    env["SURVEY_JSON_OVERRIDE"] = survey_json
    if task_list:
        env["TASK_LIST_OVERRIDE"] = task_list
    else:
        env.pop("TASK_LIST_OVERRIDE", None)

    return subprocess.run(
        ["bash", str(SCRIPT), "--print-prompt"],
        input=stdin_text,
        capture_output=True,
        text=True,
        env=env,
    )


# ---------------------------------------------------------------------------
# Tests — existing milestone selection
# ---------------------------------------------------------------------------


def test_existing_milestone_prompt_contains_name():
    """Selecting milestone 1 produces a prompt that includes the milestone name."""
    result = run_launcher("1\n", SURVEY_ONE_MILESTONE, TASK_LIST_EMPTY)
    assert result.returncode == 0, result.stderr
    prompt = result.stdout.strip()
    assert "ccs-sprint: pi-workflow" in prompt


def test_existing_milestone_prompt_has_pipeline_prefix():
    """Prompt always starts with the pipeline keyword."""
    result = run_launcher("1\n", SURVEY_ONE_MILESTONE, TASK_LIST_EMPTY)
    assert result.returncode == 0, result.stderr
    prompt = result.stdout.strip()
    assert "orchestrator pipeline" in prompt


def test_existing_milestone_prompt_has_continue_keyword():
    """Selecting an existing milestone produces a prompt with 'Continue milestone'."""
    result = run_launcher("1\n", SURVEY_ONE_MILESTONE)
    assert result.returncode == 0, result.stderr
    prompt = result.stdout.strip()
    assert "Continue milestone" in prompt


def test_existing_milestone_prompt_no_fixed_task():
    """Prompt must NOT contain a fixed task id — sequencer picks it via cc-backlog next."""
    result = run_launcher("1\n", SURVEY_ONE_MILESTONE)
    assert result.returncode == 0, result.stderr
    prompt = result.stdout.strip()
    # No specific task id or "Next open task" wording in the prompt
    assert "Next open task" not in prompt
    assert "CCS-036.04" not in prompt


def test_existing_milestone_without_next_task():
    """When no To-Do tasks remain, the prompt still includes the milestone name."""
    result = run_launcher("1\n", SURVEY_ONE_MILESTONE, TASK_LIST_EMPTY)
    assert result.returncode == 0, result.stderr
    prompt = result.stdout.strip()
    assert "ccs-sprint: pi-workflow" in prompt
    # No task reference in output
    assert "Next open task" not in prompt


def test_second_milestone_selected():
    """Selecting milestone 2 from a two-milestone list uses the correct name."""
    result = run_launcher("2\n", SURVEY_TWO_MILESTONES, TASK_LIST_EMPTY)
    assert result.returncode == 0, result.stderr
    prompt = result.stdout.strip()
    assert "ccs-sprint: beta" in prompt
    assert "ccs-sprint: alpha" not in prompt


# ---------------------------------------------------------------------------
# Tests — new milestone
# ---------------------------------------------------------------------------


def test_new_milestone_prompt_contains_name():
    """Choosing 'new milestone' and entering a name produces a prompt with that name."""
    # Survey has 1 milestone, so "2" = new milestone.
    result = run_launcher("2\nmy-new-sprint\n", SURVEY_ONE_MILESTONE)
    assert result.returncode == 0, result.stderr
    prompt = result.stdout.strip()
    assert "my-new-sprint" in prompt


def test_new_milestone_prompt_has_new_keyword():
    """New milestone prompt signals 'new milestone' intent."""
    result = run_launcher("2\nmy-new-sprint\n", SURVEY_ONE_MILESTONE)
    assert result.returncode == 0, result.stderr
    prompt = result.stdout.strip()
    assert "new milestone" in prompt.lower()


def test_new_milestone_with_no_existing_milestones():
    """When there are no milestones, option 1 = direct tasks, option 2 = new milestone."""
    result = run_launcher("2\nfresh-milestone\n", SURVEY_EMPTY)
    assert result.returncode == 0, result.stderr
    prompt = result.stdout.strip()
    assert "fresh-milestone" in prompt
    assert "new milestone" in prompt.lower()


def test_direct_tasks_when_no_milestones():
    """No open milestones -> option 1 runs existing tasks directly (no milestone scope)."""
    result = run_launcher("1\n", SURVEY_EMPTY)
    assert result.returncode == 0, result.stderr
    prompt = result.stdout.strip()
    assert "orchestrator pipeline" in prompt
    assert "Pick the next open task" in prompt
    # Direct path has no milestone framing.
    assert "new milestone" not in prompt.lower()
    assert "Continue milestone" not in prompt


# ---------------------------------------------------------------------------
# Tests — error handling
# ---------------------------------------------------------------------------


def test_invalid_selection_exits_nonzero():
    """An out-of-range selection should exit with a non-zero code."""
    result = run_launcher("99\n", SURVEY_ONE_MILESTONE)
    assert result.returncode != 0


def test_zero_selection_exits_nonzero():
    """Zero is not a valid selection."""
    result = run_launcher("0\n", SURVEY_ONE_MILESTONE)
    assert result.returncode != 0


def test_empty_new_milestone_name_exits_nonzero():
    """Empty name for a new milestone should exit non-zero."""
    result = run_launcher("2\n\n", SURVEY_ONE_MILESTONE)
    assert result.returncode != 0
