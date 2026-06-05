---
name: context-load
description: Laedt Session-Kontext beim ersten Prompt — Backlog-Sprint (repo-lokal, PRIMÄR/auto), qmd-Wiki-Semantik (GLOBAL, laeuft aus jedem Repo sobald das Vault-Verzeichnis existiert), Projekt-Repo und (nur on-demand bei expliziter Anfrage) aktiver TaskNote (vault-bezogen). Nutzt context-resolve.py fuer Klassifikation + Task-Match. USE WHEN neue Session, Session Start, Kontext laden, context-load, was ist das Projekt, aktiver Sprint, Backlog-Tasks, sessionStart hook.
allowed-tools: Read, Bash, Glob, Grep, AskUserQuestion, Skill
---

# Context-Load Skill

`/context-load` ist ein Adapter um die plugin-internen Skripte. Wird vom
`userprompt-context-match` Hook beim ersten Prompt jeder Session getriggert,
kann aber auch manuell aufgerufen werden.

## Session-Start (Hook-Kontext)

Der `SessionStart`-Hook (Claude Code) bzw. `inject-project-context.sh` (Cursor)
injiziert beim Start bereits den **Backlog-Stand** (PRIMÄR): offene Milestones
(name, done/total, offene Subtask-IDs), In-Progress-Tasks und empfohlene nächste
To-Dos — plus Projekt-ID, Knowledge-Pfad und 2-Level-Tree. **Diesen injizierten
Kontext zuerst lesen** — nicht blind antworten. **Vault-TaskNotes werden NICHT
mehr automatisch injiziert** (nur on-demand, siehe Layer 1). Dieser Skill (beim
ersten User-Prompt getriggert) ergaenzt den Header um Backlog-Sprint-Match, Wiki-
und Repo-Semantik. Hook-Log (falls Repo `logs/`): `logs/hook-session-start.log`.

## Skript-Pfade (Flat Install, Deploy-Zeit-Substitution)

Der Platzhalter im Bash-Block unten wird von `deploy.sh` beim Install durch den
absoluten Flat-Pfad ersetzt (`$CLAUDE_HOME/skills/cc-setup` — `$CLAUDE_HOME` =
`$CLAUDE_CONFIG_DIR` falls gesetzt, sonst `~/.claude`). Im laufenden Bash-Tool
ist diese Variable selbst NICHT gesetzt; entscheidend ist die Substitution zur
**Deploy-Zeit**. Die deployte SKILL.md enthaelt also bereits absolute Pfade —
kein offenes `${...}` mehr (sonst lief der Deploy gegen den falschen Home):

```bash
RESOLVE="${CLAUDE_PLUGIN_ROOT}/scripts/context-resolve.py"
QMD_ENSURE="${CLAUDE_PLUGIN_ROOT}/scripts/qmd-ensure.sh"
TIER="${CLAUDE_PLUGIN_ROOT}/scripts/wiki-tier-extract.py"
SPRINT="${CLAUDE_PLUGIN_ROOT}/scripts/sprint_bridge.py"
```

Vault-Aufloesung (erste nicht-leere): `$OBSIDIAN_VAULT_PATH` → `$TASKNOTES_VAULT`
→ `~/GITHUB/ObsidianPKM`. Setze sie einmalig in deinem Shell-Profil (macht
`deploy.sh`), damit die Bash-Tool-Calls den Vault finden.

## WICHTIG — redactor strict mode

Der `redactor`-Hook blockiert jeden Bash-/PowerShell-Command, der nicht durch
`redactor wrap --` (Alias `r wrap --`) laeuft. **Nutze die Befehle unten 1:1
inklusive Wrapper.** Kein Bash-Call darf ohne Wrapper rausgehen.

Korrekt:

```bash
redactor wrap -- uv run --script "$RESOLVE" "<user-anfrage>" --limit 5
```

## Vault-Detection (gated NUR die Vault-Layer)

Vor dem ersten Skript-Call pruefen, ob das Vault-*Verzeichnis* existiert. Das
steuert **nur Layer 1 (Task-Match) und Layer 2 (Wiki)** — die repo-lokalen Layer
1.5 (Backlog-Sprint) und 3 (Repo-qmd) laufen unabhaengig davon.

