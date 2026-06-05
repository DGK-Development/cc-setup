---
name: daily-review
description: Daily Recap fuer den Obsidian-Vault — scannt Efforts/ nach ueberfaelligen Tasks/Terminen und waiting-Items ohne scheduled, gruppiert nach Projekt + Status, schlaegt Bulk-Aktionen vor (status=done, clear-scheduled, reschedule). Aendert Frontmatter atomic und schreibt CHANGELOG-Eintraege. USE WHEN daily review, daily recap, ueberfaellige tasks, warum nicht erledigt, reschedule, reminder fuer waiting, blocked tasks, sprint cleanup, /daily-review.
---

# /daily-review

Interaktiver Daily Recap. Bucket-Logik adaptiert aus `relations-projectview`
(`Atlas/Reference/Repos/relations-projectview/src/core/buckets.ts`).

## Quick Start (so fuehrst du den Skill aus)

```bash
# Skript ist via uv-shebang direkt ausfuehrbar.
# Im Vault-Root:
uv run skripte/daily-review.py --format summary    # Uebersicht
uv run skripte/daily-review.py > /tmp/dr.json      # Vollscan als JSON
```

**Strict-Mode-Vault:** Wenn der Vault `redactor strict mode` aktiv hat, jeden
Aufruf mit `redactor wrap -- uv run ...` praefixen. JSON-Output kann
sensible Pfade (z.B. mit token-like Substrings) maskieren — bei Faellen wo
ein Pfad als `<redacted:...>` erscheint, direkt mit Read/Glob auf den
echten Dateinamen pruefen oder ein Python-Helper-Skript schreiben statt
Bash-Pipeline (siehe "Bulk-Operationen" unten).

## Was der Skill liefert

Scant `Efforts/` (rekursiv, ohne `Atlas/Reference/Repos`) nach Notizen mit
`type: task | calendar` bzw. `tags: [task, ...]` und klassifiziert in:

| Bucket | Bedingung |
|---|---|
| `overdue_tasks` | `scheduled < heute`, type=task, status nicht done/cancelled/archived |
| `overdue_calendar` | Termine in der Vergangenheit, noch nicht abgehakt |
| `waiting_no_sched` | Status `blocked|question|verify` und **kein** scheduled (Bucket 2 "Wiedervorlage fehlt") |
| `today_calendar` | type=calendar, scheduled == heute |
| `upcoming_calendar` | type=calendar, scheduled in [heute+1, heute+7] |
| `day_density` | `{YYYY-MM-DD: count}` der Termine in [heute, heute+7] |

Jedes Item enthaelt einen `suggested_scheduled` Vorschlag (Werktag-basiert,
Calendar-Density-aware):

- `urgent` → naechster Werktag
- `high` → ruhiger Werktag (max. 1 Event) in den naechsten 3 Werktagen, sonst +2 WT
- `normal` → ruhiger Werktag (max. 2 Events) in den naechsten 5 Werktagen, sonst +3 WT
- `low` → +5 Werktage

## Skript: `skripte/daily-review.py`

Self-contained Python mit uv-shebang (`#!/usr/bin/env -S uv run --script`).
Vier Subcommands plus Default-Scan:

| Aufruf | Wirkung |
|---|---|
| `uv run skripte/daily-review.py` | Scan + JSON nach stdout |
| `uv run skripte/daily-review.py --format summary` | Scan + 5-Zeilen-Summary |
| `uv run skripte/daily-review.py set-scheduled <relpath> <YYYY-MM-DD>` | Setzt scheduled (atomic write) |
| `uv run skripte/daily-review.py clear-scheduled <relpath>` | Entfernt scheduled (fuer "muss neu geprueft werden") |
| `uv run skripte/daily-review.py set-status <relpath> <status>` | Setzt status (v1: audit/question/plan/action/verify/blocked/deferred/done/cancelled) |
| `uv run skripte/daily-review.py append-changelog <relpath> --note "<text>"` | Fuegt `- YYYY-MM-DD HH:MM — <note>` unter `## CHANGELOG` ein (jungste oben) |

