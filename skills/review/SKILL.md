---
name: review
description: Router fuer Vault-Reviews. Nutzt `skripte/review-routing-audit.py` als kanonische Gate-Quelle und delegiert dann in Daily, Weekly, Monthly, Initial Task Audit, Reference Review oder Claude-Code-Development Review.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, TaskCreate, TaskUpdate, TaskList, TaskGet
model: sonnet
user-invocable: true
---

# Review Skill

`/review` ist der Management-Router. Die Route wird aus bestehenden Feldern berechnet, nicht als eigener Workflow-State gespeichert.

## Commands

```text
/review             # Routing-Preflight, dann passende Lane
/review routing     # Nur read-only Gate-Report
/review daily       # Daily Lane
/review weekly      # Weekly Lane
/review monthly     # Monthly Lane
/review references  # Reference-Notiz / Reference-Ingest Review
/review code        # Claude-Code Development Lane
```

## Source of Truth

Kanonisches Routing-Modul:

```bash
redactor wrap -- uv run python3 skripte/review-routing-audit.py --scope all --format summary --limit 40
```

### Nach Route filtern (bevorzugt — kein JSON-Parsing)

Mit `--route` (kommagetrennt) direkt eine Gate-Gruppe holen. **Erst auditieren, dann abarbeiten:**

```bash
# 1. Was muss auditiert werden (Pflichtfelder fehlen)?
redactor wrap -- uv run python3 skripte/review-routing-audit.py --scope tasks --route task-audit-needed --limit 200
# 2. Was kann ich jetzt abarbeiten?
redactor wrap -- uv run python3 skripte/review-routing-audit.py --scope tasks --route task-action --limit 50
# Mehrere Routen zugleich:
redactor wrap -- uv run python3 skripte/review-routing-audit.py --scope tasks --route task-question,task-blocked,task-verify --limit 50
# CC-Tasks (mit tracks):
redactor wrap -- uv run python3 skripte/review-routing-audit.py --scope tasks --route task-cc-action --limit 50
```

Weitere Varianten:

```bash
redactor wrap -- uv run python3 skripte/review-routing-audit.py --scope references --route reference-ingest --limit 40
redactor wrap -- uv run python3 skripte/review-routing-audit.py --scope topics --route topic-parent,topic-develop --limit 40
redactor wrap -- uv run python3 skripte/review-routing-audit.py --path <file-or-folder> --format markdown --all
```

> **Output-Format:** `--format summary` (Default) ist text. `--format json` liefert ein **Array** von Route-Objekten (`[{path, route, actor, next_action, ...}]`) — KEIN `{items:[...]}`-Wrapper. Fuer gezielte Filter `--route` nutzen statt JSON nachzuparsen.

Task-Routen (in Abarbeitungs-Reihenfolge): `task-audit-needed` → `task-question` → `task-blocked` → `task-action` → `task-cc-action` → `task-verify` → `task-plan`. Terminal/ignorierbar: `task-deferred`, `task-done`, `calendar-event`.

Keine neuen `taskflow_*` Felder einfuehren. Gates werden aus `type`, `kind`, `status`, `nextActor`, `tracks`, `migrated_at` und Links abgeleitet. **`status` ist die Pipeline-Achse** (v1, siehe [[tasknote-frontmatter-syntax-v1]]).

## Lane Selection

Wenn der User eine Lane explizit nennt, direkt diese Lane ausfuehren.

Ohne explizite Lane:

1. Routing-Preflight laufen lassen.
2. Wenn `task-audit-needed` vorkommt, Initial Task Audit fuer die relevantesten Tasks starten.
3. Wenn die Anfrage Code/Spec/Issue/PR/CI nennt oder `task-cc-action` (Tasks mit `tracks`) betroffen ist, `/review code`.
4. Wenn die Anfrage References, YouTube, `notiz`, `migrated_at` oder `reference-*` nennt, `/review references`.
5. Sonst time-based: monthly > weekly > daily.

## Initial Task Audit

Ziel: aktive Tasks unmittelbar handlungsfaehig machen. Ein Task ist auditiert, wenn **alle** Pflichtfelder gesetzt sind — dann verlaesst er `status: audit`.

Pflichtfelder (v1):

