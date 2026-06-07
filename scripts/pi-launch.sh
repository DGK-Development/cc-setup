#!/usr/bin/env bash
# pi-launch.sh — Interactive pi launcher with milestone discovery.
#
# Usage:
#   bash scripts/pi-launch.sh                  # interactive: show milestones, ask, exec pi
#   bash scripts/pi-launch.sh --print-prompt   # dry-run: print the built prompt, do NOT exec pi
#
#   pio() { CC_SETUP_DIR="${CC_SETUP_DIR:-$HOME/GITHUB_DG/cc-setup}" bash "$CC_SETUP_DIR/scripts/pi-launch.sh" "$@"; }
#
# Requires: pi, jq (or python3), uv on $PATH; called from the repo root (cwd = Ziel-Repo).
#
# CC_SETUP_DIR: Verzeichnis der zentralen cc-setup-Installation (Maschinerie).
#   Default = Verzeichnis des Skripts / .. (sodass es aus cc-setup selbst funktioniert).
#   Setze CC_SETUP_DIR wenn du pi-launch.sh aus einem anderen Repo heraus aufrufst
#   (z.B. via pio-Funktion), damit Maschinerie aus cc-setup aufgeloest wird.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# CC_SETUP_DIR: zentrale cc-setup-Installation (Maschinerie: Extensions, Scripts).
# Default = Repo-Root des Launchers (= bisheriges cc-setup-Verhalten, Backward-Compat).
CC_SETUP_DIR="${CC_SETUP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
export CC_SETUP_DIR

DRY_RUN=false
if [[ "${1:-}" == "--print-prompt" ]]; then
    DRY_RUN=true
fi

# list_draft_ids — sortierte Draft-IDs (z.B. DRAFT-1) des aktuellen Repos.
# Genutzt fuer Snapshot-Diff: neue Drafts = (nachher) minus (vorher).
list_draft_ids() {
    # Trailing '|| true': leeres grep (keine Drafts) wuerde unter set -euo pipefail
    # sonst Exit 1 liefern und das Skript abbrechen.
    backlog draft list --plain 2>/dev/null \
        | sed 's/^[[:space:]]*//' \
        | grep -oE '^[A-Za-z][A-Za-z0-9._-]*-[0-9.]+' \
        | sort || true
}

# CC_DISPATCH_CMD: erlaubt Tests, den echten SDK-Worker-Aufruf zu ersetzen.
# Default = echter cc-dispatch.ts via bun.
CC_DISPATCH_CMD="${CC_DISPATCH_CMD:-bun $CC_SETUP_DIR/scripts/cc-dispatch.ts}"

# ---------------------------------------------------------------------------
# 1. Fetch survey JSON from sprint_bridge
# ---------------------------------------------------------------------------

SURVEY_JSON=""

# Allow injection via env for tests (SURVEY_JSON_OVERRIDE) — see test_pi_launch.py.
if [[ -n "${SURVEY_JSON_OVERRIDE:-}" ]]; then
    SURVEY_JSON="$SURVEY_JSON_OVERRIDE"
else
    SURVEY_JSON=$(uv run --script "$CC_SETUP_DIR/scripts/sprint_bridge.py" survey --repo "$PWD" 2>/dev/null || echo '{"open_milestones":[]}')
fi

# ---------------------------------------------------------------------------
# 2. Parse open_milestones (name, done, total) — use python3 as jq fallback
# ---------------------------------------------------------------------------

parse_milestones() {
    # Outputs lines: "<index> <name> <done> <total>"
    # Uses jq if available, otherwise python3.
    local json="$1"
    if command -v jq &>/dev/null; then
        echo "$json" | jq -r '
            .open_milestones // [] |
            to_entries[] |
            "\(.key) \(.value.name) \(.value.done) \(.value.total)"
        '
    else
        python3 - <<'PYEOF'
import json, sys, os
data = json.loads(os.environ.get("_MS_JSON", "{}"))
for i, ms in enumerate(data.get("open_milestones") or []):
    name = ms.get("name","")
    done = ms.get("done",0)
    total = ms.get("total",0)
    # Tab-delimit so names with spaces survive; reader uses read -r
    print(f"{i}\t{name}\t{done}\t{total}")
PYEOF
    fi
}

# Build parallel arrays from parsed output.
MS_NAMES=()
MS_DONE=()
MS_TOTAL=()

