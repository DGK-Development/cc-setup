---
name: deno-knowledge-nav-count-items
description: deno-knowledge-app browser.js nav-count branch assumes COLL[id].items exists — special collections (categories etc.) crash the whole nav loop
metadata:
  type: feedback
---

In `deno-knowledge-app/assets/browser.js`, the nav-build loop's count cell falls through to `COLL[it.id].items.length`. A nav entry whose collection has NO `.items` array (e.g. `coll.context` uses `categories`) throws a TypeError that aborts the ENTIRE `NAV.forEach` — the nav item silently never renders even though `window.DATA` is correct.

**Why:** Discovered building CCS-031 (Kontext view). buildData + render tests all passed; only the live browser revealed the missing nav entry. The DATA was right; the client crashed mid-loop. Type-checks and unit tests do NOT catch this — it's a runtime DOM-build failure.

**How to apply:** When adding a new nav entry backed by a non-standard collection shape, add an explicit branch in the nav-count code BEFORE the generic `COLL[it.id].items.length` fallback, and verify the nav actually renders in a real browser (rodney) — not just that buildData/renderPage tests pass. UI-rendering correctness needs end-to-end browser verification, per the project's verifiable-success-criteria rule.
