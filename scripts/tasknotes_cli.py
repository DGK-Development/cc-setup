#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "pyyaml>=6.0.2",
#   "rich>=13.7.0",
# ]
# ///
"""Small TaskNotes CLI for an ObsidianPKM vault.

The CLI treats these vault folders as project roots:

- Projects          -> work
- Projects Privat   -> private

Project metadata lives in `<project>/<project name> Übersicht.md`.
Task files live in `<project>/tasks/*.md`.
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import sqlite3
import textwrap
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Iterable

import yaml
from rich.console import Console
from rich.table import Table

console = Console()

WORK_DIR_NAME = "Projects"
PRIVATE_DIR_NAME = "Projects Privat"
ACE_WORK_DIR = "Efforts/Work"
ACE_PRIVATE_DIR = "Efforts/Private"
TASKS_DIR_NAME = "tasks"
# Task-tagged notes also live outside tasks/ — calendar events under <project>/Kalender/.
# These carry tags:[task] + scheduled/due and must be discovered so downstream consumers
# (statusline AGENDA, cockpit) see appointments, not only tasks/ entries.
TASK_SUBDIR_NAMES = ("tasks", "Kalender")
OVERVIEW_NAMES = ("Übersicht.md", "Uebersicht.md", "overview.md", "CLAUDE.md")
OVERVIEW_SUFFIX = "Übersicht.md"
DEFAULT_DB_PATH = Path(
    "/Users/niclasedge/Library/Application Support/com.niclasedge.taskmd.dev/taskmd-cloud.db"
)

DONE_STATUSES = {"done", "completed", "cancelled", "archived", "archiviert"}
BLOCKED_STATUSES = {"blocked", "waiting"}
PRIORITY_SCORE = {
    "urgent": 50,
    "critical": 50,
    "high": 40,
    "normal": 25,
    "medium": 25,
    "low": 10,
    "none": 0,
    None: 0,
}

STATUS_ALIASES = {
    "pending": "open",
    "completed": "done",
    "archiviert": "archived",
}


@dataclass(frozen=True)
class Project:
    area: str
    root: Path
    folder: Path
    meta_path: Path | None
    meta: dict[str, Any]

    @property
    def name(self) -> str:
        return str(self.meta.get("title") or self.folder.name)

    @property
    def project_id(self) -> str:
        return str(self.meta.get("project_id") or infer_project_id(self))

    @property
    def prefix(self) -> str:
        value = self.meta.get("prefix")
        if value:
            return str(value)
        return infer_prefix(self)

    @property
    def tasks_dir(self) -> Path:
        return self.folder / TASKS_DIR_NAME

    @property
    def rel(self) -> str:
        return rel_to_vault(self.folder)

    @property
    def note_link(self) -> str:
        preferred = preferred_overview_path(self.folder)
        if preferred.exists():
            return f"[[{rel_to_vault(preferred.with_suffix(''))}]]"
        if (
            self.meta_path
            and self.meta_path.exists()
            and self.meta_path.name != "CLAUDE.md"
        ):
            return f"[[{rel_to_vault(self.meta_path.with_suffix(''))}]]"
        claude = self.folder / "CLAUDE.md"
        if claude.exists():
            return f"[[{rel_to_vault(claude.with_suffix(''))}]]"
        return f"[[{self.rel}]]"


@dataclass(frozen=True)
class Task:
    path: Path
    project: Project
    fm: dict[str, Any]
    body: str

    @property
    def task_id(self) -> str:
        return str(self.fm.get("taskmd_id") or self.path.stem)

    @property
    def title(self) -> str:
        return str(self.fm.get("title") or self.path.stem)

    @property
    def status(self) -> str:
        return str(self.fm.get("status") or "open")

    @property
    def priority(self) -> str:
        return str(self.fm.get("priority") or "none")

    @property
    def phase(self) -> str:
        return str(self.fm.get("phaseName") or self.fm.get("phase") or "")


@dataclass(frozen=True)
class Question:
    path: Path
    fm: dict[str, Any]
    body: str

    @property
    def title(self) -> str:
        return str(self.fm.get("title") or self.path.stem)

    @property
    def status(self) -> str:
        return str(self.fm.get("status") or "open")

    @property
    def priority(self) -> str:
        return str(self.fm.get("priority") or "normal")

    @property
    def parent_link(self) -> str | None:
        raw = self.fm.get("parent")
        return parse_wikilink_target(raw) if raw else None

    @property
    def asked_by(self) -> str:
        return str(self.fm.get("asked_by") or "claude")

    @property
    def asked_at(self) -> str | None:
        v = self.fm.get("asked_at")
        return str(v) if v else None


def parse_wikilink_target(value: Any) -> str | None:
    """Aus '[[Foo|Bar]]' -> 'Foo'. Akzeptiert auch nackten String oder Liste."""
    if value is None:
        return None
    if isinstance(value, list):
        value = value[0] if value else None
        if value is None:
            return None
    s = str(value).strip()
    m = re.search(r"\[\[([^\]\|#]+)", s)
    if m:
        return m.group(1).strip()
    return s or None


def main() -> int:
    parser = argparse.ArgumentParser(prog="tn", description="TaskNotes CLI")
    parser.add_argument("--vault", type=Path, default=default_vault())
    parser.add_argument("--area", choices=["all", "work", "private"], default="all")
    parser.add_argument("--project", "-p")
    sub = parser.add_subparsers(dest="command", required=True)

    p_projects = sub.add_parser("projects", help="List projects")
    p_projects.add_argument("--format", choices=["text", "json"], default="text")

    p_list = sub.add_parser("list", help="List tasks")
    p_list.add_argument("--status")
    p_list.add_argument("--phase")
    p_list.add_argument("--kunde")
    p_list.add_argument("--q")
    p_list.add_argument("--limit", type=int, default=80)
    p_list.add_argument("--format", choices=["text", "json"], default="text")

    p_next = sub.add_parser("next", help="Show next tasks")
    p_next.add_argument("--limit", type=int, default=10)
    p_next.add_argument("--include-blocked", action="store_true")
    p_next.add_argument("--format", choices=["text", "json"], default="text")

    p_info = sub.add_parser("info", help="Show project overview")
    p_info.add_argument("--limit", type=int, default=5)
    p_info.add_argument("--include-blocked", action="store_true")
    p_info.add_argument(
        "--all",
        action="store_true",
        help="Show all projects even when cwd matches a single project",
    )
    p_info.add_argument("--format", choices=["text", "json"], default="text")

    p_phase = sub.add_parser("phases", help="List phases")

    p_show = sub.add_parser("show", help="Show a task")
    p_show.add_argument("task")
    p_show.add_argument("--format", choices=["text", "json"], default="text")

    p_add = sub.add_parser("add", help="Create a task")
    p_add.add_argument("title")
    p_add.add_argument("--phase")
    p_add.add_argument("--status", default="pending")
    p_add.add_argument("--priority", default="normal")
    p_add.add_argument("--kunde")
    p_add.add_argument("--tag", action="append", default=[])
    p_add.add_argument("--body", default="")
    p_add.add_argument("--due")
    p_add.add_argument("--scheduled")

    p_set = sub.add_parser("set", help="Update task metadata")
    p_set.add_argument("task")
    p_set.add_argument("--status")
    p_set.add_argument("--priority")
    p_set.add_argument("--phase")
    p_set.add_argument("--due")
    p_set.add_argument("--scheduled")
    p_set.add_argument("--dry-run", action="store_true")
    p_set.add_argument("--format", choices=["text", "json"], default="json")

    p_complete = sub.add_parser("complete", help="Complete a task")
    p_complete.add_argument("task")
    p_complete.add_argument("--note", default="")
    p_complete.add_argument("--dry-run", action="store_true")
    p_complete.add_argument("--format", choices=["text", "json"], default="json")

    p_append = sub.add_parser("append-changelog", help="Append a task changelog entry")
    p_append.add_argument("task")
    p_append.add_argument("--entry", required=True)
    p_append.add_argument("--dry-run", action="store_true")
    p_append.add_argument("--format", choices=["text", "json"], default="json")

    p_questions = sub.add_parser(
        "questions",
        help="List type:question notes (parent-based filtering)",
    )
    p_questions.add_argument(
        "--status", help="Filter by status (open/answered/done/...)"
    )
    p_questions.add_argument(
        "--parent",
        help="Filter by parent — task-id, stem, or wikilink target (e.g. wiki-format_v6)",
    )
    p_questions.add_argument(
        "--task",
        help="Shortcut for --parent <task>; finds questions for a specific task",
    )
    p_questions.add_argument("--limit", type=int, default=80)
    p_questions.add_argument("--format", choices=["text", "json"], default="text")

    p_meta = sub.add_parser("meta", help="Project metadata")
    meta_sub = p_meta.add_subparsers(dest="meta_command", required=True)
    meta_sub.add_parser("list", help="List project metadata")
    p_meta_init = meta_sub.add_parser(
        "init", help="Create/update project Uebersicht.md"
    )
    p_meta_init.add_argument("--working-dir")
    p_meta_init.add_argument("--repo-url")
    p_meta_init.add_argument("--project-id")
    p_meta_init.add_argument("--prefix")
    p_meta_init.add_argument("--group-name")
    p_meta_init.add_argument("--kunde")
    p_meta_init.add_argument("--due")
    p_meta_import = meta_sub.add_parser(
        "import-db", help="Import project metadata from taskmd DB"
    )
    p_meta_import.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    p_meta_import.add_argument("--dry-run", action="store_true")
    p_meta_import.add_argument("--overwrite", action="store_true")

    args = parser.parse_args()
    global VAULT_ROOT
    VAULT_ROOT = args.vault.resolve()

    projects = discover_projects(VAULT_ROOT)
    selected_projects = select_projects(projects, args.area, args.project, args.command)

    if args.command == "projects":
        cmd_projects(selected_projects, args)
    elif args.command == "list":
        tasks = load_tasks(selected_projects)
        cmd_list(tasks, args)
    elif args.command == "next":
        tasks = load_tasks(selected_projects)
        cmd_next(tasks, args)
    elif args.command == "info":
        if args.all:
            selected_projects = filter_projects(
                projects, args.area, args.project, allow_many=True
            )
        tasks = load_tasks(selected_projects)
        cmd_info(selected_projects, tasks, args)
    elif args.command == "phases":
        tasks = load_tasks(selected_projects)
        cmd_phases(tasks)
    elif args.command == "show":
        tasks = load_tasks(selected_projects)
        cmd_show(tasks, args)
    elif args.command == "add":
        project = one_project(projects, args.area, args.project)
        cmd_add(project, args)
    elif args.command == "set":
        tasks = load_tasks(selected_projects)
        cmd_set(tasks, args)
    elif args.command == "complete":
        tasks = load_tasks(selected_projects)
        cmd_complete(tasks, args)
    elif args.command == "append-changelog":
        tasks = load_tasks(selected_projects)
        cmd_append_changelog(tasks, args)
    elif args.command == "questions":
        questions = discover_questions(VAULT_ROOT)
        cmd_questions(questions, args)
    elif args.command == "meta":
        if args.meta_command == "list":
            cmd_meta_list(selected_projects)
        elif args.meta_command == "init":
            project = one_project(projects, args.area, args.project)
            cmd_meta_init(project, args)
        elif args.meta_command == "import-db":
            cmd_meta_import_db(selected_projects, args)
    return 0


def default_vault() -> Path:
    # Plugin-portable resolution: explicit env wins, then the legacy in-vault
    # layout (script under <vault>/skripte/), then a home-relative default.
    for var in ("TASKNOTES_VAULT", "OBSIDIAN_VAULT_PATH"):
        env = os.environ.get(var)
        if env:
            return Path(env).expanduser()
    script = Path(__file__).resolve()
    if script.parent.name == "skripte":
        return script.parent.parent
    return Path.home() / "GITHUB" / "ObsidianPKM"


VAULT_ROOT = default_vault().resolve()


def discover_projects(vault: Path) -> list[Project]:
    """Scan ACE Efforts folders for projects.

    Falls back to legacy `Projects/` and `Projects Privat/` only if ACE
    folders are missing — this lets the CLI keep working in vaults that
    are pre-Phase-4. After ACE migration, only Efforts/ is scanned.
    """
    projects: list[Project] = []
    seen_folders: set[Path] = set()

    ace_roots = [
        ("work", vault / ACE_WORK_DIR, 2),
        ("private", vault / ACE_PRIVATE_DIR, 2),
    ]
    legacy_roots = [
        ("work", vault / WORK_DIR_NAME, 1),
        ("private", vault / PRIVATE_DIR_NAME, 1),
    ]

    have_ace = any(root.is_dir() and any(root.iterdir()) for _, root, _ in ace_roots)
    roots = ace_roots if have_ace else legacy_roots
    if have_ace:
        # Add legacy roots only if they still exist with content (mid-migration vaults).
        for area, root, depth in legacy_roots:
            if root.is_dir() and any(p for p in root.iterdir() if p.is_dir()):
                roots.append((area, root, depth))

    for area, root, depth in roots:
        if not root.is_dir():
            continue
        for folder in _iter_project_folders(root, depth):
            if folder.name.startswith("."):
                continue
            resolved = folder.resolve()
            if resolved in seen_folders:
                continue
            meta_path, meta = read_project_meta(folder)
            if (
                not (folder / TASKS_DIR_NAME).is_dir()
                and not meta
                and not (folder / "CLAUDE.md").exists()
            ):
                continue
            seen_folders.add(resolved)
            projects.append(
                Project(
                    area=area, root=root, folder=folder, meta_path=meta_path, meta=meta
                )
            )
    return projects


def _iter_project_folders(root: Path, depth: int) -> Iterable[Path]:
    """Yield project folders at the configured depth.

    depth=1 -> root/<project> (legacy Projects/, Projects Privat/)
    depth=2 -> root/<bucket>/<project> (ACE Efforts/Work/<kunde>/<project>,
              Efforts/Private/<domain>/<project>)
    """
    if depth <= 1:
        yield from sorted(p for p in root.iterdir() if p.is_dir())
        return
    for bucket in sorted(p for p in root.iterdir() if p.is_dir()):
        if bucket.name.startswith(".") or bucket.name.startswith("_"):
            continue
        yield from sorted(p for p in bucket.iterdir() if p.is_dir())


def read_project_meta(folder: Path) -> tuple[Path | None, dict[str, Any]]:
    preferred = preferred_overview_path(folder)
    if preferred.exists():
        fm, _ = read_markdown(preferred)
        return preferred, fm
    for name in OVERVIEW_NAMES:
        path = folder / name
        if path.exists():
            fm, _ = read_markdown(path)
            return path, fm
    return None, {}


def filter_projects(
    projects: list[Project], area: str, query: str | None, *, allow_many: bool
) -> list[Project]:
    filtered = [p for p in projects if area == "all" or p.area == area]
    if query:
        matches = [p for p in filtered if project_matches(p, query)]
        if not matches:
            raise SystemExit(f"project not found: {query}")
        if not allow_many and len(matches) > 1:
            names = ", ".join(p.name for p in matches)
            raise SystemExit(f"project is ambiguous: {query} ({names})")
        return matches
    return filtered


def select_projects(
    projects: list[Project], area: str, query: str | None, command: str
) -> list[Project]:
    selected = filter_projects(projects, area, query, allow_many=True)
    if query:
        return selected
    if command in {
        "list",
        "next",
        "info",
        "phases",
        "show",
        "set",
        "complete",
        "append-changelog",
    }:
        current = current_project(selected)
        if current:
            return [current]
    return selected


def one_project(projects: list[Project], area: str, query: str | None) -> Project:
    if query:
        return filter_projects(projects, area, query, allow_many=False)[0]
    filtered = filter_projects(projects, area, None, allow_many=True)
    project = current_project(filtered)
    if project:
        return project
    raise SystemExit("pass --project or run from inside a project folder")


def current_project(projects: list[Project]) -> Project | None:
    cwd = normalize_path(Path.cwd())
    matches: list[tuple[Project, Path]] = []
    for project in projects:
        for root in project_paths(project):
            if path_contains(root, cwd):
                matches.append((project, root))
    if not matches:
        return None
    matches.sort(key=lambda item: len(str(item[1])), reverse=True)
    best_len = len(str(matches[0][1]))
    best = [item for item in matches if len(str(item[1])) == best_len]
    project_ids = {project.project_id for project, _ in best}
    if len(project_ids) > 1:
        names = ", ".join(sorted(project.name for project, _ in best))
        raise SystemExit(f"cwd matches multiple projects: {names}")
    return matches[0][0]


def project_matches(project: Project, query: str) -> bool:
    q = query.casefold()
    path = Path(query).expanduser()
    candidates = {
        project.name.casefold(),
        project.folder.name.casefold(),
        project.project_id.casefold(),
        project.prefix.casefold(),
        project.rel.casefold(),
        str(project.folder).casefold(),
    }
    if q in candidates:
        return True
    if path.is_absolute():
        resolved = normalize_path(path)
        return any(path_contains(root, resolved) for root in project_paths(project))
    return False


_FOREIGN_HOME_RE = re.compile(r"^/(?:Users|home)/[^/]+(/.*)?$")


def _platform_normalize_home(raw: str) -> str:
    # /Users/<x>/... (mac) or /home/<x>/... (linux) -> ~/... so expanduser()
    # resolves to the current OS's actual home (Windows: C:\Users\<USER>\...).
    match = _FOREIGN_HOME_RE.match(raw)
    if not match:
        return raw
    rest = match.group(1) or ""
    return f"~{rest}"


def _resolve_working_dir(value: str) -> Path:
    return normalize_path(Path(_platform_normalize_home(value)).expanduser())


def project_paths(project: Project) -> list[Path]:
    values: list[Path] = [normalize_path(project.folder)]
    working_dir = project.meta.get("working_dir")
    if isinstance(working_dir, str):
        values.append(_resolve_working_dir(working_dir))
    elif isinstance(working_dir, list):
        for item in working_dir:
            if item:
                values.append(_resolve_working_dir(str(item)))
    unique_paths: list[Path] = []
    seen: set[str] = set()
    for value in values:
        key = str(value)
        if key not in seen:
            seen.add(key)
            unique_paths.append(value)
    return unique_paths


def normalize_path(path: Path) -> Path:
    return path.expanduser().resolve(strict=False)


def path_contains(root: Path, path: Path) -> bool:
    return path == root or path.is_relative_to(root)


def load_tasks(projects: list[Project]) -> list[Task]:
    out: list[Task] = []
    seen: set[Path] = set()
    for project in projects:
        for sub in TASK_SUBDIR_NAMES:
            sub_dir = project.folder / sub
            if not sub_dir.is_dir():
                continue
            for path in sorted(sub_dir.glob("*.md")):
                if path in seen:
                    continue
                fm, body = read_markdown(path)
                if not is_tasknote(fm):
                    continue
                seen.add(path)
                out.append(Task(path=path, project=project, fm=fm, body=body))
    return out


def read_markdown(path: Path) -> tuple[dict[str, Any], str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return {}, text
    parts = text.split("---\n", 2)
    if len(parts) < 3:
        return {}, text
    try:
        raw = yaml.safe_load(parts[1]) or {}
    except yaml.YAMLError:
        raw = {}
    if not isinstance(raw, dict):
        raw = {}
    return raw, parts[2]


def write_markdown(path: Path, fm: dict[str, Any], body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    dumped = yaml.safe_dump(
        fm, sort_keys=False, allow_unicode=True, default_flow_style=False
    ).strip()
    path.write_text(f"---\n{dumped}\n---\n{body}", encoding="utf-8")


def is_tasknote(fm: dict[str, Any]) -> bool:
    tags = fm.get("tags") or []
    if isinstance(tags, str):
        tags = [tags]
    return "task" in [str(t) for t in tags]


def cmd_projects(projects: list[Project], args: argparse.Namespace) -> None:
    if getattr(args, "format", "text") == "json":
        print_json(
            {
                "count": len(projects),
                "projects": [
                    {
                        "area": p.area,
                        "name": p.name,
                        "id": p.project_id,
                        "prefix": p.prefix,
                        "tasks": len(load_tasks([p])),
                        "kunde": p.meta.get("kunde") or None,
                        "repo": repo_url(p),
                        "working_dir": json_ready(p.meta.get("working_dir")),
                        "path": p.rel,
                        "note_link": p.note_link,
                    }
                    for p in projects
                ],
            }
        )
        return
    table = Table(title="Projects")
    for col in (
        "Area",
        "Name",
        "ID",
        "Prefix",
        "Tasks",
        "Kunde",
        "Repo",
        "Working Dir",
    ):
        table.add_column(col)
    for p in projects:
        task_count = len(load_tasks([p]))
        table.add_row(
            p.area,
            p.name,
            p.project_id,
            p.prefix,
            str(task_count),
            str(p.meta.get("kunde") or ""),
            str(repo_url(p) or ""),
            str(p.meta.get("working_dir") or ""),
        )
    console.print(table)


def cmd_list(tasks: list[Task], args: argparse.Namespace) -> None:
    rows = filter_tasks(tasks, args)
    rows = rows[: args.limit]
    if args.format == "json":
        print_json(
            {
                "count": len(rows),
                "tasks": [task_to_json(task, include_body=False) for task in rows],
            }
        )
        return
    table = Table(title=f"Tasks ({len(rows)})")
    for col in ("ID", "Project", "Status", "Prio", "Phase", "Due", "Title"):
        table.add_column(col)
    for task in rows:
        table.add_row(
            task.task_id,
            task.project.folder.name,
            task.status,
            task.priority,
            task.phase,
            str(task.fm.get("due") or task.fm.get("scheduled") or ""),
            ellipsize(task.title, 72),
        )
    console.print(table)


def filter_tasks(tasks: list[Task], args: argparse.Namespace) -> list[Task]:
    rows = tasks
    if getattr(args, "status", None):
        rows = [t for t in rows if t.status == args.status]
    if getattr(args, "phase", None):
        rows = [t for t in rows if t.phase == args.phase]
    if getattr(args, "kunde", None):
        rows = [t for t in rows if str(t.fm.get("kunde") or "") == args.kunde]
    if getattr(args, "q", None):
        q = args.q.casefold()
        rows = [t for t in rows if q in t.title.casefold() or q in t.body.casefold()]
    return rows


def cmd_next(tasks: list[Task], args: argparse.Namespace) -> None:
    ranked = rank_next_tasks(tasks, args.limit, args.include_blocked)
    if args.format == "json":
        print_json(
            {
                "count": len(ranked),
                "tasks": [task_to_json(task, include_body=False) for task in ranked],
            }
        )
        return
    print_ranked_tasks("Next Tasks", ranked)


def cmd_info(
    projects: list[Project], tasks: list[Task], args: argparse.Namespace
) -> None:
    if getattr(args, "format", "text") == "json":
        cwd = normalize_path(Path.cwd())
        matched: Project | None = None
        best_len = -1
        for project in projects:
            for root in project_paths(project):
                if path_contains(root, cwd) and len(str(root)) > best_len:
                    matched = project
                    best_len = len(str(root))
        proj_rows = []
        for project in projects:
            ptasks = [
                t for t in tasks if t.project.project_id == project.project_id
            ]
            proj_rows.append(
                {
                    "id": project.project_id,
                    "name": project.name,
                    "area": project.area,
                    "tasks": len(ptasks),
                    "open": len(
                        [t for t in ptasks if not is_done(t) and not is_waiting(t)]
                    ),
                    "in_progress": len([t for t in ptasks if is_active(t)]),
                    "waiting": len([t for t in ptasks if is_waiting(t)]),
                    "done": len([t for t in ptasks if is_done(t)]),
                }
            )
        active_tasks = sorted(
            (t for t in tasks if is_active(t)), key=task_score, reverse=True
        )[: args.limit]
        waiting_tasks = sorted(
            (t for t in tasks if is_waiting(t)), key=task_score, reverse=True
        )[: args.limit]
        next_tasks = rank_next_tasks(tasks, args.limit, args.include_blocked)
        print_json(
            {
                "cwd": str(cwd),
                "cwd_match": matched is not None,
                "matched_project": (
                    {
                        "id": matched.project_id,
                        "name": matched.name,
                        "area": matched.area,
                    }
                    if matched
                    else None
                ),
                "projects": proj_rows,
                "active": [task_to_json(t, include_body=False) for t in active_tasks],
                "waiting": [
                    task_to_json(t, include_body=False) for t in waiting_tasks
                ],
                "next": [task_to_json(t, include_body=False) for t in next_tasks],
            }
        )
        return
    if len(projects) == 1:
        project = projects[0]
        cwd = normalize_path(Path.cwd())
        matched_root: Path | None = None
        for root in project_paths(project):
            if path_contains(root, cwd):
                matched_root = root
                break
        console.print(
            f"[bold]{project.name}[/bold] "
            f"([dim]{project.project_id}[/dim], area={project.area})"
        )
        console.print(f"  vault : {project.folder}")
        if matched_root:
            console.print(f"  cwd   : {matched_root} [green]matched[/green]")
        else:
            console.print(
                "  cwd   : [yellow]no match — passed via --project or area filter[/yellow]"
            )
    table = Table(title="Info")
    for col in ("Project", "ID", "Tasks", "Open", "In Arbeit", "Waiting", "Done"):
        table.add_column(col)
    for project in projects:
        project_tasks = [t for t in tasks if t.project.project_id == project.project_id]
        done = [t for t in project_tasks if is_done(t)]
        active = [t for t in project_tasks if is_active(t)]
        waiting = [t for t in project_tasks if is_waiting(t)]
        open_tasks = [t for t in project_tasks if not is_done(t) and not is_waiting(t)]
        table.add_row(
            project.name,
            project.project_id,
            str(len(project_tasks)),
            str(len(open_tasks)),
            str(len(active)),
            str(len(waiting)),
            str(len(done)),
        )
    console.print(table)

    active_tasks = sorted(
        (t for t in tasks if is_active(t)), key=task_score, reverse=True
    )[: args.limit]
    waiting_tasks = sorted(
        (t for t in tasks if is_waiting(t)), key=task_score, reverse=True
    )[: args.limit]
    next_tasks = rank_next_tasks(tasks, args.limit, args.include_blocked)
    print_task_rows("In Arbeit", active_tasks)
    print_task_rows("Waiting", waiting_tasks)
    print_ranked_tasks("Next Tasks", next_tasks)


def rank_next_tasks(tasks: list[Task], limit: int, include_blocked: bool) -> list[Task]:
    candidates = [
        t for t in tasks if not is_done(t) and (include_blocked or not is_waiting(t))
    ]
    return sorted(candidates, key=task_score, reverse=True)[:limit]


def print_ranked_tasks(title: str, tasks: list[Task]) -> None:
    table = Table(title=title)
    for col in ("Score", "ID", "Project", "Status", "Prio", "Phase", "Title"):
        table.add_column(col)
    for task in tasks:
        table.add_row(
            str(task_score(task)),
            task.task_id,
            task.project.folder.name,
            task.status,
            task.priority,
            task.phase,
            ellipsize(task.title, 78),
        )
    console.print(table)


def print_task_rows(title: str, tasks: list[Task]) -> None:
    table = Table(title=title)
    for col in ("ID", "Project", "Status", "Prio", "Phase", "Title"):
        table.add_column(col)
    for task in tasks:
        table.add_row(
            task.task_id,
            task.project.folder.name,
            task.status,
            task.priority,
            task.phase,
            ellipsize(task.title, 78),
        )
    console.print(table)


def is_done(task: Task) -> bool:
    return task.status in DONE_STATUSES


def is_active(task: Task) -> bool:
    return task.status in {"in-progress", "in-review"}


def is_waiting(task: Task) -> bool:
    return task.status in BLOCKED_STATUSES or bool(task.fm.get("blockedBy"))


def task_score(task: Task) -> int:
    score = 0
    if task.status == "in-progress":
        score += 60
    elif task.status == "in-review":
        score += 45
    elif task.status in {"pending", "open"}:
        score += 30
    score += PRIORITY_SCORE.get(task.priority, 0)
    due = parse_date(task.fm.get("due") or task.fm.get("scheduled"))
    if due:
        delta = (due - date.today()).days
        if delta < 0:
            score += 50
        elif delta <= 2:
            score += 35
        elif delta <= 7:
            score += 20
    if task.fm.get("blockedBy"):
        score -= 100
    return score


def cmd_phases(tasks: list[Task]) -> None:
    phases: dict[tuple[str, str], dict[str, int]] = {}
    for task in tasks:
        key = (
            task.project.folder.name,
            task.phase or "(none)",
        )
        bucket = phases.setdefault(key, {"total": 0, "open": 0, "done": 0})
        bucket["total"] += 1
        if task.status in DONE_STATUSES:
            bucket["done"] += 1
        else:
            bucket["open"] += 1
    table = Table(title="Phases")
    for col in ("Project", "Phase", "Open", "Done", "Total"):
        table.add_column(col)
    for (project, phase), counts in sorted(phases.items()):
        table.add_row(
            project,
            phase,
            str(counts["open"]),
            str(counts["done"]),
            str(counts["total"]),
        )
    console.print(table)


def cmd_show(tasks: list[Task], args: argparse.Namespace) -> None:
    task = find_task(tasks, args.task)
    if args.format == "json":
        data = {"task": task_to_json(task, include_body=True)}
        try:
            qs = discover_questions(VAULT_ROOT)
            related = filter_questions_for(qs, task.path.stem, task.task_id)
            data["questions"] = [
                {
                    "path": str(q.path.relative_to(VAULT_ROOT)),
                    "title": q.title,
                    "status": q.status,
                    "priority": q.priority,
                    "asked_by": q.asked_by,
                }
                for q in related
            ]
        except Exception:
            pass
        print_json(data)
        return
    console.rule(f"{task.task_id} · {task.title}")
    console.print(f"[bold]Project:[/] {task.project.name}")
    console.print(
        f"[bold]Status:[/] {task.status}   [bold]Priority:[/] {task.priority}"
    )
    console.print(f"[bold]Phase:[/] {task.phase or '-'}")
    console.print(f"[bold]Path:[/] {task.path}")
    if task.fm.get("blockedBy"):
        console.print(f"[bold]Blocked by:[/] {task.fm['blockedBy']}")
    console.print(task.body.strip() or "[dim]No body[/]")

    try:
        qs = discover_questions(VAULT_ROOT)
        related = filter_questions_for(qs, task.path.stem, task.task_id)
        if related:
            console.rule("Open Questions")
            for q in related:
                rel = (
                    q.path.relative_to(VAULT_ROOT)
                    if VAULT_ROOT in q.path.parents
                    else q.path
                )
                console.print(
                    f"  [{q.status}] [{q.priority}] [bold]{q.title}[/]  [dim]({rel})[/]"
                )
    except Exception as exc:
        console.print(f"[dim](could not load questions: {exc})[/]")


def discover_questions(vault: Path) -> list[Question]:
    """Find all type:question notes in the vault.

    Locations scanned:
      - <project>/questions/*.md  (Template-Default)
      - Efforts/_inbox/questions/*.md  (Fallback)
      - Any other *.md with `type: question` in frontmatter (best-effort)
    """
    seen: set[Path] = set()
    out: list[Question] = []

    # Primary: questions/ subfolders under Efforts/
    efforts = vault / "Efforts"
    if efforts.is_dir():
        for q_dir in efforts.rglob("questions"):
            if not q_dir.is_dir():
                continue
            for md in q_dir.glob("*.md"):
                if md in seen:
                    continue
                fm, body = read_markdown(md)
                if fm.get("type") == "question":
                    seen.add(md)
                    out.append(Question(path=md, fm=fm, body=body))

    return out


def filter_questions_for(
    questions: list[Question], task_stem: str, task_id: str | None = None
) -> list[Question]:
    """Filter questions whose parent points at the given task."""
    candidates = {task_stem.lower()}
    if task_id:
        candidates.add(task_id.lower())
    out = []
    for q in questions:
        target = q.parent_link
        if not target:
            continue
        # parent: "[[<path>|<alias>]]" → target = "<path>" — extract last component
        tail = target.rsplit("/", 1)[-1].lower()
        if tail in candidates or target.lower() in candidates:
            out.append(q)
    # Sort: open first, then by priority, then by ctime
    prio_order = {"urgent": 0, "high": 1, "normal": 2, "low": 3, "none": 4}
    out.sort(
        key=lambda q: (
            0 if q.status == "open" else 1 if q.status == "answered" else 2,
            prio_order.get(q.priority, 5),
            q.path.stat().st_ctime,
        )
    )
    return out


def cmd_questions(questions: list[Question], args: argparse.Namespace) -> None:
    """List questions, filtered by status and/or parent."""
    parent_filter = args.parent or args.task
    items = list(questions)

    if args.status:
        items = [q for q in items if q.status == args.status]

    if parent_filter:
        pf = parent_filter.lower().rsplit("/", 1)[-1]
        items = [
            q
            for q in items
            if q.parent_link
            and (
                pf == q.parent_link.lower()
                or pf == q.parent_link.lower().rsplit("/", 1)[-1]
            )
        ]

    # Sort: status open → answered → others, then priority, then ctime
    prio_order = {"urgent": 0, "high": 1, "normal": 2, "low": 3, "none": 4}
    status_order = {
        "open": 0,
        "answered": 1,
        "in-progress": 2,
        "blocked": 3,
        "done": 4,
        "obsolete": 5,
    }
    items.sort(
        key=lambda q: (
            status_order.get(q.status, 9),
            prio_order.get(q.priority, 5),
            q.path.stat().st_ctime,
        )
    )

    items = items[: args.limit]

    if args.format == "json":
        print_json(
            [
                {
                    "path": str(q.path.relative_to(VAULT_ROOT))
                    if VAULT_ROOT in q.path.parents
                    else str(q.path),
                    "title": q.title,
                    "status": q.status,
                    "priority": q.priority,
                    "parent": q.parent_link,
                    "asked_by": q.asked_by,
                    "asked_at": q.asked_at,
                }
                for q in items
            ]
        )
        return

    if not items:
        console.print("[dim]No questions found.[/]")
        return

    table = Table(title=f"Questions ({len(items)})")
    table.add_column("Status", style="cyan")
    table.add_column("Prio")
    table.add_column("Parent", style="dim")
    table.add_column("Title")
    table.add_column("Path", style="dim")
    for q in items:
        try:
            rel = str(q.path.relative_to(VAULT_ROOT))
        except (ValueError, AttributeError):
            rel = str(q.path)
        table.add_row(
            q.status,
            q.priority,
            (q.parent_link or "")[:40],
            q.title[:60],
            rel,
        )
    console.print(table)


def cmd_set(tasks: list[Task], args: argparse.Namespace) -> None:
    task = find_task(tasks, args.task)
    fm = dict(task.fm)
    body = task.body
    for key in ("status", "priority", "phase", "due", "scheduled"):
        value = getattr(args, key)
        if value is not None:
            if key == "phase":
                fm["phaseName"] = value
                fm.pop("phase", None)
            else:
                fm[key] = value
    result = write_task_change(task, fm, body, dry_run=args.dry_run, tool="tn set")
    output_write_result(result, args.format)


def cmd_complete(tasks: list[Task], args: argparse.Namespace) -> None:
    task = find_task(tasks, args.task)
    fm = dict(task.fm)
    fm["status"] = "done"
    fm["completed"] = date.today().isoformat()
    body = append_completion_note(task.body, args.note)
    result = write_task_change(task, fm, body, dry_run=args.dry_run, tool="tn complete")
    output_write_result(result, args.format)


def cmd_append_changelog(tasks: list[Task], args: argparse.Namespace) -> None:
    task = find_task(tasks, args.task)
    body = append_changelog_entry(task.body, args.entry)
    result = write_task_change(
        task, dict(task.fm), body, dry_run=args.dry_run, tool="tn append-changelog"
    )
    output_write_result(result, args.format)


def find_task(tasks: list[Task], query: str) -> Task:
    matches = [t for t in tasks if t.task_id == query or t.path.stem == query]
    if not matches:
        q = query.casefold()
        matches = [t for t in tasks if q in t.title.casefold()]
    if not matches:
        raise SystemExit(f"task not found: {query}")
    if len(matches) > 1:
        exact = [t for t in matches if t.task_id == query or t.path.stem == query]
        if exact:
            return exact[0]
    return matches[0]


def task_to_json(task: Task, *, include_body: bool) -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": task.task_id,
        "title": task.title,
        "status": task.status,
        "priority": task.priority,
        "phase": task.phase,
        "due": json_ready(task.fm.get("due")),
        "scheduled": json_ready(task.fm.get("scheduled")),
        "blockedBy": json_ready(task.fm.get("blockedBy")),
        "path": rel_to_vault(task.path),
        "project": {
            "id": task.project.project_id,
            "name": task.project.name,
            "area": task.project.area,
            "path": task.project.rel,
        },
        "metadata": json_ready(task.fm),
    }
    if include_body:
        item["body"] = task.body
    return item


def print_json(data: Any) -> None:
    print(json.dumps(json_ready(data), ensure_ascii=False, indent=2))


def json_ready(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): json_ready(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_ready(v) for v in value]
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Path):
        return rel_to_vault(value)
    return value


def render_markdown(fm: dict[str, Any], body: str) -> str:
    dumped = yaml.safe_dump(
        fm, sort_keys=False, allow_unicode=True, default_flow_style=False
    ).strip()
    return f"---\n{dumped}\n---\n{body}"


def write_task_change(
    task: Task, fm: dict[str, Any], body: str, *, dry_run: bool, tool: str
) -> dict[str, Any]:
    fm = dict(fm)
    before = render_markdown(task.fm, task.body)
    after = render_markdown(fm, body)
    if before != after:
        fm["dateModified"] = (
            datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        )
        after = render_markdown(fm, body)
    changed = before != after
    diff = "".join(
        difflib.unified_diff(
            before.splitlines(keepends=True),
            after.splitlines(keepends=True),
            fromfile=f"{rel_to_vault(task.path)}:before",
            tofile=f"{rel_to_vault(task.path)}:after",
        )
    )
    if changed and not dry_run:
        write_markdown(task.path, fm, body)
    return {
        "tool": tool,
        "dryRun": dry_run,
        "changed": changed,
        "changedPaths": [rel_to_vault(task.path)] if changed else [],
        "task": task_to_json(
            Task(task.path, task.project, fm, body), include_body=False
        ),
        "diff": diff,
    }


def output_write_result(result: dict[str, Any], output_format: str) -> None:
    if output_format == "json":
        print_json(result)
        return
    status = "dry-run" if result["dryRun"] else "written"
    changed = "changed" if result["changed"] else "unchanged"
    console.print(f"{status}\t{changed}\t{', '.join(result['changedPaths'])}")
    if result.get("diff"):
        console.print(result["diff"])


def append_completion_note(body: str, note: str) -> str:
    note = note.strip()
    if not note:
        return body
    if note in body:
        return body
    body = body.rstrip() + "\n\n"
    if "## Completion Notes" not in body:
        body += "## Completion Notes\n\n"
    body += f"- {date.today().isoformat()}: {note}\n"
    return body


def append_changelog_entry(body: str, entry: str) -> str:
    entry = entry.strip()
    if not entry:
        raise SystemExit("--entry must not be empty")
    if entry in body:
        return body
    body = body.rstrip() + "\n\n"
    if "## Changelog" not in body:
        body += "## Changelog\n\n"
    body += f"- {date.today().isoformat()}: {entry}\n"
    return body


def cmd_add(project: Project, args: argparse.Namespace) -> None:
    project.tasks_dir.mkdir(parents=True, exist_ok=True)
    seq = next_seq(project)
    task_id = f"{project.prefix}-{seq:03d}"
    now = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    fm: dict[str, Any] = {
        "title": args.title,
        "type": "task",
        "status": args.status,
        "priority": args.priority,
    }
    if args.kunde or project.meta.get("kunde"):
        fm["kunde"] = args.kunde or project.meta.get("kunde")
    if args.due:
        fm["due"] = args.due
    if args.scheduled:
        fm["scheduled"] = args.scheduled
    fm["projects"] = [project.note_link]
    fm["tags"] = unique(["task", *args.tag])
    if args.phase:
        fm["phaseName"] = args.phase
    fm["dateCreated"] = now
    fm["dateModified"] = now
    fm["taskmd_id"] = task_id
    fm["taskmd_project_id"] = project.project_id
    fm["taskmd_seq"] = seq
    body = f"\n{args.body.strip()}\n" if args.body.strip() else "\n"
    path = unique_task_path(project.tasks_dir / f"{task_id}-{slug(args.title)}.md")
    write_markdown(path, fm, body)
    console.print(f"created\t{path}")


def cmd_meta_list(projects: list[Project]) -> None:
    table = Table(title="Project Metadata")
    for col in (
        "Area",
        "Project",
        "Project ID",
        "Prefix",
        "Kunde",
        "Repo URL",
        "Working Dir",
        "Meta",
    ):
        table.add_column(col)
    for p in projects:
        table.add_row(
            p.area,
            p.folder.name,
            p.project_id,
            p.prefix,
            str(p.meta.get("kunde") or ""),
            str(repo_url(p) or ""),
            str(p.meta.get("working_dir") or ""),
            str(p.meta_path or ""),
        )
    console.print(table)


def cmd_meta_init(project: Project, args: argparse.Namespace) -> None:
    path = writable_overview_path(project)
    fm, body = (
        read_markdown(path) if path.exists() else ({}, f"\n# {project.folder.name}\n")
    )
    fm.setdefault("title", project.folder.name)
    fm.setdefault("area", project.area)
    if args.project_id:
        fm["project_id"] = args.project_id
    else:
        fm.setdefault("project_id", project.project_id)
    if args.prefix:
        fm["prefix"] = args.prefix
    else:
        fm.setdefault("prefix", infer_prefix(project))
    if args.group_name:
        fm["group_name"] = args.group_name
    if args.kunde:
        fm["kunde"] = args.kunde
    elif project.area == "private":
        fm.setdefault("kunde", "privat")
    if args.working_dir:
        fm["working_dir"] = _platform_normalize_home(args.working_dir)
    if args.repo_url:
        fm["repo_url"] = args.repo_url
        gh = parse_github_url(args.repo_url)
        if gh:
            fm["github"] = {"owner": gh[0], "repo": gh[1]}
    if args.due:
        fm["due"] = args.due
    fm.setdefault("sync", {"enabled": True, "phase_labels_enabled": False})
    fm.setdefault("workdays_bitmask", 31)
    fm.setdefault("region", "DE-NW")
    write_markdown(path, fm, body)
    console.print(f"metadata\t{path}")


def cmd_meta_import_db(projects: list[Project], args: argparse.Namespace) -> None:
    rows = read_db_project_rows(args.db)
    table = Table(title="Import Project Metadata")
    for col in ("Project", "DB ID", "Prefix", "Group", "Repo", "Action"):
        table.add_column(col)
    for project in projects:
        row = rows.get(project.project_id)
        if not row:
            table.add_row(
                project.folder.name, project.project_id, "", "", "", "missing in DB"
            )
            continue
        path = writable_overview_path(project)
        fm, body = (
            read_markdown(path)
            if path.exists()
            else ({}, f"\n# {project.folder.name}\n")
        )
        before = dict(fm)
        set_meta_value(fm, "title", project.folder.name, args.overwrite)
        set_meta_value(fm, "taskmd_name", row.get("name"), args.overwrite)
        set_meta_value(fm, "project_id", row.get("id"), args.overwrite)
        set_meta_value(fm, "prefix", row.get("prefix"), args.overwrite)
        set_meta_value(fm, "group_name", row.get("group_name"), args.overwrite)
        set_meta_value(
            fm, "workdays_bitmask", row.get("workdays_bitmask"), args.overwrite
        )
        set_meta_value(fm, "region", row.get("region"), args.overwrite)
        set_meta_value(fm, "due", row.get("due_date"), args.overwrite)
        if project.area == "private":
            set_meta_value(fm, "kunde", "privat", args.overwrite)
        repo = row.get("repo_url")
        set_meta_value(fm, "repo_url", repo, args.overwrite)
        if row.get("backend") or row.get("owner") or row.get("repo"):
            remote = {
                "backend": row.get("backend"),
                "owner": row.get("owner"),
                "repo": row.get("repo"),
                "sync_enabled": bool(row.get("sync_enabled"))
                if row.get("sync_enabled") is not None
                else None,
                "phase_labels_enabled": bool(row.get("phase_labels_enabled"))
                if row.get("phase_labels_enabled") is not None
                else None,
            }
            remote = {k: v for k, v in remote.items() if v is not None and v != ""}
            set_meta_value(fm, "remote", remote, args.overwrite)
        if repo:
            gh = parse_github_url(repo)
            if gh:
                set_meta_value(
                    fm, "github", {"owner": gh[0], "repo": gh[1]}, args.overwrite
                )
        action = (
            "unchanged" if fm == before else ("dry-run" if args.dry_run else "write")
        )
        if fm != before and not args.dry_run:
            write_markdown(path, fm, body)
        table.add_row(
            project.folder.name,
            str(row.get("id") or ""),
            str(row.get("prefix") or ""),
            str(row.get("group_name") or ""),
            str(repo or ""),
            action,
        )
    console.print(table)


def set_meta_value(fm: dict[str, Any], key: str, value: Any, overwrite: bool) -> None:
    if value in (None, ""):
        return
    if overwrite or key not in fm or fm.get(key) in (None, ""):
        fm[key] = value


def preferred_overview_path(folder: Path) -> Path:
    return folder / f"{folder.name} {OVERVIEW_SUFFIX}"


def writable_overview_path(project: Project) -> Path:
    preferred = preferred_overview_path(project.folder)
    if preferred.exists():
        return preferred
    if project.meta_path and project.meta_path.name not in {"CLAUDE.md"}:
        return preferred
    return preferred


def read_db_project_rows(db_path: Path) -> dict[str, dict[str, Any]]:
    if not db_path.exists():
        raise SystemExit(f"db not found: {db_path}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            select
                p.id,
                p.name,
                p.prefix,
                p.group_name,
                p.workdays_bitmask,
                p.region,
                p.due_date,
                pr.backend,
                pr.owner,
                pr.repo,
                pr.sync_enabled,
                pr.phase_labels_enabled,
                pr.extra
            from projects p
            left join project_remote_links pr on pr.project_id = p.id
            where p.deleted_at is null
            """
        ).fetchall()
    finally:
        conn.close()
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        item = dict(row)
        item["repo_url"] = project_repo_url(item)
        out[str(item["id"])] = item
    return out


def project_repo_url(row: dict[str, Any]) -> str | None:
    extra = row.get("extra")
    if extra:
        try:
            data = json.loads(extra)
            if isinstance(data, dict) and data.get("html_url"):
                return str(data["html_url"])
        except json.JSONDecodeError:
            pass
    if row.get("backend") == "github" and row.get("owner") and row.get("repo"):
        return f"https://github.com/{row['owner']}/{row['repo']}"
    return None


def next_seq(project: Project) -> int:
    max_seq = 0
    for task in load_tasks([project]):
        value = task.fm.get("taskmd_seq")
        if isinstance(value, int):
            max_seq = max(max_seq, value)
            continue
        match = re.match(rf"^{re.escape(project.prefix)}-(\d+)", task.task_id)
        if match:
            max_seq = max(max_seq, int(match.group(1)))
    return max_seq + 1


def infer_project_id(project: Project) -> str:
    tasks_dir = project.folder / TASKS_DIR_NAME
    if tasks_dir.is_dir():
        for path in sorted(tasks_dir.glob("*.md")):
            fm, _ = read_markdown(path)
            value = fm.get("taskmd_project_id")
            if value:
                return str(value)
    return slug(project.folder.name)


def infer_prefix(project: Project) -> str:
    tasks_dir = project.folder / TASKS_DIR_NAME
    if tasks_dir.is_dir():
        for path in sorted(tasks_dir.glob("*.md")):
            fm, _ = read_markdown(path)
            task_id = str(fm.get("taskmd_id") or path.stem)
            match = re.match(r"([a-zA-Z0-9]+)-\d+", task_id)
            if match:
                return match.group(1)
    letters = re.sub(r"[^a-z0-9]+", "", slug(project.folder.name))
    return letters[:4] or "task"


def unique_task_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    for index in range(2, 10_000):
        candidate = path.with_name(f"{stem}-{index}{suffix}")
        if not candidate.exists():
            return candidate
    raise SystemExit(f"could not find free filename near {path}")


def repo_url(project: Project) -> str | None:
    value = project.meta.get("repo_url")
    if value:
        return str(value)
    gh = project.meta.get("github")
    if isinstance(gh, dict) and gh.get("owner") and gh.get("repo"):
        return f"https://github.com/{gh['owner']}/{gh['repo']}"
    return None


def parse_github_url(url: str) -> tuple[str, str] | None:
    match = re.match(r"https://github\.com/([^/]+)/([^/#?]+)", url.rstrip("/"))
    if not match:
        return None
    repo = match.group(2)
    if repo.endswith(".git"):
        repo = repo[:-4]
    return match.group(1), repo


def parse_date(value: Any) -> date | None:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def rel_to_vault(path: Path) -> str:
    try:
        return path.resolve().relative_to(VAULT_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def slug(value: str) -> str:
    text = value.lower()
    text = re.sub(r"https?://\S+", "", text)
    text = (
        text.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    )
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "task"


def unique(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            out.append(value)
    return out


def ellipsize(value: str, width: int) -> str:
    return textwrap.shorten(value, width=width, placeholder="…")


if __name__ == "__main__":
    raise SystemExit(main())
