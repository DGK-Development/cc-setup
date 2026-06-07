# cc-setup — Decisions

Append-only Entscheidungs-Log (neueste oben). Status: `proposed` · `accepted` · `superseded`.

## 009 — Orchestrator pusht nach Human-Diff-Freigabe auf Feature-Branch (verfeinert 002)
`accepted` · 2026-06-07 · **verfeinert 002**

**Context.** Bisher pushte die KI NIE (ADR 002; builder.md, System-Prompt). User-Wunsch: am
DONE-Punkt den Diff via Slack schicken und bei Freigabe `git add/commit/push`.

**Decision.** Neuer STEP 7 PUBLISH, in `mark_done` gefaltet (ein Toolcall → robust gegen
gemma-Stall): nach Done → Diff via Slack (`requestHuman` phase=PUBLISH, attachment=Diff) →
**NUR bei explizitem `HUMAN_APPROVED`** pusht `publishTask` auf Branch `pio/<id>`
(`git branch -f <branch> HEAD` ohne Checkout + `git push -u origin <branch>`; **nie main, nie
force, kein PR** — User-Wahl). Dirty-Fallback: gezielt geänderte Dateien adden (Noise
`.pi/`/`.fallow`/`logs/`/`.gitignore` ausgeschlossen, **kein `-A`**) + commit. Der builder-Worker
pusht weiterhin nie.

**Human-Oversight gewahrt:** der Mensch SIEHT den Diff und gibt explizit frei, BEVOR gepusht
wird; der Merge nach `main` (= produktiver Einsatz) bleibt ein manueller Mensch-Schritt. dev≠review
unberührt (Reviewer-Worker + Mensch). Ablehnung/Freitext/Timeout → kein Push.

**Consequences.** + Diff-Review im Flow, ein manueller Branch-Push weniger. − Der Orchestrator
hat jetzt (gated) Push-Fähigkeit; Restrisiko eines gemma-Fehltriggers gemildert durch
HUMAN_APPROVED-only + Branch-statt-main + kein force + kein Remote-Push ohne origin. Siehe CCS-036.19.

## 008 — Gate-Runner: keine konfigurierten Gates = SKIP (als PASS), nicht fail-closed
`accepted` · 2026-06-07

**Context.** Echter pio-Lauf (PIT-5, Doku-Task in pi-test): `run-gates.sh` fand keine
Gate-Quelle (kein justfile/package.json/Cargo.toml/deno.json, keine `.pi/gates`) und gab
fail-closed `{pass:false, failed:[no-gates-detected]}`. Folge: `mark_done` (verlangt
`pass:true`) blockiert, Task hängt auf In Progress, das schwache gemma-Modell dreht eine
sinnlose Builder-„Fix"-Schleife.

**Decision.** 0 erkannte Gates → `{pass:true, failed:[], log:"skipped: no gates configured …"}`
(exit 0). SKIP gilt als bestanden; der Orchestrator behandelt SKIP wie PASS (kein Retry).
Oversight bleibt via Human-Gate₀ (Spec) + Reviewer (Step 5). Lautes Log macht transparent,
dass NICHT automatisiert getestet wurde. Alternativen „Orchestrator-Sonderfall" (gemma zu
fragil) und „.pi/gates pro Repo" (zu viel Handarbeit) verworfen. Siehe CCS-036.17.

**Consequences.** + Doku-/Sandbox-Repos laufen durch; deterministisch, kein gemma-Sonderfall.
− Fail-open: ein Code-Repo, das seine Gate-Config verliert, wird still durchgewinkt — mitigiert
durch lautes Log + Gate₀ + Reviewer. Wer strikte Gates will, definiert `.pi/gates`.

## 007 — Neuer Meilenstein: Launcher-Pre-Decomposition per `milestone-planner`-Worker + Human-Gate
`accepted` · 2026-06-07

**Context.** Bei `pio` → „Neuer Meilenstein" pickte der Orchestrator stumpf den global nächsten
To-Do (`backlog_next`); CCS-036.07 hatte den Neu-Fall offen gelassen. Der Meilenstein wurde nie
in Tasks ausgearbeitet.

