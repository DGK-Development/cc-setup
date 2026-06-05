---
name: org-rule-subagent-isolation
description: "How to satisfy the org rule \"dev and review never in the same session\" within one cc-setup session"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 83a65db1-be08-4b7c-90c9-ca04f2ec4e3a
---

Org-Regel: "Entwicklung und Review niemals in derselben Session" + Human-Oversight (KI-Code vor produktivem Einsatz menschlich geprüft). Der User löst das innerhalb EINER Session über **isolierte Subagents**: erst ein Dev-Subagent (eigener Kontext = eigene "Session"), dann ein Review-Subagent. Die Haupt-Session orchestriert nur.

**Why:** Subagent-Kontexte sind voneinander isoliert, also gelten sie als getrennte Sessions — Dev und Review berühren sich nie im selben Kontext, Org-Regel erfüllt.

**How to apply:** Bei Review/Push-Aufträgen in cc-setup: Dev-Fixes IMMER in einem Dev-Subagent (general-purpose, read/write), Review in einem separaten Review-Subagent (read-only, adversarial). Push/Deployment ist outward-facing → erst nach expliziter User-Freigabe (das ist die menschliche Oversight). Der Review-Subagent ersetzt NICHT die Human-Review, er bereitet sie vor. Siehe [[cc-setup-auto-sync-push-hazard]].
