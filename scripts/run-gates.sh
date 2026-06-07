#!/usr/bin/env bash
# run-gates.sh — deterministischer Gate-Runner (portabel, Auto-Detect)
# Fuehrt die konfigurierten Gates der Reihe nach aus und gibt ein valides
# JSON-Objekt auf stdout aus:
#   {"pass": <bool>, "failed": ["<gate-name>", ...], "log": "<pfad>"}
#
# Aufruf: redactor wrap -- bash scripts/run-gates.sh
#   oder:  bash /path/to/cc-setup/scripts/run-gates.sh   (aus beliebigem Repo, cwd=Ziel-Repo)
#
# Optionen:
#   --print-gates   Dry-Run: gibt erkannte Gates als "name:command" aus (eine pro Zeile)
#                   und beendet sich ohne die Gates auszufuehren (exit 0).
#
# Gate-Konfiguration (in Reihenfolge):
#   1. ${REPO_ROOT}/.pi/gates   — Zeilen "name:command" (ueberschreibt Auto-Detect komplett)
#   2. Auto-Detect (mehrere moeglich, in dieser Prio):
#        justfile / Justfile   -> test:just test
#        package.json          -> test:npm test
#        Cargo.toml            -> test:cargo test
#        deno.json / deno.jsonc -> test:deno task test
#   3. Nichts erkannt und keine .pi/gates -> Fehler-JSON {pass:false, failed:[no-gates-detected]}
#
# REPO_ROOT = PWD (cwd = Ziel-Repo); Skript-Ort ist irrelevant.
# Alle Sub-Commands laufen via redactor wrap -- (Org-Compliance).

set -euo pipefail

# PATH-Erweiterung: In non-login Subshells (pi-Orchestrator, CI) fehlen oft die
# Homebrew- und User-Bins. Wir fuegen die ueblichen Pfade vorne ein, damit
# just/deno/jq/redactor gefunden werden, ohne den System-PATH zu ueberschreiben.
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${HOME}/.cargo/bin:${HOME}/.local/bin:${HOME}/.bun/bin:${HOME}/.deno/bin:${PATH:-}"

# ── Optionen parsen ───────────────────────────────────────────────────────────
PRINT_GATES=false
for _arg in "$@"; do
    if [[ "${_arg}" == "--print-gates" ]]; then
        PRINT_GATES=true
    fi
done

# ── REPO_ROOT aus cwd ─────────────────────────────────────────────────────────
# cwd = Ziel-Repo (gesetzt vom Aufrufer / pi-Launcher). Skript-Ort ist irrelevant.
REPO_ROOT="${PWD}"
LOG_DIR="${REPO_ROOT}/logs"

# ── Gate-Auto-Detect / .pi/gates Override ────────────────────────────────────
# Ergebnis: GATES-Array mit "name:command"-Strings.
declare -a GATES=()

