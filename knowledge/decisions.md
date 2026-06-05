# cc-setup — Decisions

Append-only Entscheidungs-Log (neueste oben). Status: `proposed` · `accepted` · `superseded`.
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
