---
name: deno-knowledge-tn-org-block
description: tn-Daten (tasknotes) = kundenspezifisch + personenbezogen → Org-Regel verbietet Aggregation ins Deno-Dashboard
metadata: 
  node_type: memory
  type: project
  originSessionId: f8e5304e-b509-47e8-b0b3-ba511eecda57
---

Beim Bau der deno-knowledge-app Statusline/Sidebar zeigte `tn projects --format json` kundenspezifische Daten (`kunde: "DSM"`, Kundenprojekt-Namen) UND private Bereiche (familie/fitness). Cross-Projekt-tn-Aggregation + tn-Counts pro Projekt in der Sidebar wurden deshalb NICHT gebaut und der tn-Call aus dem Cache-Aggregat entfernt.

**Why:** Org-Regel — niemals kundenspezifische/personenbezogene Daten verarbeiten. Das Vault-tn-System spannt genau diese auf (work/kunde + private Bereiche). Ein Dashboard, das tn projektübergreifend aggregiert, zieht das systematisch rein.

**How to apply:** Im Deno-Dashboard NUR Repo-Backlog (Dev-Tasks aus `backlog/tasks/`) + Token-Kosten cross-project aggregieren. tn nur als per-Projekt-Sektion im gewählten Projekt-View (user-initiiert, einzeln) belassen — NICHT auto-aggregieren. `tn projects`/vault-weite tn-Calls meiden (exponieren Kunden-/Privatdaten ins Context). Siehe [[deno-knowledge-cache-python-runaway]].