**Decision.** Die Zerlegung passiert **im Launcher vor `pi`**, nicht als Orchestrator-Schritt:
`pi-launch.sh` dispatcht einen starken Claude-SDK-Worker (`.pi/agents/milestone-planner.md`,
read+bash, sonnet), der das Ziel in 3–7 atomare Tasks zerlegt und als **Drafts** anlegt
(`backlog task create --draft -m`). **Human-Gate**: Drafts werden gezeigt → `promote` (To Do)
oder `archive`; ohne Freigabe kein `pi`. Danach `CC_ORCH_MILESTONE` + scoped Prompt → Pipeline
**unverändert**. Alternative (Orchestrator-STEP-0) verworfen: würde dem schwachen gemma-Modell
einen neuen Branch aufbürden (CCS-036.14). Siehe CCS-036.15.

**Consequences.** + Orchestrator bleibt mechanisch; starke Zerlegung; Mensch kontrolliert den
Meilenstein-Scope. − Meilenstein-Logik an zwei Orten (Launcher + Orchestrator); Live-Pfad noch
ohne automatischen Integrationstest (Folge-AC).

## 006 — pi-Worker Headless-Permissions via `canUseTool`, nicht `bypassPermissions`
`accepted` · 2026-06-07

**Context.** Der Builder-Worker (Agent SDK, `settingSources:[]`) bekam Write/Bash still
verweigert und „fragte" endlos nach Genehmigung — trotz `permissionMode:'bypassPermissions'`
+ `allowDangerouslySkipPermissions`. Verifiziert (SDK v0.3.168): unter der **Enterprise-Managed-
Policy** dieser Org wird Bypass nicht honoriert (headless-auto-deny); `'auto'` ist nur ein
Modell-Klassifizierer; `allowedTools` allein reicht nicht.

**Decision.** `cc-dispatch.ts` nutzt `permissionMode:'default'` + einen expliziten
**`canUseTool`-Whitelist-Approver** (lässt genau die Rollen-Tools aus dem Frontmatter `tools` zu,
lehnt Rest ab). Zusätzlich hängt der Orchestrator den **echten Repo-Root + Autonomie-Ansage**
deterministisch vor den Worker-Prompt (gegen erfundene Absolut-Pfade). Siehe CCS-036.10.

**Consequences.** + Worker führen Tools real aus (builder/reviewer); robust gegen Org-Policy;
kein bypass-Flag-Risiko. − Worker-Toolbreite hängt allein am `tools`-Frontmatter; Egress-Schutz
im Worker weiterhin via isolierter Session + „kein git push" (nicht via redactor-Hook).

## 005 — pi-Rückfragen blockierend über Slack (Kanal `C0B8R3ERUNR`) statt File-Flag-Resume
`accepted` · 2026-06-07 · **verfeinert 004 (F)**

**Context.** Das Human-Gate aus 004 (F) war datei-basiert/asynchron: `requestHuman` schrieb
`.pi/orchestrator-state.json`, schickte eine ntfy-Push und wartete auf `touch .pi/orchestrator-resume`
— **plus manuellen pi-Neustart**. Das ist kein „fragen und auf Antwort warten": jede Spec-Gate-Pause
brach den Lauf ab. Genau das verhinderte den voll-autonomen E2E (CCS-035 AC#1 blieb offen — der reale
`just orchestrate`-Lauf pausierte am Spec-Gate und musste manuell neu gestartet werden).

**Decision.**

**(A) Blockierende Slack-Rückfrage als Primärweg.** `requestHuman` stellt die Frage an den Slack-Kanal
`C0B8R3ERUNR` und **wartet blockierend** auf die menschliche Antwort (`scripts/slack-ask.ts` →
spawnt das vorhandene `SlackNotify.py` mit `send` dann `poll`, Default-Timeout 900s). Die Antwort wird
klassifiziert (`classifyHumanAnswer` → `approve | abort | answer`) und als Prefix-Tool-Result
zurückgegeben; pi fährt **im selben Prozess** mit dem korrekten Folge-STEP fort. Gilt für **alle**
Interventionen (Spec-Gate, OPEN QUESTION, Cap-/Retry-Überschreitung) — User-Entscheidung.