```yaml
nextAction: "Verb + konkretes Target"
nextActor: user | claude | external
scheduled: <date|datetime>     # wann arbeite ich dran (Slot)
due: <date|datetime>           # Deadline
timeEstimate: <int>            # Minuten
status: audit | question | plan | action | verify | blocked | deferred | done | cancelled
reviewed_at: "YYYY-MM-DDTHH:mm:ss+02:00"
```

`status` ersetzt das alte `reviewClassification` — der Status IST die Pipeline-Position. Calendar braucht nur `due` + `timeEstimate` (kein `scheduled`/`nextAction`).

Status-Bedeutung:

| status | Bedeutung |
|---|---|
| `audit` | Pflichtfelder fehlen / muss geprueft werden |
| `question` | offene Frage blockiert |
| `plan` | Slot gesetzt, noch nicht dran |
| `action` | dran / startbereit |
| `verify` | Ergebnis liegt vor, Sign-off/Merge offen |
| `blocked` | extern blockiert |
| `deferred` | Someday/Maybe |

Regeln:

- Body-aware auditieren; nicht nur Frontmatter lesen.
- Keine Bulk-Klassifikation mit generischen `nextAction`-Texten.
- Wenn eine Entscheidung fehlt, `type: question` Note in `<project>/questions/` erstellen → `status: question`.
- Jede materielle Statusaenderung bekommt einen kurzen `## Task-Changelog` Eintrag.
- Bei vielen Tasks projektweise arbeiten und nach jedem Projekt Ergebnis zeigen.

Quality-Bar fuer `nextAction`: Verb + Datei/Befehl/Person/Deliverable. Verboten sind Titel-Paraphrasen wie "Fortsetzen: <title>".

## Reference Review

Read-only Phase:

```bash
redactor wrap -- uv run python3 skripte/review-reference-notizen.py --format summary
redactor wrap -- uv run python3 skripte/review-reference-notizen.py --format markdown
```

Routing fuer Ingest/Rebind:

```bash
redactor wrap -- uv run python3 skripte/review-routing-audit.py --scope references --format summary --limit 40
```

In Phase 1 keine Tasks, Topics oder Frontmatter schreiben. Bei Phase 2 erst Conversion-Policy bestaetigen: Question, Task, Topic, Topic-Update oder ignorieren.

## Claude-Code Development Review

Nutzen wenn ein Task `tracks` (Links auf `github-issue` / `github-pr` Notes) hat oder Spec, GitHub Issue, PR, CI oder Review betroffen sind. Route `task-cc-action`.

**v1:** Keine `cc_*` Felder mehr. Der Task verlinkt via `tracks` auf die github-issue/pr-Notes; CI/Review/Merge-Status lebt in der PR-Note (`ci_status`, `review_status`, `merged`). Die CC-Substage wird daraus abgeleitet:

| cc-Substage (abgeleitet) | Naechster Schritt |
|---|---|
| `spec` | finale ausfuehrbare Spec erstellen/verlinken (noch kein issue/pr in `tracks`) |
| `issue` | GitHub Issue Execution Envelope erstellen/verlinken |
| `pr` | spec-to-pr Routine triggern oder PR-Trace aktualisieren |
| `ci-fix` | scoped CI-Fix (PR-Note `ci_status: failure`) |
| `review-fix` | Review-Findings beheben (PR-Note `review_status: findings`) |
| `merge` | Merge dokumentieren, Task auf `verify`→`done` |

Schreibregeln:

- Task ist Dashboard-Source-of-Truth; `status` zeigt die Pipeline-Position.
- CI/Review/Merge-Status wird in der `github-pr`-Note gepflegt, nicht im Task.
- Externe Artefakte werden via `tracks` im Task verlinkt.
- Claude setzt `status: done` erst nach sichtbarem User-Merge.

## Daily / Weekly / Monthly

Diese Lanes werden nicht hier dupliziert:

- Daily: `.claude/skills/daily/SKILL.md`
- Weekly: `.claude/skills/weekly/SKILL.md`
- Monthly: `.claude/skills/monthly/SKILL.md`
- Effort Scan: `.claude/skills/daily-review/SKILL.md`

Der Review-Router nennt nur die erkannte Lane und folgt dann dem Ziel-Skill.

## Output

Kurz und task-zentriert:

```markdown
### Review Router

Detected: <lane>
Route source: `skripte/review-routing-audit.py`

| Artifact | Route | Next |
|---|---|---|
| ... | `task-audit-needed` | ... |

Next action:
- ...
```
