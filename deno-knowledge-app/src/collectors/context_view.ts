// context_view — building blocks for the per-project "Kontext" view.
// Models a /context-style breakdown of the STATIC initial-session context that
// every new Claude Code session loads in this project: system prompt + tools
// (fixed, harness-dependent constants), custom agents, skills, memory files
// (global + project CLAUDE.md + MEMORY.md), plus a placeholder for the LIVE
// SessionStart hook injection (filled in client-side via /hook-inject).
//
// All token numbers are ESTIMATES (estTokens ≈ chars/4); the two SYS_* values
// are coarse fixed approximations of the harness-side prompt/tools that we
// cannot measure from the repo.

import { estTokens } from "../md.ts";
import { encodeCwd } from "./sessions_native.ts";
import { join } from "@std/path";

const HOME = Deno.env.get("HOME") ?? "/tmp";

// Fixed, harness-dependent approximations — NOT measurable from the repo.
// Coarse ≈ values for the Claude Code system prompt and the built-in tool
// definitions. Marked `fixed` in the UI so it's clear these are not measured.
// ≈ fix, harness-/versionsabhängig, beobachtet via /context.
const SYS_PROMPT_TOK = 3600;
const SYS_TOOLS_TOK = 7900;

// Kalibrierungsfaktor für datei-basierte Kategorien (Skills, Agents, Memory).
// chars/4 unterschätzt Markdown/Deutsch um ~1.7-1.9×; empirisch gegen /context
// kalibriert (cc-setup: Memory 17.9k→17.1k, Skills 11.1k→10.4k, total ~43k→~42k).
// Wird NUR in der Kontext-View-Aggregation angewendet — estTokens bleibt unverändert
// (parity-gebunden gegen knowledge.py). Alle Werte bleiben als "≈ geschätzt" gelabelt.
const CTX_CALIB = 1.7;

/** Wendet den Kalibrierungsfaktor auf einen estTokens-Wert an. Nur für die Kontext-View. */
function ctxTok(est: number): number {
  return Math.round(est * CTX_CALIB);
}

// Claude Code context window (≈ 1M-token tier). The free-space gauge is computed
// against this.
const CTX_WINDOW = 1_000_000;

/** A single token-bearing item inside a context category (agent/skill/file). */
export interface ContextItem {
  name: string;
  tokens: number;
  desc?: string;
  /** If present: kind for /read to show file content inline (claude-global/claude-project/homefile/project-agent). */
  read?: string;
  /** Absolute file path (used together with read="homefile"). */
  readPath?: string;
  /** Quell-Gruppe für Untergruppen in der UI (Project/User/Plugin · <name>/Built-in). */
  group?: string;
}

/** A context category: a labelled token bucket with optional drill-down items. */
export interface ContextCategory {
  key: string;
  label: string;
  tokens: number;
  /** true → harness-fixed approximation (not measured). */
  fixed?: boolean;
  /** true → filled live client-side (hook injection). */
  live?: boolean;
  items: ContextItem[];
}

/**
 * Best-effort token estimate of this project's persistent MEMORY.md.
 *
 * Resolution (mirrors tokens.ts / sessions_native.ts encodeCwd):
 *   CLAUDE_MEMORY_DIR (if set) / MEMORY.md
 *   else  ${HOME}/.claude/projects/${encodeCwd(cwd)}/memory/MEMORY.md
 *
 * Returns {available:false, tokens:0} when the file is missing/unreadable, so
 * the caller can simply omit the MEMORY.md drill-down item.
 *
 * NOTE: the default path is an assumption based on how Claude Code encodes a
 * project's cwd into its per-project dir. If the harness changes that layout,
 * set CLAUDE_MEMORY_DIR to override.
 */
async function memoryMdTokens(
  cwd: string,
): Promise<{ available: boolean; tokens: number; path: string }> {
  const dir = Deno.env.get("CLAUDE_MEMORY_DIR") ??
    join(HOME, ".claude", "projects", encodeCwd(cwd), "memory");
  const path = join(dir, "MEMORY.md");
  try {
    const text = await Deno.readTextFile(path);
    return { available: true, tokens: estTokens(text), path };
  } catch {
    return { available: false, tokens: 0, path };
  }
}
