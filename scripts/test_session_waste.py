"""Tests for token-waste heuristics in session_analyze.py — TDD RED first."""

# /// script
# requires-python = ">=3.11"
# dependencies = ["pytest"]
# ///
import json
import os
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent / "session_analyze.py"


def run_script(args, env=None):
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    return subprocess.run(
        ["uv", "run", "--with", "pytest", "--script", str(SCRIPT), *args],
        capture_output=True,
        text=True,
        env=merged_env,
    )


def run_analyze(session_dir, cwd="/home/fake/project"):
    env = {"CLAUDE_PROJECTS_DIR": str(session_dir.parent)}
    return run_script(
        ["--output-json", "--projects-dir", str(session_dir.parent), "--cwd", cwd],
        env=env,
    )


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _asst(tool_uses, usage=None, uuid="a", session_id="s1"):
    content = [
        {
            "type": "tool_use",
            "id": tu["id"],
            "name": tu["name"],
            "input": tu.get("input", {}),
        }
        for tu in tool_uses
    ]
    msg = {"role": "assistant", "content": content}
    if usage:
        msg["usage"] = usage
    return json.dumps(
        {
            "type": "assistant",
            "uuid": uuid,
            "sessionId": session_id,
            "timestamp": "2026-06-01T10:00:00.000Z",
            "message": msg,
        }
    )


def _user_result(tool_use_id, content, is_error=False, uuid="u", session_id="s1"):
    item = {"type": "tool_result", "tool_use_id": tool_use_id, "content": content}
    if is_error:
        item["is_error"] = True
    return json.dumps(
        {
            "type": "user",
            "uuid": uuid,
            "sessionId": session_id,
            "timestamp": "2026-06-01T10:00:01.000Z",
            "message": {"role": "user", "content": [item]},
        }
    )


DEFAULT_USAGE = {
    "input_tokens": 100,
    "output_tokens": 10,
    "cache_read_input_tokens": 0,
    "cache_creation_input_tokens": 0,
}


@pytest.fixture
def session_dir(tmp_path):
    proj = tmp_path / "-home-fake-project"
    proj.mkdir()
    return proj


# ---------------------------------------------------------------------------
# Fixture: repeated reads of same file
# ---------------------------------------------------------------------------


@pytest.fixture
def redundant_reads_jsonl(session_dir):
    """Three Read calls for the same file path in one session."""
    lines = []
    for i in range(3):
        lines.append(
            _asst(
                [
                    {
                        "id": f"r{i}",
                        "name": "Read",
                        "input": {"file_path": "/home/user/CLAUDE.md"},
                    }
                ],
                usage=DEFAULT_USAGE,
                uuid=f"a{i}",
            )
        )
        lines.append(_user_result(f"r{i}", "# CLAUDE content", uuid=f"u{i}"))
    (session_dir / "session-reads.jsonl").write_text("\n".join(lines) + "\n")
    return session_dir


# ---------------------------------------------------------------------------
# Fixture: oversized tool output
# ---------------------------------------------------------------------------


@pytest.fixture
def oversized_output_jsonl(session_dir):
    """One tool_result with content > 50 000 chars."""
    big_content = "x" * 55_000
    lines = [
        _asst(
            [
                {
                    "id": "big-read",
                    "name": "Read",
                    "input": {"file_path": "/big/file.py"},
                }
            ],
            usage=DEFAULT_USAGE,
            uuid="a-big",
        ),
        _user_result("big-read", big_content, uuid="u-big"),
    ]
    (session_dir / "session-big.jsonl").write_text("\n".join(lines) + "\n")
    return session_dir


# ---------------------------------------------------------------------------
# Fixture: repeated identical bash commands
# ---------------------------------------------------------------------------


@pytest.fixture
def repeated_commands_jsonl(session_dir):
    """'git status' called 4 times in same session."""
    lines = []
    for i in range(4):
        lines.append(
            _asst(
                [{"id": f"gs{i}", "name": "Bash", "input": {"command": "git status"}}],
                usage=DEFAULT_USAGE,
                uuid=f"a-gs{i}",
            )
        )
        lines.append(_user_result(f"gs{i}", "On branch main", uuid=f"u-gs{i}"))
    (session_dir / "session-cmds.jsonl").write_text("\n".join(lines) + "\n")
    return session_dir


# ---------------------------------------------------------------------------
# Tests: waste_signals present in aggregate
# ---------------------------------------------------------------------------


class TestWasteSignalsPresent:
    def test_aggregate_has_waste_signals_key(self, session_dir, redundant_reads_jsonl):
        r = run_analyze(session_dir)
        assert r.returncode == 0, r.stderr
        agg = json.loads(r.stdout)
        assert "waste_signals" in agg

    def test_waste_signals_has_required_categories(
        self, session_dir, redundant_reads_jsonl
    ):
        r = run_analyze(session_dir)
        agg = json.loads(r.stdout)
        ws = agg["waste_signals"]
        for key in ("redundant_reads", "oversized_outputs", "repeated_commands"):
            assert key in ws, f"Missing waste category: {key}"

    def test_thresholds_documented(self, session_dir, redundant_reads_jsonl):
        """waste_signals must include a thresholds sub-dict so thresholds are explicit."""
        r = run_analyze(session_dir)
        agg = json.loads(r.stdout)
        assert "thresholds" in agg["waste_signals"]


# ---------------------------------------------------------------------------
# Tests: redundant_reads category
# ---------------------------------------------------------------------------


