---
name: session-stop
description: Session-Ende sauber abschliessen — Tests/Commit, neue Lessons-Learned und Backlog-Task-Stand dokumentieren, dann PKM-Sync. USE WHEN Session beenden, session abschliessen, stop hook, finalize, finalise, was wurde gemacht dokumentieren, lessons learned, backlog dokumentieren, PKM sync, knowledge finish, stop-workflow.
---

# Session Stop

Schliesst eine Arbeitssession sauber ab. Reihenfolge: **Code → Doku → PKM-Sync.**
Nur der **User** setzt Tasks auf `done` — du meldest `verify`-ready und wartest.

## 1. Code finalisieren (nur wenn Code geaendert wurde)

1. **Tests** — Framework auto-erkennen, laufen lassen, Ergebnis berichten. Rot ist nicht
   blockierend, aber explizit markieren.

   | vitest | jest | pytest | go | make |
   |---|---|---|---|---|
   | `npm run test:unit -- --run` | `npm test -- --passWithNoTests` | `python -m pytest -q --tb=short` | `go test ./... -count=1` | `make test` |

2. **Commit** — nur wenn der User es will (oder Branch ≠ main). `type(scope): …` mit
   Aenderungen + Test-Status. Keine `.env`/`*.key`. PRs merged der User selbst.

## 2. Lessons-Learned dokumentieren

Nur **genuinely neue** Erkenntnisse — kein Re-Dump von Bekanntem. Je Lesson eine knappe
Zeile/Absatz nach `knowledge/lessons-learned.md` (Datei anlegen falls fehlt). Dedupe gegen
Vorhandenes. Vorher kurz als Vorschlag zeigen, dann schreiben.

## 3. Backlog-Tasks dokumentieren (Repo mit `backlog/`)

Stand der bearbeiteten Tasks via CLI festhalten — **nie** Task-Dateien direkt editieren:

```bash
backlog task edit <id> --append-notes "<fortschritt / entscheidung / blocker>"
backlog task edit <id> --check-ac <n>                 # erfuellte Akzeptanzkriterien
backlog task edit <id> --final-summary "<PR-Stil>"    # erst bei Abschluss
```

Status auf `In Progress`/`verify` lassen — `Done` setzt der User.

## 4. PKM-Sync (wenn der Stop-Hook `followup_message` / PKM-SYNC liefert)

Protocol lesen + ausfuehren: `$HOME/GITHUB/ObsidianPKM/.claude/PKM_SYNC_PROTOCOL.md`

| Aufgabe | Regel |
|---|---|
| Session-Eintrag | max 3 Zeilen / 300 Zeichen; Routing nach `ACTIVE_KIND` |
| Resume State | nur bei echtem Re-entry; nur bei TaskNotes |
| Lessons/Decisions | Scope-Routing §3-4; nur Neues |
| Git | nur wenn Repo; User merged selbst bei PRs |

Manueller Abschluss ohne Hook:

```bash
uv run ~/.claude/hooks/knowledge-bridge.py finish <projekt> --summary "Deutsche Zusammenfassung" --cost 0.42
```

Stop-Loop: Cursor-`stop`-Hook hat `loop_limit: 3`; bei `stop_hook_active=true` ist
`pkm-sync-stop` silent (kein Doppel-Fire).

## Antwort nach Abschluss

Kurz: was getan, Lessons/Backlog dokumentiert, Commit-SHA falls vorhanden. Keine Romane.
