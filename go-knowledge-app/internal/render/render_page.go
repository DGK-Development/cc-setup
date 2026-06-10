package render

import (
	"strconv"
	"strings"

	"go-knowledge-app/internal/appctx"
	"go-knowledge-app/internal/collectors"
)

const extraCSS = `
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
.mp-list .li-group-link{ cursor:pointer; }
.mp-list .li-group-link:hover{ text-decoration:underline; }
.mp-list .li-group-link .li-group-id{ opacity:.6; font-weight:600; }
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
`

const headerCSS = `
.hd{
  display:flex; align-items:center; gap:14px;
  padding:9px 14px; border-bottom:1px solid var(--line-2);
  background:linear-gradient(var(--panel-2),var(--panel));
  flex:none;
}
.crumb{ display:flex; align-items:baseline; gap:8px; font-size:12.5px; min-width:0; }
.crumb .root{ color:var(--green); font-weight:700; }
.crumb .sep{ color:var(--faint); }
.crumb .here{ color:var(--fg); font-weight:600; }
.crumb .scope{ color:var(--dim); }
.hd .sp{ flex:1; }
.stats{ display:flex; align-items:stretch; gap:0; }
.stat{ display:flex; flex-direction:column; gap:2px; padding:0 14px; border-left:1px solid var(--line); }
.stat:first-child{ border-left:0; }
.stat .sv{ font-size:13px; font-weight:700; color:var(--fg); line-height:1; font-variant-numeric:tabular-nums; }
.stat .sv.g{ color:var(--green); } .stat .sv.a{ color:var(--amber); } .stat .sv.c{ color:var(--cyan); }
.stat .sl{ font-size:9px; letter-spacing:.1em; text-transform:uppercase; color:var(--dim); }
.hd .asof{ font-size:10.5px; color:var(--faint); white-space:nowrap; }
.hd .tg{
  flex:none; font:inherit; font-size:13px; line-height:1;
  background:var(--panel-3); color:var(--fg-2); border:1px solid var(--line-2);
  border-radius:6px; padding:4px 9px; cursor:pointer;
}
.hd .tg:hover{ color:var(--fg); border-color:var(--line-3); }
`