Alle Write-Operationen sind atomic (tmp + rename) und Symlink-geschuetzt
(Pfad muss unter Vault-Root aufloesen).

## Workflow

### Schritt 1 — Scan und Lage zeigen

```bash
uv run skripte/daily-review.py --format summary
uv run skripte/daily-review.py > /tmp/dr.json
```

Zeige dem User:

1. **Heute (today_calendar)** + **Naechste 7 Tage (upcoming_calendar)** — kontextualisiert den Tag.
2. **day_density** — welche Tage sind voll, welche frei.
3. **Breakdown** der Buckets nach Projekt, Status, Prioritaet (Top-N).
4. **Relevante Dateien** zeigen: bei Bulk-Vorschlaegen die jeweiligen Pfade
   listen, damit der User sie im Vault auf einen Klick oeffnen kann.

Bei vielen Items (>20) **nicht 1-by-1 fragen** — direkt Bulk-Strategie vorschlagen.

### Schritt 2 — Bulk-Aktionen vorschlagen

Typische Patterns (aus echten Sessions abgeleitet):

**Pattern A — Sprint-Tasks unter falschem Datum:** Eine Gruppe Tasks
(z.B. 20+ aus einem Projekt) liegt alle auf demselben alten scheduled-Datum.
Riecht nach altem Sprint-Snapshot. Vorschlag: `clear-scheduled` fuer alle,
gesonderte Pruefung im naechsten Schritt durch User.

**Pattern B — Abgeschlossenes Projekt:** Alle verify/blocked Tasks
eines Projekts (z.B. CC Agent Dashboard) gehoeren zu fertigem Workstream.
Vorschlag: `set-status done` fuer alle.

**Pattern C — Echter Daily-Recap (kleine Anzahl):** <10 Items, 1-by-1
durchgehen mit Reason-Frage + Reschedule-Vorschlag aus `suggested_scheduled`.

### Schritt 3 — Bestaetigung holen

Konkreten Plan zeigen mit Zahlen + Pfaden, dann User bestaetigen lassen.
**Nicht** `AskUserQuestion` wenn User schon klare Anweisungen gibt — direkt
ausfuehren.

### Schritt 4 — Apply

Zwei Wege je nach Volumen:

**Single-Items** (handvoll):
```bash
redactor wrap -- uv run skripte/daily-review.py set-status "<relpath>" done
redactor wrap -- uv run skripte/daily-review.py clear-scheduled "<relpath>"
redactor wrap -- uv run skripte/daily-review.py set-scheduled "<relpath>" 2026-05-19
redactor wrap -- uv run skripte/daily-review.py append-changelog "<relpath>" --note "<reason>"
```

**Bulk** (>10 Items): Helper-Skript nach `/tmp/dr_apply.py` schreiben, das
die Pfadliste iteriert und `subprocess.run([...])` aufruft. Vorteil: alle
Errors gesammelt, ein einziges Tool-Call statt 50.

```python
# /tmp/dr_apply.py — Schablone
import json, subprocess
from pathlib import Path

VAULT = Path("/Users/niclasedge/GITHUB/ObsidianPKM")
SCRIPT = VAULT / "skripte/daily-review.py"

paths = json.load(open("/tmp/dr_done.json"))  # vorher generiert
for p in paths:
    subprocess.run(
        ["uv", "run", str(SCRIPT), "set-status", p, "done"],
        cwd=str(VAULT), check=True,
    )
```

Aufruf: `redactor wrap -- uv run python3 /tmp/dr_apply.py`.

### Schritt 5 — Verifikation + Abschluss

```bash
uv run skripte/daily-review.py --format summary
```

Zeige Delta: vorher 53 overdue + 59 waiting → nachher X + Y.
Liste ggf. excluded Items (z.B. wenn Pattern A nur hir-*-Files anpacken
wollte, aber Project-Filter auch FlaggedMails/Kalender einschloss).

## User-Antwort-Mapping bei Einzeldialog (Pattern C)

Format:

