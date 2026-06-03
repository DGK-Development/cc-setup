# Design: tn→Milestone Sprint-Workflow (Backlog.md als CC-Task-Manager)

- **Datum:** 2026-06-03
- **Status:** Approved (brainstorming) → bereit für writing-plans
- **Repo:** cc-setup (Plugin), Integration ins context-load-Plugin
- **Backlog.md:** v1.45.2

## Ziel

Backlog.md als repo-lokalen Task-Manager für AI-Agents etablieren, gebunden an die
strategische TaskNote-Ebene (tn) im ObsidianPKM-Vault. Eine tn (großer Feature-Ansatz)
wird zum Sprint = einem Backlog-**Milestone** mit dekomponierten Subtasks. Der Workflow
wird ins context-load-Plugin integriert, sodass jede Session im Repo den Sprint-Stand
sieht.

## Entscheidungen (aus Brainstorming)

| # | Entscheidung | Wahl |
|---|---|---|
| 1 | Source of Truth | tn checkt voll in Backlog aus; tn hält Pointer + Final Summary |
| 2 | Repo-Bindung | CWD = Ziel-Repo (`git rev-parse`) |
| 3 | Dekomposition | Vorschlag → Bestätigung (Human-Oversight) |
| 4 | Umfang | `/sprint-start` + `/sprint-finish`, **ohne** Git (Branch/PR via `/finalize`) |
| 5 | Form | Helper-Skript `sprint_bridge.py` + 2 Markdown-Skills im Plugin |
| 6 | Sprint-Modell | natives Milestone = Sprint (je tn → 1 Milestone) |
| 7 | Spec-Anker | Parent-Task pro Milestone trägt die tn-Spec (`--ref`→tn) |
| 8 | auto_commit | `false` (kein Commit-Rauschen; bewusste Commits) |
| 9 | Einstieg | Bestandsaufnahme zuerst (Survey-JSON), dann Frage neu/fortsetzen |
| 10 | Milestone-Name | `"<tn-id>: <kurztitel>"` (tn-id als stabiler Sprint-Key) |
| 11 | Projekt-Match | CWD-Repo-Pfad ↔ Projekt-`Working Dir`/`Repo` (tasknotes-Metadaten) |
| 12 | tn-Status nach Finish | `in-review` (wenn alle Backlog-Tasks implementiert), nicht `done` |
| 13 | Changelog | je implementierter Subtask ein tn-Changelog-Eintrag bei Finish |

## Zwei-Ebenen-Modell

| Ebene | Ort | Rolle |
|---|---|---|
| **TaskNote (tn)** | Vault `Efforts/…/tasks/<id>.md` | Strategischer Sprint-Anker. Nach Start: Pointer + Final Summary. |
| **Milestone** | Repo `backlog/` | = der Sprint. Gruppierung + Completion-Tracking (`milestone list`). |
| **Parent-Spec-Task** | Repo `backlog/tasks/` | Trägt die tn-Spec: Description=Ziel, `--ref`→tn, AC=Sprint-Erfolg. |
| **Subtasks** | Repo `backlog/tasks/` | Die Arbeit. `-p <parent>` + `-m <milestone>`, mit `--dep` + `--ac`. |

Ein tn-Sprint = ein Milestone `"<tn-id>: <titel>"` + ein Parent-Spec-Task + n Subtasks.

### Backlog.md-Realität (verifiziert v1.45.2)

- **Kein `milestone create`** — Milestones entstehen implizit via `task create -m "<name>"`.
  Milestone-Subcommands: nur `list` (`--plain`, `--show-completed`) und `archive`.
- Milestone trägt **keine** Beschreibung/`--ref` → Spec muss am Parent-Task hängen.
- **Kein JSON-Output** — nur `--plain`. `sprint_bridge.py` parst und produziert das JSON.
- `task create` unterstützt: `-m/--milestone`, `-p/--parent`, `--dep/--depends-on`,
  `--ac`, `--ref`, `--priority`, `-l/--labels`. Validiert zirkuläre Deps.

## Komponenten

