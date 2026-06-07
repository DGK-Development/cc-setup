# cc-setup Orchestrator-Workflow

Lokaler pi-Dispatcher (gemma4:12b-mlx) sequenziert Backlog-Tasks durch eine feste Pipeline.
Intelligenzlastige Schritte werden an spezialisierte Claude Agent SDK Worker delegiert.

Verweis: Vollständige Architektur + Flag-Mapping in `specs/spec-pi-orchestrator-workflow.md`.
ADR: `knowledge/decisions.md` (ADR 004).

---

## Voraussetzungen

| Abhängigkeit | Zweck |
|---|---|
| `pi` auf `$PATH` | Dispatcher-Runtime (github.com/earendil-works/pi) |
| Ollama lokal mit `gemma4:12b-mlx` | Schwaches lokales Modell für Sequenzierung |
| `ANTHROPIC_API_KEY` gesetzt | claude -p Worker (planner/builder/reviewer) |
| `bun` auf `$PATH` | Worker-Spawn via `scripts/cc-dispatch.ts` |
| `just`, `jq` auf `$PATH` | Gate-Runner und Hilfs-Skripte |

---

## Starten

```bash
# Nächsten "To Do"-Task automatisch wählen:
just orchestrate

# Kontext-Hinweis auf einen bestimmten Task:
just orchestrate CCS-042
```

Hinter dem Recipe steht:
```
pi --provider ollama --model gemma4:12b-mlx \
   -e .pi/extensions/damage-control.ts \
   -e .pi/extensions/cc-orchestrator.ts \
   --no-builtin-tools \
   -p "Start orchestrator pipeline [for task <id>]"
```

---

## Pipeline

```
PICK   backlog_next → backlog_set <id> "In Progress"
SPEC   dispatch_worker(planner, <task+kontext>)
         Bei OPEN QUESTION im Output → request_human → STOP
GATE₀  request_human(GATE0_SPEC, ...)          <<< HUMAN: Spec freigeben >>>
DEV    dispatch_worker(builder, <plan>)
GATE₁  run_gates()
         Fail + Retries <= MAX → builder erneut mit Gate-Log
         Fail + Retries überschritten → request_human → STOP
REVIEW dispatch_worker(reviewer, <diff+AC>)
         REJECT + Retries <= MAX → builder + run_gates erneut
         REJECT + Retries überschritten → request_human → STOP
DONE   mark_done(id, ac_indices, final_summary)
         Nur nach grünem Gate + APPROVE (code-seitig erzwungen)
HUMAN  git push / Merge → manuell, nach menschlichem Review
```

---

## Die 6 Orchestrator-Tools

| Tool | Pipeline-Schritt | Beschreibung |
|---|---|---|
| `backlog_next` | PICK | Nächster "To Do"-Task; setzt Caps-State zurück |
| `backlog_set` | PICK, DONE | Setzt Task-Status über `backlog`-CLI |
| `dispatch_worker` | SPEC, DEV, REVIEW | Spawnt planner/builder/reviewer Worker via `bun scripts/cc-dispatch.ts` |
| `run_gates` | GATE₁ | Deterministischer Gate-Runner (`just test` + Build); gibt `{pass, failed, log}` zurück |
| `request_human` | GATE₀, Intervention | Pausiert Pipeline, schreibt `.pi/orchestrator-state.json`, sendet ntfy-Push |
| `mark_done` | DONE | Setzt AC, Final Summary, Status=Done; ruft code-seitig `run_gates` vor Done |

Der Dispatcher hat **keine** Code-Tools (kein read/write/edit/bash) — `setActiveTools` beschränkt ihn auf diese 6.

---

## Die 3 Worker-Rollen

| Rolle | Tools | Aufgabe |
|---|---|---|
| `planner` | read, grep, find, ls | Analysiert Task; produziert nummerierten Plan + geschärfte AC + Dateien + Risiken. Keine Datei-Änderungen. Bei Unklarheit: `OPEN QUESTION: …` |
| `builder` | read, write, edit, bash, grep, find, ls | Implementiert exakt den freigegebenen Plan. Lokaler Commit (nur eigene Dateien, kein `-A`, kein push). Bash via `redactor wrap --`. |
| `reviewer` | read, bash, grep, find, ls | Reviewt Diff auf Bugs/Security/Style/AC-Erfüllung. Verdict: `APPROVE` oder `REJECT` + nummerierte Findings. Keine Datei-Änderungen. |

Rollen-Definitionen: `.pi/agents/{planner,builder,reviewer}.md`.
Jeder Worker = eigener Prozess/eigene Session (Org-Regel: Entwicklung ≠ Review in derselben Session).

---

## Spec-Gate freigeben / abbrechen

Nach `request_human` pausiert die Pipeline und schreibt den Zustand nach `.pi/orchestrator-state.json`.

```bash
# Freigeben (approve):
touch .pi/orchestrator-resume

# Abbrechen (cancel):
touch .pi/orchestrator-resume-cancel

# Danach pi erneut starten:
just orchestrate [<task-id>]
```

Eine ntfy-Push-Benachrichtigung wird beim Pausieren gesendet (best-effort, erfordert `NTFY_TOKEN`).

---

## Kill-Switch (sofortiger Abbruch)

```bash
# Pipeline sofort stoppen (kein Done wird gesetzt):
touch .pi/orchestrator.kill

# Stale Lock manuell bereinigen (wenn Prozess abgestürzt):
rm .pi/orchestrator.lock

# Nach Bereinigung:
rm .pi/orchestrator.kill
just orchestrate
```

---

## Safety-Caps

Alle Caps sind code-seitig erzwungen (in `.pi/extensions/cc-orchestrator.ts`):

| Cap | Default | Bedeutung |
|---|---|---|
| `MAX_DEV_RETRIES` | 2 | Max. Builder-Retry-Zyklen bei Gate-Fail |
| `MAX_REVIEW_RETRIES` | 1 | Max. Builder-Retries bei Reviewer-REJECT |
| `MAX_COST_USD_PER_TASK` | $5.00 | Kostenlimit pro Task |
| `MAX_WALL_CLOCK_PER_TASK` | 900 s | Zeitlimit pro Task |

Cap-Überschreitung → `request_human` → Pipeline pausiert, Status bleibt "In Progress", nie "Done".

---

## Weiterführend

- Vollständige Architektur + Flag-Mapping: `specs/spec-pi-orchestrator-workflow.md`
- ADR (Warum agent-team, SDK, Env-Gating, settingSources): `knowledge/decisions.md` (ADR 004)
- End-to-End Dry-Run Report: `knowledge/orchestrator-dry-run-report.md`
- Worker-Dispatch-Code: `scripts/cc-dispatch.ts`
- Orchestrator-Extension: `.pi/extensions/cc-orchestrator.ts`