```
[OVERDUE 14d] high  ssl-017 · IT Software Laufzettel · status=blocked
  Title:    Retention Policy erstellen
  blockedBy: ssl-002-power-automate-premium-lizenz
  Vorschlag: 2026-05-15 (high: ruhiger Werktag, 0 Events)

  Was hat es geblockt / warum nicht erledigt? [skip/done/reason]:
  Neues scheduled? [Enter=Vorschlag / YYYY-MM-DD / skip]:
```

- `skip` → kein Write
- `done` → `set-status done` (kein scheduled-Write, kein changelog)
- Sonst (Text): `append-changelog --note "<text>"`
- Datum: Enter = Vorschlag uebernehmen | `YYYY-MM-DD` = uebersteuern | `skip` = nur Reason loggen

## CHANGELOG-Format im Task-File

```
## CHANGELOG

- 2026-05-14 09:56 — Reason-Text aus dem Daily-Review
- 2026-05-10 14:22 — Aelterer Eintrag (bleibt erhalten)
```

Jungste Eintraege oben (gleiche Konvention wie `knowledge/CHANGELOG.md`).

## JSON-Schema (was der Scan liefert)

```jsonc
{
  "today": "2026-05-14",
  "scope": "Efforts",
  "overdue_tasks": [
    {
      "path": "Efforts/.../ssl-017-...md",
      "title": "Retention Policy erstellen",
      "type": "task",
      "status": "blocked",
      "priority": "low",
      "scheduled": "2026-04-30",
      "due": null,
      "days_overdue": 14,
      "kunde": "swn",
      "project": "IT Software Laufzettel Übersicht",
      "blocked_by": ["ssl-002-..."],
      "suggested_scheduled": "2026-05-15",
      "suggestion_reason": "low: Fallback Default-Slot"
    }
  ],
  "overdue_calendar": [ /* same shape */ ],
  "waiting_no_sched": [ /* same shape, scheduled=null */ ],
  "today_calendar":  [ /* termine die heute liegen */ ],
  "upcoming_calendar": [ /* termine in [heute+1, heute+7] */ ],
  "day_density": { "2026-05-16": 1, "2026-05-20": 3 },
  "summary": { "overdue_tasks": 53, "overdue_calendar": 0, ... }
}
```

## Edge-Cases

- **Calendar-Items ohne Status** zaehlen als `open` (offen).
- **Items mit `due` aber ohne `scheduled`**: `due` wird als Effective-Date
  behandelt (zaehlt fuers Overdue-Bucket).
- **Wochenenden**: Vorschlaege ueberspringen Samstag/Sonntag.
- **Doppelte calendar-Events am gleichen Tag**: zaehlen einzeln in `day_density`,
  was ruhige Tage automatisch deprioriziert.
- **Symlink-Schutz**: alle Write-Subcommands validieren, dass der
  Zielpfad unter dem Vault-Root liegt.
- **Redactor maskiert Pfade**: Wenn ein JSON-Pfad ein
  token-like Substring enthaelt (selten, aber moeglich), wird er im
  Redactor-Output zerstoert. Dann direkt im Vault via Glob den echten
  Pfad finden und in einem Python-Helper-Skript (`uv run --with pyyaml`)
  die Datei manuell anpassen.

## Daten-Quellen

- Bucket-Logik: `Atlas/Reference/Repos/relations-projectview/src/core/buckets.ts`
  (insbes. `is_waiting && !has_scheduled` → Bucket 2 "Wiedervorlage fehlt").
- Date-Helpers: `Atlas/Reference/Repos/relations-projectview/src/core/dates.ts`.
- Frontmatter-Schema: `Atlas/Reference/Repos/relations-projectview/src/types.ts` (TaskFM).

## Nicht im Scope

- **Daily-Note-Checkboxen** (`- [ ] ...` ohne Frontmatter) — zu unstrukturiert.
- **TaskMD-Tasks unter `tasks/`** ohne `tags: [task]` im Frontmatter werden
  ggf. uebersehen. Die meisten Vault-Tasks haben `tags: [task, work]` drin;
  sonst `--scope tasks` ergaenzen.