const sidebarCSS = `
.kn-body{ display:flex; align-items:stretch; flex:1 1 auto; min-height:0; }
.pane-side{
  width:236px; flex:0 0 236px; overflow:auto;
  border-right:1px solid var(--line-2); background:var(--bg-grid);
}
.pane-side::-webkit-scrollbar{ width:9px; }
.pane-side::-webkit-scrollbar-thumb{ background:var(--line-2); border-radius:5px;
  border:2px solid transparent; background-clip:padding-box; }
.pane-side::-webkit-scrollbar-thumb:hover{ background:var(--line-3); }
.kn-body .mp{ flex:1 1 auto; min-width:0; }
/* zero-noise project list */
.proj-list{ padding:2px 0 14px; }
.proj-list-hd{
  font-size:9px; letter-spacing:.12em; text-transform:uppercase; color:var(--dim);
  padding:10px 14px 4px; font-weight:700;
}
.proj-ov{
  display:flex; align-items:center; gap:8px;
  padding:7px 14px; margin:0 6px; border-radius:7px; cursor:pointer;
  text-decoration:none; color:var(--dim); font-size:11.5px;
  transition:background .1s;
}
.proj-ov::before{ content:"←"; font-size:10px; color:var(--faint); }
.proj-ov:hover{ background:var(--panel-2); color:var(--fg-2); }
.proj-i{
  display:grid; grid-template-columns:auto 1fr auto; align-items:baseline; gap:5px;
  padding:6px 14px; margin:0 6px; border-radius:7px; cursor:pointer; transition:background .1s;
  text-decoration:none; color:inherit;
}
.proj-i:hover{ background:var(--panel-2); }
.proj-i.is-active{ background:var(--panel-3); box-shadow:inset 2px 0 0 var(--cyan); }
.proj-i .pn{ font-size:12px; color:var(--fg-2); word-break:break-word; }
.proj-i:hover .pn, .proj-i.is-active .pn{ color:var(--fg); }
.proj-chips{ display:flex; gap:7px; white-space:nowrap; font-variant-numeric:tabular-nums; }
.proj-chips .ch{ font-size:10px; color:var(--faint); }
.proj-chips .ch.open{ color:var(--amber); }
.proj-chips .ch.tn{ color:var(--cyan); }
.proj-chips .ch.cost{ color:var(--dim); }
.proj-i.muted .pn{ color:var(--dim); }
.proj-more{ font-size:10.5px; color:var(--faint); padding:4px 18px; }
.proj-more b{ color:var(--cyan); cursor:pointer; }
.proj-more b:hover{ text-decoration:underline; }
/* Accordion: chevron glyph + sub-nav for active project */
.proj-chev{
  font-size:9px; color:var(--faint); flex:none; width:12px; text-align:center;
  transition:transform .15s;
}
.proj-i.is-active .proj-chev{ color:var(--cyan); }
.proj-sub{
  background:var(--inset); overflow:hidden;
  border-bottom:1px solid var(--line-2);
}
/* Accordion variant: sub-nav follows an active project row → indented + left border */
.proj-i.is-active + .proj-sub{
  border-left:2px solid var(--line-2);
  margin:2px 6px 4px 14px; border-radius:0 6px 6px 0;
  border-bottom:0;
}
/* Project sidebar: headings larger, sub-items smaller (swapped) */
.proj-sub #mp-nav .nav-g{
  font-size:13px; padding:9px 10px 4px; letter-spacing:.04em;
}
.proj-sub #mp-nav .nav-i{ padding:4px 10px; margin:0 4px; }
.proj-sub #mp-nav .nav-i:not(.nav-solo) .nn{ font-size:10.5px; }
/* Single-item nav groups: lone item rendered as a heading-styled clickable link */
#mp-nav .nav-i.nav-solo{ margin-top:5px; }
#mp-nav .nav-i.nav-solo .nn{ font-size:13px; letter-spacing:.04em; text-transform:uppercase;
  font-weight:700; color:var(--dim); }
#mp-nav .nav-i.nav-solo:hover .nn{ color:var(--fg-2); }
#mp-nav .nav-i.nav-solo.is-active .nn{ color:var(--cyan); }
`