if command -v jq &>/dev/null; then
    while IFS=' ' read -r idx name done total; do
        # name may contain spaces — capture everything between second and third-last tokens
        # Actually jq output format: "<idx> <name (may have spaces)> <done> <total>"
        # We need a stable separator. Re-parse with tab separator via jq.
        :
    done < /dev/null
    # Use jq with tab-separated output for safety
    while IFS=$'\t' read -r idx name done total; do
        MS_NAMES+=("$name")
        MS_DONE+=("$done")
        MS_TOTAL+=("$total")
    done < <(echo "$SURVEY_JSON" | jq -r '
        .open_milestones // [] |
        to_entries[] |
        [(.key|tostring), .value.name, (.value.done|tostring), (.value.total|tostring)] |
        join("\t")
    ')
else
    while IFS=$'\t' read -r idx name done total; do
        MS_NAMES+=("$name")
        MS_DONE+=("$done")
        MS_TOTAL+=("$total")
    done < <(python3 -c "
import json, sys
data = json.loads('''$SURVEY_JSON''')
for i, ms in enumerate(data.get('open_milestones') or []):
    name = ms.get('name','').replace(chr(9),' ')
    done = ms.get('done',0)
    total = ms.get('total',0)
    print(f'{i}\t{name}\t{done}\t{total}')
")
fi

# ---------------------------------------------------------------------------
# 3. Show menu
# ---------------------------------------------------------------------------

NUM_MILESTONES=${#MS_NAMES[@]}

if [[ "$DRY_RUN" == "false" ]]; then
    echo ""
    echo "=== pi Launcher — Welcher Meilenstein? ==="
    echo ""
fi

if [[ $NUM_MILESTONES -eq 0 ]]; then
    if [[ "$DRY_RUN" == "false" ]]; then
        echo "  (Keine offenen Meilensteine gefunden)"
        echo ""
    fi
else
    for i in "${!MS_NAMES[@]}"; do
        label=$((i + 1))
        if [[ "$DRY_RUN" == "false" ]]; then
            printf "  %d) %s  (%d/%d done)\n" "$label" "${MS_NAMES[$i]}" "${MS_DONE[$i]}" "${MS_TOTAL[$i]}"
        fi
    done
fi

NEW_LABEL=$((NUM_MILESTONES + 1))
if [[ "$DRY_RUN" == "false" ]]; then
    printf "  %d) Neuer Meilenstein\n" "$NEW_LABEL"
    echo ""
    printf "Auswahl [1-%d]: " "$NEW_LABEL"
fi

# ---------------------------------------------------------------------------
# 4. Read selection
# ---------------------------------------------------------------------------

read -r SELECTION

# Validate: must be a number in range
if ! [[ "$SELECTION" =~ ^[0-9]+$ ]] || [[ "$SELECTION" -lt 1 ]] || [[ "$SELECTION" -gt "$NEW_LABEL" ]]; then
    echo "Ungueltige Auswahl: $SELECTION" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# 5. Build the pi prompt
# ---------------------------------------------------------------------------

PROMPT=""

if [[ "$SELECTION" -eq "$NEW_LABEL" ]]; then
    # New milestone: ask for name
    if [[ "$DRY_RUN" == "false" ]]; then
        printf "Name des neuen Meilensteins: "
    fi
    read -r NEW_MS_NAME
    if [[ -z "$NEW_MS_NAME" ]]; then
        echo "Kein Meilenstein-Name angegeben." >&2
        exit 1
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
        # Dry-run: KEINE Worker-/Backlog-Seiteneffekte. Alten Prompt-Shape beibehalten
        # (Prompt-Form-Tests in test_pi_launch.py); echtes Verhalten unten im Live-Pfad.
        echo "Start orchestrator pipeline for new milestone '${NEW_MS_NAME}'."
        exit 0
    fi

    # ── Live-Pfad: Meilenstein per Claude-Worker in Draft-Tasks zerlegen ──────
    # Optionales Ziel/Beschreibung fuer eine bessere Zerlegung.
    printf "Ziel/Beschreibung (optional, Enter = Name verwenden): "
    read -r NEW_MS_GOAL
    [[ -z "$NEW_MS_GOAL" ]] && NEW_MS_GOAL="$NEW_MS_NAME"

    # 1) Drafts VOR dem Worker schnappschiessen (fuer den Diff).
    DRAFTS_BEFORE="$(list_draft_ids)"

    # 2) milestone-planner Worker dispatchen — er legt die Tasks als Drafts an.
    #    stderr (Live-Fortschritt) bleibt sichtbar; stdout (Ergebnis-JSON) -> /dev/null.
    echo ""
    echo "→ Claude-Worker zerlegt den Meilenstein in Aufgaben (Drafts)…"
    WORKER_PROMPT="Milestone name (use VERBATIM as the -m tag): ${NEW_MS_NAME}
Milestone goal: ${NEW_MS_GOAL}
Repo root (your CWD): ${PWD}
Decompose this milestone into 3-7 atomic, ordered, independently-testable backlog tasks and CREATE each as a DRAFT:
  backlog task create \"<title>\" -d \"<why>\" --ac \"<criterion>\" -m \"${NEW_MS_NAME}\" --draft
Do not promote, commit, or push."
    # shellcheck disable=SC2086
    ${CC_DISPATCH_CMD} milestone-planner "$WORKER_PROMPT" --role milestone-planner --model claude-sonnet-4-6 --timeout 300 >/dev/null || true

    # 3) Neue Drafts = (nachher) minus (vorher).
    DRAFTS_AFTER="$(list_draft_ids)"
    NEW_DRAFTS="$(comm -13 <(printf '%s\n' "$DRAFTS_BEFORE") <(printf '%s\n' "$DRAFTS_AFTER"))"

    if [[ -z "${NEW_DRAFTS//[$'\n\t ']/}" ]]; then
        echo "Worker hat keine Draft-Tasks erzeugt — Abbruch." >&2
        exit 1
    fi

    # 4) Human-Gate: vorgeschlagene Drafts zeigen + freigeben (vor dem Build-Loop).
    echo ""
    echo "=== Vorgeschlagene Tasks (Drafts) für Meilenstein '${NEW_MS_NAME}' ==="
    while IFS= read -r d; do
        [[ -z "$d" ]] && continue
        title="$(backlog draft view "$d" --plain 2>/dev/null | grep -m1 -E '^Task ' | sed 's/^Task //' || true)"
        printf "  - %s\n" "${title:-$d}"
    done <<< "$NEW_DRAFTS"
    echo ""
    printf "Freigeben und Build-Loop starten? [j/N]: "
    read -r APPROVE
    if [[ ! "$APPROVE" =~ ^[jJyY] ]]; then
        echo "Verworfen — Drafts werden archiviert (kein Build)."
        while IFS= read -r d; do
            [[ -n "$d" ]] && backlog draft archive "$d" >/dev/null 2>&1 || true
        done <<< "$NEW_DRAFTS"
        exit 0
    fi

    # 5) Freigegeben → Drafts zu To-Do-Tasks promoten.
    while IFS= read -r d; do
        [[ -n "$d" ]] && backlog draft promote "$d" >/dev/null 2>&1 || true
    done <<< "$NEW_DRAFTS"

    # 6) PICK auf den neuen Meilenstein scopen + normalen Pipeline-Prompt bauen.
    export CC_ORCH_MILESTONE="$NEW_MS_NAME"
    PROMPT="Start orchestrator pipeline. Continue milestone '${NEW_MS_NAME}'. Pick the next open task and run the full pipeline."
else
    # Existing milestone
    IDX=$((SELECTION - 1))
    MS_NAME="${MS_NAMES[$IDX]}"

    # Export the chosen milestone so cc-backlog.sh cmd_next can filter by it.
    export CC_ORCH_MILESTONE="$MS_NAME"

    PROMPT="Start orchestrator pipeline. Continue milestone '${MS_NAME}'. Pick the next open task and run the full pipeline."
fi

# ---------------------------------------------------------------------------
# 6. Dry-run: print prompt and exit; else exec pi
# ---------------------------------------------------------------------------

if [[ "$DRY_RUN" == "true" ]]; then
    echo "$PROMPT"
    exit 0
fi

exec pi \
    --provider ollama \
    --model gemma4:12b-mlx \
    -e "$CC_SETUP_DIR/.pi/extensions/damage-control.ts" \
    -e "$CC_SETUP_DIR/.pi/extensions/cc-orchestrator.ts" \
    --no-builtin-tools \
    "$PROMPT"
