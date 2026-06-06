# Plan: pi-Orchestrator-Workflow auf cc-setup (lokaler Dispatcher → claude -p Worker)

> Task-Typ: **feature** · Komplexität: **complex**
> Status: Entwurf (Spec-Gate offen — wartet auf menschliche Freigabe)
> Verwandte Memory: `org-rule-subagent-isolation`, `subagent-selfreport-verify`,
> `cc-setup-auto-sync-push-hazard`, `deno-knowledge-cache-python-runaway`,
> `cc-context-skill-agent-metadata-only`

## Task Description

Ein lokal laufender **pi**-Agent (github.com/earendil-works/pi, schwaches lokales
Modell) wird zum **Dispatcher/Manager** des Backlog-Task-Durchsatzes. pi entscheidet
nichts Inhaltliches selbst — es **sequenziert** eine feste Pipeline und delegiert
jeden intelligenzlastigen Schritt an spezialisierte **`claude -p`**-Worker
(headless Claude Code). Ziel: schneller entwickeln, weil jeder Claude-Worker nur
EINE eng umrissene Aufgabe mit perfektem Kontext bekommt, während pi billig/lokal
das Drumherum (Task-Auswahl, Status, Gates, Retries, Doku) übernimmt.

Pattern = pi **agent-team** (Dispatcher-only): der Primär-Agent hat keine
Code-Tools, nur Delegations- und Buchhaltungs-Tools. Die eigentliche Routing-Logik
wird als **strikte, nummerierte Prozedur** im System-Prompt kodiert, damit das
schwache Modell nur in Reihenfolge Tools aufruft, statt zu improvisieren.

## Objective

Nach Abschluss existiert ein lauffähiger Orchestrator, der pro Backlog-Task die
Kette **PICK → SPEC → (Spec-Gate) → DEV → GATE → REVIEW → DONE → (Human Merge)**
autonom durchläuft, mit:
- allen Worker-Schritten als isolierte `claude -p`-Prozesse (Dev ≠ Review = Org-Regel automatisch erfüllt),
- menschlicher Freigabe der Spec und des finalen Merges (Human-Oversight-Pflicht),
- deterministischen Quality-Gates (Tests/Lint/Build) durch pi selbst,
- harten Safety-Caps gegen Runaway (Kosten/Retries/Prozesse),
- erhaltenem `redactor`-Egress-Schutz in den Workern (Org-Compliance).

## Problem Statement

Heute orchestriert eine interaktive Claude-Code-Session selbst (teuer, bindet
Aufmerksamkeit, vermischt Orchestrierung + Implementierung + Doku in einem
Kontext). Die cc-setup-Hooks sind genau dafür gebaut (SessionStart kippt den
ganzen Backlog rein; Stop-Hook zwingt via `decision:block` PKM-Doku). Für einen
Durchsatz-orientierten Workflow soll die Orchestrierung an ein billiges lokales
Modell wandern und Claude nur noch fokussierte Einzelaufgaben erledigen.

Zwei Stolpersteine, die die Spec lösen muss:
1. **Schwaches Orchestrator-Modell** darf nicht die intelligenzlastigen Schritte
   (Prompt-/Spec-Autorenschaft, semantisches Review) übernehmen — die gehen an
   Claude. pi bleibt rein mechanischer Sequenzer.
2. **Die cc-setup-Hooks arbeiten gegen Headless-Worker** (Backlog-Dump zerstört
   Fokus; `decision:block` treibt den Worker in ungewollte PKM-Doku/Loops) — aber
   der `redactor`-Hook MUSS aktiv bleiben (Org-Egress-Redaction). Pauschales
   Hook-Deaktivieren ist daher verboten; es braucht chirurgisches Env-Gating
   pro Hook-Skript.

## Solution Approach

- **Dispatcher = pi-Extension** auf Basis der verifizierten `agent-team.ts`-Mechanik
  (Referenz: `reference/pi-vs-claude-code/extensions/agent-team.ts:301-465`), aber
  `spawn("claude", …)` statt `spawn("pi", …)`. Der Primär-pi-Agent läuft auf einem
  lokalen Modell und bekommt nur grobkörnige Tools (ein Tool ≈ ein Pipeline-Schritt).
