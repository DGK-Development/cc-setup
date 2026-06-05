---
name: qmd
description: Hybride Markdown-Suche (BM25 + Vector + HyDE) ueber alle indizierten Vaults/Repos via qmd-CLI. USE WHEN qmd, qmd query, qmd search, hybride suche, semantische suche, vector search, hyde, ueber projekte hinweg suchen, collection list, qmd status, qmd collection.
user-invocable: true
allowed-tools: Bash(redactor wrap -- qmd:*), Bash(qmd:*)
license: MIT
metadata:
  upstream: "@tobilu/qmd"
  upstream_version: "2.0.1"
  adapted_from: ".agents/skills/qmd"
  adapted: "2026-05-17"
---

# /qmd — Quick Markdown Search

Hybrid-Suche ueber alle indizierten Markdown-Sammlungen (Vault + GITHUB-Projekte). Lokal — keine Cloud, kein Netz. Drei Such-Modi (BM25, Vector, HyDE) plus Auto-Expand via lokalem LLM.

**Binary:** `/opt/homebrew/bin/qmd` (v2.1.0)
**Index:** `~/.cache/qmd/index.sqlite` (~333 MB, 9921 Files / 45290 Vectors)
**Strict-Mode:** alle Aufrufe ueber `redactor wrap -- qmd …`

---

## Wann automatisch nutzen

- User fragt "wo steht …" / "haben wir das schon mal …" / "vergleiche … mit …"
- Cross-Projekt-Recherche (Vault + GITHUB-Repos in einem Call)
- Semantische Suche, wenn `r search` (Keyword-only) zu wenig liefert
- Disambiguierung mehrdeutiger Begriffe (`intent:` steering)

**Abgrenzung zu `r search` (recall):** `r search` ist Keyword-only + Temporal-Decay, schnell. `qmd` ist hybrid (BM25 + Vector), kann natuerlichsprachliche Fragen, kostet ~3-5s pro Query (LLM-Expansion).

---

## Indizierte Collections (Stand 2026-05-17)

| Collection | Files | Updated |
|---|---:|---|
| `ObsidianPKM` | 8151 | 2h |
| `yt-gen-pipeline` | 914 | 2h |
| `affiliate-hub-sites` | 352 | 23d |
| `claude-code` | 218 | 28d |
| `claude-research-assistant` | 72 | 27d |
| `obsidian-kanban` | 92 | 29d |
| `deinelistings-de` | 67 | 29d |
| `eink` | 33 | 14h |
| `mac-mini-agent` | 14 | 29d |
| `youtube-summary` | 8 | 41d |
| `wiki` | 0 | — (leer) |
| `sessions` | 0 | — (leer) |

Live abrufen: `redactor wrap -- qmd collection list`. Details zum Verwalten siehe [references/collections.md](references/collections.md).

---

## Standard-Aufrufe

### Auto-Expand (Default)
```bash
redactor wrap -- qmd query "wie funktioniert der wiki-migrate skill"
```
Eine Zeile, kein Praefix — qmd expandiert via lokalem LLM zu lex/vec/hyde-Varianten.

### BM25 only (schnell, kein LLM)
```bash
redactor wrap -- qmd search "wiki migration"
```
Reine Keyword-Suche. Praefix-Match, Phrasen mit `"…"`, Exclude mit `-term`.

### Strukturiertes Query-Dokument
```bash
redactor wrap -- qmd query $'lex: wiki migrate spec\nvec: wie ist die wiki-struktur aufgebaut'
```
Mehrzeiliges Dokument: jede Zeile mit `lex:` / `vec:` / `hyde:` Praefix. Erster Eintrag bekommt 2x Gewicht im Fusion-Ranking.

### Mit Intent-Steering (bei mehrdeutigen Queries)
```bash
redactor wrap -- qmd query $'intent: web page load times\nlex: performance'
```
`intent:` steuert Expansion + Rerank + Snippet-Auswahl, sucht selbst aber nicht.

### Auf bestimmte Collection beschraenken
Geht nur via MCP-Tool (`collections: ["docs"]`) — CLI hat aktuell keinen `--collection`-Filter. Workaround: `qmd ls <collection>` zum Browsen, dann gezielt `qmd get`.

---

## Such-Typen Cheatsheet

| Typ | Methode | Input-Stil | Wann |
|---|---|---|---|
| `lex` | BM25 | 2-5 Keywords, Phrasen, Exclusions | exakte Begriffe, Namen, Code |
| `vec` | Vector | natuerlichsprachliche Frage | wenn Vokabular unklar |
| `hyde` | Vector | 50-100 Woerter hypothetische Antwort | komplexe Themen, beste Recall |
| `expand` (default) | alle 3 | eine Zeile, kein Praefix | quick lookup, "ich weiss nicht genau" |

---

## Dokumente abrufen

```bash
redactor wrap -- qmd get "qmd://ObsidianPKM/README.md"        # via URI
redactor wrap -- qmd get "Atlas/Wiki/Topics/foo.md"            # via Pfad
redactor wrap -- qmd get "#a1b2c3"                             # via Docid
redactor wrap -- qmd multi-get "Atlas/Wiki/Topics/*.md" -l 40  # Batch via Glob
redactor wrap -- qmd ls ObsidianPKM/Atlas/Wiki                 # Index-Browse
```

