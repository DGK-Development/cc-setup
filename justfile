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

# Single-Pane-Status-Dashboard (Deno) auf 127.0.0.1 starten + Browser oeffnen.
# Stoppt ZUERST alle laufenden Instanzen (kein Mehrfach-Server → keine RAM-Last).
overview port="8765":
    #!/usr/bin/env bash
    pkill -f "deno task" 2>/dev/null || true
    pkill -f "deno run.*main\.ts.*--cwd" 2>/dev/null || true
    sleep 1
    echo "knowledge (deno) → http://127.0.0.1:{{port}}/"
    cd deno-knowledge-app && exec deno task start --cwd .. --port {{port}}

# Wie overview, aber mit Live-Reload (--watch) + ohne Browser-Autostart (Dev).
deno port="8765":
    #!/usr/bin/env bash
    pkill -f "deno task" 2>/dev/null || true
    pkill -f "deno run.*main\.ts.*--cwd" 2>/dev/null || true
    sleep 1
    echo "knowledge (deno) → http://127.0.0.1:{{port}}/  · Live-Reload via --watch"
    cd deno-knowledge-app && exec deno task dev --cwd .. --port {{port}} --no-open

# Deno-Tests (deno test)
deno-test:
    cd deno-knowledge-app && deno task test

# Alle Test-Suites: Python-Helper (sprint-bridge + session-analyse + waste + context-resolve)
# plus die Deno-App (deno-knowledge-app). knowledge.py-Dashboard ist nach Deno migriert (CCS-018).
test:
    cd scripts && uv run --with pytest --with pyyaml pytest test_sprint_bridge.py test_session_analyze.py test_session_waste.py test_context_resolve.py -v
    cd deno-knowledge-app && deno task test