```bash
redactor wrap -- bash -c 'V="${OBSIDIAN_VAULT_PATH:-${TASKNOTES_VAULT:-$HOME/GITHUB/ObsidianPKM}}"; test -d "$V" && echo "vault-ok: $V" || echo "vault-missing: $V"'
```

- `vault-missing` → Layer 1 + 2 ueberspringen (kein Vault zum Durchsuchen), aber
  **Layer 1.5 + 3 trotzdem ausfuehren** (CWD-Repo-Kontext), dann antworten.
- `vault-ok` → alle Layer.

**Wichtig — qmd-Wiki ist CWD-unabhaengig:** Layer 2 durchsucht den globalen Wiki
(`$VAULT/Atlas/Wiki`), NICHT das aktuelle Repo. Sobald das Vault-Verzeichnis
existiert, laeuft die Wiki-Suche aus **jedem** Repo (z.B. `cc-setup`) — der Vault
muss NICHT das CWD sein. Nur der deterministische TaskNotes-Task-Match (Layer 1)
ist vault-bezogen.

## Workflow — 4-Layer Retrieval

**Primärer Auto-Layer ist Layer 1.5 (Backlog-Sprint, repo-lokal)** — Backlog.md-
Tasks/Milestones sind die Arbeits-Quelle und werden bei jedem Session-Einstieg
geladen. Danach hybride qmd-Suche fuer Wiki und (bedingt) Projekt-Repo. **Layer 1
(Vault-TaskNote-Match) laeuft NUR on-demand** — bei expliziter TaskNote-/Vault-
Anfrage. Keine Schicht stoppt am ersten Treffer.

Reihenfolge im Auto-Fall: **1.5 → 2 → 3 → 4**. Layer 1 wird nur eingeschoben,
wenn der Prompt explizit eine TaskNote/Vault-Sache referenziert.

### Layer 1.5 — Aktiver Sprint (Backlog.md, PRIMÄR/auto, no-op außerhalb Repos)

**Der primäre Auto-Layer.** Anzeige des repo-lokalen Sprint-Stands als aktiver
Arbeitskontext. `sprint_bridge.py` ist **read-only** (parst nur `backlog …
--plain` + `tn next` JSON, schreibt nichts).

**Klassifikation zuerst (für Layer-2/3-Gating):** `$RESOLVE` einmal laufen lassen,
um `classification.type` und `classification.stages` zu bekommen. Im Auto-Fall
wird daraus NUR die Klassifikation genutzt (steuert, ob Layer 2/3 triggern) — der
TaskNote-`clear_match`/`candidates[]`-Teil wird hier **nicht** konsumiert (das ist
on-demand Layer 1). Wenn das Vault-Verzeichnis fehlt, kommen die Kandidaten leer
zurück; die Klassifikation funktioniert trotzdem.

```bash
redactor wrap -- uv run --script "$RESOLVE" "<user-anfrage>" --limit 5
redactor wrap -- uv run --script "$SPRINT" resolve-repo
```

- `initialized: false` → **Layer 1.5 komplett überspringen** (kein `backlog/` im
  CWD-Repo, oder gar kein Repo). Keine Ausgabe, kein Block.
- `initialized: true` → survey holen:

```bash
redactor wrap -- uv run --script "$SPRINT" survey
```

JSON lesen: `open_milestones[]` (`name`, `done`, `total`, `open_tasks[]` mit
`id`+`title`), `candidate_tns[]` (`id`, `title`, `status`, `project`,
`next_action`), `tn_available`.

**Anzeige (immer, wenn initialized):** Block `### Aktiver Sprint` rendern —
Milestones als `<name> · n/m done · offen: <id>, <id>`. Danach **explizit den
nächsten Task in Reihenfolge** hervorheben: `**Nächster Task:** <id> – <title>`
= `open_tasks[0]` des ersten offenen Milestones (Reihenfolge wie `survey` sie
liefert; entspricht `sprint_bridge status → active.next_open_task`). Plus, falls
vorhanden, `tn next` (top 5) als kurze Liste.

