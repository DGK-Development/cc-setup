import { escape } from "@std/html/entities";
import { buildData, fmtCost } from "./context.ts";
import { repoRoot } from "./collectors/project.ts";
import { readText } from "./shared.ts";
import { estTokens } from "./md.ts";
import { join } from "@std/path";

export interface RenderOptions {
  cwd: string;
}

// ---------------------------------------------------------------------------
// safeScriptJson — XSS-safe serialization for window.DATA
// ---------------------------------------------------------------------------

/** JSON-serializes obj with </script>, <, >, & and JS line separators escaped. */
export function safeScriptJson(obj: unknown): string {
  let s = JSON.stringify(obj);
  // Replace chars that break a <script> context
  s = s.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  // U+2028 and U+2029 via split/join to avoid embedding them in source
  s = s.split(String.fromCharCode(0x2028)).join("\\u2028");
  s = s.split(String.fromCharCode(0x2029)).join("\\u2029");
  return s;
}

// ---------------------------------------------------------------------------
// _resultPage — outcome page for git actions
// ---------------------------------------------------------------------------

const RESULT_CSS = "body{margin:0;background:#0a0b0d;color:#d7dee5;" +
  'font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:13px;line-height:1.55;}' +
  ".wrap{max-width:900px;margin:0 auto;padding:34px 24px;}" +
  "h1{font-size:16px;font-weight:700;margin:0 0 4px;}" +
  ".cmd{color:#6c7682;font-size:12px;margin:0 0 14px;}" +
  "pre.out{background:#0b0d10;border:1px solid #1c2229;border-radius:9px;padding:14px;" +
  "font-size:12px;white-space:pre-wrap;word-break:break-word;color:#aab3bd;}" +
  "a{color:oklch(0.83 0.11 215);} .ok{color:oklch(0.83 0.15 152);} .err{color:oklch(0.68 0.19 26);}" +
  "@media (prefers-color-scheme: light){" +
  "body{background:#eff1f5;color:#4c4f69;}" +
  "pre.out{background:#e6e9ef;border-color:#ccd0da;color:#5c5f77;}" +
  ".cmd{color:#8c8fa1;} a{color:#209fb5;} .ok{color:#40a02b;} .err{color:#d20f39;}" +
  "}";

export function resultPage(action: string, result: Record<string, unknown>): string {
  const ok = Boolean(result.ok);
  const badge = ok ? '<span class="ok">OK</span>' : '<span class="err">Fehler</span>';
  return (
    "<!DOCTYPE html>\n<html lang='de'><head><meta charset='utf-8'>" +
    "<meta name='viewport' content='width=device-width, initial-scale=1'>" +
    `<title>git ${escape(action)}</title><style>${RESULT_CSS}</style></head>` +
    "<body><div class='wrap'>" +
    `<h1>git ${escape(action)} ${badge}</h1>` +
    `<p class='cmd'><code>${escape(String(result.cmd ?? ""))}</code></p>` +
    `<pre class='out'>${escape(String(result.output ?? ""))}</pre>` +
    "<p><a href='/'>← zurück zum Dashboard</a></p>" +
    "</div></body></html>"
  );
}

// ---------------------------------------------------------------------------
// _read_doc — whitelisted file reader for GET /read
// ---------------------------------------------------------------------------

const READ_MAX_CHARS = 60000;

function under(child: string, parent: string): boolean {
  try {
    const c = child.startsWith("/") ? child : `${parent}/${child}`;
    // Normalize: remove .. segments
    const norm = new URL(`file://${c}`).pathname;
    return norm.startsWith(parent.endsWith("/") ? parent : parent + "/") || norm === parent;
  } catch {
    return false;
  }
}

