/**
 * Tests for the orchestrator system prompt (CCS-036.18 AC#4):
 * Verifies that the system prompt in cc-orchestrator.ts contains the critical
 * mark_done-enforcement instructions (STEP 5 → immediate tool call, STEP 6 → MUST call).
 *
 * These tests guard against the "proceed to STEP 6 in text only" regression where gemma
 * would narrate the step without actually calling the tool.
 */
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { ORCHESTRATOR_STEP5_6_PROMPT } from "./system-prompt.ts";

// Read the actual orchestrator source to verify the live prompt text
const ORCHESTRATOR_PATH = join(import.meta.dir, "../.pi/extensions/cc-orchestrator.ts");
const orchestratorSrc = readFileSync(ORCHESTRATOR_PATH, "utf-8");

describe("Orchestrator system prompt — STEP 5/6 mark_done enforcement (CCS-036.18 AC#4)", () => {
  it("STEP 5: APPROVE requires an IMMEDIATE mark_done tool call (not just text announcement)", () => {
    // The critical line: after APPROVE, the model must CALL the tool, not announce it
    expect(orchestratorSrc).toContain(
      "IMMEDIATELY go to STEP 6 and CALL the mark_done tool in your VERY NEXT action",
    );
  });

  it("STEP 5: explicitly forbids text-only 'proceed to STEP 6' announcements", () => {
    expect(orchestratorSrc).toContain(
      "Do NOT just say \"proceed to STEP 6\"",
    );
  });

  it("STEP 6: MUST emit mark_done TOOL CALL — not just announce", () => {
    expect(orchestratorSrc).toContain(
      "You MUST emit the mark_done TOOL CALL now",
    );
  });

  it("STEP 6: announces-only is explicitly labeled a failure", () => {
    expect(orchestratorSrc).toContain(
      "is NOT enough and is a failure",
    );
  });

  it("STEP 6: task stays unfinished clause present", () => {
    expect(orchestratorSrc).toContain(
      "the task stays unfinished until mark_done actually runs",
    );
  });

  it("exported STEP5_6 prompt contains the APPROVE→mark_done requirement", () => {
    // The exported constant must match key assertions too (kept in sync)
    expect(ORCHESTRATOR_STEP5_6_PROMPT).toContain(
      "IMMEDIATELY go to STEP 6 and CALL the mark_done tool in your VERY NEXT action",
    );
    expect(ORCHESTRATOR_STEP5_6_PROMPT).toContain(
      "You MUST emit the mark_done TOOL CALL now",
    );
    expect(ORCHESTRATOR_STEP5_6_PROMPT).toContain(
      "is NOT enough and is a failure",
    );
  });

  it("mark_done tool is mentioned as a Call in STEP 6", () => {
    // Regex: STEP 6 section contains a Call: mark_done(...) instruction
    expect(orchestratorSrc).toMatch(/STEP 6[\s\S]*Call: mark_done\(/);
  });
});

describe("Orchestrator system prompt — STEP 1/2 RESUME fallback (CCS-036.19)", () => {
  it("STEP 1 PICK mentions PICK (RESUME) variant", () => {
    expect(orchestratorSrc).toContain("PICK (RESUME)");
  });

  it("STEP 1 RESUME variant forbids calling backlog_set", () => {
    expect(orchestratorSrc).toContain("Do NOT call backlog_set");
  });

  it("STEP 2 RESUME variant directs planner to assess REMAINING work", () => {
    expect(orchestratorSrc).toContain("REMAINING work");
  });
});
