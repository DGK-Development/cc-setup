# tn→Milestone Sprint-Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backlog.md als repo-lokalen AI-Task-Manager an die TaskNote-Ebene binden — je tn ein Milestone-Sprint mit Parent-Spec + Subtasks, gesteuert über zwei Skills und integriert in context-load.

**Architecture:** Ein deterministisches Helper-Skript `sprint_bridge.py` (im project-context-Submodul, neben `tasknotes_cli.py`) übernimmt die tn↔Backlog-Brücke: Survey/Status lesen `backlog/tasks/*.md`-Frontmatter read-only, Schreiben in Backlog läuft nur über die `backlog`-CLI, tn-Frontmatter wird atomar geschrieben. Zwei Markdown-Skills (`/sprint-start`, `/sprint-finish`) tragen die LLM-Urteilsteile (Auswahl, Dekomposition). context-load bekommt einen additiven Layer 1.5.

**Tech Stack:** Python 3 (PEP 723 inline deps via `uv run --script`, `pyyaml`), `backlog` CLI v1.45.2, pytest (`uv run --with pytest`), bestehende `tasknotes_cli.py`.

---

## Verifizierte Fakten (aus Exploration)

- **Backlog-Task-Frontmatter:** `id` (z. B. `CCS-001`, Subtask `CCS-001.01`), `status` ∈ {`To Do`,`In Progress`,`Done`}, `milestone` (String), `dependencies` (Liste), `references` (Liste), `parent_task_id` (bei Subtasks). Body: `## Acceptance Criteria` mit `<!-- AC:BEGIN/END -->`.
- **`backlog milestone list --plain`:** `  <name> (done/total done)` unter „Active milestones".
- **Schreiben nur via CLI:** `backlog task create "<t>" -m "<ms>" -p <parent> --dep <ids> --ac "<c>" --ref <url>`; `backlog task edit <id> -s "In Progress"`; `backlog task edit <id> --check-ac <n>`.
- **`tasknotes_cli.py`:** `projects --format json` (liefert Working Dirs/Repo je Projekt), globales `--project <id>` + `next --format json --limit N`, `show <id> --format json`, `set <id> --status …`.
- **`auto_commit: false`** ist bereits gesetzt.
- **Pfade:** Submodul-Root `vendor/cc-plugin-project-context/`. Skript-Dir `vendor/cc-plugin-project-context/scripts/`. Skills `vendor/cc-plugin-project-context/skills/`. context-load `vendor/cc-plugin-project-context/skills/context-load/SKILL.md`.

## File Structure

| Datei | Verantwortung |
|---|---|
| `vendor/cc-plugin-project-context/scripts/sprint_bridge.py` | CLI: `resolve-repo`, `survey`, `bind`, `status`, `sync-finish` |
| `vendor/cc-plugin-project-context/scripts/test_sprint_bridge.py` | pytest-Unit/Integration |
| `vendor/cc-plugin-project-context/skills/sprint-start/SKILL.md` | Skill `/sprint-start` |
| `vendor/cc-plugin-project-context/skills/sprint-finish/SKILL.md` | Skill `/sprint-finish` |
| `vendor/cc-plugin-project-context/skills/context-load/SKILL.md` | + Layer 1.5 (Edit) |
| `CLAUDE.md` (root) | Scope „NEVER EDIT TASK FILES" → `backlog/tasks/` (Edit) |
| `templates/agents/agent-index.md` | Backlog-Dekomposition-Helfer eintragen (Edit) |
| `justfile` | `test`-Recipe ergänzen (Edit) |

> **Hinweis Submodul:** `vendor/cc-plugin-project-context` ist ein Git-Submodul. Commits zu Dateien darin gehen ins Submodul-Repo; danach im cc-setup-Superprojekt den Submodul-Zeiger committen. Jede Task unten sagt, wo committet wird.

## Datenschema `survey`-JSON

```jsonc
{
  "repo": "/abs/path",            // git toplevel
  "prefix": "ccs",                // backlog task_prefix
  "initialized": true,            // backlog/config.yml vorhanden
  "project_matched": true,        // tn-Projekt über Pfad gefunden
  "open_milestones": [
    { "name": "aic-127: ModernBERT-Filter", "done": 3, "total": 7,
      "open_tasks": [ { "id": "CCS-012", "title": "…", "status": "To Do" } ] }
  ],
  "candidate_tns": [ { "id": "aic-127", "title": "…", "status": "action", "next_action": "…" } ]
}
```

---

## Task 1: Test-Harness + `resolve-repo`

**Files:**
- Create: `vendor/cc-plugin-project-context/scripts/sprint_bridge.py`
- Create: `vendor/cc-plugin-project-context/scripts/test_sprint_bridge.py`

- [ ] **Step 1: Write the failing test**

`test_sprint_bridge.py`:

