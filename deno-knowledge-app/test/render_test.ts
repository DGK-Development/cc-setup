import { assertStringIncludes } from "@std/assert";
import { renderPage } from "../src/render.ts";

// Regression: the static assets (dash.css/browser.css/browser.js) are read from
// scripts/knowledge_assets relative to this module. A wrong number of "../" left
// them empty, producing a styled-and-scriptless dead page. The asset path is
// independent of --cwd, so this asserts inlining directly.
Deno.test("renderPage shows cross-project statusline + Überblick entry", async () => {
  const html = await renderPage({
    cwd: "/tmp",
    view: "overview",
    sidebar: [
      { name: "a", path: "/a", open_tasks: 3, cost_7d: 1.5, tn: 4 },
      { name: "b", path: "/b", open_tasks: 2, cost_7d: 0.5, tn: 1 },
    ],
    generatedAt: "2026-06-05 20:00",
  });
  assertStringIncludes(html, "kn-status");
  assertStringIncludes(html, "<b>5</b> offene Backlog-Tasks"); // 3 + 2 summed cross-project
  assertStringIncludes(html, "<b>5</b> tn-Tasks"); // 4 + 1 summed cross-project
  assertStringIncludes(html, "Überblick");
});

Deno.test("renderPage inlines browser.js (asset path resolves correctly)", async () => {
  const html = await renderPage({ cwd: "/tmp" });
  // browser.js is full of addEventListener — a wrong asset path leaves the
  // inline <script> empty (no token). dash.css/browser.css share the same
  // assetsDir, so this one assertion covers all three asset reads.
  assertStringIncludes(html, "addEventListener");
});
