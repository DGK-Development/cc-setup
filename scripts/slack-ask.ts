/**
 * slack-ask.ts — send a question to a Slack channel and block until a human replies.
 *
 * Reuses SlackNotify.py (already installed at ~/.claude/skills/Slack/Tools/SlackNotify.py)
 * via subprocess — no new Slack client code. Spawn + JSON-stdout pattern mirrors cc-dispatch.ts.
 *
 * Exports:
 *   askSlack(question, opts?) → Promise<SlackAskResult>
 *   classifyHumanAnswer(text) → "approve" | "abort" | "answer"
 *
 * CLI (bun scripts/slack-ask.ts "<question>" [--channel C0B8R3ERUNR] [--timeout 900]):
 *   writes SlackAskResult as JSON to stdout, always exits 0 (pipeline must continue on error).
 *
 * Dependency injection (for tests):
 *   SLACK_NOTIFY_SCRIPT — path to notifier script
 *                         (default: ~/.claude/skills/Slack/Tools/SlackNotify.py)
 *   SLACK_PYTHON        — Python interpreter (default: python3).
 *                         On machines where python3 is a shim (e.g. requires uv),
 *                         set this to a direct interpreter path such as
 *                         /path/to/venv/bin/python. Do NOT hardcode here.
 *   SLACK_BOT_TOKEN     — Slack bot token (required at runtime; missing → graceful error)
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SlackAskResult {
  answered: boolean;
  answer: string | null;
  timed_out: boolean;
  ts: string;
  error?: string;
}

export interface AskSlackOpts {
  channel?: string;
  timeoutSecs?: number;
  intervalSecs?: number;
}

/** Classification of a human's free-text reply. */
export type HumanDecision = "approve" | "abort" | "answer";

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_CHANNEL = "C0B8R3ERUNR";
const DEFAULT_TIMEOUT_SECS = 900;
const DEFAULT_INTERVAL_SECS = 5;
const DEFAULT_NOTIFY_SCRIPT = join(
  homedir(),
  ".claude",
  "skills",
  "Slack",
  "Tools",
  "SlackNotify.py",
);

// ── classifyHumanAnswer ───────────────────────────────────────────────────────

/**
 * Classify a human's free-text reply into a decision category.
 *
 * - "approve" — affirmative: ja, ok, yes, approved, continue, weiter, lgtm, go, proceed, done
 * - "abort"   — negative:   nein, no, cancel, stop, abbrechen, abort, halt, reject, nope
 * - "answer"  — everything else (free-text answer to an OPEN QUESTION)
 *
 * Matching is case-insensitive and trims whitespace.
 * A single matching word anywhere in the text suffices (e.g. "ja, bitte weiter" → approve).
 * abort takes precedence over approve when both match (safety default).
 */