### `scripts/sprint_bridge.py` (deterministisch, testbar — Muster wie `tasknotes_cli.py`)

Subcommands:

- **`survey [--repo .] [--project <name>]`** → JSON für den Einstieg:
  ```jsonc
  {
    "repo": "<root>", "prefix": "ccs",
    "open_milestones": [
      { "name": "aic-127: ModernBERT-Filter", "done": 3, "total": 7,
        "open_tasks": [ { "id": "ccs-012", "title": "…", "status": "To Do" } ] }
    ],
    "candidate_tns": [ { "id": "aic-127", "title": "…", "status": "action", "next_action": "…" } ]
  }
  ```
  Quellen: `backlog milestone list --plain` + `backlog task list -m <m> --plain` (offene
  Tasks je Milestone), `tasknotes_cli.py next` (project-gefiltert, top 5). Read-only.
  **Projekt-Match:** CWD-Repo-Pfad (`resolve-repo`) wird gegen die `Working Dir`- und
  `Repo`-Metadaten der tasknotes-Projekte gematcht (ein Projekt kann mehrere Working Dirs
  haben). Treffer → `candidate_tns` aus diesem Projekt. Kein Pfad-Treffer → `candidate_tns`
  leer + Flag `project_matched: false` (Skill bietet dann freie Auswahl aller tns an).

- **`resolve-repo`** → `git rev-parse --show-toplevel`; prüft ob `backlog/config.yml`
  existiert; liefert `{ repo, prefix, initialized }`. Kein Abbruch bei fehlendem Backlog.

- **`bind --tn <path> --milestone <name> --parent <id>`** → schreibt tn-Frontmatter
  **atomar**: `backlog_repo`, `backlog_milestone`, `backlog_parent`,
  `sprint_status: active`, `sprint_started: <date>`.

- **`status [--repo .]`** → liest `milestone list` + Parent-Status für den aktiven
  Sprint des Repos → `{ milestone, done, total, next_open_task }`.

- **`sync-finish --tn <path>`** → zieht Parent-`Final Summary` + Completion in die tn,
  atomar:
  - tn-Status → **`in-review`** (sobald alle Backlog-Subtasks `Done`/implementiert sind),
    nicht `done` — Review-Gate bleibt beim User.
  - `sprint_status: done`.
  - **je implementiertem Subtask ein tn-Changelog-Eintrag** (Datum, `<ccs-id>`: Titel),
    plus die Parent-`Final Summary` in die tn-Final-Summary-Sektion.

Konvention: Schreibende Backlog-Operationen laufen **nur über die `backlog`-CLI**
(nie direktes File-Editing in `backlog/tasks/`). Survey/Status lesen read-only.

### Skill `/sprint-start` (in-session, SPOC-Rolle PM)

0. `sprint_bridge survey` → JSON in Kontext laden; beide Listen rendern.
1. **Initiale Frage** (`AskUserQuestion`):
   - **Offenen Milestone fertigmachen** → Milestone wählen → nächster offener Subtask,
     direkt in die Arbeit.
   - **Neuen tn-Sprint anlegen** → next-5-tn rendern → tn wählen.
2. (neuer Sprint) tn laden (Body, AC, blockedBy). Offener Blocker → Warnung + Wahl.
3. **Dekomposition vorschlagen**: Milestone-Name `"<tn-id>: <kurztitel>"`, Parent-Spec
   (Description=Ziel, `--ref`→tn, AC), Subtask-Liste mit `--dep` + `--ac`. **Anzeigen,
   OK abwarten** (Human-Oversight).
4. Nach OK: `backlog task create` (Parent zuerst mit `--ref`→tn + `-m`; dann Subtasks
   `-p <parent> -m <milestone> --dep … --ac …`) → `sprint_bridge bind`.
5. Report: Milestone, Parent-ID, Subtask-IDs, `backlog milestone list`.

### Skill `/sprint-finish` (in-session, PM)

1. Aktiven Sprint aus CWD-Repo + tn-Pointern auflösen.
2. Backlog-Stand zusammenfassen (offene/erledigte Subtasks). Sind noch Subtasks offen →
   Hinweis + Wahl (trotzdem in-review / abbrechen).
