/**
 * caps-logic.ts — Pure override-decision helper for the pi-Orchestrator.
 *
 * Extracted from .pi/extensions/cc-orchestrator.ts so it can be unit-tested
 * without importing the full extension runtime (CCS-036.11 AC#4).
 *
 * The orchestrator delegates its override-limit decision to decideOverride() —
 * behavior is identical to the inline checkCaps() branch it replaces.
 */

export interface OverrideState {
  overridesConsumed: number;
}

export interface OverrideDecision {
  /** true = override is allowed; consume one slot and proceed */
  consume: boolean;
  /** true = limit already reached; the caller must pause the pipeline */
  limitReached: boolean;
  /** overridesConsumed after this call (only incremented when consume=true) */
  nextConsumed: number;
}

/**
 * Decide whether a pending cap-override request should be consumed or rejected.
 *
 * Rules (mirrors checkCaps() branch in cc-orchestrator.ts):
 *  - If state.overridesConsumed >= max → limitReached=true, no consume.
 *  - Otherwise → consume=true, nextConsumed = state.overridesConsumed + 1.
 *
 * @param state  Current caps state (only overridesConsumed is relevant here).
 * @param max    Maximum allowed overrides (CAPS.MAX_CAP_OVERRIDES).
 */
export function decideOverride(state: OverrideState, max: number): OverrideDecision {
  if (state.overridesConsumed >= max) {
    return { consume: false, limitReached: true, nextConsumed: state.overridesConsumed };
  }
  return { consume: true, limitReached: false, nextConsumed: state.overridesConsumed + 1 };
}
