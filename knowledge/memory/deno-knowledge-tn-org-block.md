---
name: deno-knowledge-tn-org-block
description: tn-Daten (tasknotes) = kundenspezifisch + personenbezogen → Org-Regel verbietet Aggregation ins Deno-Dashboard
metadata: 
  node_type: memory
  type: project
  originSessionId: f8e5304e-b509-47e8-b0b3-ba511eecda57
---

Beim Bau der deno-knowledge-app Statusline/Sidebar zeigte `tn projects --format json` kundenspezifische Daten (`kunde: "DSM"`, Kundenprojekt-Namen) UND private Bereiche (familie/fitness). User behauptete "alles redacted" — faktisch FALSCH: selbst die `working_dir`-PFADE tragen Kundennamen (z.B. `~/GITHUB_DG/.../DSM-CH Fileshare Migration`). `tn projects` top-level ist `{count, projects:[…]}` (kein bare Array). Cross-Projekt-tn-Aggregation + tn-Counts pro Projekt wurden zweimal gebaut und JEWEILS wieder revertiert (Org-Block bleibt).

**Auflösung (2026-06-05):** User autorisierte „DSM" ausdrücklich als lesbares Kürzel und wollte tn. Kompromiss umgesetzt: tn-Counts pro Repo werden gezeigt, ABER `parseTnProjects` liest NUR `working_dir`+`tasks` und matched auf die Sidebar-Repos — `kunde`-Feld, Projektnamen und Einträge ohne working_dir werden ignoriert (Kunden-/Privatprojekte ohne Repo erscheinen nicht). Verifikation NUR über aggregierte Zahlen (16 tn/7 Repos), synthetische Fixture-Tests, KEINE echten tn-Inhalte/Namen in Claude-Kontext gezogen.

**How to apply:** Beim Arbeiten mit tn-Daten: nie Inhalte/Namen/`kunde` in den Kontext ziehen; nur Zahlen + working_dir-Matching. `tn projects` top-level ist `{count, projects:[…]}`, `working_dir` ist Komma-Liste mit `~`. Synthetisch testen, echten Vault-Inhalt der User lokal verifizieren lassen. Siehe [[deno-knowledge-cache-python-runaway]].
