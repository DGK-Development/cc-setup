---
name: local-ci
description: Lokale git-gesteuerte CI-Pipeline (localci) in ein Repo einbauen — ein pre-push-Hook, der Tests/Lint als Gate ausfuehrt, schlechte Pushes blockt, Deployment nur bei Erfolg laufen laesst und pro Lauf CTRF-JSON + GitHub-Style-HTML-Report (runs.html + Detailseiten) erzeugt. USE WHEN local ci, localci, pre-push gate, push gaten, pipeline.yml, .localci, gate tests before push, ci report ohne server, runs.html, lokale CI einrichten, CI in anderes repo einbauen.
---

# local-ci

Projektunabhaengiger, lokaler CI-Runner. **Ein einziges Python-Script** (`localci.py`,
laeuft via `uv run --script`, zieht PyYAML als Inline-Dependency selbst) plus eine
projektspezifische `pipeline.yml`. Loest bei `git push` (`pre-push`-Hook) ein Gate aus:
schlaegt ein gegateter Step fehl → Push blockiert. Pro Lauf: ein CTRF-JSON (Quelle der
Wahrheit) + selbst-gerenderte HTML-Reports im GitHub-Dark-Look (Aggregat `runs.html` mit
Trend-Graph + eine Zeile pro Run; Detailseite mit aufklappbaren Step-Logs). Kein Server,
kein npm, keine externen Reporter.

## Voraussetzungen

- `uv` im PATH (Script laeuft als PEP-723-Inline-Script; PyYAML wird automatisch geholt).
- `git`. Sonst nichts.

## In ein neues Repo einbauen (Copy-Paste)

Referenzdateien liegen im cc-setup-Plugin unter `skills/local-ci/assets/`. Aus dem Ziel-Repo-Root:

```sh
SKILL="${CLAUDE_PLUGIN_ROOT}/skills/local-ci/assets"
mkdir -p .localci/hooks
cp "$SKILL/localci.py"            .localci/localci.py
cp "$SKILL/pre-push"             .localci/hooks/pre-push
cp "$SKILL/pipeline.example.yml" .localci/pipeline.yml   # danach anpassen!
chmod +x .localci/hooks/pre-push
printf '
# localci: Reports koennen Step-Output enthalten
reports/
' >> .gitignore
```

Ohne aktive Plugin-Session (manuell aus dem Skills-Dir):

```sh
SKILL="$HOME/.claude/skills/cc-setup/skills/local-ci/assets"
```

Ohne aktive Plugin-Session (manuell aus dem Skills-Dir):

```sh
SKILL="$HOME/.claude/skills/cc-setup/skills/local-ci/assets"
```

Dann:

1. **`.localci/pipeline.yml` anpassen** — `name:` setzen, Stages/Steps auf den Stack
   umschreiben (i. d. R. nur die `run:`-Kommandos; Schema unten).
2. **Trocken testen** (nichts wird ausgefuehrt):
   ```sh
   uv run --script .localci/localci.py run --dry-run
   ```
3. **Echten Lauf testen** und Report ansehen:
   ```sh
   uv run --script .localci/localci.py run
   open reports/html/runs.html
   ```
4. **Hook scharfschalten** (Human-Oversight: erst nach Review!):
   ```sh
   git config core.hooksPath .localci/hooks
   ```
5. **Gate beweisen, ohne zu pushen:**
   ```sh
   git push --dry-run     # pre-push feuert, pusht nichts; exit!=0 = wuerde blocken
   ```

`.localci/` ins Repo committen, damit Pipeline + Hook versioniert/teilbar sind.

## pipeline.yml — Schema

| Feld | Ebene | Pflicht | Bedeutung |
|---|---|---|---|
| `name` | root | ja | Pipeline-/Projektname (im Report). |
| `env` | root | nein | Key/Value, an jeden Step als Umgebungsvariable. |
| `stages[].name` | stage | ja | Stage-Name = CTRF-Suite (Gruppierung). |
| `stages[].gate` | stage | nein (`false`) | `true` = Fehler blockt Push + ueberspringt Folge-Gates/on_success. |
| `stages[].when` | stage | nein (`always`) | `always` \| `on_success` \| `on_failure` \| `manual`. |
| `stages[].steps[].name` | step | ja | Anzeigename = ein CTRF-Eintrag. |
| `stages[].steps[].run` | step | ja | Shell-Kommando. |
| `steps[].when` | step | nein (`always`) | wie Stage-`when`, auf Step-Ebene. |
| `steps[].allow_failure` | step | nein (`false`) | `true` = Fehler erfasst, gatet aber nicht. |
| `steps[].timeout` | step | nein | Sekunden; Ueberschreitung = `failed`. |

Vollstaendiges Beispiel mit Stack-Varianten (Node/Python/Rust/Go): `assets/pipeline.example.yml`.

## CLI

```
uv run --script .localci/localci.py run [--gate-only] [--stage NAME] [--no-deploy] [--dry-run] [--publish]
uv run --script .localci/localci.py aggregate <json-dir> <html-out-dir>
```

- `--gate-only` — nur `gate`-Stages (das nutzt der `pre-push`-Hook).
- `--stage NAME` — nur diese Stage.
- `--no-deploy` — `on_success`-Stages ueberspringen.
- `--dry-run` — Plan zeigen, nichts ausfuehren.
- `--publish` — Platzhalter (Publish bewusst nicht automatisiert).

