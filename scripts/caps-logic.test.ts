/**
 * Tests for decideOverride (CCS-036.11 AC#4):
 * Verifies that after N=MAX consecutive overrides the next attempt returns
 * limitReached=true (pipeline must abort, not ask again).
 */
import { describe, it, expect } from "bun:test";
import { decideOverride } from "./caps-logic.ts";

describe("decideOverride", () => {
  const MAX = 2; // mirrors CAPS.MAX_CAP_OVERRIDES

  it("override #1 (0→1): consume=true, limitReached=false", () => {
    const d = decideOverride({ overridesConsumed: 0 }, MAX);
    expect(d.consume).toBe(true);
    expect(d.limitReached).toBe(false);
    expect(d.nextConsumed).toBe(1);
  });

  it("override #2 (1→2): consume=true, limitReached=false", () => {
    const d = decideOverride({ overridesConsumed: 1 }, MAX);
    expect(d.consume).toBe(true);
    expect(d.limitReached).toBe(false);
    expect(d.nextConsumed).toBe(2);
  });

  it("override #3 (2→limit): consume=false, limitReached=true, counter unchanged", () => {
    const d = decideOverride({ overridesConsumed: 2 }, MAX);
    expect(d.consume).toBe(false);
    expect(d.limitReached).toBe(true);
    expect(d.nextConsumed).toBe(2); // counter must not increase
  });

  it("any attempt beyond MAX is always limitReached", () => {
    for (const n of [3, 4, 10]) {
      const d = decideOverride({ overridesConsumed: n }, MAX);
      expect(d.limitReached).toBe(true);
      expect(d.consume).toBe(false);
    }
  });

  it("works with MAX=0 (no overrides allowed at all)", () => {
    const d = decideOverride({ overridesConsumed: 0 }, 0);
    expect(d.limitReached).toBe(true);
    expect(d.consume).toBe(false);
  });

  it("works with larger MAX", () => {
    const d = decideOverride({ overridesConsumed: 4 }, 5);
    expect(d.consume).toBe(true);
    expect(d.limitReached).toBe(false);
    expect(d.nextConsumed).toBe(5);
  });
});
