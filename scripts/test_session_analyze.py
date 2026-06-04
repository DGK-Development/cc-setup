"""Tests for session_analyze.py — TDD: tests written before implementation."""

# /// script
# requires-python = ">=3.11"
# dependencies = ["pytest"]
# ///
import json
import os
from pathlib import Path

import pytest

SCRIPT = Path(__file__).with_name("session_analyze.py")


# ---------------------------------------------------------------------------
# Helper: build a minimal JSONL session for fixture use
# ---------------------------------------------------------------------------


def make_entry(type_, **kwargs):
    base = {"type": type_, "sessionId": "test-session-01"}
    base.update(kwargs)
    return json.dumps(base)


def make_assistant_entry(tool_uses=None, usage=None, uuid="u-asst-01"):
    """Build an assistant JSONL entry with optional tool_use content + usage."""
    content = []
    for tu in tool_uses or []:
        content.append(
            {
                "type": "tool_use",
                "id": tu["id"],
                "name": tu["name"],
                "input": tu.get("input", {}),
            }
        )
    msg = {"role": "assistant", "content": content}
    if usage:
        msg["usage"] = usage
    return json.dumps(
        {
            "type": "assistant",
            "uuid": uuid,
            "sessionId": "test-session-01",
            "timestamp": "2026-06-01T10:00:00.000Z",
            "message": msg,
        }
    )