export async function readDoc(
  cwd: string,
  claudeHome: string,
  kind: string,
  name = "",
  path = "",
): Promise<Record<string, unknown>> {
  try {
    const skillsRoot = join(claudeHome, "skills");
    let fpath: string;

    switch (kind) {
      case "claude-global":
        fpath = join(claudeHome, "CLAUDE.md");
        break;
      case "claude-project":
        fpath = join(await repoRoot(cwd), "CLAUDE.md");
        break;
      case "skill": {
        if (!/^[A-Za-z0-9._:-]+$/.test(name)) return { ok: false, error: "ungültiger Skill-Name" };
        fpath = join(skillsRoot, name, "SKILL.md");
        if (!under(fpath, skillsRoot)) return { ok: false, error: "Pfad ausserhalb skills/" };
        break;
      }
      case "skillfile": {
        if (!/^[A-Za-z0-9._:-]+$/.test(name)) return { ok: false, error: "ungültiger Skill-Name" };
        const skillRoot = join(skillsRoot, name);
        fpath = join(skillRoot, path);
        if (!under(fpath, skillRoot)) return { ok: false, error: "Pfad ausserhalb des Skills" };
        break;
      }
      case "agent": {
        if (!/^[A-Za-z0-9._-]+$/.test(name)) return { ok: false, error: "ungültiger Agent-Name" };
        fpath = join(claudeHome, "agents", name + ".md");
        if (!under(fpath, join(claudeHome, "agents"))) {
          return { ok: false, error: "Pfad ausserhalb agents/" };
        }
        break;
      }
      case "homefile": {
        if (!path) return { ok: false, error: "kein Pfad" };
        fpath = path.startsWith("/") ? path : join(claudeHome, path);
        if (!under(fpath, claudeHome)) return { ok: false, error: "Pfad ausserhalb ~/.claude" };
        break;
      }
      case "memory": {
        if (!/^[A-Za-z0-9._-]+$/.test(name)) return { ok: false, error: "ungültiger Memory-Name" };
        const memRoot = join(await repoRoot(cwd), "knowledge", "memory");
        fpath = join(memRoot, name);
        if (!under(fpath, memRoot)) return { ok: false, error: "Pfad ausserhalb knowledge/memory" };
        break;
      }
      case "lektion": {
        if (!/^[A-Za-z0-9._-]+$/.test(name)) return { ok: false, error: "ungültiger Lektion-Name" };
        const knRoot = join(await repoRoot(cwd), "knowledge");
        fpath = join(knRoot, name);
        if (!under(fpath, knRoot)) return { ok: false, error: "Pfad ausserhalb knowledge/" };
        break;
      }
      case "knowfile": {
        const knRoot = join(await repoRoot(cwd), "knowledge");
        let rel = path || name;
        if (rel.startsWith("knowledge/")) rel = rel.slice("knowledge/".length);
        fpath = join(knRoot, rel);
        if (!under(fpath, knRoot)) return { ok: false, error: "Pfad ausserhalb knowledge/" };
        break;
      }
      case "taskfile": {
        const tasksRoot = join(await repoRoot(cwd), "backlog", "tasks");
        fpath = join(tasksRoot, name);
        if (!under(fpath, tasksRoot)) return { ok: false, error: "Pfad ausserhalb backlog/tasks" };
        break;
      }
      default:
        return { ok: false, error: `unbekannte Art: ${kind}` };
    }

    const text = await readText(fpath);
    if (text === null) return { ok: false, error: `nicht gefunden: ${fpath.split("/").pop()}` };
    let size = 0;
    try {
      size = (await Deno.stat(fpath)).size;
    } catch { /* ok */ }
    return {
      ok: true,
      kind,
      name,
      path,
      tokens: estTokens(text),
      size,
      truncated: text.length > READ_MAX_CHARS,
      content: text.slice(0, READ_MAX_CHARS),
    };
  } catch (exc) {
    return { ok: false, error: String(exc) };
  }
}

// ---------------------------------------------------------------------------
// Extra CSS (git forms + inline file reader + various UI polish)
// ---------------------------------------------------------------------------

