---
name: pi-orchestrator-workflow
description: "pi-Dispatcher (lokal) → claude -p Worker; Spec geschrieben, wartet auf Spec-Gate-Freigabe"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9068d45a-43d1-4a9c-b5db-e1c34d0c3dc1
---

Geplanter Workflow: lokaler **pi**-Agent (github.com/earendil-works/pi, schwaches lokales Modell) als **agent-team-Dispatcher**, der Backlog-Tasks orchestriert und jeden intelligenzlastigen Schritt an **`claude -p`**-Worker delegiert (planner/builder/reviewer als `.pi/agents/*.md`). Pipeline: PICK → SPEC → Spec-Gate(Mensch) → DEV → GATE(pi, deterministisch) → REVIEW → DONE → Human-Merge.

Geklärte Entscheidungen (User, 2026-06-06): Pattern = **agent-team (Dispatcher direkt)**; **alle Worker = claude -p** (nicht pi-native — wegen vollem cc-setup-Stack: redactor/backlog/skills); Autonomie = **Spec-Gate**; Done = **Backlog-Done + lokaler Commit/Branch**, Push/Merge bleibt menschlich; pi existiert bereits lokal.

Spec liegt in `specs/spec-pi-orchestrator-workflow.md` (11 atomare Backlog-Tasks in Dependency-Reihenfolge skizziert). **Status: wartet auf menschliche Spec-Gate-Freigabe.** Danach Backlog-Tasks via `backlog task create` anlegen — Implementierung in SEPARATER Session (Org-Regel [[org-rule-subagent-isolation]]).

**Schlüssel-Insight (nicht offensichtlich):** cc-setup-Hooks für Headless-Worker per Env `CC_ORCHESTRATED=1` **gaten, NICHT pauschal deaktivieren** — sonst fällt der `redactor`-PreToolUse-Hook mit weg = Org-Egress-Verstoß. Nur `inject-project-context.sh` (Backlog-Dump) + `stop-workflow.sh` (`decision:block`/PKM-Sync) früh überspringen; redactor bleibt aktiv. Verwandt: [[cc-setup-auto-sync-push-hazard]], [[deno-knowledge-cache-python-runaway]] (Runaway-Caps).

pi-Bausteine verifiziert in `reference/pi-vs-claude-code/` (agent-team.ts Spawn-Mechanik, damage-control, The Chronicle als spätere Ausbaustufe) + `reference/pi-agent-observability/`. pi-Engine via opensrc unter `~/.opensrc/repos/github.com/earendil-works/pi/main`.