export function classifyHumanAnswer(text: string): HumanDecision {
  const normalized = text.toLowerCase().trim();

  const ABORT_TOKENS = ["nein", "no", "cancel", "stop", "abbrechen", "abort", "halt", "reject", "nope"];
  const APPROVE_TOKENS = ["ja", "ok", "yes", "approved", "approve", "continue", "weiter", "lgtm", "go", "proceed", "done"];

  // Split on word-boundaries so "okay" does not match "ok" falsely,
  // but simple token search on whole words is good enough here.
  const words = normalized.split(/[\s,;.!?]+/).filter(Boolean);

  const hasAbort = words.some((w) => ABORT_TOKENS.includes(w));
  if (hasAbort) return "abort";

  const hasApprove = words.some((w) => APPROVE_TOKENS.includes(w));
  if (hasApprove) return "approve";

  return "answer";
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function notifierBase(): [string, string] {
  const python = process.env["SLACK_PYTHON"] ?? "python3";
  const script = process.env["SLACK_NOTIFY_SCRIPT"] ?? DEFAULT_NOTIFY_SCRIPT;
  return [python, script];
}

/**
 * Run a subprocess synchronously, return { stdout, stderr, exitCode }.
 * Using spawnSync keeps the same pattern as cc-dispatch.ts (collect then parse).
 *
 * @param timeoutMs  Hard-kill deadline for spawnSync in milliseconds.
 *   - send step:   60_000 ms (network round-trip; fast)
 *   - poll step:   (timeoutSecs + 30) * 1000 — 30s buffer so Python's own
 *                  --timeout fires and emits JSON before spawnSync sends SIGTERM.
 *                  Without this buffer, spawnSync kills the poll process early,
 *                  stdout is empty, and the caller sees a spurious "non-JSON" error
 *                  instead of timed_out:true.
 *
 * Env is passed explicitly (not inherited implicitly) so intent is documented
 * and SlackNotify.py cannot fall through to its own hardcoded token fallback.
 * Token is conveyed via env, NOT via argv (argv is visible in ps/process lists).
 *
 * OS-level spawn errors (ENOENT, ETIMEDOUT, EPERM) are surfaced as a readable
 * stderr string so callers get a meaningful error rather than a "non-JSON" message.
 */
function runSync(
  args: string[],
  timeoutMs: number,
): { stdout: string; stderr: string; exitCode: number } {
  const [cmd, ...rest] = args;
  const result = spawnSync(cmd, rest, {
    encoding: "utf-8",
    timeout: timeoutMs,
    env: { ...process.env },
  });
  if (result.error) {
    // ENOENT → interpreter not found; ETIMEDOUT → spawnSync killed the process;
    // EPERM → permission denied. Surface as readable stderr for the caller to map.
    return { stdout: "", stderr: result.error.message, exitCode: 1 };
  }
  return {
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
    exitCode: result.status ?? 1,
  };
}

/**
 * Parse JSON from a subprocess's stdout.
 * Returns {ok:true, data} on success, {ok:false, error} on failure.
 * The error string distinguishes between empty stdout (spawn/OS failure)
 * and a non-empty but unparseable payload.
 */
function parseJson(
  raw: string,
  context: string,
  spawnStderr: string,
): { ok: boolean; data?: Record<string, unknown>; error: string } {
  if (!raw) {
    const detail = spawnStderr
      ? spawnStderr.slice(0, 200)
      : "no output (interpreter not found or crash before output)";
    return { ok: false, error: `${context} spawn failed: ${detail}` };
  }
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    return { ok: true, data };
  } catch {
    return { ok: false, error: `${context} returned non-JSON: ${raw.slice(0, 200)}` };
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Send *question* to *channel* and block until a human reply arrives or timeout.
 *
 * Never throws — all error paths return a structured result so the caller's
 * pipeline can continue.
 */
export async function askSlack(
  question: string,
  opts: AskSlackOpts = {},
): Promise<SlackAskResult> {
  const channel = opts.channel ?? DEFAULT_CHANNEL;
  const timeoutSecs = opts.timeoutSecs ?? DEFAULT_TIMEOUT_SECS;
  const intervalSecs = opts.intervalSecs ?? DEFAULT_INTERVAL_SECS;

  const token = process.env["SLACK_BOT_TOKEN"] ?? "";
  if (!token) {
    return {
      answered: false,
      answer: null,
      timed_out: false,
      ts: "",
      error: "SLACK_BOT_TOKEN is not set — cannot contact Slack",
    };
  }

  const [python, script] = notifierBase();

  // ── Step 1: send the question ─────────────────────────────────────────────
  const SEND_TIMEOUT_MS = 60_000;
  const sendArgs = [python, script, "send", "--channel", channel, "--message", question];
  const send = runSync(sendArgs, SEND_TIMEOUT_MS);

  const sendParsed = parseJson(send.stdout, "send", send.stderr);
  if (!sendParsed.ok) {
    return { answered: false, answer: null, timed_out: false, ts: "", error: sendParsed.error };
  }

  const sendData = sendParsed.data!;
  if (!sendData["ok"]) {
    const errMsg = (sendData["error"] as string | undefined) ?? "unknown send error";
    return { answered: false, answer: null, timed_out: false, ts: "", error: `send failed: ${errMsg}` };
  }

  const afterTs = (sendData["ts"] as string | undefined) ?? "";

  // ── Step 2: poll for a human reply ───────────────────────────────────────
  // Give spawnSync a 30s buffer beyond Python's own --timeout so Python can
  // emit its timeout JSON before spawnSync sends SIGTERM and clears stdout.
  const pollTimeoutMs = (timeoutSecs + 30) * 1000;
  const pollArgs = [
    python, script,
    "poll",
    "--channel", channel,
    "--after-ts", afterTs,
    "--timeout", String(timeoutSecs),
    "--interval", String(intervalSecs),
  ];
  const poll = runSync(pollArgs, pollTimeoutMs);

  const pollParsed = parseJson(poll.stdout, "poll", poll.stderr);
  if (!pollParsed.ok) {
    return {
      answered: false,
      answer: null,
      timed_out: false,
      ts: afterTs,
      error: pollParsed.error,
    };
  }

  const pollData = pollParsed.data!;
  if (pollData["ok"]) {
    return {
      answered: true,
      answer: (pollData["text"] as string | null) ?? null,
      timed_out: false,
      ts: afterTs,
    };
  }

  // Not ok: timeout or other error
  const isTimeout = pollData["error"] === "timeout";
  const result: SlackAskResult = {
    answered: false,
    answer: null,
    timed_out: isTimeout,
    ts: afterTs,
  };
  if (!isTimeout) {
    result.error = (pollData["error"] as string | undefined) ?? "unknown poll error";
  }
  return result;
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    process.stderr.write(
      "Usage: bun scripts/slack-ask.ts <question> [--channel C0B8R3ERUNR] [--timeout 900] [--interval 5]\n",
    );
    process.exit(1);
  }

  const question = args[0];
  const opts: AskSlackOpts = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--channel" && args[i + 1]) {
      opts.channel = args[++i];
    } else if (args[i] === "--timeout" && args[i + 1]) {
      opts.timeoutSecs = parseInt(args[++i], 10);
    } else if (args[i] === "--interval" && args[i + 1]) {
      opts.intervalSecs = parseInt(args[++i], 10);
    }
  }

  const result = await askSlack(question, opts);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  // Always exit 0 — pipeline must continue even on timeout/error
  process.exit(0);
}