const EXTRA_CSS = `
.gitforms{ display:grid; gap:9px; }
.gf{ display:flex; flex-wrap:wrap; gap:7px; align-items:center; }
.gf input{ font:inherit; font-size:12px; padding:5px 9px; border:1px solid var(--line-2);
  border-radius:6px; background:var(--inset); color:var(--fg); flex:1; min-width:120px; }
.gf input::placeholder{ color:var(--faint); }
.gf button{ font:inherit; font-size:11.5px; font-weight:700; padding:6px 12px; border-radius:6px;
  border:1px solid color-mix(in oklch,var(--green) 40%,var(--line-2)); background:var(--green-d);
  color:var(--green); cursor:pointer; white-space:nowrap; }
.gf button.danger{ border-color:color-mix(in oklch,var(--red) 45%,var(--line-2));
  background:var(--red-d); color:var(--red); }
.gf .gn{ font-size:10px; color:var(--red); }
.filebody{ background:var(--inset); border:1px solid var(--line); border-radius:8px;
  padding:13px 15px; font-size:11.5px; line-height:1.6; color:var(--fg-2);
  white-space:pre-wrap; word-break:break-word; max-height:62vh; overflow:auto; margin:0; }
.filebody.loading{ color:var(--faint); font-style:italic; white-space:normal; }
.ftrunc{ color:var(--faint); font-size:10.5px; margin-top:6px; }
.rlwrap{ display:grid; gap:9px; margin-top:2px; }
.rlm-row{ display:flex; justify-content:space-between; gap:8px; margin-bottom:4px; align-items:baseline; }
.rlm-l{ font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:var(--dim); }
.rlm-v{ font-size:10px; color:var(--fg-2); font-variant-numeric:tabular-nums; }
.rlm-na{ font-size:10px; color:var(--faint); }
.mp-list .li .li-s{ display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.hookrows{ display:grid; gap:8px; }
.hookrow{ background:var(--panel); border:1px solid var(--line); border-radius:7px; padding:9px 11px; }
.hookrow .hh{ display:flex; gap:8px; align-items:baseline; margin-bottom:5px; }
.hookrow .hh code{ color:var(--cyan); font-size:11px; }
.hookrow .hh .ht{ color:var(--faint); font-size:10px; text-transform:uppercase; letter-spacing:.08em; }
.hookrow .hc{ font-size:11px; color:var(--green); white-space:pre-wrap; word-break:break-word; line-height:1.5; }
.nav-i .nc{ text-align:right; line-height:1.25; }
.nav-i .nc small{ display:block; font-size:8.5px; color:var(--faint); font-weight:500; letter-spacing:.02em; }
.fmeta{ font-size:10px; color:var(--faint); margin-bottom:5px; font-variant-numeric:tabular-nums; }
.fchips{ display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
.fchip{ font:inherit; font-size:10.5px; color:var(--fg-2); background:var(--panel-3);
  border:1px solid var(--line-2); border-radius:6px; padding:4px 9px; cursor:pointer;
  display:inline-flex; align-items:center; gap:7px; white-space:nowrap; }
.fchip:hover{ background:var(--panel-2); border-color:var(--line-3); }
.fchip.is-active{ border-color:color-mix(in oklch,var(--cyan) 45%,var(--line-2)); color:var(--cyan); }
.fchip .fl{ font-size:8.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--amber); }
.fchip .fz{ color:var(--faint); font-size:9.5px; }
.fchip.diffall{ color:var(--cyan); }
.filehost2{ margin-top:4px; }
.gfiles{ display:grid; gap:4px; margin-bottom:10px; }
.gfile{ font:inherit; font-size:11.5px; text-align:left; background:var(--panel);
  border:1px solid var(--line); border-radius:6px; padding:6px 10px; cursor:pointer;
  display:flex; align-items:center; gap:9px; color:var(--fg-2); }
.gfile:hover{ background:var(--panel-2); }
.gfile.is-active{ box-shadow:inset 2px 0 0 var(--cyan); background:var(--panel-3); }
.gfile .gfp{ word-break:break-all; }
.filebody.diff{ padding:0; }
.filebody.diff .dl{ display:block; padding:0 13px; }
.filebody.diff .dp{ color:var(--green); background:color-mix(in oklch,var(--green) 9%,transparent); }
.filebody.diff .dm{ color:var(--red); background:color-mix(in oklch,var(--red) 9%,transparent); }
.filebody.diff .dh{ color:var(--cyan); }
.filebody.diff .df{ color:var(--dim); }
.mp-list .li-group{ position:sticky; top:0; z-index:1; font-size:9.5px; letter-spacing:.12em;
  text-transform:uppercase; color:var(--amber); background:var(--panel);
  padding:9px 13px 5px; border-bottom:1px solid var(--line); }
.mp-list details.done-grp{ border-top:1px solid var(--line-2); }
.mp-list details.done-grp > summary{ list-style:none; cursor:pointer; font-size:9.5px;
  letter-spacing:.12em; text-transform:uppercase; color:var(--dim);
  padding:10px 13px; user-select:none; }
.mp-list details.done-grp > summary::-webkit-details-marker{ display:none; }
.mp-list details.done-grp > summary:hover{ background:var(--panel-2); color:var(--fg-2); }
.mp-list details.done-grp[open] > summary{ color:var(--green); }
.mp-list details.done-grp .ct{ color:var(--faint); }
.clrows{ display:grid; gap:7px; }
.clrow{ background:var(--panel); border:1px solid var(--line); border-radius:7px; padding:8px 11px; }
.clrow.cl-err{ border-color:color-mix(in oklch,var(--red) 30%,var(--line)); }
.clrow .clh{ display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; }
.clrow .clh code{ color:var(--green); font-size:11px; word-break:break-all; }
.clrow .clt{ font-size:10px; font-weight:700; padding:1px 6px; border-radius:5px;
  background:var(--panel-3); color:var(--dim); white-space:nowrap; }
.clrow .clt.r{ color:var(--red); } .clrow .clt.a{ color:var(--amber); }
.clrow .clp{ margin-top:6px; font-size:10.5px; color:var(--fg-2); white-space:pre-wrap;
  word-break:break-word; max-height:120px; overflow:auto; }
.list-head .gss{ font-size:10px; color:var(--dim); margin-top:7px; font-variant-numeric:tabular-nums; }
.mp-list .gfile{ width:100%; font:inherit; font-size:12px; text-align:left; background:none;
  border:0; border-bottom:1px solid var(--line); padding:7px 13px; cursor:pointer;
  display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:9px; color:var(--fg-2); }
.mp-list .gfile:hover{ background:var(--panel-2); }
.mp-list .gfile.is-active{ background:var(--panel-3); box-shadow:inset 2px 0 0 var(--cyan); color:var(--fg-strong); }
.mp-list .gfile .gfp{ word-break:break-all; line-height:1.3; }
.mp-list .gfile .gdelta{ font-size:10px; font-variant-numeric:tabular-nums; white-space:nowrap; }
.gd-add{ color:var(--green); } .gd-del{ color:var(--red); margin-left:5px; } .gd-new{ color:var(--amber); }
.git-actions{ border-top:1px solid var(--line-2); margin-top:4px; }
.git-actions > summary{ list-style:none; cursor:pointer; font-size:9.5px; letter-spacing:.1em;
  text-transform:uppercase; color:var(--dim); padding:11px 13px; user-select:none; }
.git-actions > summary::-webkit-details-marker{ display:none; }
.git-actions > summary:hover{ color:var(--fg-2); }
.git-actions > summary .ct{ color:var(--faint); text-transform:none; letter-spacing:0; }
.git-actions .gitforms{ padding:2px 13px 14px; }
.gitdiff{ min-height:100%; }
.gitdiff-head{ display:flex; align-items:baseline; gap:12px; flex-wrap:wrap;
  padding:12px 16px; border-bottom:1px solid var(--line);
  position:sticky; top:0; background:var(--bg-grid); z-index:2; }
.gitdiff-head code{ color:var(--green); font-size:12.5px; word-break:break-all; }
.gitdiff-head .gdh-rec{ color:var(--dim); font-size:10.5px; }
.gitdiff .filebody.diff{ border:0; border-radius:0; max-height:none; overflow:visible; }
.splitdiff{ font-size:11.5px; line-height:1.55; font-variant-numeric:tabular-nums; }
.sd-headrow, .sd-row{ display:grid; grid-template-columns:46px minmax(0,1fr) 46px minmax(0,1fr); }
.sd-headrow{ position:sticky; top:0; z-index:1; background:var(--panel); border-bottom:1px solid var(--line-2); }
.sd-headrow .sd-h{ grid-column:span 2; padding:7px 12px; font-size:9.5px; letter-spacing:.1em;
  text-transform:uppercase; color:var(--dim); }
.sd-headrow .sd-h:nth-child(2){ border-left:1px solid var(--line-2); }
.sd-hunk{ padding:3px 12px; color:var(--cyan); background:var(--inset);
  border-top:1px solid var(--line); border-bottom:1px solid var(--line); font-size:10.5px; }
.sd-ln{ text-align:right; padding:1px 8px; color:var(--faint); font-size:10px; user-select:none;
  border-right:1px solid var(--line); background:var(--bg-grid); }
.sd-code{ padding:1px 10px; white-space:pre-wrap; word-break:break-word; color:var(--fg-2);
  border-right:1px solid var(--line); }
.sd-code.dm{ background:color-mix(in oklch,var(--red) 13%,transparent); color:var(--red); }
.sd-code.dp{ background:color-mix(in oklch,var(--green) 13%,transparent); color:var(--green); }
.sd-code.empty{ background:repeating-linear-gradient(45deg,transparent,transparent 6px,var(--inset) 6px,var(--inset) 12px); }
`;

