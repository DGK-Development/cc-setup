---
name: pi-new-milestone-elaboration
description: "pio Neuer-Meilenstein: Launcher zerlegt per milestone-planner-Worker in Draft-Tasks + Human-Gate; Orchestrator-Pipeline unverändert"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4e9ecb1b-a1db-4f64-a6f4-7d0db66a8c7e
---

Bei `pio` → „Neuer Meilenstein" arbeitete der Orchestrator früher stumpf den global nächsten To-Do ab (`backlog_next`), weil [[pi-orchestrator-workflow]]/CCS-036.07 den Neu-Fall bewusst offen ließ (CC_ORCH_MILESTONE unset). Implementiert (CCS-036.15, User-Entscheid: **Launcher-Pre-Decomposition**, Orchestrator-Extension bleibt unverändert):

- **Neue Rolle `.pi/agents/milestone-planner.md`** (tools: read,bash,grep,find,ls): liest CLAUDE.md + `backlog task list` zum Grounding, zerlegt das Meilenstein-Ziel in 3–7 atomare Tasks und legt sie als **Drafts** an (`backlog task create --draft -m "<name>"`). Promotet NICHT.
- **`scripts/pi-launch.sh` Live-Pfad** (nur non-DRY_RUN): fragt Ziel/Beschreibung → dispatcht den Worker via `cc-dispatch.ts --model claude-sonnet-4-6` → erkennt neue Drafts per **Snapshot-Diff** von `backlog draft list` → **Human-Gate**: `j` = `backlog draft promote` (→ To Do), sonst `backlog draft archive`; ohne Freigabe wird pi NICHT gestartet → setzt `CC_ORCH_MILESTONE` + scoped „Continue milestone"-Prompt → `exec pi`.
- DRY_RUN (`--print-prompt`) bleibt seiteneffektfrei (alter Prompt-Shape), damit `test_pi_launch.py` grün bleibt.

Wichtig: braucht den canUseTool-Fix ([[pi-worker-canusetool-permissions]]) — der Worker nutzt Bash für `backlog`. `CC_DISPATCH_CMD`-Env erlaubt Test-Fakes. Verifiziert: echter Lauf 4 Drafts → PIT-5..8 → scoped Stub-pi; Reject/keine-Drafts-Pfade ok.
