# Plan: deno-knowledge-app „aufgeräumt" — Design & Struktur

## Context

Das knowledge-Dashboard (`deno-knowledge-app`) wirkt überladen: **zwei gestapelte
Kopfzeilen** (`.kn-status` + `.kn-tabs`), **zwei Navi-Spalten** (`.kn-projects`
Projektliste + `.mp-nav` Sektions-Nav), **Null-Rauschen** in der Projektliste
(`0 offen · 0 tn · $0.00` auf fast jeder Zeile) und im Skill-Detail mehrfach
wiederholte Beschreibungen.

Eine Claude-Design-Vorlage (`aufgeraeumt/Dashboard.html` + `clean.css` +
`views.js`, extrahiert nach `/tmp/design-ref/`) räumt das auf: **1 Header**,
**3 Panes**, Null-Rauschen weg, Skills mit Init-Load-Tokens statt Status-Punkt,
entdoppeltes Detail, plus eine **neue Projekt-Übersichtsseite**. Der Prototyp ist
ein statischer Single-Page-Mock — Ziel ist, die *visuellen* Aspekte in die echte
Deno-App zu portieren (Server-Render `render.ts` + Client-Renderer `browser.js` +
Daten `context.ts/buildData` + Tokens `dash.css`/`browser.css`).

## Scope-Entscheidungen (vom User bestätigt)

1. **Globaler „Überblick": Tiles behalten, nur restylen.** Das bestehende
   tmux-Tile-Grid (`renderOverview`, inkl. Git/Cost-Limits/Sessions-Health) bleibt
   inhaltlich erhalten und wird nur ins neue 1-Header-/3-Spalten-Layout gesetzt.
2. **Bestehende Server-Architektur behalten.** Überblick- vs. Projekt-Ansicht
   bleiben serverseitig getrennt (Projektwechsel = Reload via `?project=`, eigene
   `nav` je Ansicht). Kein Single-Page-Client-Router. → geringes Regressionsrisiko,
   Tests bleiben weitgehend stabil.

## Constraints

- **Org-Regel (Pflicht): Entwicklung und Review nie in derselben Session.**
  Umsetzung über Subagenten: Implementierung → `developer`-Subagent; danach
  unabhängiges Review → `reviewer`-Subagent; SPOC verifiziert Self-Report eigenständig.
- **tn Org-Block:** tn-Daten sind kunden-/personenbezogen. tn-**Inhalte** (Titel,
  Sektionen) nur für das **aktive Projekt** rendern (wie bisher `COLL.tn`).
  Cross-project nur **Zahlen** (`OV.tn_total`, Header-Summe). Niemals tn-Inhalte
  projektübergreifend aggregieren.
- **Surgical:** nur anfassen, was der Umbau braucht. Catppuccin-Tokens aus
  `dash.css` wiederverwenden (alle benötigten Variablen existieren bereits).

## Ist-Struktur (Referenz)

```
.kn-shell
├── .kn-status      ← Kopfzeile 1 (Global-Stats)            [render.ts]
├── .kn-tabs        ← Kopfzeile 2 (Titel + Theme-Toggle)     [render.ts/browser.css]
└── .kn-body
    ├── aside.kn-projects  ← Projektliste (Sidebar A)        [render.ts SIDEBAR_CSS]
    └── .mp (#mp)  grid 214/280/1fr
        ├── nav#mp-nav   ← Sektions-Nav (Sidebar B)          [browser.js + browser.css]
        ├── #mp-list     ← Liste                              [browser.js]
        └── #mp-detail   ← Detail                             [browser.js]
```

## Ziel-Struktur

```
.kn-shell
├── header.hd       ← 1 Header: lights · Breadcrumb(root/here/scope) · Stats · asof · Theme
└── .kn-body
    ├── aside.pane-side    ← EINE Sidebar:
    │     ├── nav#mp-nav        (Sektions-Nav, client-rendered, id bleibt)
    │     └── .proj-list        (Projektliste, server-rendered, zero-noise + chips)
    └── .mp (#mp)  grid 280/1fr  (is-overview → 1fr)
        ├── #mp-list
        └── #mp-detail
```