// ---------------------------------------------------------------------------
// renderPage — full single-page HTML, browser.js-compatible DOM
// ---------------------------------------------------------------------------

const SIDEBAR_CSS = `
.kn-body{ display:flex; align-items:stretch; flex:1 1 auto; min-height:0; }
.kn-projects{ width:232px; flex:0 0 232px; overflow:auto; border-right:1px solid var(--line-2,#1c2229);
  padding:8px 0; }
.kn-proj-h{ font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#6c7682;
  padding:8px 14px 6px; }
.kn-proj{ display:flex; flex-direction:column; gap:2px; padding:7px 14px; text-decoration:none;
  color:inherit; border-left:2px solid transparent; }
.kn-proj:hover{ background:rgba(127,127,127,.10); }
.kn-proj.is-active{ background:rgba(127,127,127,.16); border-left-color:oklch(0.83 0.11 215); }
.kn-proj-n{ font-size:13px; font-weight:600; }
.kn-proj-s{ font-size:11px; color:#8a929c; }
.kn-proj-s b{ color:#aab3bd; }
.kn-title{ font-size:13px; font-weight:700; padding:0 6px; color:#aab3bd; }
.kn-body .mp{ flex:1 1 auto; min-width:0; }
.kn-status{ display:flex; flex-wrap:wrap; align-items:baseline; column-gap:16px; row-gap:2px;
  padding:6px 14px; font-size:11.5px; line-height:1.5;
  border-bottom:1px solid var(--line-2,#1c2229); color:#8a929c; background:rgba(127,127,127,.04); }
.kn-status > span{ position:relative; }
.kn-status > span + span::before{ content:"·"; position:absolute; left:-10px; color:#3a414a; }
.kn-status b{ color:#d7dee5; }
.kn-status .kn-status-2{ color:#6c7682; }
.kn-status .kn-loading{ color:oklch(0.83 0.13 80); }
.kn-proj-ov{ border-bottom:1px solid var(--line-2,#1c2229); margin-bottom:4px; padding-bottom:9px; }
.kn-proj-ov .kn-proj-n{ color:oklch(0.83 0.11 215); }
@media (prefers-color-scheme: light){
  .kn-projects{ border-right-color:#ccd0da; }
  .kn-proj-s{ color:#6c6f85; } .kn-proj-s b{ color:#4c4f69; } .kn-title{ color:#4c4f69; }
  .kn-status{ border-bottom-color:#ccd0da; color:#6c6f85; } .kn-status b{ color:#4c4f69; }
  .kn-proj-ov{ border-bottom-color:#ccd0da; }
}`;

