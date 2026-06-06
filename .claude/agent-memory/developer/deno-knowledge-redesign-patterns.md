---
name: deno-knowledge-redesign-patterns
description: Patterns from the aufgeräumt redesign — header/sidebar merge, renderProjectOverview, dt-raw, li-tok, chip markup for project rows
metadata:
  type: project
---

Redesign "aufgeräumt" implemented 2026-06-06:

- `kn-status` + `kn-tabs` merged into single `header.hd` — breadcrumb IDs `crumb-here`/`crumb-scope` updated by browser.js `setCrumb()` on every `select()` call.
- Sidebar: `aside.pane-side` contains `nav#mp-nav` (browser.js fills) + `.proj-list` (server-rendered). Old `aside.kn-projects` removed.
- Project rows now use chip markup `<span class="ch open">N offen</span>` — tests must match this, not `<b>N</b> offen`.
- `renderProjectOverview()` added to browser.js — called when `ACTIVE && id==="ov"`. Reads: `COLL.tn.items`, `COLL.backlog.items`, `COLL.psections`, `COLL.decisions`, `COLL.changelog`, `COLL.context.categories`, `OV.*`, `DATA.projects` (for per-project cost_7d), `DATA.meta.branch`.
- `statusIcon(s, size)` helper added in browser.js (open/wip/done SVGs, no deleg).
- SKILL.md and Agent-Definition sections wrapped in `<details class="dt-raw">` (default closed) using `raw: true` flag on sec objects.
- `.li` rows: skill/agent/know/lesson/memory have no dot; skill/agent show `.li-tok` (metaTokens) on right.
- `.mp` grid changed to `280px 1fr` (was `214px 280px 1fr`); `.mp.is-overview` → `1fr` (was `214px 1fr`).
- Quiet-project toggle: rows with no activity have `hidden` attr; inline script wires `#kn-show-quiet` click.

**Why:** Plan `functional-riding-oasis.md` — reduce visual noise (2 headers → 1, 2 nav columns → 1 sidebar).

**How to apply:** When touching deno-knowledge-app layout — the new HTML skeleton is `header.hd > .kn-body > aside.pane-side + .mp`. Old `.kn-status`/`.kn-tabs`/`.kn-projects` classes no longer exist in the shell.
