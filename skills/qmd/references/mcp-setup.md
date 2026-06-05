# qmd als MCP-Server in Claude Code einbinden

## Status

Aktuell **NICHT** registriert in Claude Code. `claude mcp list` zeigt nur:
- claude.ai Google Drive
- claude.ai Gmail
- claude.ai Google Calendar

Suche laeuft via CLI (`redactor wrap -- qmd …`). Das funktioniert tadellos. MCP ist eine optionale Erweiterung — schoener fuer Claude (strukturiertes JSON-Output, weniger Tokens), aber nicht zwingend.

## Vor- und Nachteile

| | CLI | MCP |
|---|---|---|
| Setup | bereits da | settings.json + Restart |
| Output | Text | strukturiertes JSON |
| Token-Kosten | hoch (Snippets als Text) | niedrig (Server haendelt Trimming) |
| Strict-Mode kompatibel | Ja (`redactor wrap`) | nicht relevant — Tool-Calls statt Shell |
| Multi-Search im selben Call | nein, sequentiell | Ja (Array von Suchen) |
| Collection-Filter | nein | Ja (`collections: ["docs"]`) |

## Installation

**Per CLI (empfohlen):**
```bash
redactor wrap -- claude mcp add qmd qmd mcp
```

**Manuell:** in `/Users/niclasedge/.claude/settings.json` (oder `.claude/settings.local.json` fuer projekt-scoped) den `mcpServers`-Block ergaenzen:

```json
{
  "mcpServers": {
    "qmd": {
      "command": "qmd",
      "args": ["mcp"]
    }
  }
}
```

Danach Claude Code neu starten (`/restart` oder neue Session).

## Verifizieren

```bash
redactor wrap -- claude mcp list
# sollte "qmd" zeigen, ggf. mit Status "OK" oder "Connecting…"
```

In Claude Code tauchen dann die Tools auf:
- `mcp__qmd__query` — Strukturierte Suche
- `mcp__qmd__get` — Einzeldokument
- `mcp__qmd__multi_get` — Batch-Abruf
- `mcp__qmd__status` — Health-Check

## MCP-Tool: `query`

```json
{
  "searches": [
    { "type": "lex", "query": "wiki migrate spec" },
    { "type": "vec", "query": "wie ist die wiki-struktur aufgebaut" }
  ],
  "collections": ["ObsidianPKM"],
  "intent": "topic-hierarchie und slug-chain",
  "limit": 10,
  "minScore": 0.0
}
```

Felder:
| Feld | Typ | Default |
|---|---|---|
| `searches[].type` | `lex` \| `vec` \| `hyde` | required |
| `searches[].query` | string | required |
| `collections` | string[]? | alle |
| `intent` | string? | none |
| `limit` | number? | 10 |
| `minScore` | number? | 0.0 |

## MCP-Tool: `get`

```json
{ "path": "qmd://ObsidianPKM/README.md", "full": false, "lineNumbers": true }
```

`path` akzeptiert Pfad, `qmd://`-URI oder `#docid`.

## MCP-Tool: `multi_get`

```json
{ "pattern": "Atlas/Wiki/Topics/*.md", "maxBytes": 10240 }
```

`pattern` ist Glob oder kommaseparierte Liste.

## HTTP-Modus (alternative)

Wenn qmd parallel von mehreren Clients genutzt wird, lohnt sich der HTTP-Daemon:

```bash
redactor wrap -- qmd mcp --http --daemon       # Port 8181
redactor wrap -- qmd mcp stop                   # stop daemon

# Test
redactor wrap -- curl -X POST http://localhost:8181/query \
  -H "Content-Type: application/json" \
  -d '{"searches": [{"type":"lex","query":"test"}]}'
```

## Troubleshooting

- **MCP nicht da nach Reload:** `redactor wrap -- which qmd` → Pfad pruefen. Bei nicht-standard-Install: absoluten Pfad in `command:` eintragen.
- **"connection refused":** `qmd mcp` manuell starten, Errors lesen.
- **Slow first response:** Embedding-Modelle laden (~3 GB). Einmal aufwaermen, dann schnell.
- **Kein Result trotz Treffer in CLI:** `collections`-Filter checken — leere Liste = keine Treffer.
