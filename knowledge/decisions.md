# cc-setup — Decisions

Append-only Entscheidungs-Log (neueste oben). Status: `proposed` · `accepted` · `superseded`.

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
