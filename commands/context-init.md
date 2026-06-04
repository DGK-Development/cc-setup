---
description: Initialisiert das aktuelle Projekt fuer das project-context-Plugin — prueft ObsidianPKM-Projekt-Binding (working_dir + Tasks), legt es bei Bedarf an, und stellt die qmd-Collection samt Embeddings sicher.
---

# /context-init — Per-Projekt Bootstrap

Einmal pro Repo auszufuehren. Verbindet das aktuelle Arbeitsverzeichnis (`$PWD`,
typisch `~/GITHUB/<repo>/`) mit einem ObsidianPKM-Projekt und richtet die
qmd-Suche fuer dieses Repo ein. Idempotent — mehrfaches Ausfuehren ist sicher.

## WICHTIG — redactor strict mode

Jeder Bash-Call MUSS mit `redactor wrap --` (Alias `r wrap --`) laufen, sonst
blockt der Hook. Nutze die Befehle unten **1:1 inklusive Wrapper**.

## Plugin-Pfade

Die Skripte liegen im Flat-Install-Verzeichnis. Verwende den absoluten Pfad:

```bash
TN="$HOME/.claude/skills/cc-setup/scripts/tasknotes_cli.py"
QMD_ENSURE="$HOME/.claude/skills/cc-setup/scripts/qmd-ensure.sh"
```

Vault-Pfad-Aufloesung (erste nicht-leere gewinnt): `$OBSIDIAN_VAULT_PATH` →
`$TASKNOTES_VAULT` → `~/GITHUB/ObsidianPKM`.

## Schritt 0 — Vorbedingungen

```bash
redactor wrap -- bash "$HOME/.claude/skills/cc-setup/scripts/context-deps.sh" --check
```

- Fehlt eine harte Dependency (uv, jq, redactor, qmd) → an User melden und
  vorschlagen `bash "$HOME/.claude/skills/cc-setup/scripts/context-deps.sh"` (ohne `--check`)
  auszufuehren. Nicht ohne Dependencies weitermachen.

## Schritt 1 — Projekt-Binding pruefen (working_dir + Tasks)

`tn info` matcht `$PWD` gegen das `working_dir`-Frontmatter aller Projekte.

```bash
redactor wrap -- uv run --script "$TN" info --format json
```

Werte aus dem JSON:
- `cwd_match` / gematchtes Projekt (Feldname dem Output entnehmen)
- Task-Counter des gematchten Projekts

**Verzweigung:**

- **Match + Tasks vorhanden** → Binding ist intakt. Weiter zu Schritt 2.
- **Match, aber 0 Tasks** → Binding ok, nur leer. Dem User melden, weiter zu Schritt 2.
- **Kein Match** → Schritt 1a.

### Schritt 1a — kein Binding: User fragen

Projektliste zeigen:

```bash
redactor wrap -- uv run --script "$TN" projects --format json
```

Dann via **AskUserQuestion** klaeren (kompletten Repo-Namen `$(basename "$PWD")`
und die Kandidaten zeigen, plus „Neues Projekt anlegen" und „Ueberspringen"):

> Das aktuelle Repo `<repo>` ist keinem ObsidianPKM-Projekt zugeordnet. Womit verbinden?
> - <bestehendes Projekt A>  (working_dir wird auf `$PWD` gesetzt)
> - <bestehendes Projekt B>
> - Neues Projekt anlegen
> - Ueberspringen (kein Binding)

**Bei bestehendem Projekt** — `working_dir` setzen (matcht kuenftig CWD automatisch):

```bash
redactor wrap -- uv run --script "$TN" -p "<projekt>" meta init --working-dir "$PWD"
```

**Bei „Neues Projekt anlegen"** — das ist eine Vault-Struktur-Entscheidung
(Work vs. Private, Kunde, Phase). Nicht raten: dem User sagen, dass das Anlegen
ueber den Vault-Workflow (`/review` bzw. manuell) laeuft, und nur das
`working_dir` setzen, sobald das Projekt existiert. Alternativ minimal:

```bash
redactor wrap -- uv run --script "$TN" -p "<neuer-projektname>" meta init --working-dir "$PWD"
```

(nur wenn der User den Projektnamen explizit bestaetigt).

**Bei „Ueberspringen"** → Binding-Schritt auslassen, direkt zu Schritt 2.

## Schritt 2 — qmd-Collection fuer dieses Repo sicherstellen

Repo-Root und -Name bestimmen, dann Collection idempotent anlegen + embedden.
ObsidianPKM selbst wird uebersprungen (die `Wiki`-Collection deckt es ab, die
`/context-load` separat pflegt).

```bash
REPO_ROOT="$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null || echo "$PWD")"
REPO="$(basename "$REPO_ROOT")"
if [ "$REPO" = "ObsidianPKM" ]; then
  echo "skip qmd: ObsidianPKM nutzt die Wiki-Collection (siehe /context-load)"
else
  redactor wrap -- bash "$QMD_ENSURE" "$REPO" "$REPO_ROOT" 14
fi
```

`qmd-ensure.sh` legt die Collection an + embedded sie, wenn sie fehlt, und
re-indexed inkrementell, wenn sie > 14 Tage alt ist. Beim ersten Lauf kann das
Embedding einige Sekunden bis Minuten dauern — dem User die Laufzeit ansagen.

Optional auch die globale `Wiki`-Collection sicherstellen (falls neu installiert):

```bash
VAULT="${OBSIDIAN_VAULT_PATH:-${TASKNOTES_VAULT:-$HOME/GITHUB/ObsidianPKM}}"
redactor wrap -- bash "$QMD_ENSURE" Wiki "$VAULT/Atlas/Wiki" 7
```

## Schritt 3 — Zusammenfassung ausgeben

```markdown
### context-init abgeschlossen

Repo:        <repo>  (<REPO_ROOT>)
Vault:       <VAULT>
Binding:     <Projekt X · working_dir gesetzt | bereits vorhanden | uebersprungen>
Tasks:       <N im Projekt>
qmd-Collection: <angelegt + embedded | aktuell | uebersprungen (ObsidianPKM)>

Naechster Schritt: normale Session starten — /context-load triggert ab jetzt
automatisch beim ersten Prompt und findet sowohl Tasks als auch qmd-Treffer.
```

## Was diese Command NICHT macht

- Keine Tasks anlegen oder Status aendern (das macht der normale Workflow).
- Keine Vault-Ordnerstruktur fuer neue Projekte erzeugen ohne explizite
  User-Bestaetigung des Projektnamens.
- Kein eigenmaechtiges Installieren von Dependencies (nur `--check`; Install nur
  auf User-Wunsch via `context-deps.sh`).