- **Worker = `claude -p`** mit pro-Rolle übersetztem Flag-Satz (Rollen-`.md`-Body →
  `--append-system-prompt`, `tools`-Whitelist → `--allowedTools`, eigenes
  `--model`, eigene `--settings`/Env). Jeder Worker = eigener Prozess = eigene
  Session.
- **Gates = pi selbst** (deterministisch, kein LLM): `just test` + Lint + Build +
  Typecheck → strukturiertes Pass/Fail.
- **Backlog = Single Source of Truth**, alle Schreibzugriffe nur über `backlog`-CLI
  (nie Datei-Edits — cc-setup-Regel).
- **Human-Gates** an genau zwei Stellen: Spec-Freigabe und finaler Push/Merge.
- **Safety**: pi `damage-control` für pi-eigene Bash-Calls + Orchestrator-Caps
  (Retries, Cost-Budget, single-flight Lock, Kill-Switch). `redactor` schützt die
  Worker-Egress.

### Architektur (ASCII)

```
 ┌────────────────────────────────────────────────────────────────────┐
 │  pi-orchestrator  (LOKALES Modell, agent-team Dispatcher)           │
 │  Tools: backlog_next · backlog_set · run_gates · dispatch_worker    │
 │         · request_human · mark_done     (KEINE Code-Tools)          │
 │  System-Prompt = strikte nummerierte Pipeline + Caps               │
 └───────┬──────────────┬───────────────┬───────────────┬─────────────┘
         │ pick/set      │ dispatch      │ run_gates     │ mark_done
         ▼               ▼ (spawn)       ▼ (bash)        ▼
 ┌───────────────┐  ┌──────────────────────────────┐  ┌──────────────┐
 │ backlog CLI   │  │  claude -p  Worker (headless) │  │ git commit   │
 │ (Tasks/AC/    │  │  ┌────────┐ ┌───────┐ ┌──────┐│  │ (lokal,      │
 │  Status)      │  │  │planner │ │builder│ │review││  │  KEIN push)  │
 └───────────────┘  │  └────────┘ └───────┘ └──────┘│  └──────────────┘
                    │  redactor PreToolUse AKTIV    │
                    │  SessionStart/Stop ENV-GATED  │
                    └──────────────────────────────┘
   ░ Spec-Gate (Mensch) nach planner ░     ░ Push/Merge (Mensch) nach DONE ░
```

### Pipeline (pro Backlog-Task)

```
PICK   pi: backlog_next → backlog_set <id> -s "In Progress"
SPEC   pi: dispatch_worker(planner, <task+kontext>)
           → pi schreibt Ergebnis: backlog edit --plan/--ac/--notes
GATE₀  pi: request_human("Spec freigeben?")        ░ HUMAN ░  (Autonomie=Spec-Gate)
DEV    pi: dispatch_worker(builder, <freigegebene spec>)
           → builder committet lokal (KEIN push)
GATE₁  pi: run_gates() → {pass|fail, log}
           fail → dispatch_worker(builder, <fail-log>)  [≤ MAX_DEV_RETRIES]
                  danach → request_human("intervention")
REVIEW pi: dispatch_worker(reviewer, <diff>)  (separate Session!)
           reject → dispatch_worker(builder, <findings>) [≤ MAX_REVIEW_RETRIES]
DONE   pi: backlog --check-ac …, --final-summary …, -s "Done"
           git add <eigene Dateien> && git commit (lokal, Branch)
HUMAN  Push/Merge nach main = manuell, nach menschlichem Review
```

## Relevant Files

Use these files to complete the task:

