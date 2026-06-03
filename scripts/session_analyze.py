# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""session_analyze.py — Deterministic session log analyser for Claude Code projects.

Derives the project session path from CWD (or --cwd / FAKE_CWD env override),
reads all *.jsonl files in that directory, and extracts:
  - failed_commands   : tool_results with is_error=true, correlated to tool_use
  - tool_frequencies  : count of each tool name used across all sessions
  - token_stats       : input/output/cache token sums + per-session breakdown
  - repeated_sequences: consecutive tool-call sequences that repeat ≥2 times
  - waste_signals     : redundant_reads / oversized_outputs / repeated_commands

Usage:
  # Full aggregate JSON
  uv run --script session_analyze.py --output-json [--projects-dir DIR] [--cwd PATH]

  # Path resolution only (for tests / debugging)
  uv run --script session_analyze.py --resolve-path [--cwd PATH] [--projects-dir DIR]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

def _encode_cwd(cwd: str) -> str:
    """Encode an absolute CWD path to the Claude project directory name.

    Rule: replace every / with -, keeping leading /.
      /home/nedge/git/cc-setup  →  -home-nedge-git-cc-setup
    """
    return cwd.replace("/", "-")


def resolve_session_dir(cwd: str, projects_dir: Path) -> Path:
    """Return the Path to the encoded project directory inside projects_dir."""
    encoded = _encode_cwd(cwd)
    return projects_dir / encoded


def get_projects_dir() -> Path:
    """Return the Claude projects directory (env override for tests)."""
    env_override = os.environ.get("CLAUDE_PROJECTS_DIR")
    if env_override:
        return Path(env_override)
    return Path.home() / ".claude" / "projects"


def get_cwd() -> str:
    """Return current working directory (env override for tests)."""
    return os.environ.get("FAKE_CWD") or os.getcwd()


# ---------------------------------------------------------------------------
# JSONL parsing
# ---------------------------------------------------------------------------