const KANBAN_CSS = `
.mp.is-board{ grid-template-columns:214px 1fr; }
.mp.is-board .mp-list{ display:none; }
.kn-board-head{ padding:11px 16px; border-bottom:1px solid var(--line,#1c2229); display:flex;
  align-items:baseline; gap:10px; background:var(--panel,#0b0d10); font-size:13px; }
.kn-board-head .lc{ color:var(--faint,#6c7682); }
.kn-board-head .bh-hint{ margin-left:auto; color:var(--dim,#8a929c); font-size:10.5px; }
.kn-board{ display:flex; gap:12px; padding:14px 16px; align-items:flex-start; overflow:auto; height:100%; }
.kn-col{ flex:1 1 0; min-width:220px; background:var(--bg-grid,#0a0b0d);
  border:1px solid var(--line-2,#1c2229); border-radius:9px; display:flex; flex-direction:column;
  max-height:100%; }
.kn-col-h{ padding:9px 12px; font-size:12px; font-weight:700;
  border-bottom:1px solid var(--line-2,#1c2229); display:flex; gap:8px; }
.kn-col-c{ color:var(--faint,#6c7682); font-weight:500; }
.kn-col-body{ padding:8px; display:flex; flex-direction:column; gap:8px; min-height:60px; overflow:auto; }
.kn-col.dragover{ outline:2px dashed oklch(0.83 0.11 215); outline-offset:-3px; }
.kn-card{ background:var(--panel,#0b0d10); border:1px solid var(--line-2,#1c2229); border-radius:7px;
  padding:8px 10px; cursor:grab; }
.kn-card:active{ cursor:grabbing; }
.kn-card.dragging{ opacity:.4; }
.kn-card-id{ font-size:11px; color:oklch(0.83 0.11 215); font-weight:600; }
.kn-card-t{ font-size:12.5px; margin-top:2px; line-height:1.35; }
.kn-card-ms{ font-size:10.5px; color:var(--dim,#8a929c); margin-top:3px; }
.kn-modal{ position:fixed; inset:0; background:rgba(0,0,0,.55); display:flex; align-items:center;
  justify-content:center; z-index:1000; }
.kn-modal-box{ background:var(--panel,#0b0d10); border:1px solid var(--line-2,#1c2229);
  border-radius:10px; width:min(820px,92vw); max-height:86vh; display:flex; flex-direction:column; }
.kn-modal-h{ display:flex; align-items:center; gap:10px; padding:11px 14px;
  border-bottom:1px solid var(--line-2,#1c2229); font-size:13px; }
.kn-modal-h b{ flex:1; color:oklch(0.83 0.11 215); }
.kn-modal-x{ background:none; border:0; color:var(--dim,#8a929c); cursor:pointer; font-size:14px; }
.kn-modal-body{ margin:0; padding:14px 16px; overflow:auto; white-space:pre-wrap; word-break:break-word;
  font-size:12px; line-height:1.5; color:var(--fg,#d7dee5); }
`;