**Frage (nur beim echten Einstieg):** `AskUserQuestion` „Womit weitermachen?"
**nur** stellen, wenn der Prompt keinen klaren Backlog-Task referenziert **und**
es eine echte Wahl gibt (≥1 offener Milestone-Task). Sonst: nur den Block
anzeigen, **nicht** fragen (kein Nagging bei jedem Prompt).
- Optionen = offene Milestone-Tasks (`<id> – <title>`). `candidate_tns` werden
  hier **nicht** als Optionen angeboten — TaskNotes sind on-demand (Layer 1).
- Wahl Milestone-Task → `backlog task <id> --plain` laden, als aktiven Arbeits-
  kontext setzen.

Edge Cases: Keine offenen Tasks → nur „Sprint X: n/m done" anzeigen, keine Frage.
`tn next` wird hier **nicht** automatisch gezogen — nur on-demand (Layer 1).

### Layer 1 — Aktiver Vault-TaskNote (deterministisch, NUR on-demand)

**Läuft NICHT im Auto-Fall.** Nur einschieben, wenn der Prompt explizit eine
Vault-TaskNote referenziert — z.B. `tn next`, eine konkrete TaskNote-ID, „aktive
TaskNotes", „mein Task im Vault", oder ein Vault-Projekt. Im normalen Session-
Einstieg sind Backlog-Tasks (Layer 1.5) die Arbeits-Quelle, nicht TaskNotes.

Die Klassifikation (`$RESOLVE`) ist im Auto-Fall bereits gelaufen (siehe Layer
1.5). Bei expliziter TaskNote-Anfrage deren Ergebnis konsumieren:

JSON lesen: `classification.type`, `clear_match`, `candidates[]`, `vault_exists`.

Verhalten:
- `vault_exists: false` → kein Vault zum Durchsuchen; dem User sagen, dass keine
  TaskNotes verfügbar sind.
- `clear_match: true` → Top-Task laden (Body, `blockedBy`, `questions`, `tracks`, Resume State).
- Mehrere aehnliche Kandidaten → User fragen (AskUserQuestion), welcher gemeint ist.
- Kein Kandidat → dem User sagen, dass keine passende TaskNote gefunden wurde.

Zusätzlich `tn next` (top 5) zeigen, wenn explizit danach gefragt
(`tn_available` aus survey berücksichtigen).

### Layer 2 — Wiki-Semantik (qmd hybrid, ~3-12s)

Collection sicherstellen (Helper legt an wenn fehlend, re-indexed wenn > 7 Tage stale):

```bash
redactor wrap -- bash -c 'V="${OBSIDIAN_VAULT_PATH:-${TASKNOTES_VAULT:-$HOME/GITHUB/ObsidianPKM}}"; bash "'"$QMD_ENSURE"'" Wiki "$V/Atlas/Wiki" 7'
redactor wrap -- qmd query "<user-anfrage>" -c Wiki -n 5
```

Skip wenn:
- **`2` steht NICHT in `classification.stages`** (maßgeblich). Z.B. `type: status` → `stages: [1]`: Backlog-Sprint (Layer 1.5) reicht, qmd-Semantik überspringen.
- `classification.type == "lookup"` mit konkreter Task-ID (`\b[a-z]{2,6}-\d+\b` matched)
- On-demand Layer 1 lieferte `clear_match: true` mit Top-Score > 90 UND Query enthaelt Task-ID oder Projektname

Sonst (wenn `2 in stages`): triggern. Liefert verwandte Topics/References/Concepts, die der
Frontmatter-Scorer strukturell nicht sieht.

### Layer 3 — Projekt-Repo (qmd hybrid, bedingt)

Nur wenn **`3` in `classification.stages`** UND CWD = `~/GITHUB/<repo>/` UND `<repo>` != ObsidianPKM:

```bash
redactor wrap -- bash -c 'r=$(basename "$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null || echo "$PWD")"); [ "$r" = ObsidianPKM ] || bash "'"$QMD_ENSURE"'" "$r" "$HOME/GITHUB/$r" 14'
redactor wrap -- bash -c 'r=$(basename "$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null || echo "$PWD")"); [ "$r" = ObsidianPKM ] || qmd query "<user-anfrage>" -c "$r" -n 3'
```

