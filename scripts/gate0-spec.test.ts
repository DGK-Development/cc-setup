/**
 * Tests for buildSpecBlock (CCS-036.13 AC#3):
 * Verifies that the full planner output (not just the first 2 lines) is included
 * in the GATE0_SPEC block, and that other phases return an empty block.
 */
import { describe, it, expect } from "bun:test";
import { buildSpecBlock } from "./gate0-spec.ts";

// Realistic planner output that starts with preamble, then has the actual plan
const REAL_PLANNER_OUTPUT = `Perfekt. Jetzt habe ich alle Infos die ich brauche um diesen Task zu planen.

## Plan

1. Lese die aktuelle cc-dispatch.ts (WorkerResult Interface)
2. Füge usage + durationMs Felder hinzu
3. Extrahiere mapResult() als pure Funktion

## Acceptance Criteria (geschärft)

- [ ] WorkerResult enthält usage (input/output/cache)
- [ ] mapResult() ist exportiert und testbar

## Dateien

- scripts/cc-dispatch.ts
- .pi/extensions/cc-orchestrator.ts

## Risiken

- SDK-Felder könnten sich umbenennen → usage als optional deklariert`;

describe("buildSpecBlock", () => {
  it("returns empty array for non-GATE0_SPEC phases", () => {
    expect(buildSpecBlock("GATE1_RETRIES", REAL_PLANNER_OUTPUT)).toEqual([]);
    expect(buildSpecBlock("OPEN_QUESTION", REAL_PLANNER_OUTPUT)).toEqual([]);
    expect(buildSpecBlock("REVIEW_RETRIES", REAL_PLANNER_OUTPUT)).toEqual([]);
    expect(buildSpecBlock("", REAL_PLANNER_OUTPUT)).toEqual([]);
  });

  it("returns empty array when plannerOutput is blank", () => {
    expect(buildSpecBlock("GATE0_SPEC", "")).toEqual([]);
    expect(buildSpecBlock("GATE0_SPEC", "   ")).toEqual([]);
  });

  it("includes the FULL plannerOutput in the block (not just first 2 lines)", () => {
    const block = buildSpecBlock("GATE0_SPEC", REAL_PLANNER_OUTPUT);

    // Must have 4 entries: empty-line, header, full-output, footer
    expect(block).toHaveLength(4);
    expect(block[0]).toBe("");
    expect(block[1]).toContain("Vollständiger Plan");
    expect(block[3]).toContain("──────");

    // The FULL plan must be in block[2], including late lines (AC / Dateien / Risiken)
    const planContent = block[2];
    expect(planContent).toContain("Perfekt. Jetzt habe ich alle Infos");
    expect(planContent).toContain("## Plan");
    expect(planContent).toContain("## Acceptance Criteria");
    expect(planContent).toContain("## Dateien");
    expect(planContent).toContain("## Risiken");
    // Must NOT be truncated to just the preamble (the old 2-line bug)
    expect(planContent).toContain("mapResult()");
    expect(planContent).toContain("scripts/cc-dispatch.ts");
  });

  it("trims leading/trailing whitespace from plannerOutput", () => {
    const block = buildSpecBlock("GATE0_SPEC", "   \n\n## Plan\n- Step 1\n\n  ");
    expect(block[2]).toBe("## Plan\n- Step 1");
  });

  it("works for a plan that starts directly with content (no preamble)", () => {
    const directPlan = "## Plan\n- AC1\n- AC2\n\n## Dateien\n- src/foo.ts";
    const block = buildSpecBlock("GATE0_SPEC", directPlan);
    expect(block).toHaveLength(4);
    expect(block[2]).toBe(directPlan.trim());
  });
});
