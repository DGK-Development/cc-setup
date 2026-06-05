# cc-setup — Skills + Agents + Hooks deployen (kein Plugin)

default:
    @just --list

# Deploy: Skills + Agents + Hooks + Vault flach ins Ziel-Home (default ~/.claude)
deploy target="" vault="":
    #!/usr/bin/env bash
    set -euo pipefail
    args=()
    [[ -n "{{target}}" ]] && args+=(--home "{{target}}")
    [[ -n "{{vault}}" ]] && args+=(--vault "{{vault}}")
    bash scripts/deploy.sh "${args[@]}"

# Alias: just setup → just deploy (Rückwärtskompatibilität)
setup vault="": (deploy "" vault)

# Nur Dep-Status prüfen (keine Änderungen)
check:
    bash scripts/deploy.sh --check

update: deploy

# Quellen aus Vault/Cursor nach skills/ + agents/ ziehen (manuell, selten nötig)
sync-sources:
    bash scripts/sync-from-sources.sh

sync-local-ci:
    bash scripts/sync-local-ci.sh
    bash scripts/patch-local-ci-paths.sh

pull:
    git submodule update --init --remote

# Debug-Bundle in einen inspizierbaren Ordner bauen (deploy nutzt ein Temp-Dir)
bundle out="dist/cc-setup":
    bash scripts/bundle.sh "{{out}}"

# Vault nachträglich setzen (ohne vollständigen Deploy-Durchlauf)
install-vault vault="$HOME/GITHUB/ObsidianPKM":
    bash scripts/deploy.sh --vault "{{vault}}"

# Alle Test-Suites (repo-lokal in scripts/): sprint-bridge + session-analyse + waste + context-resolve
test:
    cd scripts && uv run --with pytest --with pyyaml pytest test_sprint_bridge.py test_session_analyze.py test_session_waste.py test_context_resolve.py -v
