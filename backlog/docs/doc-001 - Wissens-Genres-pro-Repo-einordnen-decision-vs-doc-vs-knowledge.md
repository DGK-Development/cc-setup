---
id: doc-001
title: Wissens-Genres pro Repo einordnen (decision vs doc vs knowledge)
type: guide
created_date: '2026-06-04 21:05'
---

# Wissens-Genres pro Repo einordnen

Operativer Guide zu `decision-001` (Hybrid-Entscheidung). Beantwortet: **Wohin gehört
ein neuer Wissens-Eintrag?** Drei Genres, drei Töpfe — die Wahl hängt davon ab, *was*
der Inhalt ist, nicht wo er gerade entsteht.

## Entscheidungsbaum

1. **Ist es eine Entscheidung?** („Wir wählen X statt Y, weil Z.")
   → `backlog decision` (ADR). Vorausschauend, punkt-in-zeit, append-only.
2. **Ist es eine wiederholbare Anleitung?** („So machen wir X in diesem Repo.")
   → `backlog doc` (type: `guide`). Evolvierbar, im Web-Browser sichtbar.
3. **Ist es eine rückblickende Lektion oder eine Visualisierung?**
   → `knowledge/`. `lektion-*.md` (evidenzlastig) bzw. `*.html` (Mermaid/interaktiv).

## Genre-Tabelle

| Frage | Genre | Topf | Tooling |
|---|---|---|---|
| Warum haben wir X entschieden? | ADR | `backlog/decisions/` | `backlog decision create` + Datei-/Web-Edit |
| Wie machen wir X (Standard)? | Guide | `backlog/docs/` | `backlog doc create/update` (CLI+MCP+Web) |
| Welcher Fehler trat auf + Fix? | Lesson | `knowledge/lektion-*.md` | Write-Tool, CLAUDE.md-Index |
| Visuelle Analyse (Flowchart)? | Visual | `knowledge/*.html` | Write-Tool (Backlog rendert kein HTML) |

## Warum nicht alles in Backlog?

- **ADR ≠ Lesson.** Eine Decision ist append-only (superseded statt gelöscht);
  eine Lesson evolviert mit neuer Evidenz. Verschiedene Lebenszyklen.
- **Decisions haben Tooling-Reibung:** kein CLI-`edit`, keine MCP-Tools — Body nur
  per Datei-Edit oder `backlog browser`. Für agentengetriebene, häufig editierte
  Inhalte ungeeignet → solche Inhalte als `doc` führen.
- **Backlog rendert nur Markdown**, kein arbiträres HTML/Live-Mermaid → Visuals
  bleiben Files.
- **Kein Lock-in in beide Richtungen:** Backlog-Docs/Decisions sind selbst nur
  Markdown im Git, also grep-/qmd-indexierbar wie `knowledge/`.

## Konkrete Befehle

```bash
# ADR (Entscheidung)
backlog decision create "<Titel>"            # legt Skelett an (status: proposed)
#   danach Body füllen: Datei editieren ODER backlog browser
#   --status accepted  setzt den Status direkt beim Anlegen

# Guide (How-we-do-X)
backlog doc create "<Titel>" -t guide
backlog doc update doc-N --content "..."     # editierbar, evolvierend
backlog doc list   #   backlog doc view doc-N

# Suche über task + document + decision gemeinsam
backlog search "<thema>" --plain

# Alles ansehen (Tasks-Board, Docs, Decisions)
backlog browser
```

## Referenzen

- `decision-001` — die zugrundeliegende Hybrid-Entscheidung
- `knowledge/README-backlog.html` — vollständige CRUD-Matrix + Verbindungs-Diagramm
- `knowledge/README.md` — Konvention für `knowledge/`-Einträge (Slug, CLAUDE.md-Index)