const projectCSS = `
.ovwrap{ padding:0; }
/* Project overview two-column layout: left = init-load/tn/backlog, right = wissen/memory */
.ov-cols{ display:flex; gap:14px; align-items:flex-start; flex-wrap:wrap; padding:14px 16px; }
.ov-col{ display:flex; flex-direction:column; gap:14px; min-width:300px; box-sizing:border-box; }
.ov-col-l{ flex:3 1 360px; }
.ov-col-r{ flex:2 1 280px; }
.ov-col .pane{ width:100%; box-sizing:border-box; }
/* Clickable overview rows (open detail modal) */
.ov-click{ cursor:pointer; border-radius:6px; transition:background .1s; }
.ov-click:hover{ background:var(--panel-2); }
.ovbar{
  display:flex; align-items:baseline; gap:12px; flex-wrap:wrap;
  padding:14px 18px; border-bottom:1px solid var(--line); background:var(--panel);
  position:sticky; top:0; z-index:2;
}
.ovbar h2{ font-size:14px; font-weight:700; margin:0; color:var(--fg); letter-spacing:.02em; }
.ovbar h2 b{ color:var(--green); }
.ovbar .dc{ color:var(--faint); font-size:11.5px; }
.ovbar .hint{ margin-left:auto; color:var(--dim); font-size:10.5px; }
.ovbar .hint b{ color:var(--cyan); font-weight:600; }
.ovbar .branch{ font-size:10.5px; color:var(--dim); }
.ovbar .branch code{ color:var(--green); }
.ov-kpis{ display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr));
  border-bottom:1px solid var(--line); background:var(--panel); }
.ov-kpi{ padding:14px 16px; border-right:1px solid var(--line); }
.ov-kpi:last-child{ border-right:0; }
.ov-kpi .k-l{ font-size:9px; letter-spacing:.13em; color:var(--dim); text-transform:uppercase;
  display:flex; gap:6px; align-items:center; margin-bottom:8px; }
.ov-kpi .k-v{ font-size:26px; font-weight:700; line-height:1; letter-spacing:-.01em;
  color:var(--fg); font-variant-numeric:tabular-nums; }
.ov-kpi .k-v small{ font-size:12px; font-weight:500; color:var(--dim); }
.ov-kpi .k-s{ font-size:10px; color:var(--fg-2); margin-top:7px; }
.ov-kpi.g .k-v{ color:var(--green); } .ov-kpi.a .k-v{ color:var(--amber); }
.ov-kpi.c .k-v{ color:var(--cyan); } .ov-kpi.m .k-v{ color:var(--mag); }
.tload{ display:grid; gap:10px; }
.tload .row{ display:grid; grid-template-columns:108px 1fr 70px; align-items:center; gap:12px; }
.tload .tl{ font-size:11px; color:var(--fg-2); }
.tload .tl small{ color:var(--faint); font-size:10px; }
.tload .track{ height:10px; background:var(--inset); border:1px solid var(--line); border-radius:3px; overflow:hidden; }
.tload .track > i{ display:block; height:100%; border-radius:2px; }
.tload .tv{ font-size:11.5px; color:var(--fg); font-variant-numeric:tabular-nums; text-align:right; }
.tload .tv small{ color:var(--faint); font-size:9px; }
.tload-foot{ margin-top:12px; padding-top:11px; border-top:1px dotted var(--line);
  display:flex; justify-content:space-between; font-size:11.5px; }
.tload-foot .tf-l{ color:var(--dim); }
.tload-foot .tf-v{ color:var(--cyan); font-weight:700; font-variant-numeric:tabular-nums; }
.prow{ display:grid; grid-template-columns:1fr auto; gap:10px; align-items:baseline;
  padding:6px 0; border-bottom:1px dotted var(--line); font-size:12px; }
.prow:last-child{ border-bottom:0; }
.prow .pl{ color:var(--fg-2); word-break:break-word; }
.prow .pl b{ color:var(--fg); font-weight:600; }
.prow .pr{ color:var(--dim); font-variant-numeric:tabular-nums; white-space:nowrap; font-size:11px; }
.prow .pr.g{ color:var(--green); } .prow .pr.a{ color:var(--amber); } .prow .pr.c{ color:var(--cyan); }
.ico{ display:inline-flex; flex:none; }
.st-todo{ color:var(--faint); } .st-wip{ color:var(--fg-2); }
.st-done{ color:var(--green); }
.ms{ padding:11px 0; border-bottom:1px solid var(--line); }
.ms:last-child{ border-bottom:0; }
.ms-head{ display:flex; align-items:center; gap:10px; }
.ms-t{ font-size:13.5px; font-weight:600; color:var(--fg); line-height:1.45; letter-spacing:.005em; }
.ms-done .ms-t{ color:var(--dim); text-decoration:line-through; text-decoration-color:var(--line-3); }
.ms-count{ margin-left:auto; flex:none; font-size:10.5px; color:var(--faint);
  font-variant-numeric:tabular-nums; white-space:nowrap; }
.ms-done .ms-count{ color:var(--green); }
.ms-sub{ margin:8px 0 2px 7px; padding-left:17px; border-left:1px solid var(--line); display:grid; gap:2px; }
.sub{ display:flex; align-items:center; gap:10px; padding:5px 0; }
.sub .t{ font-size:12.5px; color:var(--fg-2); line-height:1.55; letter-spacing:.005em; }
.sub-done .t{ color:var(--faint); text-decoration:line-through; text-decoration-color:var(--line-2); }
.msd-h{ font-size:9.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--faint);
  margin:8px 0 2px; padding:3px 0; }
.msd-h.ov-click:hover{ color:var(--dim); }
.tn-sec{ margin-bottom:14px; }
.tn-sec:last-child{ margin-bottom:0; }
.tn-sh{
  display:flex; align-items:center; gap:8px;
  font-size:9.5px; font-weight:700; letter-spacing:.13em; text-transform:uppercase;
  color:var(--dim); margin:0 0 4px;
}
.tn-sh .tn-shc{ font-size:10px; color:var(--faint); font-weight:600; letter-spacing:0; }
.sec-over  .tn-sh{ color:var(--red); }
.sec-block .tn-sh{ color:var(--amber); }
.tn-sh::before{ content:""; width:7px; height:7px; border-radius:50%; flex:none;
  background:currentColor; opacity:.85; }
.tn-row{ display:flex; align-items:center; gap:10px; padding:6px 0;
  border-bottom:1px dotted var(--line); }
.tn-row:last-child{ border-bottom:0; }
.tn-t{ font-size:12.5px; color:var(--fg-2); line-height:1.5; letter-spacing:.005em; }
.tn-meta{ margin-left:auto; flex:none; font-size:10.5px; color:var(--faint);
  font-variant-numeric:tabular-nums; white-space:nowrap; }
.sec-over  .tn-meta{ color:var(--red); }
.sec-block .tn-meta{ color:var(--amber); }
.tn-done .tn-t{ color:var(--faint); text-decoration:line-through; text-decoration-color:var(--line-2); }
.src-tag{ flex:none; font-size:9px; font-weight:600; letter-spacing:.1em; text-transform:uppercase;
  color:var(--dim); border:1px solid var(--line-2); padding:2px 7px; border-radius:5px; margin-left:12px; }
/* Changelog entries in the project overview: heading on its own full-width line above the body */
.cl-ov{ padding:7px 0; border-bottom:1px dotted var(--line); }
.cl-ov:last-child{ border-bottom:0; }
.cl-ov-h{ font-size:12px; color:var(--fg); font-weight:600; line-height:1.4; word-break:break-word; }
.cl-ov-b{ font-size:11px; color:var(--dim); margin-top:3px; line-height:1.45; word-break:break-word; }
`

