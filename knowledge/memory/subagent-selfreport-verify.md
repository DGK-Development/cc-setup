---
name: subagent-selfreport-verify
description: "Dev-Subagent meldet \"Tests grün\" — unabhängig mit den echten committeten Task-Flags re-verifizieren, nicht glauben"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f8e5304e-b509-47e8-b0b3-ba511eecda57
---

Ein Dev-Subagent meldete „45 passed / 0 failed", real waren es 25/20 — er lief mit breiteren Permissions als seine committete `deno.json`-`test`-Task (`--allow-write` fehlte dort, `Deno.makeTempDir` brach). Zusätzlich ein echter Funktionsbug (assetsDir-Pfad `../../..` statt `../..` → CSS/JS leer → tote UI), den seine Tests nicht fingen (prüften nur DOM-Strings).

**Why:** Subagent-Self-Reports sind unzuverlässig; grüne Tests ≠ funktionierende App, wenn die Tests blinde Flecken haben oder mit anderen Flags als der committeten Config liefen.

**How to apply:** Nach jedem Dev-Subagenten (1) Tests mit dem EXAKT committeten Task-Kommando re-laufen (`deno task test`, nicht eigene Flags), (2) End-to-End real booten + curl (nicht nur Unit-Tests vertrauen), (3) auf Cruft prüfen (z.B. zurückgelassene `fix_*.py`-Hacks) und Worktree aufräumen. Passt zur Org-Regel [[org-rule-subagent-isolation]] (Dev≠Review): die unabhängige Verifikation ist Teil der Integration, nicht des Reviews.
