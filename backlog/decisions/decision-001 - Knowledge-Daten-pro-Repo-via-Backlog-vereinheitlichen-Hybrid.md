---
id: decision-001
title: Knowledge-Daten pro Repo via Backlog vereinheitlichen (Hybrid)
date: '2026-06-04 21:04'
status: accepted
---
## Context

Pro Repo existieren zwei parallele Systeme: **Backlog.md** für Task-Management
(`backlog/tasks/`, Milestones, Sprints) und ein handgepflegter **`knowledge/`-Ordner**
für Wissen (`lektion-*.md` Lessons-Learned, `standardisiertes-vorgehen-*.md` Guides,
`*.html` Mermaid-Analysen, referenziert über den CLAUDE.md-„Knowledge Index").

Ziel war zu prüfen, ob Backlog **eine einzige Quelle für Task- UND Knowledge-Management**
pro Repo werden kann — insbesondere ob die Backlog-Entitäten `decision` und `document`
den bisherigen Ansatz (Decision-Changelog + Lessons-Learned) ersetzen.

Analyse des Backlog-Quellcodes (`opensrc MrLesk/Backlog.md`, main) ergab:

- Backlog speichert alle Entities (`task`/`draft`/`document`/`decision`/`milestone`)
  als reine Markdown-Files im Git → grep-/qmd-indexierbar, **kein Lock-in**.
- `decision` ist ein **ADR-Format** (Context/Decision/Consequences, Status
  proposed→accepted→rejected→superseded) — vorausschauend, punkt-in-zeit.
- Tooling-Asymmetrie: `task`/`document` haben volles CRUD (CLI+MCP+Web);
  `decision` hat **nur `create`** (leeres Skelett) — kein CLI-`edit`, keine MCP-Tools;
  Body wird per Datei-Edit oder Web-UI gefüllt.
- Backlog rendert nur Markdown — **kein arbiträres HTML/Live-Mermaid**.

Vollständige Landkarte: `knowledge/README-backlog.html`.

## Decision

Wir vereinheitlichen Knowledge pro Repo **nicht voll**, sondern als **Hybrid nach Genre** —
weil ADR und Lessons-Learned verschiedene Genres sind und das Erzwingen einer Form
beide verbiegt:

| Inhalt | Ziel |
|---|---|
| Echte Entscheidungen („wir wählen X statt Y") | **`backlog decision`** |
| How-we-do-X-Guides (`standardisiertes-vorgehen-*`) | **`backlog doc`** (type: guide) |
| Lessons-Learned (`lektion-*`) | bleiben in **`knowledge/`** (evidenzlastig, evolvierend) |
| Interaktive HTML/Mermaid-Analysen | bleiben **Files** in `knowledge/` |

**Grenzregel (eine Zeile in CLAUDE.md):** ADR → `decision`, Guide → `doc`,
Lesson/Visual → `knowledge/`.

Task-Management bleibt unverändert die Domäne von Backlog (`backlog/tasks/`, Sprints).

## Consequences

### Positive
- Echte Entscheidungen bekommen Nummerierung, Status-Lifecycle, gemeinsame
  `backlog search` und Web-UI-Ansicht (`backlog browser`).
- Guides werden über CLI+MCP editierbar und im Browser sichtbar.
- Kein Lock-in: alles bleibt Plain-Markdown im Git (grep/qmd weiterhin nutzbar).
- Klare Genre-Grenze verhindert „Decision vs. Lesson"-Verwirrung.

### Negative
- Zwei Taxonomien koexistieren (`backlog/` + `knowledge/`) — erfordert Disziplin
  bei der Einordnung.
- Decisions haben Tooling-Reibung: Body nur per Datei-Edit oder Web-UI pflegbar
  (kein agentenfreundliches CLI-`edit`).
- HTML/Mermaid-Visualisierungen lassen sich nicht in die Backlog-Web-UI ziehen.

### Mitigation
- Genre-Grenzregel in CLAUDE.md verankern (siehe `doc-001`).
- Pilot zuerst (diese Decision + ein Guide-Doc), vor jeglicher Migration bestehender
  `knowledge/`-Inhalte.
- `knowledge/README-backlog.html` als Referenz für die CRUD-Matrix behalten.

## Alternatives

- **Voll-Konsolidierung** (alles in Backlog): 1 Web-UI/Suche/Mentalmodell, aber
  HTML/Mermaid verloren, CLAUDE.md-„on-demand-Load"-Muster muss umgebaut werden,
  Decision-Editing klobig. → verworfen.
- **Status quo** (`knowledge/` komplett getrennt): HTML funktioniert, CLAUDE.md-Muster
  bleibt, aber keine vereinte Suche/Web-UI, kein Status-Lifecycle für Entscheidungen.
  → verworfen zugunsten des Hybrids.

## References

- `knowledge/README-backlog.html` — Datei-Modell, Verbindungen, CRUD-Matrix
- `doc-001` — Guide: Wissens-Genres pro Repo einordnen
- Quelle: `opensrc MrLesk/Backlog.md` (main) — `src/types/index.ts`, `src/cli.ts`

