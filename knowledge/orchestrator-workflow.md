# cc-setup Orchestrator-Workflow

Lokaler pi-Dispatcher (gemma4:12b-mlx) sequenziert Backlog-Tasks durch eine feste Pipeline.
Intelligenzlastige Schritte werden an spezialisierte Claude Agent SDK Worker delegiert.

Rückfragen (Spec-Gate, OPEN QUESTION, Cap-Überschreitung) laufen **blockierend über Slack-Kanal
`C0B8R3ERUNR`**: pi stellt die Frage, wartet auf die menschliche Antwort und fährt im selben Lauf fort
(ADR 005). Das datei-basierte File-Flag-Resume bleibt als Fallback bei Slack-Timeout/Fehler.

Verweis: Vollständige Architektur + Flag-Mapping in `specs/spec-pi-orchestrator-workflow.md`.
ADR: `knowledge/decisions.md` (ADR 004 = Architektur, ADR 005 = Slack-Rückfragen + `just pi`).
Milestone: `ccs-sprint: pi-gated-agentic-workflow` (CCS-036).

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
# Geführt: fragt offene Meilensteine ab ("weiter bei X / neuer Meilenstein"),
# baut den pi-Prompt programmatisch und startet interaktives pi:
just pi

# Direkt: nächsten "To Do"-Task automatisch wählen, ohne Frage:
just orchestrate

# Direkt mit Kontext-Hinweis auf einen bestimmten Task:
just orchestrate CCS-042
```

`just pi` (Launcher `scripts/pi-launch.sh`) ist der bequeme Einstieg — es ermittelt die offenen
Meilensteine via `sprint_bridge survey`, lässt den Operator wählen und übergibt den gebauten Prompt
an dieselbe pi-Invocation wie `orchestrate`.

Hinter dem Recipe steht (interaktiv — der Prompt ist eine positionale Start-Nachricht, KEIN `-p`/`--print`, sonst liefe pi headless und öffnet kein TUI):
```
pi --provider ollama --model gemma4:12b-mlx \
   -e .pi/extensions/damage-control.ts \
   -e .pi/extensions/cc-orchestrator.ts \
   --no-builtin-tools \
   "Start orchestrator pipeline [for task <id>]"
```

---

## Pipeline

```
PICK   backlog_next → backlog_set <id> "In Progress"
SPEC   dispatch_worker(planner, <task+kontext>)
         Bei OPEN QUESTION → request_human(Slack) → Antwort einarbeiten / abort→STOP
GATE₀  request_human(GATE0_SPEC, Slack)        <<< HUMAN: Antwort im Kanal C0B8R3ERUNR >>>
         approve→DEV · Freitext→einarbeiten+erneut GATE₀ · abort→STOP
DEV    dispatch_worker(builder, <plan>)
GATE₁  run_gates()
         Fail + Retries <= MAX → builder erneut mit Gate-Log
         Fail + Retries überschritten → request_human(Slack): override→1 Retry / abort→STOP
REVIEW dispatch_worker(reviewer, <diff+AC>)
         REJECT + Retries <= MAX → builder + run_gates erneut
         REJECT + Retries überschritten → request_human(Slack): override→1 Retry / abort→STOP
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
| `request_human` | GATE₀, Intervention | Fragt blockierend über Slack-Kanal `C0B8R3ERUNR` (`scripts/slack-ask.ts`), klassifiziert die Antwort und lässt pi im selben Lauf fortfahren. Fallback bei Slack-Timeout/Fehler: `.pi/orchestrator-state.json` + ntfy + File-Flag |
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

## Rückfragen über Slack (Primärweg)

Bei `request_human` postet pi die Frage in Slack-Kanal **`C0B8R3ERUNR`** und **wartet blockierend** auf
deine Antwort (Default-Timeout 900 s). Du antwortest einfach im Kanal — pi klassifiziert die Antwort und
fährt **im selben Lauf** fort, ohne Neustart:

