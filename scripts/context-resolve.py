#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "pyyaml>=6.0.2",
# ]
# ///
"""Resolve a user prompt to likely Vault context.

This is the deterministic first pass for `/context-load`: classify the query,
score active TaskNotes, and return a small JSON payload the skill can act on.

Plugin-portable: the vault root is resolved from environment variables rather
than the script's location, since this file ships inside a Claude Code plugin
(scripts/) and not inside the vault (skripte/).

Resolution order:
  1. --vault CLI argument
  2. $OBSIDIAN_VAULT_PATH
  3. $TASKNOTES_VAULT
  4. ~/GITHUB/ObsidianPKM (home-relative default)
"""

from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import yaml


def resolve_vault(cli_value: str | None = None) -> Path:
    if cli_value:
        return Path(cli_value).expanduser().resolve()
    for var in ("OBSIDIAN_VAULT_PATH", "TASKNOTES_VAULT"):
        env = os.environ.get(var)
        if env:
            return Path(env).expanduser().resolve()
    return (Path.home() / "GITHUB" / "ObsidianPKM").resolve()


FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?\r?\n)---\r?\n", re.DOTALL)
# v1: status ist die Pipeline-Achse. Aktiv = alles ausser done/cancelled/deferred.
# Legacy-Werte (open/in-progress/...) bleiben fuer nicht-migrierte Notes drin.
ACTIVE_STATUSES = {
    "audit", "question", "plan", "action", "verify", "blocked",
    "open", "in-progress", "waiting", "in-review",  # legacy
}


@dataclass
class Candidate:
    path: str
    title: str
    status: str
    project: str
    score: int
    reasons: list[str]
    next_action: str
    next_actor: str
    has_resume_state: bool


def split_frontmatter(text: str) -> tuple[dict[str, Any], str] | None:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return None
    try:
        fields = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError:
        return None
    if not isinstance(fields, dict):
        return None
    return fields, text[match.end() :]


def rel(path: Path, vault: Path) -> str:
    try:
        return path.relative_to(vault).as_posix()
    except ValueError:
        return path.as_posix()


def classify(query: str) -> dict[str, Any]:
    q = query.lower()
    if re.search(r"\b(wo|where|pfad|liegt|finde)\b", q):
        return {"type": "lookup", "confidence": 0.75, "stages": [1, 2, 4]}
    if re.search(r"\b(decision|entscheidung|entschieden|letzte)\b", q):
        return {"type": "decision-recall", "confidence": 0.75, "stages": [1, 2]}
    if re.search(r"\b(vs|vergleich|unterschied|gegenueber|gegenüber)\b", q):
        return {"type": "comparison", "confidence": 0.7, "stages": [1, 2, 3]}
    # Status/Todo/Überblick: deterministischer Task+Backlog reicht — qmd-Semantik (2/3) überspringen.
    if re.search(
        r"\b(status|stand|todos?|to-?dos?|offene|offen|überblick|ueberblick|overview|"
        r"nächste|naechste|next|was steht an|woran)\b",
        q,
    ):
        return {"type": "status", "confidence": 0.7, "stages": [1]}
    if re.search(r"\b(tasks?|projekte?|goals?|ziele?|alle)\b", q):
        return {"type": "goal-traversal", "confidence": 0.65, "stages": [1, 2, 3, 4]}
    return {"type": "explainer", "confidence": 0.3, "stages": [1, 2, 3]}


def words(query: str) -> list[str]:
    raw = re.findall(r"[a-zA-Z0-9äöüÄÖÜß_-]{3,}", query.lower())
    stop = {"und", "oder", "der", "die", "das", "eine", "einen", "mit", "fuer", "für", "bitte"}
    return [w for w in raw if w not in stop]


def project_name(path: Path, vault: Path) -> str:
    parts = rel(path, vault).split("/")
    if len(parts) >= 5 and parts[0] == "Efforts":
        return parts[3]
    return ""


def iter_task_notes(task_roots: tuple[Path, ...], vault: Path) -> list[tuple[Path, dict[str, Any], str]]:
    tasks: list[tuple[Path, dict[str, Any], str]] = []
    for root in task_roots:
        if not root.exists():
            continue
        for path in root.rglob("*.md"):
            if "/tasks/" not in path.as_posix():
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            parsed = split_frontmatter(text)
            if not parsed:
                continue
            fields, body = parsed
            if fields.get("type") != "task" and "task" not in fields.get("tags", []):
                continue
            status = str(fields.get("status") or "audit").lower()
            if status not in ACTIVE_STATUSES:
                continue
            tasks.append((path, fields, body))
    return tasks


def score_task(
    path: Path, fields: dict[str, Any], body: str, terms: list[str], query: str, vault: Path
) -> Candidate:
    title = str(fields.get("title") or path.stem)
    hay_title = title.lower()
    hay_meta = " ".join(
        str(fields.get(k) or "")
        for k in ("phaseName", "kunde", "status", "nextActor")
    ).lower()
    body_head = body[:3000].lower()
    task_id_hit = re.search(r"\b[a-z]{2,6}-\d+\b", query.lower())
    score = 0
    reasons: list[str] = []
    if task_id_hit and task_id_hit.group(0) in path.stem.lower():
        score += 10
        reasons.append("task-id")
    for term in terms:
        if term in hay_title:
            score += 3
            reasons.append(f"title:{term}")
        elif term in hay_meta:
            score += 2
            reasons.append(f"meta:{term}")
        elif term in body_head:
            score += 1
            reasons.append(f"body:{term}")
    return Candidate(
        path=rel(path, vault),
        title=title,
        status=str(fields.get("status") or "audit"),
        project=project_name(path, vault),
        score=score,
        reasons=reasons[:8],
        next_action=str(fields.get("nextAction") or ""),
        next_actor=str(fields.get("nextActor") or ""),
        has_resume_state="## Resume State" in body,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query")
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--vault", help="Vault root (overrides env/default)")
    args = parser.parse_args()

    vault = resolve_vault(args.vault)
    task_roots = (vault / "Efforts/Work", vault / "Efforts/Private")

    terms = words(args.query)
    candidates = [
        score_task(path, fields, body, terms, args.query, vault)
        for path, fields, body in iter_task_notes(task_roots, vault)
    ]
    candidates = [c for c in candidates if c.score > 0]
    candidates.sort(key=lambda c: (-c.score, c.project, c.title))

    clear_match = False
    if candidates:
        second = candidates[1].score if len(candidates) > 1 else 0
        clear_match = candidates[0].score >= 5 and candidates[0].score >= second + 3

    payload = {
        "query": args.query,
        "vault": str(vault),
        "vault_exists": vault.exists(),
        "classification": classify(args.query),
        "terms": terms,
        "clear_match": clear_match,
        "candidates": [asdict(c) for c in candidates[: args.limit]],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
