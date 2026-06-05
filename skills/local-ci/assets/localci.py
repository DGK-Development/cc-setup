# /// script
# requires-python = ">=3.9"
# dependencies = ["pyyaml>=6"]
# ///
"""localci — lokale, git-gesteuerte CI-Pipeline.

Liest .localci/pipeline.yml, fuehrt Stages/Steps sequentiell aus, gatet den Push
bei fehlgeschlagenen gegateten Steps, schreibt pro Lauf ein CTRF-JSON, rendert
einen HTML-Report und aktualisiert die aggregierte runs.html.

Siehe Spec: ObsidianPKM .../ios-deployment/specs/local-ci-pipeline-spec.md
Reporting ist selbst-gerendert (kein ctrf-html-reporter) — CTRF-Kontrakt bleibt erfuellt.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

EXIT_PASSED = 0
EXIT_FAILED = 1
EXIT_CONFIG = 2

WHEN_VALUES = {"always", "on_success", "on_failure", "manual"}


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def err(msg: str) -> None:
    print(f"localci: {msg}", file=sys.stderr)


def git(*args: str) -> str:
    try:
        out = subprocess.run(
            ["git", *args], capture_output=True, text=True, check=False
        )
        return out.stdout.strip()
    except FileNotFoundError:
        return ""


def now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def make_run_id() -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    sha = git("rev-parse", "--short", "HEAD") or "nogit"
    return f"{ts}-{sha}"


# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #
def load_config(path: Path) -> dict:
    if not path.is_file():
        err(f"Pipeline-Definition nicht gefunden: {path}")
        sys.exit(EXIT_CONFIG)
    try:
        data = yaml.safe_load(path.read_text()) or {}
    except yaml.YAMLError as exc:
        err(f"YAML-Fehler in {path}: {exc}")
        sys.exit(EXIT_CONFIG)
    if not isinstance(data, dict) or "name" not in data or "stages" not in data:
        err("pipeline.yml braucht mindestens 'name' und 'stages'.")
        sys.exit(EXIT_CONFIG)
    if not isinstance(data.get("stages"), list) or not data["stages"]:
        err("'stages' muss eine nicht-leere Liste sein.")
        sys.exit(EXIT_CONFIG)
    for stage in data["stages"]:
        when = stage.get("when", "always")
        if when not in WHEN_VALUES:
            err(f"Stage '{stage.get('name')}' hat ungueltiges when: {when}")
            sys.exit(EXIT_CONFIG)
        if not stage.get("steps"):
            err(f"Stage '{stage.get('name')}' hat keine steps.")
            sys.exit(EXIT_CONFIG)
    return data


# --------------------------------------------------------------------------- #
# Execution
# --------------------------------------------------------------------------- #
def run_step(step: dict, base_env: dict) -> dict:
    """Fuehrt einen Step aus und liefert einen CTRF-test-Eintrag."""
    name = step["name"]
    cmd = step["run"]
    timeout = step.get("timeout")
    start = now_ms()
    try:
        proc = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            env=base_env,
            timeout=timeout,
        )
        output = (proc.stdout or "") + (proc.stderr or "")
        rc = proc.returncode
        timed_out = False
    except subprocess.TimeoutExpired as exc:
        output = (exc.stdout or "") + (exc.stderr or "") if exc.stdout else ""
        output += f"\n[localci] timeout nach {timeout}s"
        rc = 124
        timed_out = True
    duration = now_ms() - start

    failed = rc != 0
    status = "failed" if failed else "passed"
    entry = {
        "name": name,
        "status": status,
        "duration": duration,
        "rawStatus": status,
        "exitCode": rc,
        # Output IMMER erfassen (auch bei passed) -> jeder Step ist aufklappbar.
        "trace": output.strip()[:20000],
    }
    if failed:
        entry["message"] = (
            f"timeout nach {timeout}s" if timed_out else f"exit code {rc}"
        )
    return entry


def skipped_entry(name: str) -> dict:
    return {"name": name, "status": "skipped", "duration": 0, "rawStatus": "skipped"}


def should_run(
    when: str,
    pipeline_failed: bool,
    gate_only: bool,
    is_gate: bool,
    only_stage: str | None,
    stage_name: str,
    no_deploy: bool,
) -> bool:
    """Entscheidet, ob eine Stage tatsaechlich ausgefuehrt wird."""
    if only_stage is not None:
        return stage_name == only_stage
    if gate_only and not is_gate:
        return False
    if no_deploy and when == "on_success":
        return False
    # Spec 6.3: nach einem Gate-Fehlschlag werden nachfolgende gate- UND
    # on_success-Stages uebersprungen; nur reine when:always-Stages laufen weiter.
    if pipeline_failed and is_gate:
        return False
    if when == "always":
        return True
    if when == "on_success":
        return not pipeline_failed
    if when == "on_failure":
        return pipeline_failed
    if when == "manual":
        return False  # nur via --stage
    return True


def execute(config: dict, args: argparse.Namespace) -> dict:
    """Fuehrt die Pipeline aus, liefert das CTRF-Dokument."""
    base_env = dict(os.environ)
    for key, val in (config.get("env") or {}).items():
        base_env[str(key)] = str(val)

    pipeline_failed = False
    tests: list[dict] = []
    start = now_ms()

    for stage in config["stages"]:
        stage_name = stage["name"]
        is_gate = bool(stage.get("gate", False))
        when = stage.get("when", "always")
        run_stage = should_run(
            when,
            pipeline_failed,
            args.gate_only,
            is_gate,
            args.stage,
            stage_name,
            args.no_deploy,
        )

        for step in stage["steps"]:
            step_when = step.get("when", "always")
            # Step-when zusaetzlich zur Stage-Entscheidung
            step_runs = run_stage and (
                step_when == "always"
                or (step_when == "on_success" and not pipeline_failed)
                or (step_when == "on_failure" and pipeline_failed)
            )
            if not step_runs:
                entry = skipped_entry(step["name"])
                entry["suite"] = stage_name
                tests.append(entry)
                continue

            entry = run_step(step, base_env)
            entry["suite"] = stage_name
            tests.append(entry)
            print(
                f"  [{entry['status']:>7}] {stage_name} / {step['name']} "
                f"({entry['duration']}ms)"
            )

            if entry["status"] == "failed" and not step.get("allow_failure", False):
                if is_gate:
                    pipeline_failed = True
                    # restliche Steps dieser gate-Stage trotzdem als skipped? Nein:
                    # Spec — gegateter Fehler bricht Pipeline ab. Restliche Steps skipped.
                    break  # restliche Steps dieser Stage werden unten als skip nachgezogen
        else:
            continue
        # gate fail in dieser Stage -> verbleibende Steps der Stage als skipped erfassen
        if pipeline_failed and run_stage:
            seen = {t["name"] for t in tests if t.get("suite") == stage_name}
            for step in stage["steps"]:
                if step["name"] not in seen:
                    e = skipped_entry(step["name"])
                    e["suite"] = stage_name
                    tests.append(e)

    stop = now_ms()
    summary = summarize(tests, start, stop)
    run_status = "failed" if pipeline_failed else "passed"

    return {
        "results": {
            "tool": {"name": "localci"},
            "summary": summary,
            "environment": {
                "buildName": config["name"],
                "buildNumber": args.run_id,
                "branch": git("rev-parse", "--abbrev-ref", "HEAD") or "unknown",
                "commit": git("rev-parse", "--short", "HEAD") or "unknown",
                "trigger": os.environ.get("LOCALCI_TRIGGER", "manual"),
                "runStatus": run_status,
            },
            "tests": tests,
        }
    }


def summarize(tests: list[dict], start: int, stop: int) -> dict:
    counts = {"passed": 0, "failed": 0, "skipped": 0, "pending": 0, "other": 0}
    for t in tests:
        counts[t["status"]] = counts.get(t["status"], 0) + 1
    return {
        "tests": len(tests),
        "passed": counts["passed"],
        "failed": counts["failed"],
        "pending": counts["pending"],
        "skipped": counts["skipped"],
        "other": counts["other"],
        "start": start,
        "stop": stop,
    }


# --------------------------------------------------------------------------- #
# Reporting (self-rendered, CTRF-konform)
# --------------------------------------------------------------------------- #
# Status -> (Farbe, Glyph) — GitHub-Dark-Palette (gedaempft).
STATUS_META = {
    "passed": ("#3fb950", "✓"),  # green
    "failed": ("#f85149", "✕"),  # red
    "skipped": ("#6e7681", "–"),  # grey
    "pending": ("#d29922", "●"),  # yellow
}
STATUS_COLOR = {k: v[0] for k, v in STATUS_META.items()}

# Gemeinsames CSS — GitHub-Dark-Theme (Primer), gedaempfte Kontraste,
# eine Zeile pro Run in der Uebersicht.
CSS = """
:root{--bg:#0d1117;--surface:#161b22;--surface2:#1c2128;--border:#30363d;
--text:#e6edf3;--muted:#8b949e;--accent:#2f81f7;--green:#3fb950;--red:#f85149}
*{box-sizing:border-box}
body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
margin:0;color:var(--text);background:var(--bg)}
.wrap{max-width:1280px;margin:0 auto;padding:1.75rem 1.5rem}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
h1{font-size:1.35rem;margin:0;display:flex;align-items:center;gap:.55rem;font-weight:600}
.sub{color:var(--muted);font-size:.85rem;margin:.4rem 0 1.25rem}
.sub code{background:var(--surface);border:1px solid var(--border);padding:.08rem .35rem;
border-radius:5px}
.card{border:1px solid var(--border);border-radius:8px;background:var(--bg);margin-bottom:1.25rem}
.card-h{padding:.55rem .95rem;border-bottom:1px solid var(--border);background:var(--surface);
font-weight:600;border-radius:8px 8px 0 0;font-size:.82rem;color:var(--text)}
.badge{display:inline-flex;align-items:center;gap:.35rem;padding:.12rem .6rem;border-radius:2em;
color:#fff;font-weight:600;font-size:.76rem;text-transform:capitalize}
.ico{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;
border-radius:50%;color:#fff;font-size:11px;font-weight:700;flex:0 0 auto}
/* Steps (Detailseite) */
.job-head{padding:.45rem .95rem;font-size:.78rem;font-weight:600;color:var(--muted);
border-top:1px solid var(--border);background:var(--surface)}
.job-head:first-child{border-top:0}
.step>summary,.step-row{display:flex;align-items:center;gap:.6rem;padding:.5rem .95rem;
cursor:pointer;list-style:none;border-top:1px solid var(--border)}
.step>summary:hover{background:var(--surface)}
.step-row{cursor:default}
.step>summary::-webkit-details-marker{display:none}
.step .chev{color:var(--muted);transition:transform .15s;font-size:.7rem;width:.8em}
.step[open]>summary{background:var(--surface)}.step[open] .chev{transform:rotate(90deg)}
.step-row .chev{visibility:hidden}
.name{flex:1;font-weight:500}
.dur{color:var(--muted);font-size:.8rem;font-variant-numeric:tabular-nums}
.log{margin:0;background:#010409;color:#c9d1d9;padding:.8rem 1rem;font-size:12px;
font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;
overflow:auto;border-top:1px solid var(--border)}
/* Verlauf */
.stats{display:flex;gap:2rem;flex-wrap:wrap;padding:.9rem .95rem .5rem}
.stats b{font-size:1.5rem;display:block;font-weight:600;line-height:1.2}
.stats .lbl{font-size:.72rem;color:var(--muted);margin-top:.15rem}
.trend{padding:.3rem .95rem .9rem;overflow-x:auto}
.legend{display:flex;gap:1rem;font-size:.75rem;color:var(--muted);padding:0 .95rem .8rem}
.legend span{display:inline-flex;align-items:center;gap:.35rem}
.dot{width:10px;height:10px;display:inline-block;border-radius:2px}
/* Runs: eine Zeile pro Run (GitHub-Actions-Liste) */
.run{display:flex;align-items:center;gap:.7rem;padding:.6rem .95rem;
border-top:1px solid var(--border)}
.run:first-child{border-top:0}
.run:hover{background:var(--surface)}
.run .ico{width:16px;height:16px;font-size:10px}
.run .rid{font-weight:600;flex:0 0 auto}
.run .meta{color:var(--muted);font-size:.82rem;flex:1;min-width:0;overflow:hidden;
text-overflow:ellipsis;white-space:nowrap}
.run .cnt{font-size:.82rem;color:var(--muted);font-variant-numeric:tabular-nums;flex:0 0 auto}
.run .cnt .ok{color:var(--green)}.run .cnt .bad{color:var(--red)}
.run .rdur{color:var(--muted);font-size:.82rem;flex:0 0 auto;font-variant-numeric:tabular-nums;
min-width:3.5rem;text-align:right}
"""


def _fmt_dur(ms: int) -> str:
    if ms < 1000:
        return f"{ms} ms"
    return f"{ms / 1000:.1f} s"


def _icon(status: str) -> str:
    color, glyph = STATUS_META.get(status, ("#000", "?"))
    return f'<span class="ico" style="background:{color}">{glyph}</span>'


def _shell(title: str, body: str) -> str:
    return (
        f'<!doctype html><html lang="de"><head><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{html.escape(title)}</title><style>{CSS}</style></head>"
        f'<body><div class="wrap">{body}</div></body></html>'
    )


def _group_by_suite(tests: list[dict]):
    """Liefert [(suite, [steps...])] in Reihenfolge des ersten Auftretens."""
    order: list[str] = []
    groups: dict[str, list[dict]] = {}
    for t in tests:
        suite = t.get("suite", "")
        if suite not in groups:
            groups[suite] = []
            order.append(suite)
        groups[suite].append(t)
    return [(s, groups[s]) for s in order]


def write_json(doc: dict, json_dir: Path, run_id: str) -> Path:
    json_dir.mkdir(parents=True, exist_ok=True)
    path = json_dir / f"{run_id}.ctrf.json"
    path.write_text(json.dumps(doc, indent=2))
    return path


def render_detail(doc: dict, html_dir: Path, run_id: str) -> Path:
    r = doc["results"]
    s = r["summary"]
    env = r["environment"]
    run_status = env.get("runStatus", "passed")

    jobs = []
    for suite, steps in _group_by_suite(r["tests"]):
        rows = []
        for t in steps:
            dur = _fmt_dur(t["duration"])
            ran = "trace" in t  # passed/failed -> aufklappbar; skipped nicht
            if ran:
                head = (
                    f"$ exit {t['exitCode']}\n" if t.get("exitCode") is not None else ""
                )
                log = (t.get("trace") or "").strip()
                body = html.escape(head) + (html.escape(log) or "(keine Ausgabe)")
                rows.append(
                    f'<details class="step"><summary><span class="chev">▶</span>'
                    f'{_icon(t["status"])}<span class="name">{html.escape(t["name"])}</span>'
                    f'<span class="dur">{dur}</span></summary>'
                    f'<pre class="log">{body}</pre></details>'
                )
            else:
                rows.append(
                    f'<div class="step-row"><span class="chev">▶</span>'
                    f'{_icon(t["status"])}<span class="name">{html.escape(t["name"])}</span>'
                    f'<span class="dur">{dur}</span></div>'
                )
        jobs.append(f'<div class="job-head">{html.escape(suite)}</div>{"".join(rows)}')

    color = STATUS_COLOR.get(run_status, "#000")
    total = (s["stop"] - s["start"]) / 1000
    body = (
        f"<h1>{_icon(run_status)} {html.escape(env['buildName'])} "
        f'<span class="badge" style="background:{color}">{run_status}</span></h1>'
        f'<div class="sub"><a href="../runs.html">← alle Laeufe</a> &nbsp;&middot;&nbsp; '
        f'<code class="mono">{html.escape(run_id)}</code> &middot; '
        f'{html.escape(env["branch"])} @ <span class="mono">{html.escape(env["commit"])}</span> '
        f"&middot; trigger: {html.escape(env['trigger'])} &middot; "
        f"{s['passed']} passed / {s['failed']} failed / {s['skipped']} skipped &middot; {total:.1f}s</div>"
        f'<div class="card"><div class="card-h">Steps</div>{"".join(jobs)}</div>'
    )
    out_dir = html_dir / run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "index.html"
    out_path.write_text(_shell(f"localci · {run_id}", body))
    return out_path


def _trend_svg(runs_desc: list[dict], limit: int = 40) -> str:
    """Inline-SVG-Balkengraph der Laeufe ueber die Zeit (alt -> neu, links -> rechts)."""
    runs = list(reversed(runs_desc[:limit]))  # chronologisch
    if not runs:
        return '<div class="trend">keine Laeufe</div>'
    bw, gap, maxh, pad = 16, 7, 90, 10
    max_dur = max((rn["duration"] for rn in runs), default=1) or 1
    width = pad * 2 + len(runs) * (bw + gap)
    bars = []
    for i, rn in enumerate(runs):
        h = max(4, round(rn["duration"] / max_dur * maxh))
        x = pad + i * (bw + gap)
        y = pad + (maxh - h)
        color = STATUS_COLOR.get(rn["status"], "#999")
        ts = (
            datetime.fromtimestamp(rn["start"] / 1000, timezone.utc).strftime(
                "%Y-%m-%d %H:%M:%SZ"
            )
            if rn["start"]
            else "?"
        )
        title = f"{rn['run_id']} — {rn['status']} — {rn['duration'] / 1000:.1f}s — {ts}"
        bars.append(
            f'<a href="./{html.escape(rn["run_id"])}/index.html">'
            f'<rect x="{x}" y="{y}" width="{bw}" height="{h}" rx="2" fill="{color}">'
            f"<title>{html.escape(title)}</title></rect></a>"
        )
    base_y = pad + maxh
    svg = (
        f'<svg width="{width}" height="{base_y + 10}" '
        f'viewBox="0 0 {width} {base_y + 10}" role="img" aria-label="Run-Verlauf">'
        f'<line x1="{pad}" y1="{base_y + 0.5}" x2="{width - pad}" y2="{base_y + 0.5}" '
        f'stroke="#30363d"/>{"".join(bars)}</svg>'
    )
    return f'<div class="trend">{svg}</div>'


def aggregate(json_dir: Path, html_out: Path) -> Path:
    """Liest alle *.ctrf.json, erzeugt runs.html. Tolerant gegen kaputte JSONs."""
    html_out.mkdir(parents=True, exist_ok=True)
    runs = []
    for jf in json_dir.glob("*.ctrf.json"):
        try:
            doc = json.loads(jf.read_text())
            r = doc["results"]
            s = r["summary"]
            env = r.get("environment", {})
            run_id = env.get("buildNumber") or jf.stem.replace(".ctrf", "")
            status = "failed" if s.get("failed", 0) > 0 else "passed"
            runs.append(
                {
                    "run_id": run_id,
                    "status": status,
                    "start": s.get("start", 0),
                    "branch": env.get("branch", "?"),
                    "commit": env.get("commit", "?"),
                    "trigger": env.get("trigger", "?"),
                    "passed": s.get("passed", 0),
                    "failed": s.get("failed", 0),
                    "skipped": s.get("skipped", 0),
                    "duration": s.get("stop", 0) - s.get("start", 0),
                    "steps": r.get("tests", []),
                }
            )
        except (json.JSONDecodeError, KeyError, TypeError, OSError):
            continue  # kaputte/leere Datei ueberspringen
    runs.sort(key=lambda x: x["start"], reverse=True)

    rows = []
    for run in runs:
        color = STATUS_COLOR.get(run["status"], "#000")
        ts = (
            datetime.fromtimestamp(run["start"] / 1000, timezone.utc).strftime(
                "%Y-%m-%d %H:%M:%SZ"
            )
            if run["start"]
            else "?"
        )
        # Eine Zeile pro Run (GitHub-Actions-Liste).
        rid = html.escape(run["run_id"])
        rows.append(
            f'<div class="run">{_icon(run["status"])}'
            f'<a class="rid mono" href="./{rid}/index.html">{rid}</a>'
            f'<span class="meta">{html.escape(run["branch"])}@'
            f'<span class="mono">{html.escape(run["commit"])}</span> · '
            f"{html.escape(run['trigger'])} · {ts}</span>"
            f'<span class="cnt"><span class="ok">{run["passed"]}</span> / '
            f'<span class="bad">{run["failed"]}</span></span>'
            f'<span class="rdur">{run["duration"] / 1000:.1f}s</span></div>'
        )

    n = len(runs)
    passed_n = sum(1 for rn in runs if rn["status"] == "passed")
    rate = f"{passed_n / n * 100:.0f}%" if n else "–"
    last = runs[0]["status"] if runs else "–"
    legend = (
        '<div class="legend">'
        f'<span><i class="dot" style="background:{STATUS_COLOR["passed"]}"></i>passed</span>'
        f'<span><i class="dot" style="background:{STATUS_COLOR["failed"]}"></i>failed</span>'
        "<span>Balkenhoehe = Dauer · links alt → rechts neu</span></div>"
    )
    body = (
        f"<h1>localci</h1>"
        f'<div class="sub">{n} Laeufe · Erfolgsquote {rate} · letzter Lauf: {last}</div>'
        f'<div class="card"><div class="card-h">Verlauf</div>'
        f'<div class="stats">'
        f'<div><b>{n}</b><div class="lbl">Laeufe</div></div>'
        f'<div><b>{rate}</b><div class="lbl">passed</div></div>'
        f'<div><b>{passed_n}/{n - passed_n}</b><div class="lbl">passed / failed</div></div></div>'
        f"{_trend_svg(runs)}{legend}</div>"
        f'<div class="card"><div class="card-h">Neueste Laeufe</div>'
        f"{''.join(rows) or '<div style=padding:.9rem>keine Laeufe</div>'}</div>"
    )
    out = html_out / "runs.html"
    out.write_text(_shell("localci — alle Laeufe", body))
    return out


def update_global_overview() -> str | None:
    """Best-effort: globale Repo-Uebersicht (~/GITHUB/runs-overview.html) aktualisieren.

    Aggregator-Pfad via LOCALCI_OVERVIEW (Default ~/GITHUB/localci-overview.py).
    Fehlt das Script oder schlaegt der Aufruf fehl, wird still uebersprungen — das
    Reporting des Einzel-Repos darf nie an der Uebersicht haengen.
    """
    script = os.environ.get(
        "LOCALCI_OVERVIEW", os.path.expanduser("~/GITHUB/localci-overview.py")
    )
    if not os.path.isfile(script):
        return None
    try:
        subprocess.run(
            ["uv", "run", "--script", script],
            check=False,
            capture_output=True,
            timeout=60,
        )
        return script
    except (OSError, subprocess.SubprocessError):
        return None


# --------------------------------------------------------------------------- #
# Dry run
# --------------------------------------------------------------------------- #
def print_plan(config: dict, args: argparse.Namespace) -> None:
    print(f"Plan fuer Pipeline '{config['name']}' (dry-run):")
    pipeline_failed = False  # optimistischer Plan
    for stage in config["stages"]:
        is_gate = bool(stage.get("gate", False))
        when = stage.get("when", "always")
        runs = should_run(
            when,
            pipeline_failed,
            args.gate_only,
            is_gate,
            args.stage,
            stage["name"],
            args.no_deploy,
        )
        tag = "RUN " if runs else "skip"
        gate = " [gate]" if is_gate else ""
        print(f"  [{tag}] stage '{stage['name']}' (when={when}){gate}")
        for step in stage["steps"]:
            print(f"          - {step['name']}: {step['run']}")


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def cmd_run(args: argparse.Namespace) -> int:
    config_path = Path(os.environ.get("LOCALCI_CONFIG", args.config))
    config = load_config(config_path)

    if args.dry_run:
        print_plan(config, args)
        return EXIT_PASSED

    args.run_id = make_run_id()
    reports = Path(os.environ.get("LOCALCI_REPORTS_DIR", "reports"))
    json_dir = reports / "json"
    html_dir = reports / "html"

    print(f"localci run · {config['name']} · {args.run_id}")
    doc = execute(config, args)

    # Reporting laeuft IMMER (auch bei Fehlschlag) — built-in, when:always.
    json_path = write_json(doc, json_dir, args.run_id)
    detail = render_detail(doc, html_dir, args.run_id)
    runs_html = aggregate(json_dir, html_dir)
    overview = update_global_overview()  # best-effort, ueber alle ~/GITHUB-Repos

    run_status = doc["results"]["environment"]["runStatus"]
    print(f"  JSON   : {json_path}")
    print(f"  Report : {detail}")
    print(f"  Uebersicht: {runs_html}")
    if overview:
        print("  Global : ~/GITHUB/runs-overview.html")
    print(f"  Run-Status: {run_status}")

    if args.publish or os.environ.get("LOCALCI_PUBLISH") == "1":
        print(
            "  [publish] GitHub-Pages-Publish ist bewusst NICHT automatisiert "
            "(Human-Oversight) — Reports liegen unter reports/html/."
        )

    return EXIT_PASSED if run_status == "passed" else EXIT_FAILED


def cmd_aggregate(args: argparse.Namespace) -> int:
    json_dir = Path(args.json_dir)
    html_out = Path(args.html_out)
    if not json_dir.is_dir():
        err(f"JSON-Verzeichnis nicht gefunden: {json_dir}")
        return EXIT_CONFIG
    out = aggregate(json_dir, html_out)
    print(f"runs.html erzeugt: {out}")
    return EXIT_PASSED


def main() -> int:
    p = argparse.ArgumentParser(prog="localci")
    sub = p.add_subparsers(dest="command", required=True)

    pr = sub.add_parser("run", help="Pipeline ausfuehren")
    pr.add_argument("--config", default=".localci/pipeline.yml")
    pr.add_argument(
        "--gate-only", action="store_true", help="nur gate-Stages (fuer pre-push-Hook)"
    )
    pr.add_argument("--stage", default=None, help="nur diese Stage")
    pr.add_argument(
        "--no-deploy", action="store_true", help="on_success-Stages ueberspringen"
    )
    pr.add_argument("--dry-run", action="store_true", help="Plan zeigen, nichts tun")
    pr.add_argument("--publish", action="store_true", help="nach Aggregation publishen")
    pr.set_defaults(func=cmd_run)

    pa = sub.add_parser("aggregate", help="runs.html aus JSONs erzeugen")
    pa.add_argument("json_dir")
    pa.add_argument("html_out")
    pa.set_defaults(func=cmd_aggregate)

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
