/**
 * gate0-spec.ts — Pure helper for the GATE0_SPEC spec-block builder (CCS-036.13).
 *
 * Extracted from .pi/extensions/cc-orchestrator.ts so it can be unit-tested
 * without importing the full pi extension runtime.
 *
 * The orchestrator imports buildSpecBlock from here and uses it in requestHuman().
 */

/**
 * Baut den Spec-Block für GATE0_SPEC-Nachrichten (CCS-036.13 AC#3).
 * Pure Funktion — testbar ohne Extension-Runtime.
 *
 * @param phase          Aktuelle Pipeline-Phase
 * @param plannerOutput  Vollständiger Planner-Output (beliebiges Vorgeplänkel erlaubt)
 * @returns String-Array for [...specBlock] in the Slack question; empty for other phases.
 */
export function buildSpecBlock(phase: string, plannerOutput: string): string[] {
  if (phase !== "GATE0_SPEC" || !plannerOutput.trim()) return [];
  return [
    "",
    "──────── Vollständiger Plan (Spec) ────────",
    plannerOutput.trim(),
    "───────────────────────────────────────────",
  ];
}