const kanbanCSS = `
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
.kn-card.ro{ cursor:default; }
.kn-col-empty{ padding:10px 12px; color:var(--faint,#6c7682); font-size:11px; }
.kn-sprint-h{ font-size:9.5px; letter-spacing:.08em; text-transform:uppercase; font-weight:700;
  color:var(--amber,#d79921); padding:7px 2px 3px; margin-top:5px;
  border-top:1px solid var(--line-2,#1c2229); }
.kn-sprint-h:first-child{ margin-top:0; border-top:0; padding-top:2px; }
.kn-modal{ position:fixed; inset:0; background:rgba(0,0,0,.55); display:flex; align-items:center;
  justify-content:center; z-index:1000; }
.kn-modal-box{ background:var(--panel,#0b0d10); border:1px solid var(--line-2,#1c2229);
  border-radius:10px; width:min(820px,92vw); max-height:86vh; display:flex; flex-direction:column; }
.kn-modal-h{ display:flex; align-items:center; gap:10px; padding:11px 14px;
  border-bottom:1px solid var(--line-2,#1c2229); font-size:13px; }
.kn-modal-h b{ flex:1; color:oklch(0.83 0.11 215); }
.kn-modal-x{ background:none; border:0; color:var(--dim,#8a929c); cursor:pointer; font-size:14px; }
.kn-modal-body{ margin:0; padding:14px 18px; overflow:auto; font-size:12.5px; line-height:1.55;
  color:var(--fg,#d7dee5); word-break:break-word; }
.kn-md h2,.kn-md h3,.kn-md h4{ margin:14px 0 6px; font-weight:700; line-height:1.3; }
.kn-md h2{ font-size:15px; } .kn-md h3{ font-size:13.5px; }
.kn-md h4{ font-size:12.5px; color:var(--dim,#8a929c); }
.kn-md p{ margin:7px 0; }
.kn-md ul,.kn-md ol{ margin:7px 0; padding-left:20px; } .kn-md li{ margin:2px 0; }
.kn-md code{ background:var(--bg-grid,#0a0b0d); border:1px solid var(--line-2,#1c2229); border-radius:4px;
  padding:1px 5px; font-size:11.5px; }
.kn-md pre{ background:var(--bg-grid,#0a0b0d); border:1px solid var(--line-2,#1c2229); border-radius:7px;
  padding:10px 12px; overflow:auto; }
.kn-md pre code{ background:none; border:0; padding:0; }
.kn-md blockquote{ margin:7px 0; padding:2px 12px; border-left:3px solid var(--line-3,#2a313a);
  color:var(--dim,#8a929c); }
.kn-md hr{ border:0; border-top:1px solid var(--line-2,#1c2229); margin:12px 0; }
.kn-md a{ color:oklch(0.83 0.11 215); }
`