**Exit-Codes:** `0` = passed · `1` = failed (gegateter Step) · `2` = Konfig-/Nutzungsfehler.

## Semantik (Kurzform)

- Stages & Steps laufen sequentiell in Definitionsreihenfolge.
- Step exit `0` → `passed`, sonst `failed`. `allow_failure: true` → erfasst, gatet nicht.
- Gegateter Fehlschlag → Run `failed`, Push blockiert (exit 1); nachfolgende `gate`- und
  `on_success`-Stages werden `skipped`. `when: always`-Stages laufen trotzdem.
- Reporting (JSON + HTML + `runs.html`) laeuft **immer**, auch bei Fehlschlag.

## Globale Uebersicht ueber alle Repos (optional)

`assets/localci-overview.py` ist ein **zweiter, eigenstaendiger** Aggregator eine Ebene
ueber den Einzel-Repos: scannt `<root>/*/reports/json/*.ctrf.json` (Default `<root>` =
`~/GITHUB`) und rendert **eine** `runs-overview.html` im gleichen GitHub-Dark-Look — volle
Breite, **eine Karte je Repo** (Projektname, Erfolgsquote, Trend, letzte Laeufe inkl.
Step-Kreisen rot/gruen/grau). Verlinkt relativ in die lokalen `runs.html`/Detailseiten
jedes Repos (`file://`-tauglich, keine Dependencies, liest nur).

```sh
# Aggregator einmalig nach ~/GITHUB legen (Pfad anpassen):
cp "${CLAUDE_PLUGIN_ROOT}/skills/local-ci/assets/localci-overview.py" ~/GITHUB/localci-overview.py
# oder: cp "$HOME/.claude/skills/cc-setup/skills/local-ci/assets/localci-overview.py" ~/GITHUB/

# Manuell erzeugen / aktualisieren:
uv run --script ~/GITHUB/localci-overview.py            # alle Repos unter ~/GITHUB
uv run --script ~/GITHUB/localci-overview.py --ios-only # nur Repos mit 'ios' im Namen
open ~/GITHUB/runs-overview.html
```

Flags: `--root <dir>` · `--out <datei>` · `--ios-only` · `--recent N` (Laeufe je Karte).

**Auto-Update:** `localci.py` ruft am Ende jedes `run` `update_global_overview()` auf —
best-effort, schluckt Fehler (Einzel-Repo-Reporting darf nie daran haengen). Liegt der
Aggregator unter `~/GITHUB/localci-overview.py` (bzw. `LOCALCI_OVERVIEW`), wird die
Uebersicht nach jedem Lauf automatisch neu gebaut; fehlt er, passiert nichts.

## Env-Variablen

| Variable | Default | Zweck |
|---|---|---|
| `LOCALCI_CONFIG` | `.localci/pipeline.yml` | Pfad zur Pipeline-Definition. |
| `LOCALCI_REPORTS_DIR` | `reports` | Wurzel fuer `json/` + `html/`. |
| `LOCALCI_TRIGGER` | `manual` | landet im Report (Hook setzt `pre-push`). |
| `LOCALCI_PUBLISH` | `0` | `1` = Publish-Schritt anstossen (Platzhalter). |
| `LOCALCI_OVERVIEW` | `~/GITHUB/localci-overview.py` | Pfad zum globalen Aggregator; nach jedem Run best-effort aufgerufen (s. u.). |

## Stolperfallen

- **`core.hooksPath` ersetzt `.git/hooks` komplett** — andere lokale Hooks feuern dann nicht
  mehr. Meist egal (nur Samples vorhanden).
- **`uv` muss zur Push-Zeit im PATH sein.** GUI-Git-Clients haben oft reduzierten PATH →
  im Hook absoluten `uv`-Pfad eintragen (`which uv`).
- **Hook umgehen** (Debug/Notfall): `git push --no-verify`. **Deaktivieren:**
  `git config --unset core.hooksPath`.
- **runId** = `<UTC-Sekunde>-<short-sha>`. Zwei Laeufe in derselben Sekunde auf demselben
  Commit kollidieren (ueberschreiben). Fuer pre-push (ein Lauf/Push) irrelevant.
- **Reports koennen sensiblen Step-Output enthalten** → `reports/` per Default gitignored.
- **Human-Oversight:** generierter Pipeline-/Deploy-Code vor produktivem Einsatz pruefen,
  Hook erst danach scharfschalten.

## Referenzen

- `assets/localci.py` — kanonischer Runner (zum Kopieren). Triggert nach jedem `run`
  best-effort die globale Uebersicht (s. „Globale Uebersicht").
- `assets/localci-overview.py` — Repo-uebergreifender Aggregator → `runs-overview.html`.
- `assets/pipeline.example.yml` — Pipeline-Vorlage + Stack-Varianten.
- `assets/pre-push` — Hook-Wrapper.
- Volle Spec: `~/GITHUB/ObsidianPKM/Efforts/Private/iOS/ios-deployment/specs/local-ci-pipeline-spec.md`
- Referenz-Implementierung im Einsatz: Repo `inspire-ios-match` unter `.localci/`.