Holt repo-lokale Docs (`CLAUDE.md`, `knowledge/`, `README.md`, ADRs) ohne grep-Loop.

### Layer 4 — Synthese + Konflikt-Check

- Aktiver Sprint (Layer 1.5, Backlog.md) ist der primaere Steuerlayer.
- Ein on-demand geladener Vault-TaskNote (Layer 1) steuert nur, wenn explizit angefragt.
- Wiki-Treffer (Layer 2) als „Verwandtes Wissen" zeigen.
- Repo-Treffer (Layer 3) als „Repo-Kontext".
- **Konflikte explizit zeigen**: Wenn ein Task `status: action`/In Progress ist, aber Layer 2/3 „blocked"/„abgebrochen" sagt → Hinweiszeile, nicht stillschweigend folgen.
- **Staleness-Marker**: on-demand geladener TaskNote mit `reviewed_at` > 7 Tage alt → Hinweis.

### Task-Load Details (bei on-demand Layer 1 Match)

- Task-Body lesen (Targeted Sections wenn lang: Frontmatter + Resume State + letzte 2 Changelog-Eintraege + nextAction-Section).
- `blockedBy`, `questions`, `tracks` (oder Legacy `cc_*`) auswerten.
- Offene Question-Notes voll laden.
- Blockierte Task-Dependencies rekursiv mit Cycle-Detection laden.
- Suggested Skills aus `## Resume State` nur invoken, wenn sie zum naechsten Gate passen.

## Tiered Wiki Loading

```bash
redactor wrap -- uv run --script "$TIER" --note <path> --tier abstract --format json
redactor wrap -- uv run --script "$TIER" --note <path> --tier overview --format json
```

Regel: `abstract` zuerst. `overview` nur wenn der Abstract nicht reicht. Full
body nur bei `lookup` oder `goal-traversal`.

## Blocker Handling

Wenn der gewaehlte Task blockiert ist oder offene `type: question` Notes
verlinkt, dem User die Wahl lassen (Blocker loesen / Haupt-Task fortsetzen /
anderen Task waehlen). Beim Loesen einer Question den Task nicht still
schliessen — Antwort in Question, Task-Changelog und Review-Felder aktualisieren.

## Was diese Skill NICHT macht

- Keine eigenmaechtigen Statuswechsel ohne passenden Gate-Schritt.
- Keine Question-Notes fuer Initial Task Audit (das macht `/review`).
- Keine Specs, Issues oder PRs anlegen.
- Kein eigenes Routing-Schema erfinden.
- Keine Skript-Probes ohne `redactor wrap --`.

## Output

```markdown
### Context geladen

Projekt: <project>
Query-Type: `...`

### Aktiver Sprint (Backlog.md, PRIMÄR)   <- nur wenn CWD-Repo backlog/ hat
- <milestone> · n/m done · offen: <id>, <id>
- **Nächster Task:** <id> – <title>   (nächster offener Task in Reihenfolge)
- In Progress: <id> – <title>

### Aktiver TaskNote (Vault)   <- NUR wenn on-demand explizit geladen
- [[...]] · Status: ... · Open Questions: ... · Resume State: vorhanden / nein
- Suggested Skills: ... · Staleness: <X Tage seit reviewed_at> [Warnung falls > 7]

### Verwandtes Wissen (qmd Wiki)
- [[Atlas/Wiki/...]] (NN%) — kurzer Snippet

### Repo-Kontext (qmd <repo>)   <- nur wenn CWD = ~/GITHUB/<repo>/
- [[<repo>/CLAUDE.md]] (NN%)

### Konflikte
- (nur wenn vorhanden) Task sagt X, Daily/Wiki sagt Y

Naechster Gate: ...
```

## Maintenance

Nightly Re-Index per cron/systemd (statt macOS launchd) — ruft
`qmd-ensure.sh --all` auf. Siehe README, Abschnitt „Nightly Re-Index".

Manueller Refresh:

```bash
redactor wrap -- bash "${CLAUDE_PLUGIN_ROOT}/scripts/qmd-ensure.sh" --all
```
