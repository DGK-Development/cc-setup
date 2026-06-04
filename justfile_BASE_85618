# cc-setup — bundle cc-plugin-project-context + hook-redactor for @skills-dir

default:
    @just --list

# Alles in einem: sync → bundle → ~/.claude/skills → Vault-Frage
install:
    bash scripts/install.sh

update: install

# Nur Schritt 1 von install (manuell, selten nötig)
sync-sources:
    bash scripts/sync-from-sources.sh

sync-local-ci:
    bash scripts/sync-local-ci.sh
    bash scripts/patch-local-ci-paths.sh

pull:
    git submodule update --init --remote

bundle: pull
    bash scripts/bundle.sh

# Vault-Deps ohne kompletten install (oder non-interactive Nachziehen)
install-vault vault="$HOME/GITHUB/ObsidianPKM":
    #!/usr/bin/env bash
    set -euo pipefail
    test -x dist/cc-setup/scripts/setup.sh || { echo "run just install first (bundle)"; exit 1; }
    bash dist/cc-setup/scripts/setup.sh --vault "{{vault}}"

validate: bundle
    claude plugin validate "{{justfile_directory()}}/dist/cc-setup"

dev:
    claude --plugin-dir "{{justfile_directory()}}/dist/cc-setup"
