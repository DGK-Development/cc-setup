# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""localci-overview — globale Uebersicht ueber alle local-ci-Repos.

Scannt <root>/*/reports/json/*.ctrf.json (Default <root> = ~/GITHUB), gruppiert
pro Repo und rendert eine einzelne runs-overview.html im GitHub-Dark-Look — eine
Karte je Repo mit Erfolgsquote, Trend-Graph und den letzten Laeufen. Verlinkt
relativ in die lokalen runs.html / Run-Detailseiten jedes Repos (file://-tauglich,
kein Server, keine Dependencies).

Aufruf:
    uv run --script localci-overview.py
    uv run --script localci-overview.py --root ~/GITHUB --out ~/GITHUB/runs-overview.html
    uv run --script localci-overview.py --ios-only

Quelle der Wahrheit bleibt das CTRF-JSON jedes Repos; dieses Script liest nur.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Status -> (Farbe, Glyph) — identisch zu localci.py (GitHub-Dark-Palette).
STATUS_META = {
    "passed": ("#3fb950", "✓"),
    "failed": ("#f85149", "✕"),
    "skipped": ("#6e7681", "–"),
    "pending": ("#d29922", "●"),
}
STATUS_COLOR = {k: v[0] for k, v in STATUS_META.items()}

# Gemeinsames CSS — GitHub-Dark-Theme, deckungsgleich mit localci.py plus
# Repo-Grid (.repos / .proj-*) fuer die Uebersichtsseite.
CSS = """
:root{--bg:#0d1117;--surface:#161b22;--surface2:#1c2128;--border:#30363d;
--text:#e6edf3;--muted:#8b949e;--accent:#2f81f7;--green:#3fb950;--red:#f85149}
*{box-sizing:border-box}
body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
margin:0;color:var(--text);background:var(--bg)}
.wrap{max-width:none;margin:0;padding:1.75rem 2rem}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
h1{font-size:1.35rem;margin:0;display:flex;align-items:center;gap:.55rem;font-weight:600}
.sub{color:var(--muted);font-size:.85rem;margin:.4rem 0 1.25rem}
.card{border:1px solid var(--border);border-radius:8px;background:var(--bg);margin-bottom:1.25rem}
.card-h{padding:.55rem .95rem;border-bottom:1px solid var(--border);background:var(--surface);
font-weight:600;border-radius:8px 8px 0 0;font-size:.82rem;color:var(--text)}
.ico{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;
border-radius:50%;color:#fff;font-size:11px;font-weight:700;flex:0 0 auto}
.stats{display:flex;gap:2rem;flex-wrap:wrap;padding:.9rem .95rem .5rem}
.stats b{font-size:1.5rem;display:block;font-weight:600;line-height:1.2}
.stats .lbl{font-size:.72rem;color:var(--muted);margin-top:.15rem}
.trend{padding:.3rem .95rem .9rem;overflow-x:auto}
.legend{display:flex;gap:1rem;font-size:.75rem;color:var(--muted);padding:0 .95rem .8rem}
.legend span{display:inline-flex;align-items:center;gap:.35rem}
.dot{width:10px;height:10px;display:inline-block;border-radius:2px}
/* Repo-Grid */
.repos{display:grid;gap:1.25rem;grid-template-columns:repeat(2,minmax(0,1fr))}
@media(max-width:900px){.repos{grid-template-columns:1fr}}
.repos .card{margin-bottom:0}
.proj-h{display:flex;align-items:center;gap:.55rem;padding:.55rem .95rem;
border-bottom:1px solid var(--border);background:var(--surface);border-radius:8px 8px 0 0}
.proj-h .ico{width:16px;height:16px;font-size:10px}
.proj-h .pname{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;
white-space:nowrap}
.proj-h .repo{color:var(--muted);font-size:.78rem;flex:0 0 auto}
.proj-rate{font-size:.78rem;color:var(--muted);font-variant-numeric:tabular-nums;flex:0 0 auto}
/* Runs: eine Zeile pro Run (GitHub-Actions-Liste) */
.run{display:flex;align-items:center;gap:.7rem;padding:.55rem .95rem;
border-top:1px solid var(--border)}
.run:hover{background:var(--surface)}
.run .ico{width:16px;height:16px;font-size:10px}
.run .rid{font-weight:600;flex:0 0 auto}
.run .meta{color:var(--muted);font-size:.82rem;flex:1;min-width:0;overflow:hidden;
text-overflow:ellipsis;white-space:nowrap}
.run .cnt{font-size:.82rem;color:var(--muted);font-variant-numeric:tabular-nums;flex:0 0 auto}
.run .cnt .ok{color:var(--green)}.run .cnt .bad{color:var(--red)}
.run .rdur{color:var(--muted);font-size:.82rem;flex:0 0 auto;font-variant-numeric:tabular-nums;
min-width:3.5rem;text-align:right}
/* Step-Kreise je Run — inline, rechts vor der Zaehlung */
.steps{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto}
.sdot{width:11px;height:11px;border-radius:50%;display:inline-block;flex:0 0 auto}
.more{padding:.5rem .95rem;font-size:.8rem}
.empty{padding:.9rem .95rem;color:var(--muted)}
"""


def _shell(title: str, body: str) -> str:
    return (
        f'<!doctype html><html lang="de"><head><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{html.escape(title)}</title><style>{CSS}</style></head>"
        f'<body><div class="wrap">{body}</div></body></html>'
    )


def _icon(status: str) -> str:
    color, glyph = STATUS_META.get(status, ("#000", "?"))
    return f'<span class="ico" style="background:{color}">{glyph}</span>'


def _fmt_ts(ms: int) -> str:
    if not ms:
        return "?"
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")


def parse_runs(json_dir: Path) -> list[dict]:
    """Liest alle *.ctrf.json eines Repos. Tolerant gegen kaputte/leere Dateien.
    Gleiche Felder wie localci.aggregate(), absteigend nach Startzeit sortiert."""
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
                    "name": env.get("buildName", ""),
                    "status": status,
                    "start": s.get("start", 0),
                    "branch": env.get("branch", "?"),
                    "commit": env.get("commit", "?"),
                    "trigger": env.get("trigger", "?"),
                    "passed": s.get("passed", 0),
                    "failed": s.get("failed", 0),
                    "duration": s.get("stop", 0) - s.get("start", 0),
                    "steps": r.get("tests", []),
                }
            )
        except (json.JSONDecodeError, KeyError, TypeError, OSError):
            continue
    runs.sort(key=lambda x: x["start"], reverse=True)
    return runs


def _trend_svg(runs_desc: list[dict], link_base: str, limit: int = 40) -> str:
    """Inline-SVG-Balkengraph (alt -> neu). Balken verlinken in die Detailseite."""
    runs = list(reversed(runs_desc[:limit]))
    if not runs:
        return '<div class="trend">keine Laeufe</div>'
    bw, gap, maxh, pad = 14, 6, 70, 10
    max_dur = max((rn["duration"] for rn in runs), default=1) or 1
    width = pad * 2 + len(runs) * (bw + gap)
    bars = []
    for i, rn in enumerate(runs):
        h = max(4, round(rn["duration"] / max_dur * maxh))
        x = pad + i * (bw + gap)
        y = pad + (maxh - h)
        color = STATUS_COLOR.get(rn["status"], "#999")
        title = (
            f"{rn['run_id']} — {rn['status']} — "
            f"{rn['duration'] / 1000:.1f}s — {_fmt_ts(rn['start'])}"
        )
        href = f"{link_base}/{html.escape(rn['run_id'])}/index.html"
        bars.append(
            f'<a href="{href}">'
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


def _step_dots(steps: list[dict]) -> str:
    """Ein Kreis je Step, eingefaerbt nach Status (rot/gruen/grau), Name im Tooltip."""
    if not steps:
        return ""
    dots = []
    for t in steps:
        st = t.get("status", "other")
        color = STATUS_COLOR.get(st, "#6e7681")
        suite = t.get("suite", "")
        name = t.get("name", "")
        label = f"{suite} / {name}" if suite else name
        dur = t.get("duration", 0)
        title = f"{label} — {st}"
        if isinstance(dur, (int, float)) and dur:
            title += f" ({dur / 1000:.1f}s)"
        dots.append(
            f'<span class="sdot" style="background:{color}" '
            f'title="{html.escape(title)}"></span>'
        )
    return f'<div class="steps">{"".join(dots)}</div>'


def _run_row(run: dict, link_base: str) -> str:
    rid = html.escape(run["run_id"])
    href = f"{link_base}/{rid}/index.html"
    return (
        f'<div class="run">{_icon(run["status"])}'
        f'<a class="rid mono" href="{href}">{rid}</a>'
        f'<span class="meta">{html.escape(run["branch"])}@'
        f'<span class="mono">{html.escape(run["commit"])}</span> · '
        f"{html.escape(run['trigger'])} · {_fmt_ts(run['start'])}</span>"
        f'{_step_dots(run.get("steps", []))}'
        f'<span class="cnt"><span class="ok">{run["passed"]}</span> / '
        f'<span class="bad">{run["failed"]}</span></span>'
        f'<span class="rdur">{run["duration"] / 1000:.1f}s</span></div>'
    )


def render_repo_card(repo: str, runs: list[dict], link_base: str, recent: int) -> str:
    """Eine Karte pro Repo: Projektname, Erfolgsquote, Trend, letzte Laeufe."""
    latest = runs[0]
    name = latest["name"] or repo
    n = len(runs)
    passed_n = sum(1 for r in runs if r["status"] == "passed")
    rate = f"{passed_n / n * 100:.0f}%"
    runs_html_link = f"{link_base}/runs.html"

    rows = "".join(_run_row(r, link_base) for r in runs[:recent])
    more = ""
    if n > recent:
        more = (
            f'<div class="more"><a href="{runs_html_link}">'
            f"alle {n} Laeufe →</a></div>"
        )

    header = (
        f'<div class="proj-h">{_icon(latest["status"])}'
        f'<a class="pname" href="{runs_html_link}">{html.escape(name)}</a>'
        f'<span class="repo mono">{html.escape(repo)}</span>'
        f'<span class="proj-rate">{passed_n}/{n} · {rate}</span></div>'
    )
    return (
        f'<div class="card">{header}'
        f"{_trend_svg(runs, link_base)}"
        f"{rows}{more}</div>"
    )


def build(root: Path, out: Path, ios_only: bool, recent: int) -> Path:
    out_dir = out.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    repos: list[tuple[str, list[dict], str]] = []
    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        if ios_only and "ios" not in entry.name:
            continue
        json_dir = entry / "reports" / "json"
        if not json_dir.is_dir():
            continue
        runs = parse_runs(json_dir)
        if not runs:
            continue
        html_dir = entry / "reports" / "html"
        link_base = os.path.relpath(html_dir, out_dir).replace(os.sep, "/")
        repos.append((entry.name, runs, link_base))

    # Repos mit dem juengsten Lauf zuerst.
    repos.sort(key=lambda x: x[1][0]["start"], reverse=True)

    total_runs = sum(len(r) for _, r, _ in repos)
    total_passed = sum(
        sum(1 for x in r if x["status"] == "passed") for _, r, _ in repos
    )
    failing_repos = sum(1 for _, r, _ in repos if r[0]["status"] == "failed")
    rate = f"{total_passed / total_runs * 100:.0f}%" if total_runs else "–"

    legend = (
        '<div class="legend">'
        f'<span><i class="dot" style="background:{STATUS_COLOR["passed"]}"></i>passed</span>'
        f'<span><i class="dot" style="background:{STATUS_COLOR["failed"]}"></i>failed</span>'
        "<span>Balkenhoehe = Dauer · links alt → rechts neu</span></div>"
    )
    scope = "iOS-Repos" if ios_only else f"alle Repos unter {root}"
    summary_card = (
        f'<div class="card"><div class="card-h">Gesamt</div>'
        f'<div class="stats">'
        f'<div><b>{len(repos)}</b><div class="lbl">Repos</div></div>'
        f'<div><b>{total_runs}</b><div class="lbl">Laeufe</div></div>'
        f'<div><b>{rate}</b><div class="lbl">passed</div></div>'
        f'<div><b>{failing_repos}</b><div class="lbl">aktuell rot</div></div></div>'
        f"{legend}</div>"
    )

    if repos:
        cards = "".join(
            render_repo_card(repo, runs, link_base, recent)
            for repo, runs, link_base in repos
        )
        grid = f'<div class="repos">{cards}</div>'
    else:
        grid = (
            '<div class="card"><div class="empty">Keine Repos mit '
            "reports/json/*.ctrf.json gefunden.</div></div>"
        )

    body = (
        f"<h1>localci · Uebersicht</h1>"
        f'<div class="sub">{scope} · '
        f"{len(repos)} Repos · {total_runs} Laeufe · Erfolgsquote {rate}</div>"
        f"{summary_card}{grid}"
    )
    out.write_text(_shell("localci — Uebersicht", body))
    return out


def main() -> int:
    p = argparse.ArgumentParser(prog="localci-overview")
    p.add_argument(
        "--root",
        default=os.path.expanduser("~/GITHUB"),
        help="Wurzelverzeichnis mit den Repos (Default ~/GITHUB)",
    )
    p.add_argument(
        "--out",
        default=None,
        help="Ausgabedatei (Default <root>/runs-overview.html)",
    )
    p.add_argument(
        "--ios-only",
        action="store_true",
        help="nur Repos mit 'ios' im Namen scannen",
    )
    p.add_argument(
        "--recent",
        type=int,
        default=5,
        help="Anzahl Laeufe je Repo-Karte (Default 5; alle via Repo-runs.html)",
    )
    args = p.parse_args()

    root = Path(args.root).expanduser()
    if not root.is_dir():
        print(f"Wurzelverzeichnis nicht gefunden: {root}", file=sys.stderr)
        return 2
    out = Path(args.out).expanduser() if args.out else root / "runs-overview.html"

    result = build(root, out, args.ios_only, args.recent)
    print(f"runs-overview.html erzeugt: {result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