def _iter_jsonl(path: Path):
    """Yield parsed JSON objects from a JSONL file, skipping malformed lines."""
    with path.open(encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def _get_content_list(message: dict) -> list:
    content = message.get("content", [])
    return content if isinstance(content, list) else []


# ---------------------------------------------------------------------------
# Extraction helpers
# ---------------------------------------------------------------------------

def _extract_tool_uses(entries: list[dict]) -> dict[str, dict]:
    """Return mapping tool_use_id → {name, command/file, session_id, uuid}."""
    tool_uses: dict[str, dict] = {}
    for e in entries:
        if e.get("type") != "assistant":
            continue
        msg = e.get("message", {})
        session_id = e.get("sessionId", "")
        uuid = e.get("uuid", "")
        for item in _get_content_list(msg):
            if not isinstance(item, dict) or item.get("type") != "tool_use":
                continue
            tu_id = item.get("id", "")
            name = item.get("name", "")
            inp = item.get("input", {})
            tool_uses[tu_id] = {
                "name": name,
                "command": inp.get("command", inp.get("file_path", "")),
                "session_id": session_id,
                "uuid": uuid,
            }
    return tool_uses


def _extract_failed_commands(entries: list[dict], tool_uses: dict[str, dict]) -> list[dict]:
    """Return list of failed Bash calls (is_error=true tool_results for Bash tools)."""
    failed = []
    for e in entries:
        if e.get("type") != "user":
            continue
        msg = e.get("message", {})
        for item in _get_content_list(msg):
            if not isinstance(item, dict) or item.get("type") != "tool_result":
                continue
            if not item.get("is_error"):
                continue
            tu_id = item.get("tool_use_id", "")
            tu = tool_uses.get(tu_id, {})
            name = tu.get("name", "")
            # Include all error results; command="" for non-Bash tools
            failed.append({
                "tool": name,
                "command": tu.get("command", ""),
                "session_id": tu.get("session_id", e.get("sessionId", "")),
                "uuid": tu.get("uuid", ""),
                "error_preview": str(item.get("content", ""))[:300],
            })
    return failed


def _extract_tool_frequencies(entries: list[dict]) -> dict[str, int]:
    """Count tool_use occurrences per tool name across all entries."""
    counter: Counter = Counter()
    for e in entries:
        if e.get("type") != "assistant":
            continue
        msg = e.get("message", {})
        for item in _get_content_list(msg):
            if isinstance(item, dict) and item.get("type") == "tool_use":
                counter[item.get("name", "unknown")] += 1
    return dict(counter)


def _extract_token_stats(entries: list[dict], session_id: str) -> dict[str, Any]:
    """Sum token usage fields from assistant entries."""
    total_input = 0
    total_output = 0
    total_cache_read = 0
    total_cache_creation = 0
    turn_count = 0

    for e in entries:
        if e.get("type") != "assistant":
            continue
        msg = e.get("message", {})
        usage = msg.get("usage")
        if not isinstance(usage, dict):
            continue
        turn_count += 1
        total_input += usage.get("input_tokens", 0)
        total_output += usage.get("output_tokens", 0)
        total_cache_read += usage.get("cache_read_input_tokens", 0)
        total_cache_creation += usage.get("cache_creation_input_tokens", 0)

    return {
        "session_id": session_id,
        "turns": turn_count,
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
        "total_cache_read_tokens": total_cache_read,
        "total_cache_creation_tokens": total_cache_creation,
    }


def _extract_tool_sequence(entries: list[dict]) -> list[str]:
    """Return ordered list of (tool_name, command) tuples as strings per turn."""
    seq = []
    for e in entries:
        if e.get("type") != "assistant":
            continue
        msg = e.get("message", {})
        for item in _get_content_list(msg):
            if isinstance(item, dict) and item.get("type") == "tool_use":
                name = item.get("name", "?")
                cmd = item.get("input", {}).get("command",
                      item.get("input", {}).get("file_path", ""))
                seq.append(f"{name}:{cmd}")
    return seq


# ---------------------------------------------------------------------------
# Waste heuristics
# ---------------------------------------------------------------------------

# Documented thresholds (surfaced in aggregate so callers can see what was used)
WASTE_THRESHOLDS = {
    "redundant_read_min_count": 2,       # Same file read ≥ N times in one session
    "oversized_output_chars": 50_000,    # Tool result content length > N chars
    "repeated_command_min_count": 3,     # Same Bash command run ≥ N times total
}


def _extract_waste_signals(
    all_sessions_entries: list[tuple[str, list[dict], dict[str, dict]]],
) -> dict[str, Any]:
    """Compute waste signals across all sessions.

    Args:
        all_sessions_entries: list of (session_id, entries, tool_uses_index)
    """
    redundant_reads: list[dict] = []
    oversized_outputs: list[dict] = []
    # For repeated commands: command → list of session_ids
    command_sessions: dict[str, list[str]] = defaultdict(list)

    read_thresh = WASTE_THRESHOLDS["redundant_read_min_count"]
    size_thresh = WASTE_THRESHOLDS["oversized_output_chars"]
    cmd_thresh = WASTE_THRESHOLDS["repeated_command_min_count"]

    for session_id, entries, tool_uses in all_sessions_entries:
        # --- Redundant reads: same file_path read ≥ read_thresh times in session ---
        file_read_counts: Counter = Counter()
        for e in entries:
            if e.get("type") != "assistant":
                continue
            msg = e.get("message", {})
            for item in _get_content_list(msg):
                if (isinstance(item, dict) and item.get("type") == "tool_use"
                        and item.get("name") == "Read"):
                    fp = item.get("input", {}).get("file_path", "")
                    if fp:
                        file_read_counts[fp] += 1
        for fp, cnt in file_read_counts.items():
            if cnt >= read_thresh:
                redundant_reads.append({
                    "file_path": fp,
                    "count": cnt,
                    "session_id": session_id,
                })

        # --- Oversized outputs: tool_result content > size_thresh chars ---
        for e in entries:
            if e.get("type") != "user":
                continue
            msg = e.get("message", {})
            for item in _get_content_list(msg):
                if not isinstance(item, dict) or item.get("type") != "tool_result":
                    continue
                content_str = str(item.get("content", ""))
                if len(content_str) > size_thresh:
                    tu_id = item.get("tool_use_id", "")
                    tu = tool_uses.get(tu_id, {})
                    oversized_outputs.append({
                        "tool": tu.get("name", "unknown"),
                        "command": tu.get("command", ""),
                        "output_chars": len(content_str),
                        "session_id": session_id,
                        "tool_use_id": tu_id,
                    })

        # --- Repeated commands: identical Bash command strings ---
        for e in entries:
            if e.get("type") != "assistant":
                continue
            msg = e.get("message", {})
            for item in _get_content_list(msg):
                if (isinstance(item, dict) and item.get("type") == "tool_use"
                        and item.get("name") == "Bash"):
                    cmd = item.get("input", {}).get("command", "").strip()
                    if cmd:
                        command_sessions[cmd].append(session_id)

    # Build repeated_commands list (≥ cmd_thresh invocations)
    repeated_commands: list[dict] = []
    for cmd, sessions in command_sessions.items():
        if len(sessions) >= cmd_thresh:
            unique_sessions = sorted(set(sessions))
            repeated_commands.append({
                "command": cmd,
                "count": len(sessions),
                "sessions": unique_sessions,
            })
    repeated_commands.sort(key=lambda x: -x["count"])

    return {
        "thresholds": WASTE_THRESHOLDS,
        "redundant_reads": redundant_reads,
        "oversized_outputs": oversized_outputs,
        "repeated_commands": repeated_commands,
    }


def _find_repeated_sequences(full_seq: list[str], min_len: int = 2,
                              min_count: int = 2) -> list[dict]:
    """Find subsequences of length ≥ min_len that repeat ≥ min_count times."""
    results: dict[tuple, int] = Counter()
    n = len(full_seq)
    # Scan window sizes from min_len up to n//2
    for wlen in range(min_len, n // 2 + 1):
        for i in range(n - wlen + 1):
            window = tuple(full_seq[i:i + wlen])
            results[window] += 1

    repeated = []
    # Deduplicate: keep only sequences where no longer super-sequence also repeats
    seen_subsequences: set[tuple] = set()
    for seq_tuple, count in sorted(results.items(), key=lambda x: (-x[1], -len(x[0]))):
        if count < min_count:
            continue
        # Skip if this is contained in an already-selected longer sequence
        if any(
            len(longer) > len(seq_tuple)
            and all(seq_tuple[j] == longer[k]
                    for j in range(len(seq_tuple))
                    for k in range(j, len(longer))
                    if longer[k] == seq_tuple[j])
            for longer in seen_subsequences
        ):
            # Simplified: just skip exact sub-lists
            skip = False
            for longer in seen_subsequences:
                if len(longer) > len(seq_tuple):
                    # Check if seq_tuple is a contiguous sub-sequence of longer
                    for start in range(len(longer) - len(seq_tuple) + 1):
                        if longer[start:start + len(seq_tuple)] == seq_tuple:
                            skip = True
                            break
                if skip:
                    break
            if skip:
                continue
        seen_subsequences.add(seq_tuple)
        # Extract tool names and commands from the token strings
        parsed = []
        for token in seq_tuple:
            parts = token.split(":", 1)
            parsed.append({"tool": parts[0], "command": parts[1] if len(parts) > 1 else ""})
        repeated.append({"sequence": parsed, "count": count})

    # Sort by count desc, then by sequence length desc
    return sorted(repeated, key=lambda x: (-x["count"], -len(x["sequence"])))[:20]


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------

def analyze_sessions(session_dir: Path, cwd: str) -> dict[str, Any]:
    """Analyze all *.jsonl files in session_dir and return aggregate dict."""
    jsonl_files = sorted(session_dir.glob("*.jsonl"))

    all_failed: list[dict] = []
    all_tool_freqs: Counter = Counter()
    per_session_stats: list[dict] = []
    global_seq: list[str] = []
    # For waste heuristics: (session_id, entries, tool_uses)
    all_sessions_data: list[tuple[str, list[dict], dict[str, dict]]] = []

    total_input = 0
    total_output = 0
    total_cache_read = 0
    total_cache_creation = 0

    for jf in jsonl_files:
        session_id = jf.stem
        entries = list(_iter_jsonl(jf))

        # Build tool_use index for this session
        tool_uses = _extract_tool_uses(entries)
        all_sessions_data.append((session_id, entries, tool_uses))

        # Failed commands
        failed = _extract_failed_commands(entries, tool_uses)
        all_failed.extend(failed)

        # Tool frequencies
        freqs = _extract_tool_frequencies(entries)
        all_tool_freqs.update(freqs)

        # Token stats
        stats = _extract_token_stats(entries, session_id)
        per_session_stats.append(stats)
        total_input += stats["total_input_tokens"]
        total_output += stats["total_output_tokens"]
        total_cache_read += stats["total_cache_read_tokens"]
        total_cache_creation += stats["total_cache_creation_tokens"]

        # Sequences
        global_seq.extend(_extract_tool_sequence(entries))

    repeated = _find_repeated_sequences(global_seq)
    waste = _extract_waste_signals(all_sessions_data)

    return {
        "project_dir": str(session_dir),
        "cwd": cwd,
        "session_count": len(jsonl_files),
        "failed_commands": all_failed,
        "tool_frequencies": dict(all_tool_freqs),
        "token_stats": {
            "total_input_tokens": total_input,
            "total_output_tokens": total_output,
            "total_cache_read_tokens": total_cache_read,
            "total_cache_creation_tokens": total_cache_creation,
            "per_session": per_session_stats,
        },
        "repeated_sequences": repeated,
        "waste_signals": waste,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Analyse Claude Code session logs.")
    parser.add_argument("--output-json", action="store_true",
                        help="Print aggregate JSON to stdout")
    parser.add_argument("--resolve-path", action="store_true",
                        help="Print encoded project path JSON and exit")
    parser.add_argument("--cwd", default=None,
                        help="CWD to use (overrides actual cwd and FAKE_CWD env)")
    parser.add_argument("--projects-dir", default=None,
                        help="Base dir for Claude projects (overrides CLAUDE_PROJECTS_DIR env)")
    args = parser.parse_args()

    cwd = args.cwd or get_cwd()
    projects_dir = Path(args.projects_dir) if args.projects_dir else get_projects_dir()
    encoded = _encode_cwd(cwd)
    session_dir = projects_dir / encoded

    if args.resolve_path:
        print(json.dumps({"encoded": encoded, "resolved": str(session_dir)}))
        return

    if args.output_json:
        agg = analyze_sessions(session_dir, cwd)
        print(json.dumps(agg, indent=2, ensure_ascii=False))
        return

    # Default: human-readable summary
    agg = analyze_sessions(session_dir, cwd)
    print(f"Sessions analysed : {agg['session_count']}")
    print(f"Failed commands   : {len(agg['failed_commands'])}")
    print(f"Unique tools      : {len(agg['tool_frequencies'])}")
    ts = agg["token_stats"]
    print(f"Total input tokens: {ts['total_input_tokens']:,}")
    print(f"Total output tokens: {ts['total_output_tokens']:,}")
    print(f"Repeated sequences: {len(agg['repeated_sequences'])}")


if __name__ == "__main__":
    main()
