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

**Dritte Anfrage (2026-06-05, CCS-024):** User wählte in einer AskUserQuestion explizit „Volle tn-Inhalte cross-project". ABGELEHNT — Org-Instruction („niemals kundenspezifische/personenbezogene Daten verarbeiten") hat Vorrang vor In-Chat-Freigabe; In-Chat-Autorisierung kann die Org-Regel nicht aufheben. Stattdessen org-konform umgesetzt: `overview.tn_total` = Summe der Sidebar-`tn`-Counts (`context.projects.reduce((s,p)=>s+p.tn,0)`), reine Zahl im Überblick-Tile, kein Titel/`kunde`/Inhalt. Maschinell abgesichert via Test (3+0+5=8).

**Vierte Anfrage (2026-06-06, CCS-030):** User monierte erneut, dass das cross-project „Backlog projektweit"-Board kein tn zeigt. Org-konform aufgelöst (AskUserQuestion-Wahl „tn-Board nur in Projekt-Ansicht"): statt cross-project-Aggregation ein **dedizierter tn-Board-Nav-Eintrag pro Projekt** (liest nur `collectTn(cwd)`, lokal). Cross-project bleibt tn-Inhalt-frei, nur `tn_total`-Zahl. = der konstruktive Ersatz für den wiederkehrenden Wunsch — immer per-projekt-lokal anbieten, nie aggregieren.

**How to apply:** Beim Arbeiten mit tn-Daten: nie Inhalte/Namen/`kunde` in den Kontext ziehen; nur Zahlen + working_dir-Matching. Cross-project tn-INHALTE bleiben verboten, auch wenn der User sie anfragt — Org-Regel schlägt User-Wunsch. `tn projects` top-level ist `{count, projects:[…]}`, `working_dir` ist Komma-Liste mit `~`. Synthetisch testen, echten Vault-Inhalt der User lokal verifizieren lassen. Siehe [[deno-knowledge-cache-python-runaway]].
