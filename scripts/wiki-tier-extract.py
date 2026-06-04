#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
wiki-tier-extract.py — Read-only Parser for Tiered Body-Convention (Hybrid Context Spec §3).

Extracts:
  - tier=abstract: content of `> [!abstract] Kernidee` callout (multi-line, until
                   first non-callout line after the callout header).
  - tier=overview: content of `## Lagebild` section (whitelist of allowed headings,
                   up to the next H2 or EOF).

Output: stdout text by default, or JSON with --format json:
  {"tier": "abstract", "content": "...", "tokens": <int>, "present": <bool>}

Token estimate: len(content.split()) * 1.3 (rough heuristic, matches spec §3.1).

Exit codes:
  0  tier present and extracted
  1  abstract missing (tier=abstract)
  2  overview missing (tier=overview)
  3  note not found / parse error

Usage:
  uv run skripte/wiki-tier-extract.py --note <path> --tier abstract
  uv run skripte/wiki-tier-extract.py --note <path> --tier overview --format json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Whitelist of overview section headings (Q-3 spec). The first one that appears
# in the body wins. Case-sensitive — matches the spec literally.
OVERVIEW_HEADING_WHITELIST = ("Lagebild", "Das Lagebild", "Lagebild & Architektur")

ABSTRACT_CALLOUT_RE = re.compile(
    r"^>\s*\[!abstract\][^\n]*\n", re.MULTILINE | re.IGNORECASE
)
H2_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)
FRONTMATTER_RE = re.compile(r"\A---\s*\n.*?\n---\s*\n", re.DOTALL)


def strip_frontmatter(text: str) -> str:
    m = FRONTMATTER_RE.match(text)
    return text[m.end():] if m else text


def estimate_tokens(content: str) -> int:
    """Token estimate per spec §3.1: word_count * 1.3."""
    if not content.strip():
        return 0
    return int(len(content.split()) * 1.3)


def extract_abstract(body: str) -> tuple[str, bool]:
    """Return (content, present) for `> [!abstract] Kernidee` callout body.

    Callout body = consecutive lines starting with `>` after the callout header,
    stripped of the leading `>` and any single space.
    """
    m = ABSTRACT_CALLOUT_RE.search(body)
    if not m:
        return "", False
    # Header found. Check that it actually says "Kernidee" (case-insensitive) or
    # is the first abstract callout in the body. Spec §3.1 wants the Kernidee
    # callout specifically — but the wider pattern (`> [!abstract] *`) is also
    # the de-facto convention. We accept any [!abstract] callout.
    start = m.end()
    lines = body[start:].splitlines(keepends=True)
    content_lines: list[str] = []
    for raw_line in lines:
        # Strip optional newline for the prefix check, keep original line.
        stripped = raw_line.rstrip("\n")
        if not stripped.lstrip().startswith(">"):
            break  # first non-callout line ends the callout body
        # Drop leading `>` and at most one whitespace after it.
        line = stripped.lstrip()
        line = line[1:]  # drop `>`
        if line.startswith(" "):
            line = line[1:]
        content_lines.append(line)
    content = "\n".join(content_lines).strip()
    return content, True


def extract_overview(body: str) -> tuple[str, bool, str | None]:
    """Return (content, present, heading_matched).

    Find the first H2 header whose text matches OVERVIEW_HEADING_WHITELIST. The
    section runs from after that header until the next H2 (or EOF). Frontmatter
    must already be stripped before calling this.
    """
    headings = list(H2_RE.finditer(body))
    if not headings:
        return "", False, None
    matched_idx = -1
    matched_heading: str | None = None
    for i, h in enumerate(headings):
        text = h.group(1).strip()
        if text in OVERVIEW_HEADING_WHITELIST:
            matched_idx = i
            matched_heading = text
            break
    if matched_idx < 0:
        return "", False, None
    start = headings[matched_idx].end()
    end = headings[matched_idx + 1].start() if matched_idx + 1 < len(headings) else len(body)
    content = body[start:end].strip()
    return content, True, matched_heading


def resolve_note_path(note_arg: str) -> Path:
    p = Path(note_arg)
    if not p.is_absolute():
        p = (REPO_ROOT / p).resolve()
    return p


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--note", required=True, help="Note path (relative to vault or absolute)")
    ap.add_argument("--tier", choices=("abstract", "overview"), required=True)
    ap.add_argument("--format", choices=("text", "json"), default="text")
    args = ap.parse_args()

    note_path = resolve_note_path(args.note)
    if not note_path.is_file():
        print(f"note not found: {note_path}", file=sys.stderr)
        return 3

    try:
        raw = note_path.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"read error: {exc}", file=sys.stderr)
        return 3

    body = strip_frontmatter(raw)

    if args.tier == "abstract":
        content, present = extract_abstract(body)
        payload = {
            "tier": "abstract",
            "content": content,
            "tokens": estimate_tokens(content),
            "present": present,
        }
        exit_code = 0 if present else 1
    else:
        content, present, heading = extract_overview(body)
        payload = {
            "tier": "overview",
            "content": content,
            "tokens": estimate_tokens(content),
            "present": present,
            "heading_matched": heading,
        }
        exit_code = 0 if present else 2

    if args.format == "json":
        json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
    else:
        if present:
            sys.stdout.write(content)
            if not content.endswith("\n"):
                sys.stdout.write("\n")
        else:
            print(f"(no {args.tier} tier found)", file=sys.stderr)

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
