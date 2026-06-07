---
id: CCS-036
title: '[Meilenstein] pi-gated-agentic-workflow (Slack-Rueckfragen + just-pi-Launcher)'
status: To Do
assignee: []
created_date: '2026-06-07 08:50'
labels: []
milestone: 'ccs-sprint: pi-gated-agentic-workflow'
dependencies: []
references:
  - knowledge/gated-agentic-workflow.html
  - specs/spec-pi-orchestrator-workflow.md
  - .pi/extensions/cc-orchestrator.ts
priority: high
ordinal: 79000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Aufbauend auf CCS-035 (pi-Orchestrator, 6 Tools, PICK->SPEC->GATE0->DEV->GATE1->REVIEW->DONE). Macht den gated agentic Workflow (knowledge/gated-agentic-workflow.html) standardisiert und unbeaufsichtigt lauffaehig: (1) just-pi-Launcher fragt up-front programmatisch welcher Meilenstein fortgesetzt / neu gestartet wird und startet interaktives pi mit dem gebauten Prompt; (2) Rueckfragen (Spec-Gate, OPEN QUESTION, Cap-Eingriff) laufen blockierend ueber Slack-Kanal C0B8R3ERUNR statt File-Flag-Resume — Antwort wird injiziert, pi laeuft im selben Prozess weiter; (3) damit wird die in CCS-035 offen gebliebene AC#1 (voll-autonomer E2E ohne manuellen Neustart) eingeloest. Org: kein Auto-Push, Dev!=Review getrennt, kein hardcodierter Slack-Token im Repo.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 just pi oeffnet interaktives pi nach programmatischer Discovery: fragt weiter-bei-Meilenstein-X oder neuer-Meilenstein, baut den pi-Prompt aus der Antwort und startet die interaktive Session an dem Punkt
- [ ] #2 Rueckfragen laufen blockierend ueber Slack-Kanal C0B8R3ERUNR (send -> poll -> Antwort injiziert -> selber Lauf weiter); bei Timeout sauberer Fallback auf state.json + ntfy
- [ ] #3 Voll-autonomer E2E ohne manuellen pi-Neustart: pi faehrt einen echten Backlog-Task PICK->SPEC->GATE->DEV->GATE->REVIEW->DONE durch, einzige menschliche Eingriffe = Spec-Gate-Antwort via Slack + finaler Merge
- [ ] #4 Org-Compliance: kein Auto-Push, Dev!=Review als getrennte Sessions, kein Slack-Token-Literal im Repo (SLACK_BOT_TOKEN aus env)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just test passes
<!-- DOD:END -->
