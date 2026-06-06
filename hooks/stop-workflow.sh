#!/usr/bin/env bash
# stop-workflow.sh — Stop-Hook-Orchestrator (vendored via cc-setup, CCS-008)
#
# Reihenfolge: cleanup → PKM-Sync (Claude-Doku) → Session-Sync-to-Vault.
# WICHTIG (CCS-008): Dieser Hook pusht NIE automatisch. Commits/Pushes entscheidet
# der Mensch nach Review (Human-Oversight-Pflicht). Die Submodul-Pointer-Guard
# (submodule_push_guard) ist als Safety/Doku für den MANUELLEN Push gedacht.
#
# Laufzeit-Pfade:
#   HOOK_DIR  = Verzeichnis dieses Hooks (managed source). Beim cc-setup-Deploy ist das
#               ~/.claude/skills/cc-setup/hooks/ — hier liegt die gehärtete pkm-sync-stop.sh
#               direkt daneben und MUSS von hier aufgerufen werden (nicht aus ~/.claude/hooks/,
#               sonst läuft die Push-Härtung ins Leere).
#   PAI_DIR   = ~/.claude. Die Sub-Hooks cleanup-dispatch-stop.sh / sync-sessions-to-vault.sh
#               werden NICHT von cc-setup vendored (separate Quelle); sie werden best-effort
#               aus $PAI_DIR/hooks/ aufgerufen, falls live vorhanden.
set -u

INPUT=$(cat)
PAI_DIR="${PAI_DIR:-$HOME/.claude}"
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Orchestrated headless worker: skip PKM-sync / decision:block to avoid doc loops.
# redactor (PreToolUse) and no-auto-push (CCS-008) are separate concerns, unaffected.
if [ "${CC_ORCHESTRATED:-}" = "1" ]; then exit 0; fi

run_hook_stderr() {
  local hook="$1"
  [ -x "$hook" ] || return 0
  printf '%s' "$INPUT" | "$hook" 1>&2 || true
}

run_hook_capture() {
  local hook="$1"
  [ -x "$hook" ] || return 0
  printf '%s' "$INPUT" | "$hook" || true
}

# ── Submodul-Pointer-Guard (CCS-008, AC#2) ──────────────────────────────────────
# Prüft VOR einem (manuellen) Push, ob bei einem Parent-Commit mit geändertem
# Submodul-Gitlink der referenzierte Submodul-Commit bereits auf dem Submodul-Remote
# existiert. Verhindert "dangling gitlink"-Pushes (Parent zeigt auf einen Submodul-
# Commit, den nur das lokale Submodul kennt).
#
# Da dieser Hook NIE automatisch pusht, läuft die Guard rein advisory (Ausgabe auf
# stderr) — sie ist die Safety-Doku für den menschlichen Push.
#
# Usage:   submodule_push_guard <repo-root>
# Returns: 0 = alle geänderten Submodul-Pointer sind remote vorhanden (oder keine);
#          1 = mindestens ein Pointer fehlt remote → manueller Push wäre unsafe.
submodule_push_guard() {
  local repo="${1:-$(pwd)}"
  git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  [ -f "$repo/.gitmodules" ] || return 0

  local unsafe=0
  local sub sha remote contains lsremote
  # Geänderte Gitlinks: staged + unstaged Submodul-Pointer-Diffs.
  local subs
  subs=$(git -C "$repo" diff --name-only --submodule=short HEAD 2>/dev/null \
    | while read -r p; do
        git -C "$repo" config -f "$repo/.gitmodules" --get-regexp path 2>/dev/null \
          | awk -v p="$p" '$2==p {print $2}'
      done | sort -u)
  [ -z "$subs" ] && return 0

  while IFS= read -r sub; do
    [ -z "$sub" ] && continue
    [ -d "$repo/$sub/.git" ] || [ -f "$repo/$sub/.git" ] || continue
    # SHA, auf den der Parent-Worktree für dieses Submodul zeigt.
    sha=$(git -C "$repo/$sub" rev-parse HEAD 2>/dev/null) || continue
    # 1) Lokal: ist der SHA auf irgendeinem Remote-Tracking-Branch enthalten?
    contains=$(git -C "$repo/$sub" branch -r --contains "$sha" 2>/dev/null | head -1)
    if [ -n "$contains" ]; then
      continue
    fi
    # 2) Fallback: existiert der SHA als ls-remote-Objekt auf dem Submodul-Remote?
    lsremote=$(git -C "$repo/$sub" ls-remote origin 2>/dev/null | awk -v s="$sha" '$1==s {print; exit}')
    if [ -n "$lsremote" ]; then
      continue
    fi
    echo "  [submodule-guard] WARN: $sub → $sha existiert NICHT auf dem Submodul-Remote." 1>&2
    echo "                    Submodul zuerst pushen, dann Parent — sonst dangling gitlink." 1>&2
    unsafe=1
  done <<< "$subs"

  return "$unsafe"
}

# Order matters: cleanup must happen before PKM sync asks Claude to commit.
# Cleanup is a non-vendored live sub-hook (best-effort).
run_hook_stderr "$PAI_DIR/hooks/cleanup-dispatch-stop.sh"

# PKM-Sync: vendored + gehärtet — IMMER aus dem eigenen Hook-Verzeichnis aufrufen.
run_hook_capture_self() {
  local hook="$HOOK_DIR/pkm-sync-stop.sh"
  [ -f "$hook" ] || return 0
  printf '%s' "$INPUT" | bash "$hook" || true
}
PKM_OUTPUT=$(run_hook_capture_self)
if [ -n "$PKM_OUTPUT" ]; then
  printf '%s\n' "$PKM_OUTPUT"
  exit 0
fi

# Session-Sync-to-Vault: non-vendored live sub-hook (best-effort).
run_hook_stderr "$PAI_DIR/hooks/sync-sessions-to-vault.sh"

exit 0
