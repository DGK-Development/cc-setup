#!/usr/bin/env bash
# run-gates.sh — deterministischer Gate-Runner fuer cc-setup
# Fuehrt die konfigurierten Gates der Reihe nach aus und gibt ein valides
# JSON-Objekt auf stdout aus:
#   {"pass": <bool>, "failed": ["<gate-name>", ...], "log": "<pfad>"}
#
# Aufruf: redactor wrap -- bash scripts/run-gates.sh
# Alle Sub-Commands laufen via redactor wrap -- (Org-Compliance).
# Fortschritts-Ausgabe geht auf stderr + Logdatei; stdout ist reines JSON.
#
# Gates:
#   test      -> just test  (Python pytest + Deno-Tests)
#   go-build  -> just go-build  (Go build + vet + gofmt)

set -euo pipefail

# F5: Dependency-Guard — fehlt eine Pflicht-Binary, sofort mit Fehler-JSON abbrechen.
for _dep in jq redactor just; do
    if ! command -v "${_dep}" >/dev/null 2>&1; then
        printf '{"pass":false,"failed":["dependency-missing-%s"],"log":""}\n' "${_dep}"
        exit 2
    fi
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${REPO_ROOT}/logs"
LOG_FILE="${LOG_DIR}/run-gates-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "${LOG_DIR}"

# Gate-Definitionen: "name:command"
declare -a GATES=(
    "test:just test"
    "go-build:just go-build"
)

declare -a FAILED_GATES=()

# F2: Guard-Flag — wird auf 1 gesetzt, nachdem das regulaere JSON ausgegeben wurde.
# Der EXIT-Trap prueft das Flag und emittiert Fallback-JSON, falls der normale
# Abschluss nicht erreicht wurde (pipefail, Signal, fehlendes Binary etc.).
_JSON_EMITTED=0

_emit_fallback_json() {
    if [ "${_JSON_EMITTED}" -eq 0 ]; then
        # Baue failed-Array aus dem bisher gefuellten FAILED_GATES (ggf. leer).
        local fb_failed="[]"
        local g
        for g in "${FAILED_GATES[@]+"${FAILED_GATES[@]}"}"; do
            fb_failed="$(printf '%s' "${fb_failed}" | jq --arg g "${g}" '. + [$g]')" || true
        done
        jq -n \
            --argjson failed "${fb_failed}" \
            --arg log "${LOG_FILE:-}" \
            '{"pass":false,"failed":$failed,"log":$log}' 2>/dev/null \
            || printf '{"pass":false,"failed":[],"log":""}\n'
    fi
}
trap '_emit_fallback_json' EXIT

# F1: log() mit || true — tee-Fehler (Disk voll, LOG_FILE nicht schreibbar) bricht
# das Skript nicht ab, weil set -euo pipefail auf Pipelines greift. || true
# verhindert einen ungewollten EXIT-Trap-Aufruf in der Logging-Infrastruktur.
log() {
    echo "$*" | tee -a "${LOG_FILE}" >&2 || true
}

log "=== run-gates.sh start $(date -Iseconds) ==="
log "Repo: ${REPO_ROOT}"
log ""

for gate_entry in "${GATES[@]}"; do
    gate_name="${gate_entry%%:*}"
    gate_cmd="${gate_entry#*:}"

    log "--- Gate: ${gate_name} | cmd: ${gate_cmd} ---"

    # F3: REPO_ROOT quote-sicher einbetten via printf %q (verhindert Wortspaltung
    # und Glob-Expansion bei Pfaden mit Leerzeichen oder Sonderzeichen).
    _safe_root="$(printf '%q' "${REPO_ROOT}")"

    # Sub-Command via redactor wrap -- (Org-Compliance: Strict Mode).
    # stdout+stderr landen in der Logdatei — stdout bleibt sauber fuer JSON.
    if redactor wrap -- bash -c "cd ${_safe_root} && ${gate_cmd}" >> "${LOG_FILE}" 2>&1; then
        log "[${gate_name}] PASS"
    else
        # F1: erst FAILED_GATES befuellen, dann loggen — verhindert Datenverlust
        # falls log() intern fehlschlaegt und pipefail greift.
        FAILED_GATES+=("${gate_name}")
        log "[${gate_name}] FAIL"
    fi
    log ""
done

log "=== run-gates.sh end $(date -Iseconds) ==="

# JSON-Ausgabe bauen via jq — nur auf stdout, korrekt escapte Strings.
if [ ${#FAILED_GATES[@]} -eq 0 ]; then
    pass_val="true"
else
    pass_val="false"
fi

# failed-Array aufbauen.
failed_json="[]"
for gate_name in "${FAILED_GATES[@]+"${FAILED_GATES[@]}"}"; do
    failed_json="$(printf '%s' "${failed_json}" | jq --arg g "${gate_name}" '. + [$g]')"
done

# Einzige regulaere Ausgabe auf stdout: valides JSON-Objekt.
jq -n \
    --argjson pass "${pass_val}" \
    --argjson failed "${failed_json}" \
    --arg log "${LOG_FILE}" \
    '{"pass": $pass, "failed": $failed, "log": $log}'

# Normales Ende erreicht — Trap darf kein Fallback-JSON mehr ausgeben.
_JSON_EMITTED=1
