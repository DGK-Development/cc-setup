import { assertStringIncludes } from "@std/assert";
import { renderPage } from "../src/render.ts";

// Regression: the static assets (dash.css/browser.css/browser.js) are read from
// scripts/knowledge_assets relative to this module. A wrong number of "../" left
// them empty, producing a styled-and-scriptless dead page. The asset path is
// independent of --cwd, so this asserts inlining directly.
Deno.test("renderPage inlines browser.js (asset path resolves correctly)", async () => {
  const html = await renderPage({ cwd: "/tmp" });
  // browser.js is full of addEventListener — a wrong asset path leaves the
  // inline <script> empty (no token). dash.css/browser.css share the same
  // assetsDir, so this one assertion covers all three asset reads.
  assertStringIncludes(html, "addEventListener");
});