**(B) Kanonisches Prefix-Schema (Code-Rückgabe ↔ System-Prompt identisch, kein Orphan).**
- `HUMAN_APPROVED:` — non-cap-Phase, Zustimmung → nächster STEP.
- `HUMAN_ANSWERED:` — non-cap-Phase, Freitext → in Plan einarbeiten; bei GATE0 **erneut** Gate (kein blindes DEV).
- `HUMAN_APPROVED_OVERRIDE:` — Cap-Phase, non-abort → `capsOverridePending` (consume-on-use, ein Retry).
- `CANCELLED_BY_HUMAN:` — abort/cancel/nein → STOP, kein Done.
- `HUMAN_REQUIRED/PAUSED:` — Fallback (siehe C).

**(C) Fallback erhalten.** Bei Slack-Timeout/Fehler (`answered:false`) greift der bestehende Pfad
unverändert: `orchestrator-state`-Datei + ntfy + File-Flag-Resume (`touch .pi/orchestrator-resume`).
Das alte Verfahren bleibt als Sicherheitsnetz, nicht als Primärweg.

**(D) `just pi`-Launcher.** `scripts/pi-launch.sh` (Recipe `just pi`) fragt programmatisch die offenen
Meilensteine ab (sprint_bridge `survey`), lässt den Operator „weiter bei Meilenstein X / neuer
Meilenstein" wählen, baut daraus den pi-Prompt und startet das **interaktive** pi mit beiden Extensions
— statt die lange pi-Kommandozeile abzutippen. `just orchestrate` bleibt als direkter Start ohne Frage.

**(E) Token-Hygiene (Org-Compliance).** Der Slack-Token kommt ausschließlich aus `SLACK_BOT_TOKEN`
(env) — **kein Literal** in `slack-ask.ts` oder im Repo. Fehlt der Token → strukturiertes Fehlerobjekt,
kein Crash (Fallback C greift).

