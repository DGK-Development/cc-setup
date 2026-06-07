/**
 * slack-ask.test.ts — bun:test unit tests for askSlack()
 *
 * Hermetic: uses a fake SlackNotify.py stub injected via SLACK_NOTIFY_SCRIPT +
 * SLACK_PYTHON env vars. No real Slack API is called.
 *
 * Run: cd scripts && bun test slack-ask.test.ts
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askSlack, classifyHumanAnswer } from "./slack-ask.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

const FAKE_SEND_TS = "1717760000.111111";

/**
 * Write a tiny Python stub that mimics SlackNotify.py send + poll.
 *
 * mode "answer"  — poll returns a human text reply
 * mode "timeout" — poll returns timeout error JSON
 */
function writeFakeNotifier(dir: string, mode: "answer" | "timeout"): string {
  const pollResponse =
    mode === "answer"
      ? JSON.stringify({
          ok: true,
          text: "looks good!",
          ts: "1717760005.222222",
          user: "U12345",
        })
      : JSON.stringify({ ok: false, error: "timeout", waited: 900 });

  const script = `#!/usr/bin/env python3
import sys, json

args = sys.argv[1:]
if not args:
    print(json.dumps({"ok": False, "error": "no subcommand"}))
    sys.exit(1)

subcmd = args[0]
if subcmd == "send":
    print(json.dumps({"ok": True, "ts": "${FAKE_SEND_TS}"}))
elif subcmd == "poll":
    print('''${pollResponse}''')
else:
    print(json.dumps({"ok": False, "error": f"unknown subcommand {subcmd}"}))
    sys.exit(1)
`;

  const p = join(dir, `fake_notify_${mode}.py`);
  writeFileSync(p, script, "utf-8");
  chmodSync(p, 0o755);
  return p;
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

let tmpDir: string;
let notifierAnswer: string;
let notifierTimeout: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "slack-ask-test-"));
  notifierAnswer = writeFakeNotifier(tmpDir, "answer");
  notifierTimeout = writeFakeNotifier(tmpDir, "timeout");
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// The python3 shim on this machine requires uv; use the venv interpreter directly.
// SLACK_PYTHON env var allows overriding in CI or other environments.
const PYTHON = process.env["SLACK_PYTHON"] ?? "/Users/niclasedge/.venv/bin/python";