- `hooks/inject-project-context.sh` — SessionStart-Hook; muss bei `CC_ORCHESTRATED=1` die schwere Backlog-Injection früh überspringen (Fokus-Worker bekommen Kontext vom Dispatcher, nicht vom Hook). `redactor` bleibt unberührt.
- `hooks/stop-workflow.sh` + `hooks/pkm-sync-stop.sh` — Stop-Hook; muss bei `CC_ORCHESTRATED=1` das `decision:block`/PKM-Sync überspringen (sonst Loop-Gefahr im Headless-Worker). `no-auto-push` (CCS-008) bleibt erhalten.
- `hooks/hooks.json` — Hook-Registrierung; ggf. Doku-Hinweis auf den Env-Gate.
- `scripts/sprint_bridge.py` — read-only Backlog-Parser; Vorlage/Wiederverwendung für die Backlog-Bridge-Tools (NICHT erweitern um Writes — Writes laufen über `backlog`-CLI).
- `backlog/` — Task-Quelle; alle Status/AC/Notes-Mutationen via `backlog task edit`.
- `reference/pi-vs-claude-code/extensions/agent-team.ts` — verifizierte Dispatch-/Spawn-/JSON-Parse-Mechanik (Vorlage für `dispatch_worker`).
- `reference/pi-vs-claude-code/.pi/agents/{planner,builder,reviewer}.md` — Rollen-Format (Frontmatter `name/description/tools` + System-Prompt-Body).
- `reference/pi-vs-claude-code/.pi/damage-control-rules.yaml` — Safety-Regelsatz (Vorlage).
- `CLAUDE.md` (Repo) + globale `~/.claude/CLAUDE.md` — Worker erben diese (redactor strict, backlog-Regeln).

### New Files

- `.pi/extensions/cc-orchestrator.ts` — die Dispatcher-Extension (registriert die Orchestrator-Tools, spawnt `claude -p`, parst JSON-Output, hält Caps/Locks).
- `.pi/agents/planner.md`, `.pi/agents/builder.md`, `.pi/agents/reviewer.md` — Worker-Rollen (cc-setup-spezifisch; Tools-Whitelist + System-Prompt inkl. redactor-Reminder + backlog-Regeln).
- `.pi/cc-worker-settings.json` — Claude-Code-Settings für Worker (Permission-Default; Hooks NICHT pauschal leeren — redactor muss bleiben).
- `.pi/damage-control-rules.yaml` — Safety-Regeln für pi-eigene Bash-Calls (aus Referenz portiert).
- `scripts/run-gates.sh` — deterministischer Gate-Runner (`just test` + lint + build + typecheck → JSON `{pass, log}`).
- `scripts/cc-dispatch.ts` (oder inline in der Extension) — `claude -p`-Spawn-Helper mit Flag-Mapping + JSON-Parsing.
- `knowledge/decisions.md` (Append) — ADR: warum agent-team + claude -p Worker + Env-Gating statt Hook-Deaktivierung.

## Implementation Phases

### Phase 1: Foundation
- Worker-Rollen-Defs (`planner`/`builder`/`reviewer`) anlegen.
- `claude -p`-Spawn-Helper mit Flag-Mapping bauen und isoliert gegen einen Dummy-Task testen (gibt strukturiertes Ergebnis zurück).
- Hook-Env-Gating in `inject-project-context.sh` und `stop-workflow.sh` einbauen — redactor unangetastet.
- Gate-Runner (`scripts/run-gates.sh`) bauen.

### Phase 2: Core Implementation
- Backlog-Bridge-Tools (next/set/check-ac/final-summary/done) als CLI-Wrapper.
- `cc-orchestrator.ts` Extension: Tools registrieren, Pipeline im System-Prompt kodieren, Caps + single-flight-Lock + Kill-Switch.
- Spec-Gate- und Human-Intervention-Mechanik (Pause + Resume + ntfy-Benachrichtigung).

