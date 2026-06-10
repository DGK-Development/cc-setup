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

# Deploy OHNE redactor-Wiring (entfernt redactor aus settings.json + CLAUDE.md, setzt Sentinel)
deploy-no-redactor target="" vault="":
    #!/usr/bin/env bash
    set -euo pipefail
    args=(--no-redactor)
    [[ -n "{{target}}" ]] && args+=(--home "{{target}}")
    [[ -n "{{vault}}" ]] && args+=(--vault "{{vault}}")
    bash scripts/deploy.sh "${args[@]}"

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

# Single-Pane-Status-Dashboard (Go-Port) starten + Browser oeffnen.
# Default host=0.0.0.0 → im LAN erreichbar (via VM-IP). Fuer rein lokal: `just go 8765 127.0.0.1`.
# Loescht ZUERST den Aggregat-Cache (frische Discovery) + stoppt laufende Instanzen (Go + Deno).
go port="8765" host="0.0.0.0":
    #!/usr/bin/env bash
    pkill -f "go-knowledge-app" 2>/dev/null || true
    pkill -f "deno run.*main\.ts.*--cwd" 2>/dev/null || true
    rm -f "${CC_KNOWLEDGE_CACHE:-$HOME/.cache/cc-knowledge/cache.json}"
    sleep 1
    if [ "{{host}}" = "0.0.0.0" ]; then
      lan_ip=$(hostname -I | awk '{print $1}')
      echo "knowledge (go) → lokal: http://127.0.0.1:{{port}}/  ·  LAN: http://${lan_ip}:{{port}}/"
    else
      echo "knowledge (go) → http://{{host}}:{{port}}/"
    fi
    cd go-knowledge-app && exec go run . --cwd .. --port {{port}} --host {{host}}

# Go-Build-Gate: kompiliert + vettet + gofmt-Check (kein Server-Start).
go-build:
    cd go-knowledge-app && go build ./... && go vet ./... && test -z "$(gofmt -l .)"

# Deno-Tests (deno test)
deno-test:
    cd deno-knowledge-app && deno task test

# Alle Test-Suites: Python-Helper (sprint-bridge + session-analyse + waste + context-resolve + pi-launch)
# plus die Deno-App (deno-knowledge-app). knowledge.py-Dashboard ist nach Deno migriert (CCS-018).
test:
    cd scripts && uv run --with pytest --with pyyaml pytest test_sprint_bridge.py test_session_analyze.py test_session_waste.py test_context_resolve.py test_pi_launch.py test_run_gates_detect.py -v
    cd scripts && bun test slack-ask.test.ts cc-dispatch.test.ts caps-logic.test.ts gate0-spec.test.ts system-prompt.test.ts
    cd deno-knowledge-app && deno task test

# Interaktiver pi-Launcher: ermittelt offene Meilensteine, fragt welcher fortgesetzt
# oder ob ein neuer gestartet wird, baut daraus den pi-Prompt und startet pi mit
# beiden Extensions (damage-control + cc-orchestrator).
#
# Voraussetzungen: pi, uv, jq (oder python3) auf $PATH; Ollama + ANTHROPIC_API_KEY gesetzt.
# Fuer direkten Start ohne Frage: just orchestrate [task-id]
pi:
    bash scripts/pi-launch.sh

# Startet den pi-Orchestrator-Dispatcher (lokales Ollama-Modell) mit beiden Extensions.
# Der Dispatcher sequenziert die Pipeline PICK→SPEC→Gate→DEV→GATE→REVIEW→DONE.
# Intelligenzlastige Schritte (planner/builder/reviewer) werden an claude -p Worker delegiert.
#
# Voraussetzungen:
#   - pi auf $PATH (github.com/earendil-works/pi)
#   - Ollama läuft lokal mit Modell gemma4:12b-mlx
#   - ANTHROPIC_API_KEY gesetzt (für claude -p Worker)
#   - bun, just, jq auf $PATH
#
# Optionales Argument task-id: wird als Kontext-Hinweis an den Dispatcher übergeben.
# Ohne Argument startet der Dispatcher und wählt selbst den nächsten "To Do"-Task.
#
# Human-Gates:
#   Spec-Gate:  touch .pi/orchestrator-resume         (approve)
#               touch .pi/orchestrator-resume-cancel  (cancel)
#   Kill-Switch: touch .pi/orchestrator.kill          (sofortiger Abbruch)
orchestrate task-id="":
    #!/usr/bin/env bash
    set -euo pipefail
    prompt="Start orchestrator pipeline"
    if [[ -n "{{task-id}}" ]]; then
        prompt="Start orchestrator pipeline for task {{task-id}}"
    fi
    exec pi \
        --provider ollama \
        --model gemma4:12b-mlx \
        -e .pi/extensions/damage-control.ts \
        -e .pi/extensions/cc-orchestrator.ts \
        --no-builtin-tools \
        "$prompt"