| Antwort | Wirkung |
|---|---|
| `ja` / `ok` / `approved` / `weiter` … | **Spec-Gate / OPEN QUESTION:** freigegeben → nächster STEP. **Cap-/Retry-Phase:** einmaliger Override → ein weiterer Versuch. |
| Freitext (z. B. „AC #2 schärfen: …") | **Spec-Gate:** Antwort wird eingearbeitet, dann **erneut** Spec-Gate (kein blindes DEV). **OPEN QUESTION:** Antwort fließt in den Plan. |
| `nein` / `cancel` / `stop` / `abbrechen` | Abbruch → Pipeline STOP, kein „Done". |

Voraussetzung: `SLACK_BOT_TOKEN` in der Umgebung (kein Literal im Repo). Klassifikation: `classifyHumanAnswer`
in `scripts/slack-ask.ts` (abort hat Vorrang vor approve).

### Fallback (File-Flag) — bei Slack-Timeout/Fehler

Antwortet niemand innerhalb des Timeouts oder Slack ist nicht erreichbar, schreibt pi den Zustand nach
`.pi/orchestrator-state.json` und sendet eine ntfy-Push (best-effort, `NTFY_TOKEN`). Dann gilt das alte
Verfahren:

```bash
touch .pi/orchestrator-resume         # Freigeben (approve)
touch .pi/orchestrator-resume-cancel  # Abbrechen (cancel)
just pi                               # bzw. just orchestrate — Lauf fortsetzen
```

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

Cap-Überschreitung → `request_human` fragt über Slack (`C0B8R3ERUNR`): bei `approve` ein **einmaliger
consume-on-use Override** (`capsOverridePending`, ein weiterer Versuch); bei `abort`/Timeout bleibt der
Status "In Progress", nie "Done". Der Override hebelt die Caps nicht dauerhaft aus — er wird beim nächsten
`checkCaps()` verbraucht und beim Task-Wechsel zurückgesetzt.

---

## pio — Orchestrator in anderen Repos starten

`pio` ist eine zsh-Funktion, die `pi-launch.sh` aus der zentralen cc-setup-Installation aufruft
und dabei das **aktuelle Verzeichnis** (cwd) als Ziel-Repo nutzt.

### Einrichtung (~/.zshrc)

```zsh
pio() { CC_SETUP_DIR="${CC_SETUP_DIR:-$HOME/GITHUB_DG/cc-setup}" bash "$CC_SETUP_DIR/scripts/pi-launch.sh" "$@"; }
```

Nach `source ~/.zshrc` steht `pio` global zur Verfügung.

### Voraussetzungen im Ziel-Repo

| Voraussetzung | Zweck |
|---|---|
| `backlog/` initialisiert (`backlog init`) | Orchestrator liest Tasks über `backlog` CLI |
| Erkennbare Tests **oder** `.pi/gates` vorhanden | `run_gates` muss Gates finden |
| `ANTHROPIC_API_KEY` gesetzt | claude -p Worker (planner/builder/reviewer) |
| `SLACK_BOT_TOKEN` gesetzt (optional) | Blockierende Spec-Gate-Fragen via Slack |

### Gate-Konfiguration im Ziel-Repo

**Auto-Detect** (priorisiert, mehrere gleichzeitig möglich):

| Marker-Datei | Erkanntes Gate |
|---|---|
| `justfile` / `Justfile` | `just test` |
| `package.json` | `npm test` |
| `Cargo.toml` | `cargo test` |
| `deno.json` / `deno.jsonc` | `deno task test` |

**Override** mit `.pi/gates` (überschreibt Auto-Detect komplett):
```
# .pi/gates — Zeilen: name:command
test:just test
lint:npm run lint
```

Wird weder etwas erkannt noch `.pi/gates` gefunden, schlägt `run_gates` mit
`{"pass":false,"failed":["no-gates-detected"],"log":""}` fehl — kein stilles Pass.

### Verwendung

```bash
cd ~/GITHUB/mein-repo
pio                    # interaktiv: Meilenstein auswählen, pi starten
pio --print-prompt     # Dry-Run: zeigt nur den gebauten Prompt
```

Der Orchestrator läuft in `cwd` (= Ziel-Repo). Lock/State (`.pi/`) landen im Ziel-Repo.
Maschinerie (Extensions, Scripts) kommt aus `$CC_SETUP_DIR` (= cc-setup-Installation).

---

## Weiterführend

- Vollständige Architektur + Flag-Mapping: `specs/spec-pi-orchestrator-workflow.md`
- ADR (Architektur): `knowledge/decisions.md` (ADR 004); ADR (Slack-Rückfragen + `just pi`): ADR 005
- Workflow-Visual (ADR/PRD/BDD → Milestone → Gate): `knowledge/gated-agentic-workflow.html`
- End-to-End Dry-Run Report: `knowledge/orchestrator-dry-run-report.md`
- Worker-Dispatch-Code: `scripts/cc-dispatch.ts` · Slack-Rückfrage-Modul: `scripts/slack-ask.ts` · Launcher: `scripts/pi-launch.sh`
- Orchestrator-Extension: `.pi/extensions/cc-orchestrator.ts`