export async function renderPage(
  opts: RenderOptions & {
    context?: Record<string, unknown>;
    sidebar?: Array<
      { name: string; path: string; open_tasks: number; cost_7d: number; tn?: number }
    >;
    active?: string;
    view?: "overview" | "project";
    generatedAt?: string;
    loading?: boolean;
  },
): Promise<string> {
  const ctx = opts.context ??
    { generated_at: "", cwd: opts.cwd, projects: [], active_project: "", cards: {} };
  const view = opts.view ?? (opts.active ? "project" : "overview");
  const data = buildData(ctx, view);

  // Read static assets via /assets/ URLs (they are served by serveDir)
  // but for the inline <style> embed we read them from the filesystem.
  const assetsDir = join(new URL("..", import.meta.url).pathname, "assets");
  const dashCss = await readText(join(assetsDir, "dash.css")) ?? "";
  const browserCss = await readText(join(assetsDir, "browser.css")) ?? "";
  const browserJs = await readText(join(assetsDir, "browser.js")) ?? "";

  const css = dashCss + "\n" + browserCss + "\n" + EXTRA_CSS + "\n" + SIDEBAR_CSS + "\n" +
    KANBAN_CSS;
  const dataJson = safeScriptJson(data);

  // Left sidebar: a top "Überblick" entry (cross-project + global) above the
  // project list. Project rows are active only in project view.
  const active = view === "project" ? (opts.active ?? "") : "";
  const sb = opts.sidebar ?? [];
  const ovEntry =
    `<a class="kn-proj kn-proj-ov${view === "overview" ? " is-active" : ""}" href="/">` +
    `<span class="kn-proj-n">Überblick</span>` +
    `<span class="kn-proj-s">alle Projekte · global</span></a>`;
  const projRows = sb.map((p) => {
    const cls = p.name === active ? " is-active" : "";
    const q = encodeURIComponent(p.name);
    return `<a class="kn-proj${cls}" href="/?project=${q}" title="${escape(p.path)}">` +
      `<span class="kn-proj-n">${escape(p.name)}</span>` +
      `<span class="kn-proj-s"><b>${p.open_tasks}</b> offen · <b>${p.tn ?? 0}</b> tn · ${
        escape(fmtCost(p.cost_7d))
      }</span>` +
      "</a>";
  }).join("");
  const sidebarHtml = '<aside class="kn-projects" id="kn-projects">' + ovEntry +
    '<div class="kn-proj-h">Projekte</div>' + projRows + "</aside>";

  // Cross-project statusline (eine Zeile, umbricht bei wenig Platz): Repo-Backlog
  // + Token-Kosten + tn-Task-ZAHLEN pro Repo (nur Count via working_dir-Match,
  // keine Inhalte/kunde-Felder — siehe parseTnProjects).
  const sumOpen = sb.reduce((s, p) => s + p.open_tasks, 0);
  const sumCost = sb.reduce((s, p) => s + p.cost_7d, 0);
  const sumTn = sb.reduce((s, p) => s + (p.tn ?? 0), 0);
  const stand = escape(
    opts.generatedAt ?? String((data.meta as Record<string, unknown>)?.generated_at ?? ""),
  );
  const loadingSeg = opts.loading ? '<span class="kn-loading">Daten laden…</span>' : "";
  const statusline = '<div class="kn-status">' +
    `<span><b>${sb.length}</b> Projekte</span>` +
    `<span><b>${sumOpen}</b> offene Backlog-Tasks</span>` +
    `<span><b>${sumTn}</b> tn-Tasks</span>` +
    `<span>≈${escape(fmtCost(sumCost))} / 7 Tage</span>` +
    `<span class="kn-status-2">Stand ${stand}</span>` +
    loadingSeg +
    "</div>";
  const titleLabel = view === "overview"
    ? "Überblick · alle Projekte"
    : ("Projekt: " + escape(active));

  // Theme pre-paint init
  const themeInit = "<script>(function(){try{var t=localStorage.getItem('kn-theme');" +
    "if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}" +
    "catch(e){}})();</script>";

  return (
    "<!DOCTYPE html>\n" +
    '<html lang="de"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>knowledge — Browser</title>" +
    themeInit +
    `<style>${css}</style></head><body>` +
    '<div class="kn-shell">' +
    statusline +
    `<div class="kn-tabs" id="kn-tabs"><span class="kn-title">knowledge · ${titleLabel}</span>` +
    '<span class="kn-tabs-sp"></span>' +
    '<button class="kn-theme" id="kn-theme-toggle" type="button"' +
    ' aria-label="Theme wechseln">☀</button>' +
    "</div>" +
    '<div class="kn-body">' +
    sidebarHtml +
    "<div class='mp' id='mp'><nav class='mp-nav' id='mp-nav'></nav>" +
    "<div class='mp-list' id='mp-list'></div>" +
    "<div class='mp-detail' id='mp-detail'></div></div>" +
    "</div>" +
    "</div>" +
    `<script>window.DATA = ${dataJson};</script>` +
    `<script>${browserJs}</script>` +
    "</body></html>"
  );
}
