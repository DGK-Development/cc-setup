# qmd Collections — Indizierte Projekte verwalten

## Aktueller Stand (2026-05-17)

12 Collections, 9921 Files, 45290 Vectors, ~333 MB Index.

```
affiliate-hub-sites         352 Files   23d alt
claude-code                 218 Files   28d alt
ObsidianPKM                8151 Files    2h alt   ← Vault
mac-mini-agent               14 Files   29d alt
claude-research-assistant    72 Files   27d alt
eink                         33 Files   14h alt
obsidian-kanban              92 Files   29d alt
youtube-summary               8 Files   41d alt
deinelistings-de             67 Files   29d alt
yt-gen-pipeline             914 Files    2h alt
wiki                          0 Files    LEER
sessions                      0 Files    LEER
```

Live abrufen: `redactor wrap -- qmd collection list`

## Was fehlt aktuell

GITHUB-Projekte ohne Index (Stand `~/GITHUB/`):
- `kite-public` (SvelteKit + Go)
- `Gemini-CLI-UI`
- `astro-5-news-template`
- `llm-evals`
- `scripts` (219 Python-Skripte!)
- `glance`
- `caa-go`

Diese koennten potentiell hinzu (siehe unten), wenn cross-projekt-relevant.

## Commands

```bash
# Collection hinzufuegen
redactor wrap -- qmd collection add ~/GITHUB/scripts --name scripts
redactor wrap -- qmd embed                      # danach Vectors generieren

# Collection entfernen
redactor wrap -- qmd collection remove sessions   # die zwei leeren weg
redactor wrap -- qmd collection remove wiki

# Umbenennen
redactor wrap -- qmd collection rename old-name new-name

# Details zeigen
redactor wrap -- qmd collection show ObsidianPKM

# Aus Default-Queries ausschliessen (bleibt indiziert, taucht aber nicht in
# Cross-Search auf — sinnvoll fuer Archive)
redactor wrap -- qmd collection exclude affiliate-hub-sites
redactor wrap -- qmd collection include affiliate-hub-sites    # wieder rein

# Auto-Update-Hook setzen (vor Re-Index `git pull` ausfuehren)
redactor wrap -- qmd collection update-cmd ObsidianPKM 'git pull'
```

## Re-Index

```bash
redactor wrap -- qmd update                       # alle Collections neu indizieren
redactor wrap -- qmd update --pull                # vorher `git pull` pro Repo
redactor wrap -- qmd embed                        # nur Embeddings refreshen
redactor wrap -- qmd embed -f                     # force: alle Vectors neu
```

Re-Index ist inkrementell — nur geaenderte Dateien werden neu eingelesen.

## Context-Summaries

Pro Collection und Ordner kann eine menschlich geschriebene Zusammenfassung hinterlegt werden, die in Such-Treffer als `Context:` eingeblendet wird und in Vector-Queries als zusaetzliches Signal dient:

```bash
redactor wrap -- qmd context add ObsidianPKM/Atlas/Wiki "Wiki-Struktur v0.5: Topics + References mit parentTopic + Slug-Chain"
redactor wrap -- qmd context list
redactor wrap -- qmd context rm ObsidianPKM/Atlas/Wiki
```

Bereits gesetzt:
- Jede Collection hat `/` und `/knowledge`-Kontext (Auto-generiert beim `add`)

## Empfehlungen

1. **Leere Collections aufraeumen:**
   ```bash
   redactor wrap -- qmd collection remove wiki
   redactor wrap -- qmd collection remove sessions
   ```

2. **Stale Collections (>20 Tage):** entweder `qmd update` oder `qmd collection exclude <name>`, falls Projekt ruht.

3. **Hochfrequente Vaults (`ObsidianPKM`, `yt-gen-pipeline`):** alle paar Tage via `qmd update --pull`. Optional als launchd-Job.

4. **Neue Repos:** beim Klonen direkt `qmd collection add . --name <repo>` + `qmd embed`.

## Patterns

Default: `**/*.md` — andere Patterns via `--pattern`-Flag beim `add`:

```bash
redactor wrap -- qmd collection add ~/GITHUB/llm-evals --name llm-evals --pattern '**/*.{md,mdx,py}'
```

(Achtung: `.py`-Files werden tokenisiert wie Plain-Text, BM25 funktioniert; Vector-Embeddings bleiben semantisch eingeschraenkt fuer Code.)
