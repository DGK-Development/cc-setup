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

# Single-Pane-Status-Dashboard (read-only) auf 127.0.0.1 starten + Browser oeffnen
overview port="8765":
    uv run --script scripts/knowledge.py --cwd . --port {{port}}

# Alle Test-Suites (repo-lokal in scripts/): sprint-bridge + session-analyse + waste + context-resolve + knowledge-dashboard.
# knowledge.py braucht fastapi+httpx fuer den Route-Smoke-Test; das laeuft als python -m pytest in einer
# Ad-hoc-uv-Umgebung (uv run --with pytest <…> pytest zieht pytest als isoliertes Tool ohne die --with-Extras).
test:
    cd scripts && uv run --with pytest --with pyyaml pytest test_sprint_bridge.py test_session_analyze.py test_session_waste.py test_context_resolve.py -v
    cd scripts && uv run --isolated --no-project --with pytest --with fastapi --with httpx --with python-multipart python -m pytest test_knowledge.py -v