**Consequences.**
- Ermöglicht einen **unbeaufsichtigten E2E** ohne manuellen pi-Neustart am Spec-Gate (löst CCS-035 AC#1 ein).
- Human-Oversight bleibt strukturell: der Mensch muss aktiv im Kanal antworten und kann jederzeit `abort`.
- Neue Laufzeit-Abhängigkeit (Slack + `SLACK_BOT_TOKEN`) — durch Fallback (C) abgesichert.
- Restrisiko (Minor, Folge-Task CCS-036.06): wiederholte GATE0-Freitext-Antworten → Re-Gate-Schleife;
  Mitigation via `gate0Retries`-Cap offen.
- Verweis: `knowledge/orchestrator-workflow.md`, `scripts/slack-ask.ts`, `.pi/extensions/cc-orchestrator.ts`,
  Workflow-Visual `knowledge/gated-agentic-workflow.html`.

## 004 — pi-Orchestrator: agent-team-Dispatcher (lokales gemma4:12b-mlx) + Claude Agent SDK Worker
`accepted` · 2026-06-07

**Context.** Der bisherige Entwicklungs-Workflow erfordert eine interaktive Claude-Code-Session, die gleichzeitig
orchestriert, implementiert und dokumentiert (teuer, bindet Aufmerksamkeit, ein Kontext für alles). Für einen
Durchsatz-orientierten Workflow soll Orchestrierung an ein billiges lokales Modell wandern und Claude nur noch
fokussierte Einzelaufgaben per headless Worker erledigen.

**Decision.**

**(A) Warum agent-team (pi-Dispatcher) statt interaktiver Claude-Session?**
Ein schwaches lokales Modell (gemma4:12b-mlx, Ollama) übernimmt das mechanische Sequenzieren der Pipeline (PICK →
SPEC → Gate → DEV → GATE → REVIEW → DONE). Es hat keine Code-Tools und trifft keine inhaltlichen Entscheidungen —
nur Tool-Aufrufe in fester Reihenfolge. Claude-Kosten fallen nur für fokussierte Einzelaufgaben (planner/builder/
reviewer) an, nicht für die gesamte Orchestrierungslast. Außerdem: `just orchestrate` startet den Dispatcher
deterministisch ohne manuelle Anleitung des Operators.

**(B) Warum Claude Agent SDK (`query()`, `dispatchWorker`) statt `claude -p` CLI-Spawn?**
Das Agent SDK (`@anthropic-ai/claude-agent-sdk`) ermöglicht granulare Kontrolle ohne Shell-Escaping-Risiken:
- `allowedTools` begrenzt Tool-Zugriff strikt pro Rolle (planner: nur read/grep/find/ls; reviewer: kein write/edit).
- `permissionMode: "auto"` ermöglicht headlosen Betrieb ohne User-Prompt.
- `settingSources: []` (SDK isolation mode) lädt keine `~/.claude/settings.json` und keine externen Hooks im Worker.
- `AbortController`-basiertes Timeout und strukturiertes `WorkerResult`-Return (`result`, `is_error`, `total_cost_usd`,
  `num_turns`) ermöglichen deterministisches Cap-Enforcement im Orchestrator-Code.
Der Orchestrator ruft `bun scripts/cc-dispatch.ts` als separaten Prozess auf (kein Import in pi's jiti-Runtime),
womit jeder Worker eine echte, eigene Session ist.

**(C) Warum Env-Gating der cc-setup-Hooks (`CC_ORCHESTRATED=1`) statt globaler Hook-Deaktivierung?**
Die cc-setup-Hooks erfüllen zwei verschiedene Rollen:
- `redactor` (PreToolUse) — Egress-Redaction, Org-Compliance-Pflicht. Darf NICHT deaktiviert werden.
- `inject-project-context.sh` (SessionStart) — kippt den kompletten Backlog-Stand in den Kontext: nützlich für
  interaktive Sessions, aber Fokus-Killer für headless Worker (deren Kontext kommt vom Dispatcher).
- `stop-workflow.sh` / `pkm-sync-stop.sh` (Stop) — `decision:block`/PKM-Sync: nötig für interaktive Sessions,
  würde im Headless-Worker zu Loop-Gefahr führen.
Lösung: Chirurgisches Env-Gate (`if CC_ORCHESTRATED=1; then exit 0; fi`) pro Hook-Skript. `redactor` bleibt in
beiden Modi aktiv. Pauschales Hook-Deaktivieren über leeres `hooks: {}` in den Worker-Settings wäre Org-Verstoß
(redactor würde schweigen) und ist daher verboten.

**(D) Warum `settingSources: []` (redactor AUS im Worker, bewusste User-Autorisierung)?**
Der Worker läuft als isolierter SDK-Prozess. `settingSources: []` verhindert, dass der Worker die globalen Hooks
(inkl. redactor) aus `~/.claude/settings.json` lädt — was Reibung beim headlosen Betrieb reduziert. Diese Posture
ist für den privaten pi-Workflow bewusst so gewählt und vom User autorisiert. Der redactor-Egress-Schutz gilt
weiterhin in der Hauptsession (interaktive Claude-Code-Session), nicht im isolierten Worker-Subprocess.

**(E) Safety-Maßnahmen (Runaway-Prävention, Prior: `deno-knowledge-cache-python-runaway`).**
- `damage-control`-Extension: blockt destruktive pi-Bash-Calls (`rm -rf`, `git reset --hard`, `git push`, `.env`).
- Caps: `MAX_DEV_RETRIES`, `MAX_REVIEW_RETRIES`, `MAX_COST_USD_PER_TASK`, `MAX_WALL_CLOCK_PER_TASK` — Code-seitig
  enforced (nicht LLM-seitig), da das Modell die Zähler nicht manipulieren kann.
- Single-Flight Lock (`.pi/orchestrator.lock`): verhindert zwei parallele Orchestrator-Instanzen am selben Repo.
- Kill-Switch (`.pi/orchestrator.kill`): Operator kann die Pipeline sofort stoppen, kein `Done` wird gesetzt.
- Gate-Guard in `mark_done`: ruft `run_gates` code-seitig vor jedem Done-Setzen, unabhängig vom Modell-Verhalten.

**(F) Human-Gates (Org-Regel: Human-Oversight vor produktivem Einsatz).**
Zwei feste, nicht überspringbare Human-Gates:
1. **Spec-Gate (GATE₀)**: Der Dispatcher pausiert nach dem planner-Worker und wartet auf `touch .pi/orchestrator-resume`.
   Erst dann darf builder starten. Bei `OPEN QUESTION` im Planner-Output wird ebenfalls pausiert.
2. **Push/Merge**: Nur lokal commit (kein `git push`). Der Mensch reviewt den Branch und merged manuell.
`mark_done` ist nur Backlog-Tracking, kein Deploy-Gate.

**Consequences.**
- Deutlich günstigere Orchestrierungskosten (lokales Modell für Sequenzierung, Claude nur für Inhalt).
- Org-Regel „Entwicklung ≠ Review in derselben Session" automatisch erfüllt (builder und reviewer sind getrennte
  `claude -p`-Prozesse / eigene Sessions).
- Human-Oversight-Pflicht durch Spec-Gate und manuellen Push strukturell sichergestellt.
- redactor-Egress-Schutz in der Hauptsession erhalten; Worker-Isolation bewusst gewählt.
- Einstiegs-Hürde: Ollama mit gemma4:12b-mlx lokal laufend. Fallback: deterministischer Python/just-Treiber mit
  identischer Tool-Surface (Modell ersetzbar ohne Tool-Änderungen).
- Verweis: `specs/spec-pi-orchestrator-workflow.md` (vollständige Architektur + Flag-Mapping + Pipeline-Detail).
Älterer Volltext/History: `git log`. Architektur-Visuals: `*.html` in diesem Ordner.

## 003 — Wissen in `knowledge/` konsolidieren, Backlog nur für Tasks
`accepted` · 2026-06-05 · **supersedes 001**

**Context.** Es gab 5 Wissens-Töpfe (`backlog/tasks`, `backlog/decisions`, `backlog/docs`,
`knowledge/*.md`, `knowledge/*.html`) → wiederkehrende „wohin gehört das?"-Reibung;
`backlog decision` hat kein CLI-`edit` (Tooling-Frust für agentengetriebene Pflege).

**Decision.** Backlog ist **nur** für Tasks (Sprints/Milestones/Status). **Alles Wissen lebt
in `knowledge/`:**
- Entscheidungen → diese `decisions.md` (append-only).
- Lektionen → `lektion-<thema>.md`.
- Visuals/Analysen → `*.html`.

`CLAUDE.md` bleibt **dünn**: nur Verhaltensregeln + 1-Zeilen-Index auf `knowledge/`. Kein
inline-Wissen (sonst Token-Steuer pro Turn). **Eine Regel:** *Task? → `backlog`. Sonst → `knowledge/`.*

**Consequences.** + Eine Routing-Regel statt drei; kein CLI-Frust; ein grep/qmd-Index;
CLAUDE.md bleibt klein. − Kein Backlog-Web-UI/Status-Board für Entscheidungen (akzeptiert:
plain Markdown reicht, qmd/grep indexiert ohnehin). Migration: decision-001/002 + doc-002
hierher gezogen; doc-001 (Genre-Split) obsolet, entfernt.

## 002 — cc-setup self-contained: Flat-Install statt Plugin/Submodul
`accepted` · 2026-06-04

Alle Quellen flach im Repo-Root; `just deploy` ist der einzige Install-Pfad (kein Marketplace,
kein `submodule update --remote`). `dist/` ephemer (Temp-Build, nach Deploy aufgeräumt).
Review-Gate: KI committet, pusht/deployt aber nicht — Mensch reviewt + aktiviert (Org-Regel:
Entwicklung ≠ Review in einer Session). Architektur-/Deployment-Detail:
`knowledge/architektur-deployment.md`.

## 001 — Knowledge pro Repo via Backlog vereinheitlichen (Hybrid)
`superseded` by 003 · 2026-06-04

Ursprünglich: Hybrid nach Genre — ADR→`backlog decision`, Guide→`backlog doc`,
Lesson/Visual→`knowledge/`. Verworfen, weil drei Töpfe + `decision`-Tooling-Frust zu komplex
(siehe 003). Begründung „ADR ≠ Lesson-Lifecycle" hielt nur gegen `decision`, nicht gegen
`doc` → der Genre-Split rechtfertigte die Mehrkosten nicht.
