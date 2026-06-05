import { assertEquals, assertMatch } from "@std/assert";
import { estTokens, fmtMtime, frontmatterField, mdHeaders } from "../src/md.ts";

Deno.test("mdHeaders returns level 1+2 headers in order", () => {
  const md = "# Title\n\nintro\n\n## Section A\ntext\n### Sub\n## Section B\n";
  assertEquals(mdHeaders(md), ["Title", "Section A", "Section B"]);
});

Deno.test("mdHeaders skips headers inside fenced code blocks", () => {
  const md = "# Real\n\n```\n# DONT DO THIS\n```\n\n## Also real\n";
  assertEquals(mdHeaders(md), ["Real", "Also real"]);
});

Deno.test("mdHeaders honours the levels argument", () => {
  const md = "# One\n## Two\n### Three\n";
  assertEquals(mdHeaders(md, [3]), ["Three"]);
});

Deno.test("estTokens approximates chars/4", () => {
  assertEquals(estTokens(""), 0);
  assertEquals(estTokens("abcd"), 1);
  assertEquals(estTokens("abcde"), 2);
});

Deno.test("frontmatterField extracts and unquotes a value", () => {
  const md = '---\ntitle: "Hello World"\ndescription: a skill\n---\n# Body\n';
  assertEquals(frontmatterField(md, "description"), "a skill");
  assertEquals(frontmatterField(md, "title"), "Hello World");
});

Deno.test("frontmatterField returns '' without a leading block or field", () => {
  assertEquals(frontmatterField("no frontmatter here", "title"), "");
  assertEquals(frontmatterField("---\nfoo: bar\n---\n", "missing"), "");
});

Deno.test("frontmatterField reads a folded block scalar (title: >-)", () => {
  const md =
    "---\nid: x\ntitle: >-\n  Externe Stop-Sub-Hooks vendoren\n  oder sauber degradieren\nstatus: To Do\n---\n# Body\n";
  assertEquals(
    frontmatterField(md, "title"),
    "Externe Stop-Sub-Hooks vendoren oder sauber degradieren",
  );
  assertEquals(frontmatterField(md, "status"), "To Do");
});

Deno.test("fmtMtime returns '' for falsy input and a formatted stamp otherwise", () => {
  assertEquals(fmtMtime(0), "");
  assertEquals(fmtMtime(null), "");
  assertMatch(fmtMtime(1_700_000_000), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});
