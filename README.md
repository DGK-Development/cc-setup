# cc-setup — Claude Code PKM Bundle

Ein Befehl für alles: **`just deploy`**

Installiert Skills, Agenten, Scripts und Hooks **flach** nach `~/.claude/` — kein
Plugin, kein Marketplace. Jeder Skill ist direkt als `/<name>` erreichbar. Die
Quelle liegt flach im Repo-Root (`skills/`, `agents/`, `settings.json`,
`CONTRACT.md`); der Build läuft in einem ephemeren Temp-Dir, `dist/` wird **nicht**
mehr persistiert.

## Was `just deploy` macht

| Schritt | Aktion |
|---|---|
| **1. Vault** | Obsidian-Vault-Pfad erfragen/erkennen (für Context-Load) |
| **2. Dependencies** | `uv`, `jq`, `node`, `qmd`, `redactor` prüfen/installieren |
| **3. Bundle (ephemer)** | Repo-Root-Quellen (`skills/`, `agents/`, `CONTRACT.md`, `settings.json`, `hooks/`, Runtime-`scripts/`) → Temp-Build-Dir; danach Cleanup |
| **4. Deploy (flach)** | `skills/<name>/` → `~/.claude/skills/<name>/`, Agenten → `~/.claude/agents/`, Scripts + Hooks → `~/.claude/skills/cc-setup/` |
| **5. Konfiguration** | Managed-Block in `~/.claude/CLAUDE.md`, Hooks in `~/.claude/settings.json` (SessionStart + UserPromptSubmit + Stop), `OBSIDIAN_VAULT_PATH` ins Shell-Profil |

**Agenten: global, nicht pro Projekt.** Sie liegen unter `~/.claude/agents/` und stehen
in jeder Claude-Code-Session zur Verfügung (Agent-Tool → `developer`, `reviewer`, …).

```bash
git clone --recurse-submodules git@github-dgk:DGK-Development/cc-setup.git
cd cc-setup
just deploy
```

Optionen:
- `just deploy target=/pfad/zum/.claude` — in ein anderes Claude-Home deployen (default `~/.claude`)
- `just deploy "" vault=/pfad/zum/vault` — Vault explizit setzen
- `just check` — nur Dependency-Status, keine Änderungen
- `CC_SETUP_NONINTERACTIVE=1 just deploy` — non-interactive (CI)
- Vault nachziehen: `just install-vault` oder `just install-vault vault=/pfad/zum/vault`
- Debug-Bundle inspizieren: `just bundle` (schreibt nach `dist/cc-setup/`, nur optional)

Danach: Claude Code neu starten (oder neue Shell für `OBSIDIAN_VAULT_PATH`).

## Quellen-Sync (optional, selten nötig)

`just sync-sources` zieht die **neuesten** Definitionen von deinen **Lebend-Quellen**
in die flachen cc-setup-Repo-Quellen (`skills/`, `agents/`), bevor deployt wird:

| Quelle | Was |
|---|---|
| `~/GITHUB/ObsidianPKM/.claude/agents/` | SPOC-Subagenten (developer, reviewer, …) → `agents/` |
| `ObsidianPKM/.claude/skills/` | review, qmd, recall, opensrc, check-links, daily-review → `skills/` |
| `~/.cursor/skills/` | session-init, session-stop, knowledge → `skills/` |

Fehlt eine Quelle (z.B. kein Vault auf der Maschine) → committed `skills/`/`agents/` im
Repo werden verwendet, der Sync bricht nicht ab.

## Nach Setup verfügbar

- **Skills** flach unter `~/.claude/skills/<name>/` — z.B. `/context-load`, `/review`, `/qmd`, `/audit`, `/local-ci`
- **Agenten** via Agent-Tool: developer, reviewer, researcher, librarian, …
- **Hooks** in `~/.claude/settings.json`: SessionStart-Context + redactor strict mode

Manifest: `BUNDLE-MANIFEST.md`

## Migration vom alten Plugin-/Marketplace-Install

Frühere Versionen installierten cc-setup als Claude-Code-**Plugin** über den
Marketplace `niclasedge-pkm` (`claude plugin marketplace add … && claude plugin install …`).
Der Flat-Install ist jetzt der einzige Pfad. Wer von einem alten Setup kommt, sollte den
alten Marketplace **vor** dem ersten `just deploy` deinstallieren, sonst entstehen
Skill-Dubletten (Plugin-Namespace `/cc-setup:<name>` **und** flach `/<name>`):

```bash
# 1. Plugin deinstallieren
claude plugin uninstall project-context@niclasedge-pkm
claude plugin uninstall cc-setup@niclasedge-pkm   # falls so installiert

# 2. Marketplace entfernen
claude plugin marketplace remove niclasedge-pkm

# 3. Falls als lokales @skills-dir-Plugin konfiguriert: pluginConfigs-Eintrag
#    cc-setup@skills-dir aus ~/.claude/settings.json entfernen.

# danach Claude Code neu starten und einmal: just deploy
```

`just deploy` schreibt seine Hooks idempotent und ersetzt alte managed-Blöcke in
`~/.claude/CLAUDE.md` — der einzige Schritt, der manuell erfolgen muss, ist die
Marketplace-/Plugin-Deinstallation oben (cc-setup berührt das Live-Plugin-System nicht).

## Plattformen

macOS, Linux nativ. Windows: **Git Bash oder WSL** (bash-Hooks). Deploy nutzt `rsync`.

## Submodules

| Path | Upstream |
|---|---|
| `vendor/hook-redactor` | DGK-Development/hook-redactor |
