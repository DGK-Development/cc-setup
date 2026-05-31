# cc-setup — Claude Code PKM Bundle

Ein Befehl für alles: **`just install`**

## Was `just install` macht (4 Schritte)

| Schritt | Aktion |
|---|---|
| **1. Sync?** | Interaktiv: Agenten/Skills aus Vault/Cursor → `templates/` (überspringbar) |
| **2. Bundle** | Submodules + Templates → `dist/cc-setup/` |
| **3. Claude Home** | **Global:** `~/.claude/skills/cc-setup/` (+ flach `local-ci`) — **alle Projekte** |
| **4. Vault?** | Interaktiv: `setup.sh` wenn Dependencies fehlen |

**Agenten: global, nicht pro Projekt.** Sie liegen im User-Plugin unter `~/.claude/skills/cc-setup/agents/` und stehen in jeder Claude-Code-Session zur Verfügung (Agent-Tool → `developer`, `reviewer`, …). Projekt-spezifische Agenten wären erst in `<repo>/.claude/agents/` — das macht cc-setup bewusst nicht.

Sync steuern:
- Interaktiv: `[Y/n]` in Schritt 1
- `CC_SETUP_SYNC=1 just install` — immer sync
- `CC_SETUP_SYNC=0 just install` — nie sync (nur Repo-templates)
- `CC_SETUP_NONINTERACTIVE=1 just install` — sync aus, vault aus

Danach: Claude Code neu starten oder `/reload-plugins`.

```bash
git clone --recurse-submodules git@github-dgk:DGK-Development/cc-setup.git
cd cc-setup
just install
```

Non-interactive (CI): `CC_SETUP_NONINTERACTIVE=1 just install`

Vault nachziehen: `just install-vault` oder `just install-vault vault=/pfad/zum/vault`

## Was früher `just sync-sources` war

**Kein separater Schritt mehr nötig** — läuft automatisch in Schritt 1 von `just install`.

Manuell (selten): `just sync-sources` = nur Schritt 1, ohne Bundle/Install.

**Inhalt von Schritt 1:** Kopiert die **neuesten** Definitionen von deinen **Lebend-Quellen** ins cc-setup-Repo (`templates/`), bevor gebündelt wird:

| Quelle | Was |
|---|---|
| `~/GITHUB/ObsidianPKM/.claude/agents/` | 8 SPOC-Subagenten (developer, reviewer, …) |
| `ObsidianPKM/.claude/skills/` | review, qmd, recall, opensrc, check-links, daily-review |
| `~/.cursor/skills/` | session-init, session-stop, knowledge |

Fehlt eine Quelle (z.B. kein Vault auf der Maschine) → committed `templates/` im Repo werden verwendet, Install bricht nicht ab.

## Nach Install verfügbar

- **Plugin** `~/.claude/skills/cc-setup/` — Hooks, Scripts, Agenten, Skills
- **Skills** z.B. `/cc-setup:context-load`, `/cc-setup:review`, `/local-ci`
- **Agenten** via Agent-Tool: developer, reviewer, researcher, librarian, …

Manifest: `templates/BUNDLE-MANIFEST.md`

## Plattformen

macOS, Linux nativ. Windows: **Git Bash oder WSL** (bash-Hooks). Install nutzt `rsync` oder `cp`-Fallback.

## Submodules

| Path | Upstream |
|---|---|
| `vendor/hook-redactor` | DGK-Development/hook-redactor |
| `vendor/cc-plugin-project-context` | niclasedge/cc-plugin-project-context |
