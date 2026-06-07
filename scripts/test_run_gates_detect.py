"""Tests for run-gates.sh Auto-Detect and .pi/gates Override.

Strategy:
  - Create Tempdirs with marker files (justfile / package.json / Cargo.toml / deno.json / .pi/gates).
  - Invoke run-gates.sh --print-gates (Dry-Run) from the tempdir as cwd.
  - Assert which gate commands are detected WITHOUT running them (no real npm/cargo/etc).
  - Also verify that --print-gates exits 0 on success and that no-gates-detected is reported.

Run: cd scripts && uv run --with pytest pytest test_run_gates_detect.py -v
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).with_name("run-gates.sh")


def run_print_gates(tmpdir: str) -> subprocess.CompletedProcess:
    """Run run-gates.sh --print-gates with cwd=tmpdir."""
    return subprocess.run(
        ["bash", str(SCRIPT), "--print-gates"],
        capture_output=True,
        text=True,
        cwd=tmpdir,
    )


# ---------------------------------------------------------------------------
# Auto-Detect tests
# ---------------------------------------------------------------------------


def test_justfile_detected():
    """justfile marker -> 'just test' gate detected."""
    with tempfile.TemporaryDirectory() as d:
        Path(d, "justfile").touch()
        result = run_print_gates(d)
        assert result.returncode == 0, result.stderr
        assert "just test" in result.stdout


def test_justfile_capital_J_detected():
    """Justfile (capital J) marker -> 'just test' gate detected."""
    with tempfile.TemporaryDirectory() as d:
        Path(d, "Justfile").touch()
        result = run_print_gates(d)
        assert result.returncode == 0, result.stderr
        assert "just test" in result.stdout


def test_package_json_detected():
    """package.json marker -> 'npm test' gate detected."""
    with tempfile.TemporaryDirectory() as d:
        Path(d, "package.json").write_text("{}")
        result = run_print_gates(d)
        assert result.returncode == 0, result.stderr
        assert "npm test" in result.stdout


def test_cargo_toml_detected():
    """Cargo.toml marker -> 'cargo test' gate detected."""
    with tempfile.TemporaryDirectory() as d:
        Path(d, "Cargo.toml").write_text(
            '[package]\nname = "example"\nversion = "0.1.0"\n'
        )
        result = run_print_gates(d)
        assert result.returncode == 0, result.stderr
        assert "cargo test" in result.stdout


def test_deno_json_detected():
    """deno.json marker -> 'deno task test' gate detected."""
    with tempfile.TemporaryDirectory() as d:
        Path(d, "deno.json").write_text("{}")
        result = run_print_gates(d)
        assert result.returncode == 0, result.stderr
        assert "deno task test" in result.stdout


def test_deno_jsonc_detected():
    """deno.jsonc marker -> 'deno task test' gate detected."""
    with tempfile.TemporaryDirectory() as d:
        Path(d, "deno.jsonc").write_text("{}")
        result = run_print_gates(d)
        assert result.returncode == 0, result.stderr
        assert "deno task test" in result.stdout


def test_multiple_markers_detected():
    """Multiple markers produce multiple gates."""
    with tempfile.TemporaryDirectory() as d:
        Path(d, "justfile").touch()
        Path(d, "package.json").write_text("{}")
        result = run_print_gates(d)
        assert result.returncode == 0, result.stderr
        lines = result.stdout.strip().splitlines()
        commands = [l.split(":", 1)[1] if ":" in l else l for l in lines]
        assert any("just test" in c for c in commands)
        assert any("npm test" in c for c in commands)


def test_no_markers_reports_no_gates_detected():
    """Empty dir with no markers -> 'no-gates-detected' on stdout, exit 0 (print-gates mode)."""
    with tempfile.TemporaryDirectory() as d:
        result = run_print_gates(d)
        assert result.returncode == 0, result.stderr
        assert "no-gates-detected" in result.stdout


# ---------------------------------------------------------------------------
# .pi/gates Override tests
# ---------------------------------------------------------------------------


def test_pi_gates_override_replaces_auto_detect():
    """.pi/gates present -> uses only those gates, ignores auto-detect markers."""
    with tempfile.TemporaryDirectory() as d:
        # justfile present (would be auto-detected otherwise)
        Path(d, "justfile").touch()
        # .pi/gates overrides
        pi_dir = Path(d, ".pi")
        pi_dir.mkdir()
        (pi_dir / "gates").write_text("custom:make check\n")
        result = run_print_gates(d)
        assert result.returncode == 0, result.stderr
        assert "make check" in result.stdout
        # Auto-detect should NOT appear
        assert "just test" not in result.stdout


def test_pi_gates_multiple_entries():
    """.pi/gates with multiple entries: all are reported."""
    with tempfile.TemporaryDirectory() as d:
        pi_dir = Path(d, ".pi")
        pi_dir.mkdir()
        (pi_dir / "gates").write_text("lint:npm run lint\ntest:pytest -q\n")
        result = run_print_gates(d)
        assert result.returncode == 0, result.stderr
        assert "npm run lint" in result.stdout
        assert "pytest -q" in result.stdout


def test_pi_gates_comments_and_blank_lines_ignored():
    """.pi/gates: comment lines (#) and blank lines are ignored."""
    with tempfile.TemporaryDirectory() as d:
        pi_dir = Path(d, ".pi")
        pi_dir.mkdir()
        (pi_dir / "gates").write_text("# this is a comment\n\ntest:cargo test\n")
        result = run_print_gates(d)
        assert result.returncode == 0, result.stderr
        assert "cargo test" in result.stdout
        assert "#" not in result.stdout


# ---------------------------------------------------------------------------
# Backward-compat: cc-setup itself (justfile present -> just test detected)
# ---------------------------------------------------------------------------


def test_backward_compat_cc_setup_detects_just_test():
    """In cc-setup repo (has justfile), run-gates detects 'just test'."""
    cc_setup_root = str(SCRIPT.parent.parent)
    result = run_print_gates(cc_setup_root)
    assert result.returncode == 0, result.stderr
    assert "just test" in result.stdout