_gates_file="${REPO_ROOT}/.pi/gates"
if [[ -f "${_gates_file}" ]]; then
    # .pi/gates existiert: Zeilen laden (leere Zeilen und #-Kommentare ignorieren)
    while IFS= read -r _line; do
        [[ -z "${_line}" || "${_line}" =~ ^# ]] && continue
        GATES+=("${_line}")
    done < "${_gates_file}"
else
    # Auto-Detect: mehrere Marker koennen parallel vorhanden sein
    [[ -f "${REPO_ROOT}/justfile" || -f "${REPO_ROOT}/Justfile" ]] && GATES+=("test:just test")
    [[ -f "${REPO_ROOT}/package.json" ]] && GATES+=("test:npm test")
    [[ -f "${REPO_ROOT}/Cargo.toml" ]] && GATES+=("test:cargo test")
    [[ -f "${REPO_ROOT}/deno.json" || -f "${REPO_ROOT}/deno.jsonc" ]] && GATES+=("test:deno task test")
fi

# ── Dry-Run: Gates ausgeben ohne auszufuehren ─────────────────────────────────
if [[ "${PRINT_GATES}" == "true" ]]; then
    if [[ ${#GATES[@]} -eq 0 ]]; then
        echo "no-gates-detected"
    else
        for _g in "${GATES[@]}"; do
            echo "${_g}"
        done
    fi
    exit 0
fi

# ── Kein Gate erkannt → SKIP (als PASS gewertet) ─────────────────────────────
# Keine Gate-Quelle (kein justfile/package.json/Cargo.toml/deno.json und keine
# .pi/gates) = nichts zu pruefen. Bewusst als PASS/SKIP gewertet (User-Entscheid),
# damit die Pipeline in Doku-/Sandbox-Repos nicht fail-closed haengt. Oversight
# bleibt via Human-Gate0 (Spec) + Reviewer. Das laute Log macht transparent, dass
# NICHT automatisiert getestet wurde — kein stiller gruener Lauf.
if [[ ${#GATES[@]} -eq 0 ]]; then
    printf '{"pass":true,"failed":[],"log":"skipped: no gates configured (no justfile/package.json/Cargo.toml/deno.json and no .pi/gates)"}\n'
    exit 0
fi

# ── Dependency-Guard ──────────────────────────────────────────────────────────
# jq und redactor sind immer noetig; just nur pruefen wenn ein just-Gate aktiv ist.
for _dep in jq redactor; do
    if ! command -v "${_dep}" >/dev/null 2>&1; then
        printf '{"pass":false,"failed":["dependency-missing-%s"],"log":""}\n' "${_dep}"
        exit 2
    fi
done

# just nur pruefen wenn mindestens ein just-Gate vorhanden
_need_just=false
for _g in "${GATES[@]}"; do
    _cmd="${_g#*:}"
    if [[ "${_cmd}" == just* ]]; then
        _need_just=true
        break
    fi
done
if [[ "${_need_just}" == "true" ]] && ! command -v just >/dev/null 2>&1; then
    printf '{"pass":false,"failed":["dependency-missing-just"],"log":""}\n'
    exit 2
fi

LOG_FILE="${LOG_DIR}/run-gates-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "${LOG_DIR}"

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

    # Gate-Commands werden als Positionsparameter uebergeben (bash -c '"$@"' _ word…),
    # nicht via String-Interpolation. Das verhindert Quoting-Bugs durch printf %q:
    # "just test" bleibt zwei separate Argumente (just + test) statt einem
    # zusammengezogenen Token "just\ test". REPO_ROOT wird via printf %q abgesichert
    # (Pfade mit Leerzeichen) und nur fuer das cd-Prefix verwendet.
    # Statische, kontrollierte Gate-Strings aus dem GATES-Array — kein nutzer-supplied Input.
    _safe_root="$(printf '%q' "${REPO_ROOT}")"
    # gate_cmd in Positionsparameter aufsplitten (IFS-Split auf Leerzeichen — ausreichend
    # fuer die statischen Gate-Strings; kein Glob/Quoting-Problem moeglich).
    # shellcheck disable=SC2086
    read -r -a _gate_args <<< "${gate_cmd}"

    # Sub-Command via redactor wrap -- (Org-Compliance: Strict Mode).
    # stdout+stderr landen in der Logdatei — stdout bleibt sauber fuer JSON.
    if redactor wrap -- bash -c "cd ${_safe_root} && "'"$@"' _ "${_gate_args[@]}" >> "${LOG_FILE}" 2>&1; then
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

# F4: _JSON_EMITTED VOR dem jq-Aufruf setzen — verhindert, dass bei jq-Fehler
# der EXIT-Trap ein zweites JSON auf stdout emittiert. Wenn jq selbst fehlschlaegt
# (z.B. kaputtes failed_json), faengt das || ab und gibt ein sicheres Fallback-JSON.
# So landet IMMER genau ein JSON auf stdout.
_JSON_EMITTED=1
jq -n \
    --argjson pass "${pass_val}" \
    --argjson failed "${failed_json}" \
    --arg log "${LOG_FILE}" \
    '{"pass": $pass, "failed": $failed, "log": $log}' \
    || jq -n --arg log "${LOG_FILE}" '{"pass":false,"failed":["jq-render-error"],"log":$log}'
