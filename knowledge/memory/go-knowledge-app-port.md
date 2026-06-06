---
name: go-knowledge-app-port
description: "Go-1:1-Port der deno-knowledge-app — Phase 1 (Quellcode) fertig+verifiziert, Tests offen"
metadata: 
  node_type: memory
  type: project
  originSessionId: c6641432-a1dd-41fd-83e2-380ccfe312e7
---

`go-knowledge-app/` ist der 1:1-Go-Port der `deno-knowledge-app` (begonnen 2026-06-06, User-Auftrag "schreibe um in go … just go 1:1 umsetzen").

**Stand:** Phase 1 (kompletter Quellcode, ~6.000 Z. TS → Go) fertig + end-to-end gegen echtes cc-setup verifiziert (skills 49 / agents 23 / hooks 8 / backlog 63·59done·4offen — rekonziliert mit Repo). `just go` startet, `just go-build` ist das Gate. **Phase 2 (Tests, ~2.400 Z.) bewusst offen** — User wählte "Quellcode zuerst, Tests danach".

**Layout:** `internal/{shared,md,collectors,appctx,render,cache,server,assets}` + `main.go`. 13 Collectors als eigene Dateien in `package collectors`.

**Schlüssel-Entscheidungen (für Reviewer):**
- Assets via **go:embed** (`internal/assets/static/`) → 1 selbstständiges Binary (nicht Disk-serviert wie Deno).
- `buildData` navigiert per **JSON-Roundtrip** (`dyn()`) den Context dynamisch — bildet JS' `Record<string,unknown>`-Zugriff 1:1 ab, statt typisierte Structs zu casten.
- `tool_freq` als `orderedIntObj` (custom MarshalJSON) → count-desc-Order bleibt erhalten (Go-Maps sortieren Keys sonst alpha).
- scripts-dir-Resolution via **Upward-Search** ab cwd/exe (Deno nutzt import.meta.url) + `CC_KNOWLEDGE_SCRIPTS_DIR`-Override.
- `safeScriptJson` = nacktes `json.Marshal` (Go escapt `<>&`+U+2028/9 schon by default).

**Bewusste, dokumentierte Abweichungen (cosmetic, im Code kommentiert):** localeCompare approximiert (lower+byte-tiebreak); readDir/map-Order deterministisch-sortiert statt FS-/Insertion-Order (betrifft nur Anzeige-Reihenfolge bei Ties, Hooks-Liste); `taskDescription` nutzt sinnvolles "bis nächstes ##/EOF" statt des JS-`\Z`-Literal-Z-Bugs.

**Bug-Klasse (gefixt 2026-06-06):** `aNum`/`aBool` (JS-`Number()`/`Boolean()`-Port) müssen Go's native `int`/`int64` behandeln, NICHT nur `float64`. Der `dyn()`-Roundtrip macht alle JSON-Zahlen zu `float64`, aber Werte die DANACH frisch gebaut werden (v.a. `collectors.CtxTok()` → `int` in den Kontext-View-Items) sind echte Go-`int`. Ohne `case int` fielen sie in `default`→0 → Kontext-Kategorie-Summen (memory=0, skills/agents zu niedrig) waren falsch (16.5k statt 45k). Nach Fix matcht /context.

**browser.js-Divergenz (Bug-Fix, nicht mehr byte-identisch zu Deno):** Kontext-View readable-Items (skill/agent/project-agent) gaben `name` nicht an `/read` weiter → "ungültiger Skill-Name". Fix in `internal/assets/static/browser.js`: `data-name` an die `.ctx-readable-body`-Divs (2 Builder) + `loadFile(..., {name, path})` (Z. ~1308). Derselbe Bug steckt noch in `deno-knowledge-app/assets/browser.js` — bei Bedarf dort nachziehen. Verifiziert via rodney (headless). Server `/read` selbst war korrekt.

**Verifikation respektierte Org-Regel:** `CC_KNOWLEDGE_SCRIPTS_DIR=/nonexistent` → kein `tn projects`-Spawn (siehe [[deno-knowledge-tn-org-block]]). Deno-Live-Vergleich deshalb übersprungen. Human-Review steht noch aus (Dev-Session — Review separat).