def make_user_tool_result(tool_use_id, content, is_error=False, uuid="u-user-01"):
    """Build a user JSONL entry containing a tool_result."""
    item = {"type": "tool_result", "tool_use_id": tool_use_id, "content": content}
    if is_error:
        item["is_error"] = True
    msg = {"role": "user", "content": [item]}
    return json.dumps(
        {
            "type": "user",
            "uuid": uuid,
            "sessionId": "test-session-01",
            "timestamp": "2026-06-01T10:00:01.000Z",
            "message": msg,
        }
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def session_dir(tmp_path):
    """Create a fake project session directory with JSONL files."""
    proj_dir = tmp_path / "-home-fake-project"
    proj_dir.mkdir()
    return proj_dir


@pytest.fixture
def single_session_jsonl(session_dir):
    """One JSONL with: 1 failed Bash call, 1 successful Bash call, 2 Read calls."""
    lines = [
        # Turn 1: assistant calls Bash (non-zero exit → error result)
        make_assistant_entry(
            tool_uses=[
                {
                    "id": "tu-bash-fail",
                    "name": "Bash",
                    "input": {"command": "cat /nonexistent"},
                }
            ],
            usage={
                "input_tokens": 100,
                "output_tokens": 50,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0,
            },
            uuid="asst-1",
        ),
        make_user_tool_result(
            "tu-bash-fail",
            "cat: /nonexistent: No such file or directory",
            is_error=True,
            uuid="user-1",
        ),
        # Turn 2: assistant calls Bash (success)
        make_assistant_entry(
            tool_uses=[
                {"id": "tu-bash-ok", "name": "Bash", "input": {"command": "ls /"}}
            ],
            usage={
                "input_tokens": 200,
                "output_tokens": 30,
                "cache_read_input_tokens": 500,
                "cache_creation_input_tokens": 100,
            },
            uuid="asst-2",
        ),
        make_user_tool_result(
            "tu-bash-ok", "bin etc usr", is_error=False, uuid="user-2"
        ),
        # Turn 3: assistant calls Read twice (same file)
        make_assistant_entry(
            tool_uses=[
                {
                    "id": "tu-read-1",
                    "name": "Read",
                    "input": {"file_path": "/home/user/CLAUDE.md"},
                },
                {
                    "id": "tu-read-2",
                    "name": "Read",
                    "input": {"file_path": "/home/user/README.md"},
                },
            ],
            usage={
                "input_tokens": 300,
                "output_tokens": 20,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0,
            },
            uuid="asst-3",
        ),
        make_user_tool_result("tu-read-1", "# CLAUDE", uuid="user-3"),
        make_user_tool_result("tu-read-2", "# README", uuid="user-4"),
    ]
    f = session_dir / "session-a.jsonl"
    f.write_text("\n".join(lines) + "\n")
    return f


@pytest.fixture
def repeated_sequence_jsonl(session_dir):
    """JSONL with repeated command sequence: Bash→Read→Bash→Read (same cmds)."""
    lines = []
    for i in range(3):
        lines.append(
            make_assistant_entry(
                tool_uses=[
                    {
                        "id": f"tu-b-{i}",
                        "name": "Bash",
                        "input": {"command": "git status"},
                    }
                ],
                usage={
                    "input_tokens": 100,
                    "output_tokens": 10,
                    "cache_read_input_tokens": 0,
                    "cache_creation_input_tokens": 0,
                },
                uuid=f"asst-b-{i}",
            )
        )
        lines.append(
            make_user_tool_result(f"tu-b-{i}", "On branch main", uuid=f"user-b-{i}")
        )
        lines.append(
            make_assistant_entry(
                tool_uses=[
                    {
                        "id": f"tu-r-{i}",
                        "name": "Read",
                        "input": {"file_path": "/etc/hosts"},
                    }
                ],
                usage={
                    "input_tokens": 120,
                    "output_tokens": 5,
                    "cache_read_input_tokens": 0,
                    "cache_creation_input_tokens": 0,
                },
                uuid=f"asst-r-{i}",
            )
        )
        lines.append(
            make_user_tool_result(
                f"tu-r-{i}", "127.0.0.1 localhost", uuid=f"user-r-{i}"
            )
        )
    f = session_dir / "session-b.jsonl"
    f.write_text("\n".join(lines) + "\n")
    return f


# ---------------------------------------------------------------------------
# Tests: CWD-to-project-path derivation
# ---------------------------------------------------------------------------


def run_script(args, cwd=None, env=None):
    import subprocess

    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    return subprocess.run(
        ["uv", "run", "--with", "pytest", "--script", str(SCRIPT), *args],
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        env=merged_env,
    )


def run_analyze(session_dir, cwd_override=None, extra_env=None):
    """Run session_analyze.py with CLAUDE_PROJECTS_DIR pointing to session_dir's parent."""
    env = {"CLAUDE_PROJECTS_DIR": str(session_dir.parent)}
    if cwd_override:
        env["FAKE_CWD"] = cwd_override
    if extra_env:
        env.update(extra_env)
    return run_script(["--output-json"], env=env)


class TestCwdToProjectPath:
    def test_derives_project_dir_from_cwd(self, session_dir, tmp_path):
        """Script should map /home/fake/project → -home-fake-project folder."""
        # The session_dir IS the encoded project dir; its parent is CLAUDE_PROJECTS_DIR
        cwd = "/home/fake/project"
        r = run_script(
            ["--resolve-path", "--cwd", cwd],
            env={"CLAUDE_PROJECTS_DIR": str(session_dir.parent)},
        )
        assert r.returncode == 0, r.stderr
        out = json.loads(r.stdout)
        assert out["encoded"] == "-home-fake-project"
        assert out["resolved"] == str(session_dir)

    def test_leading_slash_becomes_leading_dash(self, session_dir, tmp_path):
        """Leading / in path becomes leading - in encoded name."""
        r = run_script(
            ["--resolve-path", "--cwd", "/some/path"],
            env={"CLAUDE_PROJECTS_DIR": str(session_dir.parent)},
        )
        assert r.returncode == 0, r.stderr
        out = json.loads(r.stdout)
        assert out["encoded"].startswith("-")

    def test_underscore_and_dot_become_dash(self, session_dir, tmp_path):
        """Claude Code encodes every non-alphanumeric char (incl. _ and .) as -.

        Real example: /Users/x/GITHUB_DG/cc-setup is stored under
        -Users-x-GITHUB-DG-cc-setup (underscore → dash). A path like
        pipeline2.0 becomes pipeline2-0 (dot → dash).
        """
        r = run_script(
            ["--resolve-path", "--cwd", "/Users/x/GITHUB_DG/app2.0"],
            env={"CLAUDE_PROJECTS_DIR": str(session_dir.parent)},
        )
        assert r.returncode == 0, r.stderr
        out = json.loads(r.stdout)
        assert out["encoded"] == "-Users-x-GITHUB-DG-app2-0"


# ---------------------------------------------------------------------------
# Tests: failed_commands extraction
# ---------------------------------------------------------------------------


class TestFailedCommands:
    def test_detects_error_tool_results(self, session_dir, single_session_jsonl):
        r = run_script(
            [
                "--output-json",
                "--projects-dir",
                str(session_dir.parent),
                "--cwd",
                "/home/fake/project",
            ],
            env={},
        )
        assert r.returncode == 0, r.stderr
        agg = json.loads(r.stdout)
        failed = agg["failed_commands"]
        assert len(failed) >= 1
        assert any("cat /nonexistent" in fc.get("command", "") for fc in failed)

    def test_failed_command_has_session_id(self, session_dir, single_session_jsonl):
        r = run_script(
            [
                "--output-json",
                "--projects-dir",
                str(session_dir.parent),
                "--cwd",
                "/home/fake/project",
            ],
            env={},
        )
        agg = json.loads(r.stdout)
        for fc in agg["failed_commands"]:
            assert "session_id" in fc

    def test_successful_bash_not_in_failed(self, session_dir, single_session_jsonl):
        r = run_script(
            [
                "--output-json",
                "--projects-dir",
                str(session_dir.parent),
                "--cwd",
                "/home/fake/project",
            ],
            env={},
        )
        agg = json.loads(r.stdout)
        failed_cmds = [fc.get("command", "") for fc in agg["failed_commands"]]
        assert not any("ls /" in c for c in failed_cmds)


# ---------------------------------------------------------------------------
# Tests: tool_frequencies
# ---------------------------------------------------------------------------


class TestToolFrequencies:
    def test_counts_tool_uses(self, session_dir, single_session_jsonl):
        r = run_script(
            [
                "--output-json",
                "--projects-dir",
                str(session_dir.parent),
                "--cwd",
                "/home/fake/project",
            ],
            env={},
        )
        agg = json.loads(r.stdout)
        freqs = agg["tool_frequencies"]
        assert freqs.get("Bash", 0) == 2
        assert freqs.get("Read", 0) == 2


# ---------------------------------------------------------------------------
# Tests: token_stats
# ---------------------------------------------------------------------------


class TestTokenStats:
    def test_sums_input_and_output_tokens(self, session_dir, single_session_jsonl):
        r = run_script(
            [
                "--output-json",
                "--projects-dir",
                str(session_dir.parent),
                "--cwd",
                "/home/fake/project",
            ],
            env={},
        )
        agg = json.loads(r.stdout)
        ts = agg["token_stats"]
        # input: 100+200+300=600, output: 50+30+20=100
        assert ts["total_input_tokens"] == 600
        assert ts["total_output_tokens"] == 100

    def test_counts_cache_tokens(self, session_dir, single_session_jsonl):
        r = run_script(
            [
                "--output-json",
                "--projects-dir",
                str(session_dir.parent),
                "--cwd",
                "/home/fake/project",
            ],
            env={},
        )
        agg = json.loads(r.stdout)
        ts = agg["token_stats"]
        assert ts["total_cache_read_tokens"] == 500
        assert ts["total_cache_creation_tokens"] == 100

    def test_per_session_stats_present(self, session_dir, single_session_jsonl):
        r = run_script(
            [
                "--output-json",
                "--projects-dir",
                str(session_dir.parent),
                "--cwd",
                "/home/fake/project",
            ],
            env={},
        )
        agg = json.loads(r.stdout)
        ts = agg["token_stats"]
        assert "per_session" in ts
        assert len(ts["per_session"]) >= 1


# ---------------------------------------------------------------------------
# Tests: repeated_sequences
# ---------------------------------------------------------------------------


class TestRepeatedSequences:
    def test_detects_repeated_tool_sequences(
        self, session_dir, repeated_sequence_jsonl
    ):
        r = run_script(
            [
                "--output-json",
                "--projects-dir",
                str(session_dir.parent),
                "--cwd",
                "/home/fake/project",
            ],
            env={},
        )
        assert r.returncode == 0, r.stderr
        agg = json.loads(r.stdout)
        seqs = agg["repeated_sequences"]
        assert len(seqs) >= 1
        # The Bash→Read sequence appears 3 times
        top = seqs[0]
        assert top["count"] >= 2
        assert "sequence" in top

    def test_repeated_commands_flagged(self, session_dir, repeated_sequence_jsonl):
        """Repeated identical Bash commands should appear."""
        r = run_script(
            [
                "--output-json",
                "--projects-dir",
                str(session_dir.parent),
                "--cwd",
                "/home/fake/project",
            ],
            env={},
        )
        agg = json.loads(r.stdout)
        # repeated_sequences or failed_commands should mention git status repeated
        seqs = agg["repeated_sequences"]
        cmds = [s.get("sequence", []) for s in seqs]
        flat = [
            item for sub in cmds for item in (sub if isinstance(sub, list) else [sub])
        ]
        assert any("git status" in str(c) for c in flat) or any(
            "Bash" in str(c) for c in flat
        )