const contextCSS = `
.ctx-wrap{ max-width:920px; }
.ctx-sum-p{ color:var(--dim); font-size:14px; font-weight:500; }
.ctx-bar{ display:flex; width:100%; height:14px; border-radius:7px; overflow:hidden;
  background:var(--inset); border:1px solid var(--line); margin:12px 0 18px; }
.ctx-seg{ height:100%; display:block; min-width:1px; }
.ctx-seg-free{ background:repeating-linear-gradient(45deg,transparent,transparent 5px,var(--line) 5px,var(--line) 10px); flex:1 1 auto; }
.ctx-cats{ display:grid; gap:6px; }
.ctx-cat{ border:1px solid var(--line); border-radius:8px; background:var(--panel); overflow:hidden; }
.ctx-cat > summary{ list-style:none; cursor:pointer; display:flex; align-items:center; gap:9px;
  padding:9px 12px; user-select:none; font-size:12.5px; }
.ctx-cat > summary::-webkit-details-marker{ display:none; }
.ctx-cat > summary:hover{ background:var(--panel-2); }
.ctx-sw{ width:10px; height:10px; border-radius:3px; flex:0 0 auto; }
.ctx-sw-free{ background:var(--line-3); }
.ctx-l{ font-weight:600; color:var(--fg); }
.ctx-tag{ font-size:9px; text-transform:uppercase; letter-spacing:.06em; padding:1px 6px;
  border-radius:5px; font-weight:700; }
.ctx-tag.fix{ background:var(--panel-3); color:var(--dim); }
.ctx-tag.live{ background:color-mix(in oklch,var(--mag) 18%,transparent); color:var(--mag); }
.ctx-bar-mini{ flex:1 1 auto; height:5px; min-width:40px; background:var(--inset);
  border-radius:3px; overflow:hidden; margin:0 4px; }
.ctx-bar-mini i{ display:block; height:100%; }
.ctx-t{ font-size:11px; color:var(--fg-2); font-variant-numeric:tabular-nums; white-space:nowrap; }
.ctx-p{ font-size:10.5px; color:var(--faint); font-variant-numeric:tabular-nums; width:46px;
  text-align:right; white-space:nowrap; }
.ctx-body{ border-top:1px solid var(--line); padding:6px 12px 9px; display:grid; gap:3px; }
.ctx-item{ display:flex; align-items:baseline; gap:9px; font-size:11.5px; color:var(--fg-2);
  padding:2px 0; }
.ctx-in{ flex:0 0 auto; color:var(--fg); font-weight:500; }
.ctx-id{ flex:1 1 auto; color:var(--faint); font-size:10.5px; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
.ctx-it{ flex:0 0 auto; color:var(--cyan); font-variant-numeric:tabular-nums; }
.ctx-item.ctx-empty, .ctx-item.ctx-loading{ color:var(--faint); font-style:italic; }
.ctx-hookout{ margin:0; font-size:10.5px; line-height:1.55; color:var(--green); white-space:pre-wrap;
  word-break:break-word; max-height:340px; overflow:auto; background:var(--inset);
  border:1px solid var(--line-2); border-radius:6px; padding:9px 11px; }
.ctx-free{ display:flex; align-items:center; gap:9px; padding:9px 12px; border:1px dashed var(--line-2);
  border-radius:8px; font-size:12.5px; color:var(--dim); }
.ctx-free .ctx-l{ color:var(--dim); }
/* Readable memory items: collapsible file viewer inside context category */
details.ctx-readable{ border-top:1px solid var(--line-2); }
details.ctx-readable:first-child{ border-top:0; }
details.ctx-readable > summary{
  list-style:none; cursor:pointer; display:flex; align-items:baseline; gap:9px;
  font-size:11.5px; color:var(--fg-2); padding:2px 0; user-select:none;
}
details.ctx-readable > summary::-webkit-details-marker{ display:none; }
details.ctx-readable > summary:hover{ color:var(--fg); }
details.ctx-readable[open] > summary .ctx-in{ color:var(--cyan); }
.ctx-readable-body{ padding:6px 0 2px; }
/* Quell-Gruppen-Header innerhalb Skills/Agents (Project/User/Plugin/Built-in) */
.ctx-grp{ font-size:9.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--amber);
  padding:7px 0 3px; margin-top:4px; border-top:1px solid var(--line-2); user-select:none; }
.ctx-grp:first-child{ border-top:0; margin-top:0; padding-top:2px; }
`