---

## Wartung

```bash
redactor wrap -- qmd status                       # Health + Collection-Liste
redactor wrap -- qmd update                       # Re-Index aller Collections
redactor wrap -- qmd update --pull                # vorher `git pull` pro Repo
redactor wrap -- qmd embed                        # Vector-Embeddings refreshen
redactor wrap -- qmd cleanup                      # Caches leeren, DB vacuum
```

---

## MCP-Integration (aktiv)

qmd ist als MCP-Server registriert und verbunden — bestaetigt via `claude mcp list`:

```
qmd: qmd mcp - ✓ Connected
```

Verfuegbare Tools (deferred — via ToolSearch ladbar):
- `mcp__qmd__query` — Hybrid-Search (Fusion lex+vec+hyde) mit optionalem `collection`/`intent`/`limit`
- `mcp__qmd__get` — Einzeldokument via URI/Pfad/Docid
- `mcp__qmd__multi_get` — Batch via Glob/CSV
- `mcp__qmd__status` — Index- + Collection-Health

Bevorzugt: **MCP-Tool fuer Agent-Calls**, **CLI fuer ad-hoc Terminal-Use**. Setup-Details: [references/mcp-setup.md](references/mcp-setup.md).

---

## Beispiele

```bash
# Cross-Projekt: wo ueberall taucht "redactor strict mode" auf?
redactor wrap -- qmd query "redactor strict mode subprocess wrap"

# Semantische Frage zur eigenen Wiki-Struktur
redactor wrap -- qmd query "wie verbinde ich topics mit blockedby"

# Phrasen-Suche mit Exclusion
redactor wrap -- qmd search '"yt-gen-pipeline" -archive'

# HyDE fuer komplexes Architektur-Thema
redactor wrap -- qmd query $'hyde: Die Clipping-Pipeline laeuft in zwei Phasen. Phase 1 macht yt-dlp flat-playlist auf Channel-URLs und holt video_ids. Phase 2 ruft claude -p Sonnet parallel auf jedes neue Video.'

# Explain-Mode (zeigt RRF + Rerank-Scores)
redactor wrap -- qmd query --json --explain "wiki migration"
```

---

## Verifizierte Commands (Test-Run 2026-05-17 nach v2.1.0-Upgrade)

| Command | Status |
|---|---|
| `qmd --version` | OK — v2.1.0 |
| `qmd status` | OK — 12 Collections, 9921 Files |
| `qmd collection list` | OK — alle 12 sichtbar |
| `qmd context list` | OK — Kontexte pro Collection |
| `qmd ls` / `qmd ls ObsidianPKM` | OK — Index-Browse |
| `qmd search "<kw>" --limit N` | OK — BM25-Hits in <1s |
| `qmd embed` | OK — Vectors aktuell |
| `qmd get qmd://ObsidianPKM/<pfad>.md` | OK |
| `qmd multi-get qmd://ObsidianPKM/<glob>` | OK (mit URI-Prefix + Lowercase) |
| `qmd --help` | OK |
| `qmd query <q>` (Auto-Expand) | OK — Vector + BM25 + HyDE in ~3-5s |
| `qmd vsearch <q>` | OK — Vector-only |
| `qmd query $'lex:…\nvec:…\nhyde:…'` | OK (siehe Caveat Bindestrich) |

### Bekannte Stolperfallen

1. **Pfad-Casing:** qmd lowercased alle Pfade intern. `qmd://ObsidianPKM/Atlas/Wiki/…` matcht NICHT — `qmd://ObsidianPKM/atlas/wiki/…` schon. `qmd ls <collection>` zeigt das tatsaechliche Casing.

2. **Bindestriche in vec/hyde:** der Parser interpretiert `-wort` ueberall als Negation. In `vec:` und `hyde:` Zeilen wirft das `Error: Negation (-term) is not supported in vec/hyde queries`. Workaround: Bindestriche raus oder durch Leerzeichen ersetzen. Beispiel: `parentTopic-Hierarchie` → `parentTopic Hierarchie`. In `lex:` ist `-term` ja gewollt (Exclusion).

3. **Shell-Quoting fuer Mehrzeilen-Queries:** zwingend `$'...'` (zsh/bash C-style strings), NICHT `$"..."` oder doppelte Quotes — `\n` muss tatsaechlich zu Newline expandiert werden, sonst sieht qmd alles als eine `lex:`-Zeile und ignoriert vec/hyde.

---

## Troubleshooting

- **"command not found":** `npm install -g @tobilu/qmd`
- **Keine Treffer:** `qmd collection list` → ist die Sammlung wirklich indiziert? `qmd embed` zum Vector-Refresh.
- **Erste Suche dauert:** Normal — Embedding-Modelle (~3 GB) werden gelazyload.
- **Index gross:** `qmd cleanup` vacuumt die SQLite-DB.

Weitere Details: [references/mcp-setup.md](references/mcp-setup.md), [references/collections.md](references/collections.md).