```python
import json, subprocess, sys, os
from pathlib import Path

SCRIPT = Path(__file__).with_name("sprint_bridge.py")

def run(args, cwd):
    r = subprocess.run(
        ["uv", "run", "--with", "pyyaml", "--script", str(SCRIPT), *args],
        cwd=str(cwd), capture_output=True, text=True,
    )
    return r

def init_repo(tmp_path):
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    (tmp_path / "backlog").mkdir()
    (tmp_path / "backlog" / "config.yml").write_text('task_prefix: "ccs"\n')
    (tmp_path / "backlog" / "tasks").mkdir()
    return tmp_path

def test_resolve_repo_reports_root_and_prefix(tmp_path):
    repo = init_repo(tmp_path)
    r = run(["resolve-repo"], repo)
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    assert Path(out["repo"]).resolve() == repo.resolve()
    assert out["prefix"] == "ccs"
    assert out["initialized"] is True

def test_resolve_repo_uninitialized(tmp_path):
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    r = run(["resolve-repo"], tmp_path)
    out = json.loads(r.stdout)
    assert out["initialized"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vendor/cc-plugin-project-context/scripts && uv run --with pytest pytest test_sprint_bridge.py -k resolve -v`
Expected: FAIL — `sprint_bridge.py` existiert nicht / kein Output.

- [ ] **Step 3: Write minimal implementation**

`sprint_bridge.py`:

```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml"]
# ///
"""tn <-> Backlog.md Sprint-Brücke. Schreiben in Backlog NUR via `backlog`-CLI;
Survey/Status lesen backlog/tasks/*.md read-only; tn-Frontmatter wird atomar geschrieben."""
from __future__ import annotations
import argparse, json, os, subprocess, sys, tempfile
from pathlib import Path
import yaml


def git_toplevel(start: Path) -> Path | None:
    r = subprocess.run(["git", "-C", str(start), "rev-parse", "--show-toplevel"],
                       capture_output=True, text=True)
    return Path(r.stdout.strip()) if r.returncode == 0 else None


def load_config(repo: Path) -> dict:
    cfg = repo / "backlog" / "config.yml"
    if not cfg.exists():
        return {}
    return yaml.safe_load(cfg.read_text()) or {}


def cmd_resolve_repo(args) -> dict:
    repo = git_toplevel(Path.cwd())
    if repo is None:
        return {"repo": None, "initialized": False, "prefix": None}
    cfg = load_config(repo)
    return {
        "repo": str(repo),
        "initialized": (repo / "backlog" / "config.yml").exists(),
        "prefix": cfg.get("task_prefix"),
    }


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="sprint_bridge")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("resolve-repo")
    args = p.parse_args(argv)
    dispatch = {"resolve-repo": cmd_resolve_repo}
    print(json.dumps(dispatch[args.cmd](args), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd vendor/cc-plugin-project-context/scripts && uv run --with pytest pytest test_sprint_bridge.py -k resolve -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit (im Submodul)**

```bash
cd vendor/cc-plugin-project-context
git add scripts/sprint_bridge.py scripts/test_sprint_bridge.py
git commit -m "feat(sprint): sprint_bridge resolve-repo + test harness"
```

---

## Task 2: `survey` — Backlog-Tasks read-only lesen + Milestones gruppieren

**Files:**
- Modify: `vendor/cc-plugin-project-context/scripts/sprint_bridge.py`
- Test: `vendor/cc-plugin-project-context/scripts/test_sprint_bridge.py`

- [ ] **Step 1: Write the failing test**

In `test_sprint_bridge.py` ergänzen:

```python
TASK_MD = """---
id: CCS-012
title: Parser bauen
status: To Do
milestone: 'aic-127: ModernBERT-Filter'
dependencies: []
parent_task_id: CCS-010
---
## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 dummy
<!-- AC:END -->
"""

DONE_MD = """---
id: CCS-011
title: Setup
status: Done
milestone: 'aic-127: ModernBERT-Filter'
---
"""

