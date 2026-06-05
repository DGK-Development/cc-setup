# knowledge/ — Single Knowledge Store

Dieser Ordner hält **alles Wissen** des Repos. Backlog ist **nur** für Tasks.

## Die eine Regel (decision-003)

> **Task? → `backlog`. Sonst → `knowledge/`.**

Kein „decision vs doc vs knowledge"-Routing mehr. `CLAUDE.md` bleibt dünn (nur Regeln +
1-Zeilen-Index) — Wissen wird **on-demand** aus diesem Ordner gelesen, nie inline in CLAUDE.md
(das lädt jeden Turn).

## Was wohin

| Inhalt | Datei |
|---|---|
| Entscheidung (ADR) | `decisions.md` — append-only, neueste oben (`## NNN — Titel`) |
| Lektion / Lessons-Learned | `lektion-<thema>.md` |
| Guide „so machen wir X" | `<slug>.md` (z.B. `architektur-deployment.md`) |
| Visualisierung / Analyse | `*.html` (Backlog rendert kein HTML) |

## CLAUDE.md-Referenz-Pattern

Statt Volltext nur eine Zeile pro Wissensdatei:

```markdown
## Knowledge Index
- [Title](knowledge/<slug>.md) — wann brauche ich das? (~120 Zeichen)
```

## Naming

kebab-case, max 50 Zeichen. `lektion-<thema>.md` für Lessons, `<thema>.md` für Guides,
`decisions.md` für Entscheidungen.

## Neuer Eintrag

- **Entscheidung** → neuen `## NNN — Titel` oben in `decisions.md` (Context/Decision/Consequences, knapp).
- **Lektion/Guide** → neue Datei + 1-Zeilen-Index in CLAUDE.md.
- **Visual** → `*.html` + Index-Zeile.

## Index

- **Live-Übersicht:** `just overview` startet den Terminal-3-Pane-Status-Browser (`scripts/knowledge.py`, FastAPI/localhost, dark) — Nav→Liste→Detail über Global · Projekt · Git · Wissen · Backlog · Usage; Git-Detail mit gated Actions (commit/push/merge/delete). Design-Assets: `scripts/knowledge_assets/`.
- [Decisions](decisions.md) — alle Architektur-/Design-Entscheidungen (003 Konsolidierung, 002 Flat-Install, 001 superseded).
- [Architektur & Deployment](architektur-deployment.md) — Repo-Layout, `just deploy` (2 Phasen), Hook-Runtime-Verhalten, Dependencies.
- [Lektion: Redactor Top-3-Fehler](lektion-redactor-strict-mode-haeufigste-fehlerquelle.md) — wrap vergessen, JSON via wrap statt `--type json`, `CLAUDE_PLUGIN_ROOT` undefiniert.
- [Session-Lifecycle, Wissens-Architektur & Zielbild (HTML)](session-lifecycle-hooks-analyse.html) — Lifecycle/Hooks/Skills (Backlog-primär vs. tn-on-demand) + 2-Töpfe-Wissensmodell + CLAUDE.md-Slimming-Zielbild.
- [Backlog Datei-Modell (HTML)](README-backlog.html) — historische Capability-Analyse von Backlog (Entity-Typen, CRUD-Matrix); Referenz, nicht mehr Empfehlung.
- [Template: standardisiertes Vorgehen](standardisiertes-vorgehen-fuer-x.md) — Kopiervorlage für einen „so machen wir X"-Guide.
- `skills.csv` — Skill-Inventar (Quelle, Trigger, Funktionsumfang, cc-setup-Tier-1).