class TestRedundantReads:
    """Threshold: same file read ≥ 2 times in one session."""

    def test_detects_repeated_file_reads(self, session_dir, redundant_reads_jsonl):
        r = run_analyze(session_dir)
        agg = json.loads(r.stdout)
        rr = agg["waste_signals"]["redundant_reads"]
        assert len(rr) >= 1

    def test_redundant_read_includes_file_path(
        self, session_dir, redundant_reads_jsonl
    ):
        r = run_analyze(session_dir)
        agg = json.loads(r.stdout)
        rr = agg["waste_signals"]["redundant_reads"]
        paths = [item["file_path"] for item in rr]
        assert "/home/user/CLAUDE.md" in paths

    def test_redundant_read_includes_session_and_count(
        self, session_dir, redundant_reads_jsonl
    ):
        r = run_analyze(session_dir)
        agg = json.loads(r.stdout)
        rr = agg["waste_signals"]["redundant_reads"]
        for item in rr:
            assert "session_id" in item
            assert item["count"] >= 2

    def test_single_read_not_flagged(self, session_dir):
        """A file read only once should NOT appear in redundant_reads."""
        lines = [
            _asst(
                [{"id": "r0", "name": "Read", "input": {"file_path": "/once.md"}}],
                usage=DEFAULT_USAGE,
            ),
            _user_result("r0", "content"),
        ]
        (session_dir / "session-once.jsonl").write_text("\n".join(lines) + "\n")
        r = run_analyze(session_dir)
        agg = json.loads(r.stdout)
        rr = agg["waste_signals"]["redundant_reads"]
        assert not any(item["file_path"] == "/once.md" for item in rr)


# ---------------------------------------------------------------------------
# Tests: oversized_outputs category
# ---------------------------------------------------------------------------


class TestOversizedOutputs:
    """Threshold: tool_result content length > 50 000 chars."""

    def test_detects_large_tool_output(self, session_dir, oversized_output_jsonl):
        r = run_analyze(session_dir)
        assert r.returncode == 0, r.stderr
        agg = json.loads(r.stdout)
        oo = agg["waste_signals"]["oversized_outputs"]
        assert len(oo) >= 1

    def test_oversized_output_has_tool_and_size(
        self, session_dir, oversized_output_jsonl
    ):
        r = run_analyze(session_dir)
        agg = json.loads(r.stdout)
        oo = agg["waste_signals"]["oversized_outputs"]
        item = oo[0]
        assert "tool" in item
        assert "output_chars" in item
        assert item["output_chars"] >= 50_000

    def test_oversized_output_has_session_id(self, session_dir, oversized_output_jsonl):
        r = run_analyze(session_dir)
        agg = json.loads(r.stdout)
        oo = agg["waste_signals"]["oversized_outputs"]
        for item in oo:
            assert "session_id" in item

    def test_normal_output_not_flagged(self, session_dir):
        """Small tool output should NOT appear in oversized_outputs."""
        lines = [
            _asst(
                [{"id": "r0", "name": "Read", "input": {"file_path": "/small.md"}}],
                usage=DEFAULT_USAGE,
            ),
            _user_result("r0", "hello"),
        ]
        (session_dir / "session-small.jsonl").write_text("\n".join(lines) + "\n")
        r = run_analyze(session_dir)
        agg = json.loads(r.stdout)
        oo = agg["waste_signals"]["oversized_outputs"]
        assert len(oo) == 0


# ---------------------------------------------------------------------------
# Tests: repeated_commands category
# ---------------------------------------------------------------------------


class TestRepeatedCommands:
    """Threshold: identical Bash command run ≥ 3 times across sessions."""

    def test_detects_repeated_bash_commands(self, session_dir, repeated_commands_jsonl):
        r = run_analyze(session_dir)
        assert r.returncode == 0, r.stderr
        agg = json.loads(r.stdout)
        rc = agg["waste_signals"]["repeated_commands"]
        assert len(rc) >= 1

    def test_repeated_command_has_count_and_command(
        self, session_dir, repeated_commands_jsonl
    ):
        r = run_analyze(session_dir)
        agg = json.loads(r.stdout)
        rc = agg["waste_signals"]["repeated_commands"]
        item = rc[0]
        assert "command" in item
        assert "count" in item
        assert item["count"] >= 3

    def test_repeated_command_includes_sessions(
        self, session_dir, repeated_commands_jsonl
    ):
        r = run_analyze(session_dir)
        agg = json.loads(r.stdout)
        rc = agg["waste_signals"]["repeated_commands"]
        for item in rc:
            assert "sessions" in item

    def test_rare_command_not_flagged(self, session_dir):
        """Command run only twice should NOT appear in repeated_commands."""
        lines = []
        for i in range(2):
            lines.append(
                _asst(
                    [
                        {
                            "id": f"x{i}",
                            "name": "Bash",
                            "input": {"command": "echo rare"},
                        }
                    ],
                    usage=DEFAULT_USAGE,
                    uuid=f"a{i}",
                )
            )
            lines.append(_user_result(f"x{i}", "rare", uuid=f"u{i}"))
        (session_dir / "session-rare.jsonl").write_text("\n".join(lines) + "\n")
        r = run_analyze(session_dir)
        agg = json.loads(r.stdout)
        rc = agg["waste_signals"]["repeated_commands"]
        assert not any(item["command"] == "echo rare" for item in rc)