### Phase 3: Integration & Polish
- `damage-control` für pi-Bash aktivieren; Safety-Caps verdrahten.
- End-to-End-Dry-Run gegen einen echten, trivialen Backlog-Task.
- Org-Compliance verifizieren (kein Auto-Push, Dev≠Review, Spec-Gate greift, redactor aktiv im Worker).
- `just orchestrate`-Recipe + Doku.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Worker-Rollen-Defs anlegen
- `.pi/agents/planner.md` — `tools: read,grep,find,ls`; Body: „Analysiere den Backlog-Task, produziere nummerierten Plan + geschärfte AC + zu ändernde Dateien + Risiken. KEINE Datei-Änderungen." + Hinweis: bei Mehrdeutigkeit „OPEN QUESTION: …" ausgeben (triggert Spec-Gate-Rückfrage).
- `.pi/agents/builder.md` — `tools: read,write,edit,bash,grep,find,ls`; Body: „Implementiere exakt den freigegebenen Plan. Nur AC-Scope. Bestehende Patterns folgen. Lokaler Commit nur eigener Dateien (`git add <pfade>`, nie `-A`). KEIN push. Bash IMMER via `redactor wrap --`."
- `.pi/agents/reviewer.md` — `tools: read,bash,grep,find,ls`; Body: „Reviewe Diff auf Bugs/Security/Style/AC-Erfüllung. Tests laufen lassen. Verdict: APPROVE oder REJECT + nummerierte Findings. KEINE Datei-Änderungen."

### 2. `claude -p`-Spawn-Helper + Flag-Mapping
- Helper, der aus einer Rollen-Def den Worker startet (siehe Flag-Mapping unten).
- `--output-format json` parsen → `{result, is_error, total_cost_usd, num_turns}`.
- Timeout + Abbruch (SIGTERM) bei Überschreitung; stderr getrennt erfassen.
- Isoliert testen: `dispatch_worker("reviewer", "Sag exakt: ok")` → Ergebnis „ok", Exit 0.

### 3. Hook-Env-Gate: SessionStart
- In `hooks/inject-project-context.sh` direkt nach Variablen-Setup:
  `if [ "${CC_ORCHESTRATED:-}" = "1" ]; then echo "(orchestrated worker — context injected by dispatcher)"; exit 0; fi`
- Verifizieren: mit `CC_ORCHESTRATED=1` kein Backlog-Dump; ohne Variable unverändert.

### 4. Hook-Env-Gate: Stop
- In `hooks/stop-workflow.sh` (vor dem PKM-Sync-Block) und defensiv in `hooks/pkm-sync-stop.sh` (nach `INPUT`-Parse):
  `if [ "${CC_ORCHESTRATED:-}" = "1" ]; then exit 0; fi`
- WICHTIG: `redactor`-Hook NICHT anfassen — bleibt für Worker aktiv (Org-Egress).
- Verifizieren: Headless-Worker mit `CC_ORCHESTRATED=1` läuft ohne `decision:block`-Loop.

### 5. Gate-Runner
- `scripts/run-gates.sh`: führt `just test` (ccs-009 deckt Suites ab), Lint, Build, Typecheck der Reihe nach; sammelt Exit-Codes; gibt `{"pass":bool,"failed":[...],"log":"…"}` (via jq) aus.
- Alle Sub-Commands via `redactor wrap --`.

### 6. Backlog-Bridge-Tools
- Dünne Wrapper um `backlog`-CLI (kein Datei-Edit):
  - `backlog_next` → `backlog task list -s "To Do" --plain` → erster Task in Reihenfolge.
  - `backlog_set(id, status)` → `backlog task edit <id> -s "<status>"`.
  - `backlog_plan(id, text)` / `backlog_notes` / `backlog_check_ac(id, idx…)` / `backlog_final_summary(id, text)`.
- Read-Pfad darf `sprint_bridge.py` wiederverwenden; Writes ausschließlich CLI.

### 7. Orchestrator-Extension `cc-orchestrator.ts`
- Auf `agent-team.ts` aufsetzen; Worker-Spawn auf `claude` umstellen (Schritt 2).
- Registrierte Tools (grobkörnig, ein Tool ≈ ein Pipeline-Schritt): `backlog_next`, `backlog_set`, `dispatch_worker`, `run_gates`, `request_human`, `mark_done`.
- `before_agent_start`: System-Prompt = **strikte nummerierte Prozedur** (die Pipeline oben) + Caps + „rufe Tools NUR in dieser Reihenfolge, improvisiere nie".
- `setActiveTools([...])` auf genau diese Tools beschränken (keine Code-Tools für pi).

