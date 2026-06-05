"""Unit tests for context-resolve.py — classify() status-intent precision.

The module filename contains a hyphen (it ships as a Claude Code plugin script,
not an importable package), so it is loaded via importlib by path.

Regression focus (CCS-009): the status-intent branch must NOT swallow
explanation/code queries that happen to contain a status word — those need
qmd semantics (stages 2/3), so they must fall through to explainer/goal.

Run: cd scripts && uv run --with pytest --with pyyaml pytest test_context_resolve.py -v
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "context_resolve", Path(__file__).with_name("context-resolve.py")
)
cr = importlib.util.module_from_spec(_SPEC)
sys.modules["context_resolve"] = cr
_SPEC.loader.exec_module(cr)


# --- False-positives: status word present, but query needs qmd semantics -----
# These must NOT be type:status — they need Layer 2/3 (stages contains 2).

FALSE_POSITIVES = [
    "status-Intent-Gap",
    "die offene Frage",
    "wie funktioniert der status-intent code",
]


@pytest.mark.parametrize("query", FALSE_POSITIVES)
def test_explanation_queries_are_not_status(query):
    c = cr.classify(query)
    assert c["type"] != "status", f"{query!r} wrongly classified as status"
    assert 2 in c["stages"], f"{query!r} should keep qmd semantics (stage 2)"


# --- Real status queries: must stay type:status with stages [1] --------------

REAL_STATUS = [
    "was ist offen",
    "sprint stand",
    "offene tasks",
    "status",
    "was steht an",
]


@pytest.mark.parametrize("query", REAL_STATUS)
def test_real_status_queries_classify_as_status(query):
    c = cr.classify(query)
    assert c["type"] == "status", f"{query!r} should classify as status"
    assert c["stages"] == [1], f"{query!r} should skip qmd semantics (stages [1])"