// Helper: run askSlack with injected env (DI for tests)
function callAskSlack(
  question: string,
  notifierPath: string,
  extraEnv: Record<string, string> = {},
) {
  // Temporarily inject env vars, restore after
  const saved: Record<string, string | undefined> = {};
  const inject: Record<string, string> = {
    SLACK_NOTIFY_SCRIPT: notifierPath,
    SLACK_PYTHON: PYTHON,
    SLACK_BOT_TOKEN: "xoxb-fake-token-for-tests",
    ...extraEnv,
  };

  for (const [k, v] of Object.entries(inject)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }

  const result = askSlack(question, { timeoutSecs: 5, intervalSecs: 1 });

  // Restore
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  return result;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("answer received — answered=true, answer text set, timed_out=false", async () => {
  const result = await callAskSlack("Is the deploy safe?", notifierAnswer);

  expect(result.answered).toBe(true);
  expect(result.answer).toBe("looks good!");
  expect(result.timed_out).toBe(false);
  expect(result.ts).toBe(FAKE_SEND_TS);
  expect(result.error).toBeUndefined();
});

test("poll timeout — answered=false, timed_out=true, answer=null", async () => {
  const result = await callAskSlack("Ready to proceed?", notifierTimeout);

  expect(result.answered).toBe(false);
  expect(result.timed_out).toBe(true);
  expect(result.answer).toBeNull();
  expect(result.ts).toBe(FAKE_SEND_TS);
});

test("missing SLACK_BOT_TOKEN — no throw, answered=false, error field set", async () => {
  const savedToken = process.env["SLACK_BOT_TOKEN"];
  delete process.env["SLACK_BOT_TOKEN"];

  let result: Awaited<ReturnType<typeof askSlack>>;
  try {
    result = await askSlack("Any question?");
  } finally {
    if (savedToken !== undefined) process.env["SLACK_BOT_TOKEN"] = savedToken;
  }

  expect(result!.answered).toBe(false);
  expect(result!.timed_out).toBe(false);
  expect(result!.answer).toBeNull();
  expect(result!.ts).toBe("");
  expect(result!.error).toBeTypeOf("string");
  expect(result!.error!.length).toBeGreaterThan(0);
});

// ── classifyHumanAnswer tests ─────────────────────────────────────────────────

test("classifyHumanAnswer — approve tokens", () => {
  expect(classifyHumanAnswer("ja")).toBe("approve");
  expect(classifyHumanAnswer("ok")).toBe("approve");
  expect(classifyHumanAnswer("yes")).toBe("approve");
  expect(classifyHumanAnswer("approved")).toBe("approve");
  expect(classifyHumanAnswer("continue")).toBe("approve");
  expect(classifyHumanAnswer("weiter")).toBe("approve");
  expect(classifyHumanAnswer("lgtm")).toBe("approve");
  expect(classifyHumanAnswer("go")).toBe("approve");
  expect(classifyHumanAnswer("proceed")).toBe("approve");
  expect(classifyHumanAnswer("done")).toBe("approve");
});

test("classifyHumanAnswer — abort tokens", () => {
  expect(classifyHumanAnswer("nein")).toBe("abort");
  expect(classifyHumanAnswer("no")).toBe("abort");
  expect(classifyHumanAnswer("cancel")).toBe("abort");
  expect(classifyHumanAnswer("stop")).toBe("abort");
  expect(classifyHumanAnswer("abbrechen")).toBe("abort");
  expect(classifyHumanAnswer("abort")).toBe("abort");
  expect(classifyHumanAnswer("halt")).toBe("abort");
  expect(classifyHumanAnswer("reject")).toBe("abort");
  expect(classifyHumanAnswer("nope")).toBe("abort");
});

test("classifyHumanAnswer — case insensitive", () => {
  expect(classifyHumanAnswer("JA")).toBe("approve");
  expect(classifyHumanAnswer("OK")).toBe("approve");
  expect(classifyHumanAnswer("NEIN")).toBe("abort");
  expect(classifyHumanAnswer("Cancel")).toBe("abort");
  expect(classifyHumanAnswer("Approved")).toBe("approve");
});

test("classifyHumanAnswer — token in sentence", () => {
  expect(classifyHumanAnswer("ja, bitte weiter machen")).toBe("approve");
  expect(classifyHumanAnswer("nein, das ist falsch")).toBe("abort");
  expect(classifyHumanAnswer("please go ahead")).toBe("approve");
});

test("classifyHumanAnswer — abort wins over approve when both present", () => {
  // Safety default: abort takes precedence
  expect(classifyHumanAnswer("ok but stop")).toBe("abort");
  expect(classifyHumanAnswer("ja nein")).toBe("abort");
});

test("classifyHumanAnswer — free-text answer classified as answer", () => {
  expect(classifyHumanAnswer("Use the postgres database not sqlite")).toBe("answer");
  expect(classifyHumanAnswer("The API key is in .env.example")).toBe("answer");
  expect(classifyHumanAnswer("please use 4 spaces for indentation")).toBe("answer");
  expect(classifyHumanAnswer("")).toBe("answer");
});

test("ENOENT interpreter — structured error, no JSON-parse confusion", async () => {
  // Point SLACK_PYTHON at a path that does not exist → spawnSync emits ENOENT.
  // Verifies that runSync.result.error is propagated as a readable error string
  // rather than leaking as a "non-JSON" message (the pre-fix behavior).
  const result = await callAskSlack("Will this crash?", notifierAnswer, {
    SLACK_PYTHON: "/nonexistent/python-interpreter",
  });

  expect(result.answered).toBe(false);
  expect(result.timed_out).toBe(false);
  expect(result.answer).toBeNull();
  // error must be a non-empty string and must NOT be a raw "non-JSON" parse message
  expect(result.error).toBeTypeOf("string");
  expect(result.error!.length).toBeGreaterThan(0);
  expect(result.error).not.toContain("non-JSON");
});