### 8. Spec-Gate & Human-Intervention
- `request_human(reason)` pausiert die Pipeline, persistiert den Zustand (Task-ID + Phase) und benachrichtigt via `ntfy` (Skill vorhanden).
- Resume-Mechanik: Mensch gibt frei → Pipeline fährt bei der nächsten Phase fort. Bei `intervention` (Cap erreicht) bleibt der Task stehen, Status NICHT „Done".

### 9. Safety: damage-control + Caps
- `.pi/damage-control-rules.yaml` aus Referenz portieren (greift für pi-eigene Bash: Gates etc.).
- Caps in der Extension: `MAX_DEV_RETRIES`, `MAX_REVIEW_RETRIES`, `MAX_COST_USD_PER_TASK`, `MAX_WALL_CLOCK_PER_TASK`, **single-flight Lock** (eine Worker-Instanz pro Repo; sonst Worktree-Isolation erzwingen), **Kill-Switch** (Datei-Flag / Ctrl-C bricht sauber ab).
- Bezug: Memory `deno-knowledge-cache-python-runaway` (Runaway-Prävention).

### 10. End-to-End-Dry-Run + Org-Compliance
- Realer trivialer Backlog-Task durch die volle Pipeline.
- Checkliste: (a) kein `git push` passiert; (b) builder- und reviewer-Prozesse sind getrennt (Logs/Sessions belegen es); (c) Spec-Gate hat tatsächlich pausiert; (d) `redactor` war im Worker aktiv (Block-Log bei ungewrapptem Bash); (e) `Done` erst nach allen AC + Gates.
- Subagent-Self-Report unabhängig gegenchecken (Memory `subagent-selfreport-verify`).

### 11. Doku + Recipe + ADR
- `just orchestrate [<task-id>]`-Recipe.
- `knowledge/decisions.md`: ADR ergänzen.
- `knowledge/` Kurz-Doku des Workflows; ggf. Memory-Eintrag.

## Testing Strategy

- **Spawn-Helper (Schritt 2):** Unit-artiger Smoke-Test gegen `claude -p "Sag exakt: ok"` → Exit 0, geparstes `result == "ok"`. Fehlerfall: ungültiges Modell → `is_error`, sauberer Nicht-Null-Exit.
- **Hook-Env-Gates (3/4):** je ein Lauf mit/ohne `CC_ORCHESTRATED=1`; Assert auf An-/Abwesenheit des Backlog-Dumps bzw. des `decision:block`-JSON. Regression: `redactor`-Block feuert in BEIDEN Modi (darf nie ausgehen).
- **Gate-Runner (5):** gegen einen bewusst rot gemachten Test → `pass:false` + korrekte `failed`-Liste; grün → `pass:true`.
- **Caps/Safety (9):** künstlich `MAX_DEV_RETRIES` überschreiten → Pipeline geht in `intervention`, Status bleibt „In Progress", kein „Done". `damage-control`: `rm -rf` im pi-Bash wird geblockt.
- **End-to-End (10):** ein echter Task; Org-Compliance-Checkliste als Akzeptanz.
- **Edge Cases:** planner liefert „OPEN QUESTION" → Spec-Gate fragt zurück statt zu raten; reviewer „REJECT" → genau ein Retry-Zyklus, kein Endlosloop; zwei Orchestrator-Starts gleichzeitig → single-flight Lock verhindert Doppel-Worker.

## claude -p Flag-Mapping (pi `--mode json -p …` → `claude -p …`)

