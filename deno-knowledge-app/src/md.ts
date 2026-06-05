// Pure markdown/frontmatter helpers — Deno-native ports of knowledge.py's
// _md_headers / _est_tokens / _frontmatter_field / _fmt_mtime. Behavior is kept
// byte-faithful to the Python originals so collector output stays parity-checkable.

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * ATX markdown headers of the given levels, in document order. Fenced code
 * blocks are skipped so a `# comment` inside ``` is not mistaken for a heading.
 */
export function mdHeaders(text: string, levels: number[] = [1, 2]): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^(#{1,6})\s+(.*\S)\s*$/);
    if (!m) continue;
    if (levels.includes(m[1].length)) out.push(m[2].trim());
  }
  return out;
}

/** Rough token estimate (~chars/4). A budget gauge, not a real tokenizer. */
export function estTokens(text: string): number {
  return Math.floor(([...text].length + 3) / 4);
}

/**
 * YAML frontmatter value from a leading `---` block ('' if absent). Handles
 * single-line scalars (with quote-stripping) AND block scalars (`>`/`|` with
 * optional chomp `+`/`-`), whose value sits on the following more-indented lines
 * — e.g. `title: >-` followed by the wrapped title. Folded (`>`) joins with
 * spaces, literal (`|`) keeps newlines.
 */
export function frontmatterField(text: string, field: string): string {
  const lead = text.replace(/^﻿+/, "");
  if (!lead.startsWith("---")) return "";
  const end = lead.indexOf("\n---", 3);
  const block = end !== -1 ? lead.slice(3, end) : lead.slice(3);
  const lines = block.split("\n");
  const re = new RegExp(`^(\\s*)${escapeRegExp(field)}\\s*:\\s*(.*)$`);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    const indent = m[1].length;
    let val = m[2].trim();
    if (/^[|>][+-]?$/.test(val)) {
      const folded = val[0] === ">";
      const body: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === "") {
          body.push("");
          continue;
        }
        const li = lines[j].length - lines[j].trimStart().length;
        if (li <= indent) break; // dedent → end of the block scalar
        body.push(lines[j].trim());
      }
      return folded ? body.filter(Boolean).join(" ").trim() : body.join("\n").replace(/\n+$/, "");
    }
    if (!val) return "";
    if (val.length >= 2 && val[0] === val[val.length - 1] && (val[0] === '"' || val[0] === "'")) {
      val = val.slice(1, -1);
    }
    return val;
  }
  return "";
}

/** Format epoch seconds as local `YYYY-MM-DD HH:MM` ('' if falsy/unknown). */
export function fmtMtime(mt: number | null | undefined): string {
  if (!mt) return "";
  const d = new Date(mt * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${
    p(d.getMinutes())
  }`;
}