## Änderungen pro Datei

### `src/render.ts` (Shell + inline CSS)
- **Header zusammenführen:** `.kn-status` + `.kn-tabs` → ein `header.hd` mit
  macOS-Lights, Breadcrumb (`knowledge / <here> <scope>`, IDs `crumb-here`/`crumb-scope`),
  kompakten Stats rechts (`<b>N</b>` Projekte · offen · tn · ≈$/7T), `asof` (Stand),
  Theme-Button (`id="kn-theme-toggle"` behalten). Stats-Werte: bestehende
  `sb.length`/`sumOpen`/`sumTn`/`sumCost`-Berechnung wiederverwenden.
- **Sidebar mergen:** `.kn-body` enthält `aside.pane-side` mit (a) `<nav id="mp-nav">`
  (leer, browser.js füllt) und (b) der Projektliste; danach `.mp` mit nur `#mp-list`
  + `#mp-detail`. `#mp-nav`-ID **beibehalten** (browser.js + `server_test.ts`).
- **Projektliste zero-noise + chips:** nur Projekte mit `open_tasks||tn||cost_7d`
  sichtbar; Rest als versteckte Rows + Zeile „+ N ohne Aktivität" (Toggle via
  kleinem inline-Script oder browser.js — Rows stehen schon im DOM, nur `hidden`).
  Chips farbcodiert nur wenn Wert > 0 (`.ch.open`/`.ch.tn`/`.ch.cost`). Aktive-Projekt-
  Row weiter mit Live-Counts (`ov.backlog_open`/`ov.tn_open`) wie bisher.
- **Neue inline-CSS-Blöcke** (analog vorhandener `SIDEBAR_CSS`/`KANBAN_CSS`),
  portiert aus `clean.css`: `HEADER_CSS` (.hd/.lights/.crumb/.stats/.stat/.asof/.tg),
  überarbeitetes `SIDEBAR_CSS` (.pane-side/.proj-list/.proj-i/.proj-chips/.ch/.proj-more),
  `PROJECT_CSS` (Projektseite, s.u.). dash.css/browser.css bleiben Basis.

### `assets/browser.css` (strukturelle Anpassungen)
- `.mp` Grid `280px 1fr` (statt `214/280/1fr`), `.mp.is-overview` → `1fr`.
- `.kn-tabs`-Block entfällt (Header lebt jetzt in `.hd`); `.kn-theme` an `.hd .tg` angleichen.
- `.li`: von `grid auto/1fr` → Flex (Name+Sub links, Init-Load-Token rechts), Status-Dot
  bei knowledge-Typen weg (`.li-tok` aus `clean.css`).
- `.mp-nav`-Styling in die Sidebar überführen (kein eigener Border-Right mehr;
  Sidebar hat einen).
- `dt-raw` (eingeklapptes SKILL.md) ergänzen.

### `assets/browser.js` (Client-Renderer)
- **Nav-Mount:** unverändert `getElementById("mp-nav")` (Element nur verschoben).
- **Breadcrumb:** `select(id)` setzt `#crumb-here` (Nav-Label) + `#crumb-scope`
  (z.B. „· alle Projekte · global" bzw. „· Projekt"). Helfer am Anfang cachen.
- **Skills/Knowledge-Liste:** in `makeRow` für `c.type` skill/agent/know/lesson/memory
  den führenden Dot weglassen und rechts Init-Load-Tokens rendern
  (`~<ktok(it.metaTokens)> tok · init`; `metaTokens` liegt bereits in `skills`/`agents`
  aus buildData — bei know/lesson/memory ohne metaTokens: kein Token-Tag).
- **Detail entdoppeln:** SKILL.md/Agent-Definition-Sektion in `<details class="dt-raw">`
  (default zu). Beschreibung steht einmal als `dt-desc` (descHtml) — schon so;
  nur das Roh-File einklappen.
