/**
 * system-prompt.ts — Static assertions for the cc-orchestrator system prompt (CCS-036.18 AC#4).
 *
 * The actual system prompt lives in .pi/extensions/cc-orchestrator.ts (before_agent_start).
 * This module exports the static STEP 5/6 fragment so it can be tested independently —
 * verifying that the prompt actually demands a mark_done TOOL CALL (not just an announcement).
 *
 * Only the parts relevant to AC#4 are exported here. Runtime-dynamic sections (CAPS values)
 * are intentionally omitted.
 */

/**
 * The STEP 5 / STEP 6 section of the orchestrator system prompt.
 *
 * STEP 5 demands an IMMEDIATE tool call after APPROVE.
 * STEP 6 explicitly forbids text-only announcements (the "proceed to STEP 6" non-bug).
 *
 * Keep this in sync with the systemPrompt string in cc-orchestrator.ts (before_agent_start).
 */
export const ORCHESTRATOR_STEP5_6_PROMPT = `STEP 5 — REVIEW
  Call: dispatch_worker(role="reviewer", prompt="Review the current diff. Task: <id>. AC: <ac-list>.")
  If reviewer verdict is APPROVE (no BLOCKER / no "REJECT"):
    → Do NOT stop. Do NOT just say "proceed to STEP 6". IMMEDIATELY go to STEP 6 and CALL the mark_done tool in your VERY NEXT action.
  If REJECT in reviewer output:
    review_retries += 1
    If review_retries > MAX_REVIEW_RETRIES:
      Call: request_human(task_id=<id>, phase="REVIEW_RETRIES", reason="Reviewer rejected after MAX_REVIEW_RETRIES retries: <findings>")
      Read the return value:
        - Starts with "HUMAN_APPROVED_OVERRIDE:" → cap overridden; continue with one more builder+review cycle.
        - Starts with "CANCELLED_BY_HUMAN:" → STOP. Report "Cancelled by human."
        - Starts with "HUMAN_REQUIRED/PAUSED:" → STOP.
    Else:
      Call: dispatch_worker(role="builder", prompt="Reviewer rejected. Findings:\\n<findings>\\nFix exactly these issues.")
      Go back to run_gates, then re-dispatch reviewer.

STEP 6 — DONE (+ STEP 7 PUBLISH + STEP 8 NEXT-gate, all inside the mark_done tool)
  You MUST emit the mark_done TOOL CALL now. Announcing "I proceed to STEP 6" in text is NOT enough and is a failure — the task stays unfinished until mark_done actually runs.
  Call: mark_done(id=<id>, ac_indices=[1,2,...], final_summary="<reviewer summary>")`;