def test_survey_groups_open_tasks_per_milestone(tmp_path, monkeypatch):
    repo = init_repo(tmp_path)
    (repo / "backlog" / "tasks" / "ccs-012 - Parser.md").write_text(TASK_MD)
    (repo / "backlog" / "tasks" / "ccs-011 - Setup.md").write_text(DONE_MD)
    # tasknotes-Aufruf neutralisieren -> kein Projekt-Match
    monkeypatch.setenv("SPRINT_BRIDGE_NO_TASKNOTES", "1")
    r = run(["survey"], repo)
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    ms = {m["name"]: m for m in out["open_milestones"]}
    m = ms["aic-127: ModernBERT-Filter"]
    assert m["done"] == 1 and m["total"] == 2
    assert [t["id"] for t in m["open_tasks"]] == ["CCS-012"]
    assert out["candidate_tns"] == []
    assert out["project_matched"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vendor/cc-plugin-project-context/scripts && uv run --with pytest pytest test_sprint_bridge.py -k survey -v`
Expected: FAIL — `survey` Subcommand unbekannt.

- [ ] **Step 3: Write minimal implementation**

In `sprint_bridge.py` ergänzen (Frontmatter-Reader + survey; tasknotes-Aufruf hinter Env-Flag):

```python
def read_frontmatter(path: Path) -> dict:
    text = path.read_text()
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    return yaml.safe_load(text[3:end]) or {}


def read_backlog_tasks(repo: Path) -> list[dict]:
    tdir = repo / "backlog" / "tasks"
    out = []
    if not tdir.is_dir():
        return out
    for f in sorted(tdir.glob("*.md")):
        fm = read_frontmatter(f)
        if fm.get("id"):
            out.append(fm)
    return out


def _tasknotes_script() -> Path:
    return Path(__file__).with_name("tasknotes_cli.py")


def match_project_and_tns(repo: Path) -> tuple[bool, list[dict]]:
    """Match repo-Pfad gegen Projekt-Working-Dirs; liefert (matched, candidate_tns)."""
    if os.environ.get("SPRINT_BRIDGE_NO_TASKNOTES"):
        return False, []
    script = _tasknotes_script()
    if not script.exists():
        return False, []
    pr = subprocess.run(["uv", "run", "--script", str(script), "projects", "--format", "json"],
                        capture_output=True, text=True)
    if pr.returncode != 0:
        return False, []
    try:
        projects = json.loads(pr.stdout).get("projects", [])
    except json.JSONDecodeError:
        return False, []
    repo_resolved = str(repo.resolve())
    project_id = None
    for proj in projects:
        wd = proj.get("working_dir")
        wd_list = wd if isinstance(wd, list) else ([wd] if wd else [])
        for w in wd_list:
            if str(Path(os.path.expanduser(w)).resolve()) == repo_resolved:
                project_id = proj.get("id")
                break
        if project_id:
            break
    if not project_id:
        return False, []
    nr = subprocess.run(["uv", "run", "--script", str(script), "--project", project_id,
                        "next", "--format", "json", "--limit", "5"],
                       capture_output=True, text=True)
    if nr.returncode != 0:
        return True, []
    try:
        tns = json.loads(nr.stdout).get("tasks", [])
    except json.JSONDecodeError:
        return True, []
    cands = [{"id": t.get("id"), "title": t.get("title"),
              "status": t.get("status"), "next_action": t.get("next_action")} for t in tns]
    return True, cands


def cmd_survey(args) -> dict:
    base = cmd_resolve_repo(args)
    repo = Path(base["repo"]) if base["repo"] else Path.cwd()
    tasks = read_backlog_tasks(repo)
    by_ms: dict[str, dict] = {}
    for t in tasks:
        ms = t.get("milestone")
        if not ms:
            continue
        slot = by_ms.setdefault(ms, {"name": ms, "done": 0, "total": 0, "open_tasks": []})
        slot["total"] += 1
        if str(t.get("status", "")).lower() == "done":
            slot["done"] += 1
        else:
            slot["open_tasks"].append({"id": t["id"], "title": t.get("title"),
                                       "status": t.get("status")})
    matched, cands = match_project_and_tns(repo)
    return {**base,
            "open_milestones": [m for m in by_ms.values() if m["done"] < m["total"]],
            "project_matched": matched,
            "candidate_tns": cands}
```

Und `dispatch`/Subparser erweitern:

```python
    sub.add_parser("survey")
```
```python
    dispatch = {"resolve-repo": cmd_resolve_repo, "survey": cmd_survey}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd vendor/cc-plugin-project-context/scripts && uv run --with pytest pytest test_sprint_bridge.py -k survey -v`
Expected: PASS.

- [ ] **Step 5: Commit (Submodul)**

```bash
cd vendor/cc-plugin-project-context
git add scripts/sprint_bridge.py scripts/test_sprint_bridge.py
git commit -m "feat(sprint): survey liest backlog-frontmatter + projekt-pfad-match"
```

---

## Task 3: `bind` — tn-Frontmatter atomar schreiben

**Files:**
- Modify: `vendor/cc-plugin-project-context/scripts/sprint_bridge.py`
- Test: `vendor/cc-plugin-project-context/scripts/test_sprint_bridge.py`

- [ ] **Step 1: Write the failing test**

```python
TN_MD = """---
title: ModernBERT Filter
status: action
---
# ModernBERT Filter

## Resume State
"""

def test_bind_writes_pointer_fields(tmp_path):
    repo = init_repo(tmp_path)
    tn = tmp_path / "aic-127.md"
    tn.write_text(TN_MD)
    r = run(["bind", "--tn", str(tn), "--repo", str(repo),
             "--milestone", "aic-127: ModernBERT-Filter",
             "--parent", "CCS-010", "--date", "2026-06-03"], repo)
    assert r.returncode == 0, r.stderr
    import yaml as y
    fm = y.safe_load(tn.read_text().split("---")[1])
    assert fm["backlog_milestone"] == "aic-127: ModernBERT-Filter"
    assert fm["backlog_parent"] == "CCS-010"
    assert fm["backlog_repo"] == str(repo.resolve())
    assert fm["sprint_status"] == "active"
    assert fm["sprint_started"] == "2026-06-03"
    assert fm["status"] == "action"  # bestehende Felder bleiben
    assert "## Resume State" in tn.read_text()  # Body bleibt
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vendor/cc-plugin-project-context/scripts && uv run --with pytest pytest test_sprint_bridge.py -k bind -v`
Expected: FAIL — `bind` unbekannt.

- [ ] **Step 3: Write minimal implementation**

```python
def split_frontmatter(text: str) -> tuple[dict, str]:
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    fm = yaml.safe_load(text[3:end]) or {}
    body = text[end + 4:]
    if body.startswith("\n"):
        body = body[1:]
    return fm, body


def write_atomic(path: Path, content: str) -> None:
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(content)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def dump_note(fm: dict, body: str) -> str:
    front = yaml.safe_dump(fm, allow_unicode=True, sort_keys=False).strip()
    return f"---\n{front}\n---\n{body}"


def cmd_bind(args) -> dict:
    tn = Path(args.tn)
    fm, body = split_frontmatter(tn.read_text())
    fm["backlog_repo"] = str(Path(args.repo).resolve())
    fm["backlog_milestone"] = args.milestone
    fm["backlog_parent"] = args.parent
    fm["sprint_status"] = "active"
    fm["sprint_started"] = args.date
    write_atomic(tn, dump_note(fm, body))
    return {"bound": str(tn), "milestone": args.milestone, "parent": args.parent}
```

Subparser + dispatch:

```python
    pb = sub.add_parser("bind")
    pb.add_argument("--tn", required=True)
    pb.add_argument("--repo", required=True)
    pb.add_argument("--milestone", required=True)
    pb.add_argument("--parent", required=True)
    pb.add_argument("--date", required=True)
```
```python
    dispatch = {"resolve-repo": cmd_resolve_repo, "survey": cmd_survey, "bind": cmd_bind}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd vendor/cc-plugin-project-context/scripts && uv run --with pytest pytest test_sprint_bridge.py -k bind -v`
Expected: PASS.

- [ ] **Step 5: Commit (Submodul)**

```bash
cd vendor/cc-plugin-project-context
git add scripts/sprint_bridge.py scripts/test_sprint_bridge.py
git commit -m "feat(sprint): bind schreibt tn-pointer-frontmatter atomar"
```

---

## Task 4: `status` — aktiven Sprint des Repos zusammenfassen

**Files:**
- Modify: `vendor/cc-plugin-project-context/scripts/sprint_bridge.py`
- Test: `vendor/cc-plugin-project-context/scripts/test_sprint_bridge.py`

- [ ] **Step 1: Write the failing test**

```python
def test_status_reports_progress_and_next_open(tmp_path, monkeypatch):
    repo = init_repo(tmp_path)
    (repo / "backlog" / "tasks" / "ccs-012 - Parser.md").write_text(TASK_MD)  # To Do
    (repo / "backlog" / "tasks" / "ccs-011 - Setup.md").write_text(DONE_MD)   # Done
    monkeypatch.setenv("SPRINT_BRIDGE_NO_TASKNOTES", "1")
    r = run(["status"], repo)
    out = json.loads(r.stdout)
    assert out["active_sprint"] is True
    m = out["milestone"]
    assert m["name"] == "aic-127: ModernBERT-Filter"
    assert m["done"] == 1 and m["total"] == 2
    assert out["next_open_task"] == {"id": "CCS-012", "title": "Parser bauen", "status": "To Do"}

def test_status_no_open_milestone(tmp_path, monkeypatch):
    repo = init_repo(tmp_path)
    (repo / "backlog" / "tasks" / "ccs-011 - Setup.md").write_text(DONE_MD)  # alles done
    monkeypatch.setenv("SPRINT_BRIDGE_NO_TASKNOTES", "1")
    r = run(["status"], repo)
    out = json.loads(r.stdout)
    assert out["active_sprint"] is False
    assert out["all_done"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vendor/cc-plugin-project-context/scripts && uv run --with pytest pytest test_sprint_bridge.py -k status -v`
Expected: FAIL — `status` unbekannt.

- [ ] **Step 3: Write minimal implementation**

```python
def cmd_status(args) -> dict:
    base = cmd_resolve_repo(args)
    repo = Path(base["repo"]) if base["repo"] else Path.cwd()
    tasks = read_backlog_tasks(repo)
    by_ms: dict[str, dict] = {}
    for t in tasks:
        ms = t.get("milestone")
        if not ms:
            continue
        slot = by_ms.setdefault(ms, {"name": ms, "done": 0, "total": 0, "open_tasks": []})
        slot["total"] += 1
        if str(t.get("status", "")).lower() == "done":
            slot["done"] += 1
        else:
            slot["open_tasks"].append({"id": t["id"], "title": t.get("title"),
                                       "status": t.get("status")})
    open_ms = [m for m in by_ms.values() if m["done"] < m["total"]]
    has_any = bool(by_ms)
    if not open_ms:
        return {"active_sprint": False, "all_done": has_any, "milestone": None,
                "next_open_task": None}
    m = open_ms[0]
    return {"active_sprint": True, "all_done": False,
            "milestone": {"name": m["name"], "done": m["done"], "total": m["total"]},
            "next_open_task": m["open_tasks"][0] if m["open_tasks"] else None}
```

Subparser + dispatch:

```python
    sub.add_parser("status")
```
```python
    dispatch = {"resolve-repo": cmd_resolve_repo, "survey": cmd_survey,
                "bind": cmd_bind, "status": cmd_status}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd vendor/cc-plugin-project-context/scripts && uv run --with pytest pytest test_sprint_bridge.py -k status -v`
Expected: PASS.

- [ ] **Step 5: Commit (Submodul)**

```bash
cd vendor/cc-plugin-project-context
git add scripts/sprint_bridge.py scripts/test_sprint_bridge.py
git commit -m "feat(sprint): status fasst aktiven sprint + naechsten offenen task zusammen"
```

---

## Task 5: `sync-finish` — tn auf in-review, je-Subtask-Changelog

**Files:**
- Modify: `vendor/cc-plugin-project-context/scripts/sprint_bridge.py`
- Test: `vendor/cc-plugin-project-context/scripts/test_sprint_bridge.py`

- [ ] **Step 1: Write the failing test**

```python
TN_ACTIVE = """---
title: ModernBERT Filter
status: action
backlog_repo: REPO
backlog_milestone: 'aic-127: ModernBERT-Filter'
backlog_parent: CCS-010
sprint_status: active
sprint_started: '2026-06-03'
---
# ModernBERT Filter
"""

def test_sync_finish_sets_in_review_and_changelog(tmp_path, monkeypatch):
    repo = init_repo(tmp_path)
    (repo / "backlog" / "tasks" / "ccs-012 - Parser.md").write_text(
        TASK_MD.replace("status: To Do", "status: Done"))
    (repo / "backlog" / "tasks" / "ccs-011 - Setup.md").write_text(DONE_MD)
    tn = tmp_path / "aic-127.md"
    tn.write_text(TN_ACTIVE.replace("REPO", str(repo.resolve())))
    monkeypatch.setenv("SPRINT_BRIDGE_NO_TASKNOTES", "1")
    r = run(["sync-finish", "--tn", str(tn), "--repo", str(repo), "--date", "2026-06-03"], repo)
    assert r.returncode == 0, r.stderr
    text = tn.read_text()
    import yaml as y
    fm = y.safe_load(text.split("---")[1])
    assert fm["status"] == "in-review"
    assert fm["sprint_status"] == "done"
    assert "## Changelog" in text
    assert "CCS-012" in text and "Parser bauen" in text  # je-Subtask-eintrag
    assert "CCS-011" in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vendor/cc-plugin-project-context/scripts && uv run --with pytest pytest test_sprint_bridge.py -k sync_finish -v`
Expected: FAIL — `sync-finish` unbekannt.

- [ ] **Step 3: Write minimal implementation**

```python
def ensure_section(body: str, header: str) -> str:
    if header in body:
        return body
    sep = "" if body.endswith("\n") or body == "" else "\n"
    return f"{body}{sep}\n{header}\n"


def append_under_section(body: str, header: str, lines: list[str]) -> str:
    body = ensure_section(body, header)
    idx = body.index(header) + len(header)
    nl = body.find("\n", idx)
    insert_at = nl + 1 if nl != -1 else len(body)
    block = "".join(f"{ln}\n" for ln in lines)
    return body[:insert_at] + block + body[insert_at:]


def cmd_sync_finish(args) -> dict:
    repo = Path(args.repo).resolve()
    tn = Path(args.tn)
    fm, body = split_frontmatter(tn.read_text())
    tasks = [t for t in read_backlog_tasks(repo)
             if t.get("milestone") == fm.get("backlog_milestone")]
    done = [t for t in tasks if str(t.get("status", "")).lower() == "done"]
    open_ = [t for t in tasks if str(t.get("status", "")).lower() != "done"]
    fm["sprint_status"] = "done"
    if not open_:
        fm["status"] = "in-review"
    changelog = [f"- {args.date} `{t['id']}`: {t.get('title','')}" for t in done]
    body = append_under_section(body, "## Changelog", changelog)
    summary = (f"- {args.date} Sprint `{fm.get('backlog_milestone')}` abgeschlossen: "
               f"{len(done)}/{len(tasks)} Subtasks implementiert.")
    body = append_under_section(body, "## Final Summary", [summary])
    write_atomic(tn, dump_note(fm, body))
    return {"tn": str(tn), "status": fm["status"], "done": len(done),
            "total": len(tasks), "open": len(open_)}
```

Subparser + dispatch:

```python
    pf = sub.add_parser("sync-finish")
    pf.add_argument("--tn", required=True)
    pf.add_argument("--repo", required=True)
    pf.add_argument("--date", required=True)
```
```python
    dispatch = {"resolve-repo": cmd_resolve_repo, "survey": cmd_survey,
                "bind": cmd_bind, "status": cmd_status, "sync-finish": cmd_sync_finish}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd vendor/cc-plugin-project-context/scripts && uv run --with pytest pytest test_sprint_bridge.py -v`
Expected: PASS (alle Tests).

- [ ] **Step 5: Commit (Submodul)**

```bash
cd vendor/cc-plugin-project-context
git add scripts/sprint_bridge.py scripts/test_sprint_bridge.py
git commit -m "feat(sprint): sync-finish setzt tn in-review + je-subtask-changelog"
```

---

## Task 6: `just test`-Recipe

**Files:**
- Modify: `justfile`

- [ ] **Step 1: Recipe ergänzen**

Am Ende von `justfile` anfügen:

```just
# Sprint-Bridge-Tests
test:
    cd vendor/cc-plugin-project-context/scripts && uv run --with pytest --with pyyaml pytest test_sprint_bridge.py -v
```

- [ ] **Step 2: Run to verify**

Run: `just test`
Expected: alle sprint_bridge-Tests PASS (DoD „just test passes").

- [ ] **Step 3: Commit (Superprojekt)**

```bash
git add justfile
git commit -m "build: just test fuehrt sprint_bridge-tests aus"
```

---

## Task 7: Skill `/sprint-start`

**Files:**
- Create: `vendor/cc-plugin-project-context/skills/sprint-start/SKILL.md`

- [ ] **Step 1: Skill schreiben**

Inhalt von `SKILL.md` (Frontmatter wie bei context-load; `SB` zeigt auf `${CLAUDE_PLUGIN_ROOT}/scripts/sprint_bridge.py`, alle Bash-Calls mit `redactor wrap --`):

````markdown
---
name: sprint-start
description: Startet/fortsetzt einen tn→Milestone-Sprint im aktuellen Repo. Zeigt offene Milestones + Resttasks, sonst next-5-tn zur Auswahl, schlägt Dekomposition vor (Bestätigung Pflicht), legt Parent-Spec + Subtasks via backlog-CLI an, bindet die tn. USE WHEN sprint start, sprint starten, neuen sprint, milestone anlegen, backlog sprint, tn als milestone, sprint fortsetzen.
---

# /sprint-start

Brücke: `SB="${CLAUDE_PLUGIN_ROOT}/scripts/sprint_bridge.py"`.
**Redactor strict mode** — jeder Bash-Call mit `redactor wrap --`.

## Schritt 0 — Bestandsaufnahme (Pflicht zuerst)

```bash
redactor wrap -- uv run --with pyyaml --script "$SB" survey
```

JSON lesen. Wenn `initialized: false` → User anbieten: `backlog init` im Repo
ausführen (mit `auto_commit:false`), sonst abbrechen mit Hinweis.

Rendere zwei Listen:
- **Offene Milestones** (`open_milestones`): je Milestone `name (done/total)` + offene Tasks.
- **Nächste tn** (`candidate_tns`): top 5 mit Status + next_action. Bei
  `project_matched:false` Hinweis „kein tn-Projekt zu diesem Repo gematcht".

## Schritt 1 — Initiale Frage (AskUserQuestion)

- **Offenen Milestone fertigmachen** → zeige `open_tasks`, springe zum ersten offenen
  Subtask; dispatch Developer-Subagent für die Umsetzung (nie Review in selber Session).
- **Neuen tn-Sprint anlegen** → Schritt 2.
  (Bei `project_matched:false`: biete freie tn-Auswahl via
  `redactor wrap -- uv run --script "${CLAUDE_PLUGIN_ROOT}/scripts/tasknotes_cli.py" next --format json --limit 10`.)

## Schritt 2 — tn laden + Dekomposition vorschlagen

tn-Body laden (`tasknotes_cli show <id> --format json`). Offener `blockedBy` →
Warnung + Wahl (Blocker / forcen / anderer tn).

Schlage vor (NUR anzeigen, **OK abwarten** — Human-Oversight):
- Milestone-Name: `"<tn-id>: <kurztitel>"`.
- Parent-Spec-Task: Titel `[Spec] <tn-title>`, Description=Ziel, `--ref <tn-pfad>`, AC.
- Subtask-Liste: je Schritt Titel, `--dep` (auf Vorgänger-Subtask-IDs), `--ac`.

## Schritt 3 — Anlegen (nach OK)

Banner: `═══ SPOC · ROLLE: PM ═══` / `🔀 DISPATCH: in-session`.

```bash
# Parent zuerst (liefert ID, z. B. CCS-010)
redactor wrap -- backlog task create "[Spec] <titel>" -m "<tn-id>: <kurz>" --ref "<tn-pfad>" --ac "<sprintziel>"
# dann Subtasks
redactor wrap -- backlog task create "<schritt>" -p CCS-010 -m "<tn-id>: <kurz>" --dep CCS-010.01 --ac "<ac>"
```

Danach binden + Datum aus Umgebung (currentDate):

```bash
redactor wrap -- uv run --with pyyaml --script "$SB" bind --tn "<tn-pfad>" --repo "$(git rev-parse --show-toplevel)" --milestone "<tn-id>: <kurz>" --parent CCS-010 --date "<YYYY-MM-DD>"
```

## Schritt 4 — Report

`redactor wrap -- backlog milestone list --plain` + Parent-/Subtask-IDs.
SPOC-Footer: `🗣️ SPOC: Sprint <milestone> angelegt · nächster Gate: Developer-Subagent für CCS-010.01`.

## NICHT

- Keine Subtasks ohne Bestätigung anlegen.
- Kein Git (Branch/PR/Push) — das macht /finalize + Developer.
- Backlog-Tasks NIE per File-Edit ändern — nur `backlog`-CLI.
````

- [ ] **Step 2: Verify (Smoke)**

Run: `redactor wrap -- uv run --with pyyaml --script vendor/cc-plugin-project-context/scripts/sprint_bridge.py survey`
Expected: gültiges JSON (im cc-setup-Repo). Skill-Datei manuell gegenlesen: alle Bash-Calls `redactor wrap --`, Pfade über `$SB`/`$CLAUDE_PLUGIN_ROOT`.

- [ ] **Step 3: Commit (Submodul)**

```bash
cd vendor/cc-plugin-project-context
git add skills/sprint-start/SKILL.md
git commit -m "feat(sprint): /sprint-start skill"
```

---

## Task 8: Skill `/sprint-finish`

**Files:**
- Create: `vendor/cc-plugin-project-context/skills/sprint-finish/SKILL.md`

- [ ] **Step 1: Skill schreiben**

````markdown
---
name: sprint-finish
description: Schließt einen tn→Milestone-Sprint ab — fasst Backlog-Stand zusammen, schreibt Final Summary + je-Subtask-Changelog in die tn, setzt tn auf in-review. Kein Git. USE WHEN sprint finish, sprint abschließen, sprint beenden, milestone fertig, sprint zusammenfassen, tn in review.
---

# /sprint-finish

Brücke: `SB="${CLAUDE_PLUGIN_ROOT}/scripts/sprint_bridge.py"`. Redactor strict mode.

## Schritt 1 — Aktiven Sprint auflösen

```bash
redactor wrap -- uv run --with pyyaml --script "$SB" status
```

Kein aktiver Sprint → Hinweis, Ende. Offene Subtasks (`active_sprint:true`, nicht
`all_done`) → User-Wahl: trotzdem in-review / abbrechen.

## Schritt 2 — Stand zusammenfassen

`redactor wrap -- backlog milestone list --plain` + offene/erledigte Subtasks anzeigen.
Die gebundene tn aus dem Repo finden: tn-Pfad steht in `backlog_repo`-gebundenen tns;
nutze `tasknotes_cli` zum Auflösen oder den beim Start gemerkten Pfad.

## Schritt 3 — sync-finish

Banner `═══ SPOC · ROLLE: PM ═══`.

```bash
redactor wrap -- uv run --with pyyaml --script "$SB" sync-finish --tn "<tn-pfad>" --repo "$(git rev-parse --show-toplevel)" --date "<YYYY-MM-DD>"
```

Setzt tn-Status `in-review`, `sprint_status: done`, schreibt je-Subtask-Changelog +
Final Summary.

## Schritt 4 — Report

`🗣️ SPOC: Sprint abgeschlossen · tn auf in-review · nächster Gate: Review (separater
Session-Reviewer) + /finalize für Branch/PR`.

## NICHT

- Kein Git, kein PR, kein Push.
- tn NICHT auf `done` (Review-Gate bleibt beim Menschen — Human-Oversight).
````

- [ ] **Step 2: Verify**

Skill-Datei gegenlesen: Bash-Calls `redactor wrap --`, kein Git, tn→in-review (nicht done).

- [ ] **Step 3: Commit (Submodul)**

```bash
cd vendor/cc-plugin-project-context
git add skills/sprint-finish/SKILL.md
git commit -m "feat(sprint): /sprint-finish skill"
```

---

## Task 9: context-load Layer 1.5

**Files:**
- Modify: `vendor/cc-plugin-project-context/skills/context-load/SKILL.md`

- [ ] **Step 1: Layer 1.5 nach Layer 1 einfügen**

Nach dem Abschnitt „### Layer 1 — Aktiver Task" einfügen:

````markdown
### Layer 1.5 — Aktiver Sprint (Backlog, additiv)

Nur wenn CWD in einem Repo mit `backlog/` liegt:

```bash
redactor wrap -- uv run --with pyyaml --script "${CLAUDE_PLUGIN_ROOT}/scripts/sprint_bridge.py" status
```

- `active_sprint: true` → Ausgabe-Block „**Aktiver Sprint:** `<milestone>` · done/total ·
  nächster offener: `<id>`". Wenn `all_done: true` → Suggested Skill `/sprint-finish`.
- Kein `backlog/` / kein aktiver Sprint → still überspringen.
- tn-Match (Layer 1) ohne gebundenen Sprint, CWD=Repo → Suggested Skill `/sprint-start`.
````

Und im Output-Block-Template die Zeile ergänzen:

```markdown
Aktiver Sprint: <milestone> · n/m done · nächster: <id>   <- nur wenn vorhanden
```

- [ ] **Step 2: Verify**

Run: `redactor wrap -- uv run --with pyyaml --script vendor/cc-plugin-project-context/scripts/sprint_bridge.py status`
Expected: gültiges JSON. SKILL.md gegenlesen — Layer 1.5 ist additiv, no-op ohne backlog/.

- [ ] **Step 3: Commit (Submodul)**

```bash
cd vendor/cc-plugin-project-context
git add skills/context-load/SKILL.md
git commit -m "feat(sprint): context-load layer 1.5 zeigt aktiven sprint"
```

---

## Task 10: CLAUDE.md-Scope + agent-index

**Files:**
- Modify: `CLAUDE.md` (root)
- Modify: `templates/agents/agent-index.md`

- [ ] **Step 1: CLAUDE.md — Scope-Klarstellung voranstellen**

Über Zeile 1 (vor `<!-- BACKLOG.MD GUIDELINES START -->`) einfügen:

```markdown
<!-- CC-SETUP SCOPE -->
> Diese Backlog-Regeln gelten NUR für `backlog/tasks/` (Repo-Tasks).
> Vault-TaskNotes werden über `tasknotes_cli.py` gepflegt (nicht hiervon betroffen).
> Sprint-Workflow: `/sprint-start`, `/sprint-finish`. Globaler Vertrag: `~/.claude/CLAUDE.md`.
<!-- /CC-SETUP SCOPE -->
```

- [ ] **Step 2: agent-index — Backlog-Helfer eintragen**

In `templates/agents/agent-index.md` eine Zeile in der Routing-Tabelle ergänzen
(Format an bestehende Zeilen anpassen):

```markdown
| Sprint planen, Backlog dekomponieren | PM | in-session (/sprint-start) — nutzt project-manager-backlog-Agent als Dekomposition-Helfer |
```

- [ ] **Step 3: Commit (Superprojekt)**

```bash
git add CLAUDE.md templates/agents/agent-index.md
git commit -m "docs: backlog-regeln auf backlog/tasks scopen + sprint-routing in agent-index"
```

---

## Task 11: Submodul-Zeiger + Dogfood-Sprint

**Files:**
- Modify: cc-setup Superprojekt (Submodul-Zeiger)
- Create: `backlog/tasks/*` im cc-setup-Repo (via CLI)

- [ ] **Step 1: Submodul-Zeiger committen**

```bash
git add vendor/cc-plugin-project-context
git commit -m "chore: submodul-zeiger auf sprint-workflow"
```

- [ ] **Step 2: Diesen Plan als ersten Sprint in Backlog gießen**

```bash
redactor wrap -- backlog task create "[Spec] tn→Milestone Sprint-Workflow" \
  -m "ccs-sprint: tn→Milestone Workflow" \
  --ref "docs/superpowers/specs/2026-06-03-tn-milestone-sprint-workflow-design.md" \
  --ac "sprint_bridge 5 subcommands getestet" --ac "2 skills + layer 1.5" --ac "just test passes"
# Subtasks (Parent-ID aus Output, hier CCS-010 angenommen):
redactor wrap -- backlog task create "sprint_bridge resolve-repo+harness" -p CCS-010 -m "ccs-sprint: tn→Milestone Workflow" --ac "resolve-repo test gruen"
redactor wrap -- backlog task create "survey" -p CCS-010 -m "ccs-sprint: tn→Milestone Workflow" --dep CCS-010.01 --ac "survey-json schema test gruen"
redactor wrap -- backlog task create "bind" -p CCS-010 -m "ccs-sprint: tn→Milestone Workflow" --dep CCS-010.01 --ac "frontmatter-roundtrip gruen"
redactor wrap -- backlog task create "status" -p CCS-010 -m "ccs-sprint: tn→Milestone Workflow" --dep CCS-010.02 --ac "status test gruen"
redactor wrap -- backlog task create "sync-finish" -p CCS-010 -m "ccs-sprint: tn→Milestone Workflow" --dep CCS-010.03 --ac "in-review+changelog test gruen"
redactor wrap -- backlog task create "/sprint-start + /sprint-finish skills" -p CCS-010 -m "ccs-sprint: tn→Milestone Workflow" --dep CCS-010.05 --ac "skills vorhanden, smoke ok"
redactor wrap -- backlog task create "context-load layer 1.5 + CLAUDE.md scope + agent-index" -p CCS-010 -m "ccs-sprint: tn→Milestone Workflow" --dep CCS-010.07 --ac "layer additiv, scope-block da"
```

- [ ] **Step 3: Stand prüfen + committen**

```bash
redactor wrap -- backlog milestone list --plain
redactor wrap -- uv run --with pyyaml --script vendor/cc-plugin-project-context/scripts/sprint_bridge.py status
git add backlog/ && git commit -m "chore(sprint): dogfood-sprint fuer tn→milestone workflow"
```

---

## Self-Review (durchgeführt)

- **Spec-Coverage:** SoT-Modell→Tasks 3/5 (bind/sync-finish); Repo-Bindung→Task 1; Dekomposition→Task 7; Umfang ohne Git→Tasks 7/8 („NICHT Git"); Form→Tasks 1-6 (Skript) + 7/8 (Skills); Milestone=Sprint→Tasks 2/4; Spec-Anker Parent→Task 7; auto_commit→bereits erledigt; Einstieg-Survey→Task 2/7; Milestone-Name→Task 7; Pfad-Match→Task 2; tn→in-review→Task 5; je-Subtask-Changelog→Task 5; Cleanup CLAUDE.md/agent→Task 10; Dogfood→Task 11. Keine Lücke.
- **Platzhalter:** keine — alle Code-Steps mit vollem Code, alle Commands mit erwartetem Ergebnis.
- **Typ-Konsistenz:** Funktionsnamen (`split_frontmatter`, `read_backlog_tasks`, `dump_note`, `write_atomic`, `append_under_section`) und survey-JSON-Felder durchgängig identisch über Tasks 1-5; dispatch-Dict in jedem Task vollständig wiederholt.