// RenderOpts holds the inputs to RenderPage.
type RenderOpts struct {
	Cwd         string
	Context     map[string]any
	Sidebar     []collectors.SidebarProject
	Active      string
	View        string // "overview" | "project"
	InitialView string
	GeneratedAt string
	Loading     bool
}

// RenderPage renders the full single-page dashboard HTML (browser.js-compatible).
func RenderPage(opts RenderOpts, assets Assets) string {
	ctx := opts.Context
	if ctx == nil {
		ctx = map[string]any{"generated_at": "", "cwd": opts.Cwd, "projects": []any{}, "active_project": "", "cards": map[string]any{}}
	}
	view := opts.View
	if view == "" {
		if opts.Active != "" {
			view = "project"
		} else {
			view = "overview"
		}
	}
	data := appctx.BuildData(ctx, view)

	css := assets.DashCSS + "\n" + assets.BrowserCSS + "\n" + extraCSS + "\n" + headerCSS + "\n" +
		sidebarCSS + "\n" + projectCSS + "\n" + kanbanCSS + "\n" + contextCSS
	dataJson := SafeScriptJson(data)

	active := ""
	if view == "project" {
		active = opts.Active
	}
	sb := opts.Sidebar
	ov, _ := data["overview"].(map[string]any)
	if ov == nil {
		ov = map[string]any{}
	}

	projChips := func(openCount, tnCount int, cost float64, isActive bool) string {
		parts := []string{}
		if openCount > 0 || isActive {
			parts = append(parts, `<span class="ch open">`+itoa(openCount)+` offen</span>`)
		}
		if tnCount > 0 {
			parts = append(parts, `<span class="ch tn">`+itoa(tnCount)+` tn</span>`)
		}
		if cost > 0 {
			parts = append(parts, `<span class="ch cost">`+escape(appctx.FmtCost(cost))+`</span>`)
		}
		return strings.Join(parts, "")
	}

	// counts for active project come from buildData overview (live), else sidebar.
	counts := func(p collectors.SidebarProject, isActive bool) (int, int) {
		openCount, tnCount := p.OpenTasksCount, p.Tn
		if isActive {
			if v, ok := ov["backlog_open"]; ok && v != nil {
				openCount = toInt(v)
			}
			if v, ok := ov["tn_open"]; ok && v != nil {
				tnCount = toInt(v)
			}
		}
		return openCount, tnCount
	}

	var projRows strings.Builder
	for _, p := range sb {
		isActive := view == "project" && p.Name == active
		openCount, tnCount := counts(p, isActive)
		hasActivity := openCount > 0 || tnCount > 0 || p.Cost7d > 0 || isActive
		cls := ""
		if isActive {
			cls = " is-active"
		} else if !hasActivity {
			cls = " muted"
		}
		q := encodeURIComponent(p.Name)
		projRows.WriteString(`<a class="proj-i` + cls + `" href="/` + q + `" title="` + escape(p.Path) + `"`)
		if !hasActivity {
			projRows.WriteString(" hidden")
		}
		projRows.WriteString(`>` +
			`<span class="pn">` + escape(p.Name) + `</span>` +
			`<span class="proj-chips">` + projChips(openCount, tnCount, p.Cost7d, isActive) + `</span>` +
			`</a>`)
	}

	quietCount := 0
	for _, p := range sb {
		isActive := view == "project" && p.Name == active
		if !isActive && p.OpenTasksCount == 0 && p.Tn == 0 && p.Cost7d == 0 {
			quietCount++
		}
	}
	quietToggle := ""
	if quietCount > 0 {
		quietToggle = `<div class="proj-more">+ <b id="kn-show-quiet">` + itoa(quietCount) + ` ohne Aktivität</b></div>`
	}

	var projRowsAccordion strings.Builder
	for _, p := range sb {
		isActive := view == "project" && p.Name == active
		openCount, tnCount := counts(p, isActive)
		hasActivity := openCount > 0 || tnCount > 0 || p.Cost7d > 0 || isActive
		chev := "▸"
		if isActive {
			chev = "▾"
		}
		cls := ""
		if isActive {
			cls = " is-active"
		} else if !hasActivity {
			cls = " muted"
		}
		q := encodeURIComponent(p.Name)
		if isActive {
			projRowsAccordion.WriteString(
				`<div class="proj-i` + cls + `" id="kn-proj-active" title="` + escape(p.Path) + `">` +
					`<span class="proj-chev">` + chev + `</span>` +
					`<span class="pn">` + escape(p.Name) + `</span>` +
					`<span class="proj-chips">` + projChips(openCount, tnCount, p.Cost7d, isActive) + `</span>` +
					`</div>` +
					`<div class="proj-sub"><nav id="mp-nav"></nav></div>`)
			continue
		}
		projRowsAccordion.WriteString(`<a class="proj-i` + cls + `" href="/` + q + `" title="` + escape(p.Path) + `"`)
		if !hasActivity {
			projRowsAccordion.WriteString(" hidden")
		}
		projRowsAccordion.WriteString(`>` +
			`<span class="proj-chev">` + chev + `</span>` +
			`<span class="pn">` + escape(p.Name) + `</span>` +
			`<span class="proj-chips">` + projChips(openCount, tnCount, p.Cost7d, isActive) + `</span>` +
			`</a>`)
	}

	var sidebarHtml string
	if view == "overview" {
		sidebarHtml = `<aside class="pane-side" id="kn-sidebar">` +
			`<div class="proj-sub"><nav id="mp-nav"></nav></div>` +
			`<div class="proj-list">` +
			`<div class="proj-list-hd">Projekte</div>` +
			projRows.String() +
			quietToggle +
			`</div>` +
			`</aside>`
	} else {
		sidebarHtml = `<aside class="pane-side" id="kn-sidebar">` +
			`<div class="proj-list">` +
			`<a class="proj-ov" href="/">Überblick · alle Projekte</a>` +
			`<div class="proj-list-hd">Projekte</div>` +
			projRowsAccordion.String() +
			quietToggle +
			`</div>` +
			`</aside>`
	}

	sumOpen, sumTn := 0, 0
	var sumCost float64
	for _, p := range sb {
		sumOpen += p.OpenTasksCount
		sumCost += p.Cost7d
		sumTn += p.Tn
	}

	standSrc := opts.GeneratedAt
	if standSrc == "" {
		if meta, ok := data["meta"].(map[string]any); ok {
			standSrc = asString(meta["generated_at"])
		}
	}
	stand := escape(standSrc)

	crumbHere := "Überblick"
	crumbScope := "· alle Projekte · global"
	if view != "overview" {
		crumbHere = escape(active)
		crumbScope = "· Projekt"
	}

	header := `<header class="hd">` +
		`<nav class="crumb">` +
		`<span class="root">knowledge</span>` +
		`<span class="sep">/</span>` +
		`<span class="here" id="crumb-here">` + crumbHere + `</span>` +
		`<span class="scope" id="crumb-scope">` + crumbScope + `</span>` +
		`</nav>` +
		`<span class="sp"></span>` +
		`<div class="stats">` +
		`<div class="stat"><span class="sv">` + itoa(len(sb)) + `</span><span class="sl">Projekte</span></div>` +
		`<div class="stat"><span class="sv a">` + itoa(sumOpen) + `</span><span class="sl">offen</span></div>` +
		`<div class="stat"><span class="sv c">` + itoa(sumTn) + `</span><span class="sl">tn-Tasks</span></div>` +
		`<div class="stat"><span class="sv g">≈` + escape(appctx.FmtCost(sumCost)) + `</span><span class="sl">7 Tage</span></div>` +
		`</div>` +
		`<span class="asof">Stand ` + stand + `</span>` +
		`<button class="tg" id="kn-theme-toggle" type="button" aria-label="Theme wechseln">◐</button>` +
		`</header>`

	themeInit := "<script>(function(){try{var t=localStorage.getItem('kn-theme');" +
		"if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}" +
		"catch(e){}})();</script>"

	quietScript := ""
	if quietCount > 0 {
		quietScript = "<script>(function(){var b=document.getElementById('kn-show-quiet');" +
			"if(!b)return;" +
			"b.addEventListener('click',function(){" +
			"var rows=document.querySelectorAll('.proj-i[hidden]');" +
			"[].forEach.call(rows,function(r){r.removeAttribute('hidden');r.classList.add('muted');});" +
			"b.closest('.proj-more').remove();});})();</script>"
	}

	accordionScript := ""
	if view == "project" {
		accordionScript = "<script>(function(){var row=document.getElementById('kn-proj-active');" +
			"if(!row)return;" +
			"row.addEventListener('click',function(){" +
			"var sub=row.nextElementSibling;" +
			"if(!sub||!sub.classList.contains('proj-sub'))return;" +
			"var open=sub.style.display!=='none';" +
			"sub.style.display=open?'none':'';" +
			"var chev=row.querySelector('.proj-chev');" +
			"if(chev)chev.textContent=open?'▸':'▾';" +
			"});})();</script>"
	}

	initialViewScript := ""
	if opts.InitialView != "" {
		initialViewScript = "<script>window.INITIAL_VIEW = " + SafeScriptJson(opts.InitialView) + ";</script>"
	}

	return "<!DOCTYPE html>\n" +
		`<html lang="de"><head><meta charset="utf-8">` +
		`<meta name="viewport" content="width=device-width, initial-scale=1">` +
		`<title>knowledge — Browser</title>` +
		themeInit +
		`<style>` + css + `</style></head><body>` +
		`<div class="kn-shell">` +
		header +
		`<div class="kn-body">` +
		sidebarHtml +
		`<div class='mp' id='mp'>` +
		`<div class='mp-list' id='mp-list'></div>` +
		`<div class='mp-detail' id='mp-detail'></div></div>` +
		`</div>` +
		`</div>` +
		`<script>window.DATA = ` + dataJson + `;</script>` +
		initialViewScript +
		`<script>` + assets.BrowserJS + `</script>` +
		quietScript +
		accordionScript +
		`</body></html>`
}

func itoa(n int) string {
	return strconv.Itoa(n)
}