3. `sprint_bridge sync-finish` → Final Summary + je-Subtask-Changelog zurück in tn,
   tn-Status → `in-review`.
4. **Kein Git.** Branch/PR/Push bleiben bei User + `/finalize` + Developer-Subagent.

### context-load-Integration (Layer 1.5)

Nach dem tn-Match (Layer 1): `sprint_bridge status` prüft, ob das CWD-Repo einen
aktiven Sprint hat. Rein additiv, no-op außerhalb von Repos.
- Aktiver Sprint → Block „**Aktiver Sprint:** `<milestone>` · n/m done · nächster: `ccs-0XX`";
  Suggested Skill `/sprint-finish` wenn alles done.
- tn-Match ohne Sprint, CWD = Repo → Suggested Skill `/sprint-start`.

## Datenfluss

```
/sprint-start → survey → [neu | fortsetzen]
  neu:  tn wählen → Vorschlag → [OK] → backlog: Parent(--ref→tn)+Subtasks+Milestone
        → sprint_bridge bind → tn.frontmatter: sprint_status=active, backlog_*
[Arbeit: Developer-Subagent · backlog task edit --check-ac · To Do→In Progress→Done]
context-load → Layer 1.5 zeigt Sprint-Fortschritt bei jeder Repo-Session
/sprint-finish → sync-finish → tn.Final Summary + je-Subtask-Changelog
              → tn-Status=in-review, sprint_status=done
```

## Fehlerbehandlung & Edge Cases

- **Kein `backlog/` im Repo** → `/sprint-start` bietet `backlog init` an (mit
  `auto_commit:false`), bricht nicht hart ab.
- **Kein tn-Match fürs Projekt** → freie Auswahl aus allen tns oder „neuer tn nötig".
- **tn schon gebunden (`sprint_status: active`)** → kein Doppel-Start; Hinweis +
  Sprung in „fortsetzen".
- **Zirkuläre Subtask-Deps** → Backlog validiert selbst; Fehler an User durchreichen.
- **Atomare Frontmatter-Writes** → temp-file + rename (wie `tasknotes_cli.py`).

## Aufräum-/Konfliktpunkte (Teil der Umsetzung)

- ✅ `auto_commit: false` gesetzt.
- **Root-`CLAUDE.md` (746 Z. Backlog-Boilerplate, committed `8f81f4d`):** behalten, aber
  Regel *„NEVER EDIT TASK FILES DIRECTLY"* explizit auf `backlog/tasks/` scopen — darf
  `tasknotes_cli.py` (Vault-tns) nicht blockieren. cc-setup-Header oben drauf mit Verweis
  auf globalen Vertrag + Sprint-Skills.
- **`.claude/agents/project-manager-backlog.md`:** nicht als Parallel-PM; im
  `agent-index` als „Backlog-Dekomposition-Helfer" einordnen, den `/sprint-start` nutzt.

## Dogfooding

cc-setup wird selbst der erste Sprint: Milestone
`cc-task-manager: tn→Milestone Sprint-Workflow`, Parent-Spec-Task mit `--ref`→diesem
Design-Doc, Subtasks = Implementierungsschritte (sprint_bridge.py + Subcommands, beide
Skills, context-load-Layer, CLAUDE.md-Scope, agent-index). Validiert den Workflow an
sich selbst.

## Tests

- `sprint_bridge.py` Unit: survey-JSON-Schema, Frontmatter-Roundtrip (bind/sync-finish),
  resolve-repo ohne `backlog/`, Plain-Output-Parser gegen Fixtures.
- Integration: temp-Repo `backlog init` → survey leer → bind → status → sync-finish.
- DoD (`backlog/config.yml`): `just test passes`.

## Bewusst nicht im Scope (YAGNI)

- Git-Automatik (Branch/PR/Push) — bleibt bei `/finalize`.
- GitHub-Issue-Status-Sync (nur `--ref` als Doku-Link).
- Voll-automatische Dekomposition ohne Bestätigung.
- Time-boxed Sprints mit Start/Enddatum.
