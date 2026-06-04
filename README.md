# cc-setup — Claude Code PKM Bundle

Ein Befehl für alles: **`just setup`**

Installiert Skills, Agenten, Scripts und Hooks **flach** nach `~/.claude/` — kein
Plugin, kein Marketplace. Jeder Skill ist direkt als `/<name>` erreichbar.

## Was `just setup` macht

| Schritt | Aktion |
|---|---|
| **1. Vault** | Obsidian-Vault-Pfad erfragen/erkennen (für Context-Load) |
| **2. Dependencies** | `uv`, `jq`, `node`, `qmd`, `redactor` prüfen/installieren |
| **3. Bundle** | Templates + repo-lokale Quellen → `dist/cc-setup/` |
| **4. Deploy (flach)** | `dist/cc-setup/skills/<name>/` → `~/.claude/skills/<name>/`, Agenten → `~/.claude/agents/`, Scripts + Hooks → `~/.claude/skills/cc-setup/` |
| **5. Konfiguration** | Managed-Block in `~/.claude/CLAUDE.md`, Hooks in `~/.claude/settings.json` (SessionStart + UserPromptSubmit + Stop), `OBSIDIAN_VAULT_PATH` ins Shell-Profil |

**Agenten: global, nicht pro Projekt.** Sie liegen unter `~/.claude/agents/` und stehen
in jeder Claude-Code-Session zur Verfügung (Agent-Tool → `developer`, `reviewer`, …).

```bash
git clone --recurse-submodules git@github-dgk:DGK-Development/cc-setup.git
cd cc-setup
just setup
```

Optionen:
- `just setup vault=/pfad/zum/vault` — Vault explizit setzen
- `just check` — nur Dependency-Status, keine Änderungen
- `CC_SETUP_NONINTERACTIVE=1 just setup` — non-interactive (CI)
- Vault nachziehen: `just install-vault` oder `just install-vault vault=/pfad/zum/vault`

Danach: Claude Code neu starten (oder neue Shell für `OBSIDIAN_VAULT_PATH`).

## Quellen-Sync (optional, selten nötig)

`just sync-sources` zieht die **neuesten** Definitionen von deinen **Lebend-Quellen**
ins cc-setup-Repo (`templates/`), bevor gebündelt wird:

| Quelle | Was |
|---|---|
| `~/GITHUB/ObsidianPKM/.claude/agents/` | SPOC-Subagenten (developer, reviewer, …) |
| `ObsidianPKM/.claude/skills/` | review, qmd, recall, opensrc, check-links, daily-review |
| `~/.cursor/skills/` | session-init, session-stop, knowledge |

Fehlt eine Quelle (z.B. kein Vault auf der Maschine) → committed `templates/` im Repo
werden verwendet, der Sync bricht nicht ab.

## Nach Setup verfügbar

- **Skills** flach unter `~/.claude/skills/<name>/` — z.B. `/context-load`, `/review`, `/qmd`, `/audit`, `/local-ci`
- **Agenten** via Agent-Tool: developer, reviewer, researcher, librarian, …
- **Hooks** in `~/.claude/settings.json`: SessionStart-Context + redactor strict mode

Manifest: `templates/BUNDLE-MANIFEST.md`

## Migration vom alten Plugin-/Marketplace-Install

Frühere Versionen installierten cc-setup als Claude-Code-**Plugin** über den
Marketplace `niclasedge-pkm` (`claude plugin marketplace add … && claude plugin install …`).
Der Flat-Install ist jetzt der einzige Pfad. Wer von einem alten Setup kommt, sollte den
alten Marketplace **vor** dem ersten `just setup` deinstallieren, sonst entstehen
Skill-Dubletten (Plugin-Namespace `/cc-setup:<name>` **und** flach `/<name>`):

```bash
# 1. Plugin deinstallieren
claude plugin uninstall project-context@niclasedge-pkm
claude plugin uninstall cc-setup@niclasedge-pkm   # falls so installiert

# 2. Marketplace entfernen
claude plugin marketplace remove niclasedge-pkm

# 3. Falls als lokales @skills-dir-Plugin konfiguriert: pluginConfigs-Eintrag
#    cc-setup@skills-dir aus ~/.claude/settings.json entfernen.

# danach Claude Code neu starten und einmal: just setup
```

`just setup` schreibt seine Hooks idempotent und ersetzt alte managed-Blöcke in
`~/.claude/CLAUDE.md` — der einzige Schritt, der manuell erfolgen muss, ist die
Marketplace-/Plugin-Deinstallation oben (cc-setup berührt das Live-Plugin-System nicht).

## Plattformen

macOS, Linux nativ. Windows: **Git Bash oder WSL** (bash-Hooks). Deploy nutzt `rsync`.

## Submodules

| Path | Upstream |
|---|---|
| `vendor/hook-redactor` | DGK-Development/hook-redactor |
| `vendor/cc-plugin-project-context` | niclasedge/cc-plugin-project-context |