| pi (agent-team.ts) | claude -p Äquivalent | Zweck |
|---|---|---|
| `-p` | `-p` / `--print` | Headless, einmalig |
| `--mode json` | `--output-format json` (bzw. `stream-json` für Live-Widget) | maschinenlesbares Ergebnis |
| `--model <prov/id>` | `--model <claude-id>` | Modell pro Worker |
| `--tools <whitelist>` | `--allowedTools "Read Edit Write Bash …"` | Tool-Whitelist pro Rolle |
| `--append-system-prompt <body>` | `--append-system-prompt "<rollen-body>"` | Rollen-Persona |
| `--session <file>` / `-c` | `--resume <id>` / `--continue` (i. d. R. NICHT nötig — frische Worker) | Session-Persistenz |
| — | `--permission-mode auto` | Headless ohne Prompt (User-Entscheidung; Prior Art `~/cc-ctxtest/bench.sh`) |
| — | `--add-dir <repo>` falls nötig | Arbeitsverzeichnis |
| — | `CC_ORCHESTRATED=1` (Env) | Hook-Gating der cc-setup-Hooks |

> ⚠️ Übrige Flag-Namen gegen die installierte `claude`-Version abgleichen
> (`claude --help`), v. a. `--output-format` und `--allowedTools`-Schreibweise.
> `--permission-mode auto` ist gesetzt (User-Entscheidung; Prior Art
> `~/cc-ctxtest/bench.sh` nutzt es bereits) — nicht mehr raten.
> `--settings` NICHT pauschal mit leerem `hooks:{}` setzen — das würde redactor
> abschalten (Org-Verstoß). Hook-Steuerung ausschließlich über das Env-Gate der
> eigenen Hook-Skripte.

## Org-Compliance-Mapping

| Org-Regel | Umsetzung in dieser Spec |
|---|---|
| Entwicklung ≠ Review in derselben Session | builder und reviewer sind getrennte `claude -p`-Prozesse (eigene Sessions). |
| Human-Oversight vor produktivem Einsatz | Spec-Gate (Mensch nickt Plan ab) + Push/Merge bleibt manuell; `mark_done` ist nur Backlog-Tracking, kein Deploy. |
| Keine internen/kunden-/personenbezogenen Daten | Reiner Code-/Repo-Workflow; `redactor` strict bleibt im Worker aktiv (Egress-Redaction); `damage-control zeroAccessPaths` schützt `.env`/`*.pem`/`~/.ssh`. |
| Kein Auto-Push (CCS-008) | Stop-Hook-Härtung bleibt; Orchestrator pusht nie; nur lokaler Commit/Branch. |

## Acceptance Criteria