- **Neue `renderProjectOverview()`** (Projekt-Ansicht-Landing, ersetzt für
  `view=project` den tmux-Grid; globaler Überblick behält `renderOverview`):
  `select("ov")` → `ACTIVE ? renderProjectOverview() : renderOverview()`.
  Bullet-Journal-Glyph-Helfer `statusIcon` (open/wip/done — **kein** deleg) aus
  `views.js` portieren.

### `test/render_test.ts` (Assertions an neues Markup angleichen)
- Header-Test: `kn-status` → neue Header-Marker (Stats-Werte `<b>5</b>` Projekte/offen/tn,
  Breadcrumb/Sidebar „Überblick").
- Projekt-Row-Tests (`<b>7</b> offen` / `<b>0</b> offen`): an Chip-Markup
  (`<span class="ch open">7 offen</span>`) anpassen.
- `server_test.ts` (`mp-nav`) bleibt grün, da ID erhalten. CCS-031-Test
  (`context`/`system_prompt`/`renderContext`/`Kontext`) bleibt grün.

## Neue Projekt-Übersichtsseite (`renderProjectOverview`, alle Daten aus `window.DATA`)

1. **Kopf:** Projektname (`ACTIVE`) · Branch (`meta.branch`) · CLAUDE.md
   (`COLL.psections.doc.tokens`/`.size`).
2. **KPI-Leiste (5):** tn-Tasks (`COLL.tn.items.length`) · Meilensteine
   (`OV.ms_total`) · offene Subtasks (`OV.backlog_open`) · 7-Tage-Kosten
   (aktives Projekt aus `DATA.projects`/`OV.cost_7d`) · Projekt-Init-Load
   (`OV.proj_init_tok`).
3. **Wissens-Reihe:** *links* CLAUDE.md-Abschnitte als Tags (`COLL.psections.items`)
   + Init-Load-Token-Balken (CLAUDE.md-Projekt `pdoc`, MEMORY aus `COLL.context`
   memory-Items; Werte datentreu, fehlende Quelle weglassen). *rechts* Wissens-Index
   (`OV.know_counts`: decisions/lektionen/memory/docs), darunter Decisions
   (`OV.decisions`/`COLL.decisions`) und Changelog (`COLL.changelog`).
4. **Aufgaben-Reihe:** *links* Tasknotes (`COLL.tn`, Sektionen Überfällig/Next/Blockiert
   nach `col`, farbcodierte Köpfe, Datum/Note rechts) — **nur aktives Projekt**.
   *rechts* Backlog (`COLL.backlog.items` nach `milestone` gruppiert → Meilenstein-Kopf
   mit offen/total + Glyph, eingerückte Subtasks; Status open/in progress/done).
   „Quelle"-Tags trennen tn (Tasknotes) und Backlog (Backlog.md).

## Verifikation

- `deno task test` (alle Tests grün; render_test/server_test/parity/sidebar/collectors).
- `deno task check` + `deno task lint` + `deno task fmt` sauber.
- **Visuell:** `deno task start` (bzw. `dev`), im Browser prüfen:
  (a) Überblick (Tiles im neuen Layout), (b) Projekt-Ansicht (neue Projektseite:
  Header, 5 KPIs, Wissens-Reihe, Aufgaben-Reihe mit tn links/Backlog rechts),
  (c) Skills-Liste (kein Dot, Init-Load-Token rechts; Detail mit eingeklapptem
  SKILL.md), (d) zero-noise Projektliste + „+N ohne Aktivität", (e) Theme-Toggle,
  (f) keine Konsolenfehler. Regression: Git-/Cost-/tn-Board-/Kontext-Sektionen
  weiter funktional.

## Workflow (Org-konform)

1. `developer`-Subagent: implementiert obige Änderungen, lässt `deno task test/check/lint`
   laufen, meldet Ergebnis.
2. `reviewer`-Subagent (separate Session): reviewt Diff gegen Plan + Constraints
   (tn-Org-Block, surgical, keine gebrochenen Tests).
3. SPOC: Self-Report unabhängig verifizieren (Tests real nachfahren + 1 visueller
   Check), dann dem User Stand melden. **Kein Commit/Push ohne User-Freigabe**
   (Auto-Sync-Push-Hazard).