- [ ] Ein lokaler pi-Dispatcher führt die volle Pipeline gegen mindestens einen echten Backlog-Task durch, ohne dass ein Mensch außer an Spec-Gate und finalem Merge eingreift.
- [ ] builder- und reviewer-Schritte sind nachweislich getrennte `claude -p`-Prozesse/Sessions.
- [ ] Spec-Gate pausiert tatsächlich und wartet auf menschliche Freigabe; bei „OPEN QUESTION" wird zurückgefragt statt geraten.
- [ ] Deterministische Gates (`run-gates.sh`) blocken einen rot gemachten Test korrekt; „Done" wird nie bei rotem Gate gesetzt.
- [ ] `CC_ORCHESTRATED=1` deaktiviert SessionStart-Dump und Stop-`decision:block`, lässt `redactor` aber aktiv (Block feuert weiterhin bei ungewrapptem Bash).
- [ ] Kein `git push` durch den Orchestrator; nur lokaler Commit/Branch.
- [ ] Safety-Caps greifen: Retry-Überschreitung → `intervention` (kein „Done"); `damage-control` blockt destruktive pi-Bash-Calls; single-flight verhindert Doppel-Worker.
- [ ] AC werden nur über `backlog`-CLI gesetzt; keine direkten Task-Datei-Edits.

## Validation Commands

Execute these commands to validate the task is complete:

- `bash -n hooks/inject-project-context.sh && bash -n hooks/stop-workflow.sh && bash -n hooks/pkm-sync-stop.sh` — Hook-Skripte syntaktisch valide.
- `CC_ORCHESTRATED=1 bash hooks/inject-project-context.sh </dev/null | grep -qiv "Backlog-Stand"` — kein Backlog-Dump im orchestrierten Modus.
- `redactor wrap -- bash scripts/run-gates.sh` — Gate-Runner liefert valides JSON `{pass,…}`.
- `redactor wrap -- claude -p "Sag exakt: ok" --output-format json` — Worker-Spawn-Smoke (Exit 0, `result` enthält „ok"). *(Flag-Namen ggf. anpassen.)*
- `redactor wrap -- pi -e .pi/extensions/cc-orchestrator.ts` *(interaktiv/tmux)* — Dispatcher startet, nur Orchestrator-Tools aktiv, keine Code-Tools.
- End-to-End: Orchestrator gegen einen Test-Backlog-Task; manuelle Org-Compliance-Checkliste (siehe Schritt 10).

## Backlog-Task-Aufschlüsselung (Dependency-Reihenfolge)

> Anlegen via `backlog task create` (Nummern vergibt die CLI; Reihenfolge = Deps).
> Vorschlag als ein Milestone „pi-orchestrator".

1. **Worker-Rollen-Defs** (`.pi/agents/{planner,builder,reviewer}.md`) — keine Deps.
2. **claude -p Spawn-Helper + Flag-Mapping** (Smoke-Test) — keine Deps.
3. **Hook-Env-Gate SessionStart** (`inject-project-context.sh`) — keine Deps.
4. **Hook-Env-Gate Stop** (`stop-workflow.sh` + `pkm-sync-stop.sh`) — keine Deps.
5. **Gate-Runner** (`scripts/run-gates.sh`) — keine Deps.
6. **Backlog-Bridge-Tools** — keine Deps.
7. **Orchestrator-Extension** (`cc-orchestrator.ts`) — Deps: 1,2,5,6.
8. **Safety: damage-control + Caps + single-flight** — Dep: 7.
9. **Spec-Gate & Human-Intervention (Pause/Resume/ntfy)** — Dep: 7.
10. **End-to-End-Dry-Run + Org-Compliance-Checkliste** — Deps: 3,4,7,8,9.
11. **Doku + `just orchestrate` + ADR** — Dep: 10.

## Notes

- **Eskalations-/Escape-Hatch:** Sollte das lokale pi-Modell die Pipeline nicht
  zuverlässig sequenzieren (zu schwach), dieselben Tools in einen deterministischen
  Treiber (Python/`just`) hängen — pi/das Modell füllt dann nur noch die
  per-Schritt-Prompts. Tool-Surface bleibt identisch; nur der Sequenzer wird
  deterministisch. (Bewusst NICHT der Default, aber risikoarmer Fallback.)
- **Ausbaustufe:** Später von agent-team (dynamischer Dispatch) auf **The Chronicle**
  (formale State-Machine mit `requires_approval`, Anti-Loop >3, Budget, Checkpoint-
  Recovery; Referenz `reference/pi-vs-claude-code/specs/agent-workflow.md`)
  hochziehen — die hier gebauten Tools/Rollen sind wiederverwendbar.
- **Beobachtbarkeit (optional):** `pi-observability`-Extension anhängen, um pro
  Worker Turns/Tools/Tokens/Kosten live zu sehen (Referenz
  `reference/pi-agent-observability/`).
- **Voraussetzungen / Runtime:** `pi` auf `$PATH` mit **Ollama-Provider, Modell
  `gemma4:12b-mlx`** (lokaler Dispatcher — Ollama-Endpoint muss laufen); `claude`
  auf `$PATH`; `bun` (pi-Extensions); `just`, `jq`; gültige `ANTHROPIC_API_KEY`
  (claude -p Worker). Worker laufen mit `--permission-mode auto`.
- **Offenes Risiko:** redactor-Friktion im headless builder (ungewrapptes Bash wird
  geblockt → kostet Turns, self-heilt aber). Mitigation: redactor-Reminder im
  builder-System-Prompt. Vor Skalierung Block-Rate im Dry-Run messen.
