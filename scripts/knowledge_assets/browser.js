/* ============================================================
   knowledge browser — controller (vanilla, no deps)
   Adapted from the Claude Design handoff "knowledge Browser.html":
   instead of hardcoded constants it reads window.DATA, which
   knowledge.py emits from its collectors. Extra sections vs. the
   original mock: Git (status + gated POST action forms) and Cost.
   ============================================================ */
(function () {
  "use strict";

  var DATA = window.DATA || {};
  var COLL = DATA.coll || {};
  var NAV = DATA.nav || [];
  var OV = DATA.overview || {};
  var GIT = DATA.git || null;
  var COST = DATA.cost || null;

  /* ---------- helpers ---------- */
  function el(html) { var t = document.createElement("template"); t.innerHTML = String(html).trim(); return t.content.firstChild; }
  function de(n) { try { return Number(n).toLocaleString("de-DE"); } catch (e) { return String(n); } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function dotStyle(d) { return d === "m" ? ' style="background:var(--mag)"' : ""; }
  function dotCls(d) { return d && d !== "m" ? " " + d : ""; }
  var STATUS = {
    "accepted": ["g", "accepted"], "in progress": ["c", "in progress"],
    "in-progress": ["c", "in progress"], "to do": ["a", "to do"], "todo": ["a", "to do"],
    "done": ["g", "done"], "superseded": ["", "superseded"], "blocked": ["r", "blocked"]
  };
  function statusPair(s) { return STATUS[String(s || "").toLowerCase()] || ["", String(s || "")]; }

  var nav = document.getElementById("mp-nav");
  var list = document.getElementById("mp-list");
  var detail = document.getElementById("mp-detail");
  var mp = document.getElementById("mp");
  var state = { coll: null, idx: 0 };

  var SPECIAL = { ov: 1, git: 1, cost: 1 };

  /* ---------- nav ---------- */
  NAV.forEach(function (grp) {
    nav.appendChild(el('<div class="nav-g">' + esc(grp.g) + "</div>"));
    (grp.items || []).forEach(function (it) {
      var c;
      if (it.id === "ov") c = "grid";
      else if (it.id === "git") c = "status";
      else if (it.id === "cost") c = "$";
      else c = COLL[it.id] ? COLL[it.id].items.length : 0;
      var row = el(
        '<div class="nav-i" data-id="' + esc(it.id) + '">' +
          '<span class="dot' + dotCls(it.dot) + '"' + dotStyle(it.dot) + "></span>" +
          '<span class="nn">' + esc(it.label) + "</span>" +
          '<span class="nc">' + esc(c) + "</span>" +
        "</div>"
      );
      row.addEventListener("click", function () { select(it.id); });
      nav.appendChild(row);
    });
  });

  /* ---------- select a nav entry ---------- */
  function select(id) {
    [].forEach.call(nav.querySelectorAll(".nav-i"), function (n) {
      n.classList.toggle("is-active", n.dataset.id === id);
    });
    if (SPECIAL[id]) {
      mp.classList.add("is-overview");
      if (id === "ov") renderOverview();
      else if (id === "git") renderGit();
      else if (id === "cost") renderCost();
      return;
    }
    mp.classList.remove("is-overview");
    state.coll = id; state.idx = 0;
    renderList(""); selectItem(0);
  }

  /* ---------- list (col 2) ---------- */
  function renderList(q) {
    var c = COLL[state.coll];
    if (!c) { list.innerHTML = ""; return; }
    var rows = c.items.map(function (it, i) { return { it: it, i: i }; });
    if (q) {
      var ql = q.toLowerCase();
      rows = rows.filter(function (r) {
        return (r.it.name + " " + (r.it.cat || r.it.role || r.it.type || "")).toLowerCase().indexOf(ql) > -1;
      });
    }
    list.innerHTML = "";
    var head = el(
      '<div class="list-head">' +
        '<div class="lt"><b>' + esc(c.title) + '</b><span class="lc">' + c.items.length + "</span>" +
          '<span class="ls">scope: ' + esc(c.scope) + "</span></div>" +
        '<label class="filter"><span>/</span><input type="text" placeholder="filter…" autocomplete="off"></label>' +
      "</div>"
    );
    list.appendChild(head);
    var inp = head.querySelector("input");
    inp.value = q || "";
    inp.addEventListener("input", function () {
      renderList(this.value);
      var f = list.querySelector("input"); f.focus();
      f.setSelectionRange(this.value.length, this.value.length);
    });

    if (!rows.length) { list.appendChild(el('<div class="li-empty">keine Treffer</div>')); return; }
    rows.forEach(function (r) {
      var sub = r.it.cat || r.it.role || r.it.type || r.it.scope || "";
      var lead = c.type === "decision"
        ? '<span class="li-ix">' + esc(r.it.id) + "</span>"
        : '<span class="dot li-dot' + dotCls(c.accent) + '"' + dotStyle(c.accent) + "></span>";
      var nm = c.type === "decision" ? String(r.it.name).replace(/^\d+\s—\s/, "") : r.it.name;
      var row = el(
        '<div class="li" data-i="' + r.i + '">' + lead +
          '<div><div class="li-n">' + esc(nm) + "</div>" +
          (sub ? '<div class="li-s">' + esc(sub) + "</div>" : "") + "</div>" +
        "</div>"
      );
      row.addEventListener("click", function () { selectItem(r.i); });
      list.appendChild(row);
    });
    var has = rows.some(function (r) { return r.i === state.idx; });
    if (!has && rows.length) { selectItem(rows[0].i); } else { markActive(); }
  }

  function markActive() {
    [].forEach.call(list.querySelectorAll(".li"), function (n) {
      n.classList.toggle("is-active", +n.dataset.i === state.idx);
    });
  }

  function selectItem(i) { state.idx = i; markActive(); renderDetail(COLL[state.coll], COLL[state.coll].items[i]); }

  /* ---------- detail (col 3) ---------- */
  function badge(cls, txt) { return '<span class="badge ' + cls + '">' + esc(txt) + "</span>"; }
  function metaCell(l, v) { return '<div class="mc"><div class="ml">' + esc(l) + '</div><div class="mv">' + v + "</div></div>"; }

  function renderDetail(c, it) {
    if (!it) { detail.innerHTML = '<div class="dt dt-empty">nichts ausgewählt</div>'; return; }
    // desc = raw text (escaped at render); descHtml = trusted markup built here.
    var b = [], meta = [], secs = [], eyebrow = c.title, desc = it.desc || "", descHtml = "";

    if (c.type === "skill") {
      b.push(badge("g", "scope: " + c.scope)); if (it.cat) b.push(badge("", it.cat));
      meta.push(metaCell("Scope", esc(c.scope)));
      if (it.cat) meta.push(metaCell("Kategorie", esc(it.cat)));
      meta.push(metaCell("Quelle", "<code>~/.claude/skills</code>"));
    } else if (c.type === "agent") {
      b.push(badge("c", "agent")); b.push(badge("", c.scope));
      if (it.role) meta.push(metaCell("Rolle", esc(it.role)));
      meta.push(metaCell("Tools", (it.tools || []).length));
      if ((it.tools || []).length) secs.push({ h: "Tools", html: '<div class="tags">' + it.tools.map(function (t) { return '<span class="tag c">' + esc(t) + "</span>"; }).join("") + "</div>" });
      descHtml = it.role ? esc(it.role) + "." : ""; desc = "";
    } else if (c.type === "hook") {
      b.push(badge("", "event")); b.push(badge((it.count || 0) > 2 ? "a" : "g", (it.count || 0) + " hook(s)"));
      meta.push(metaCell("Event", "<code>" + esc(it.name) + "</code>")); meta.push(metaCell("Hooks", it.count || 0));
      descHtml = "Hook-Event <code>" + esc(it.name) + "</code> mit " + (it.count || 0) + " registrierten Script(s). Befehle sind aus Sicherheitsgründen redacted."; desc = "";
    } else if (c.type === "setting") {
      b.push(badge("c", it.scope || ""));
      meta.push(metaCell("Key", "<code>" + esc(it.name) + "</code>"));
      if (it.scope) meta.push(metaCell("Scope", esc(it.scope)));
    } else if (c.type === "know") {
      b.push(badge("c", "knowledge/")); if (it.type) b.push(badge("", it.type));
      if (it.type) meta.push(metaCell("Typ", esc(it.type)));
      meta.push(metaCell("Pfad", "<code>knowledge/</code>"));
    } else if (c.type === "decision") {
      var st = statusPair(it.status); b.push(badge(st[0], st[1])); b.push(badge("", "ADR " + esc(it.id)));
      meta.push(metaCell("ID", esc(it.id))); meta.push(metaCell("Status", st[1]));
      if (it.ctx) secs.push({ h: "Kontext", html: '<div class="prose">' + esc(it.ctx) + "</div>" });
      if (it.dec) secs.push({ h: "Entscheidung", html: '<div class="prose">' + esc(it.dec) + "</div>" });
      desc = "";
    } else if (c.type === "task") {
      var ts = statusPair(it.status); b.push(badge(ts[0], ts[1]));
      if (it.milestone && it.milestone !== "—") b.push(badge("", it.milestone));
      meta.push(metaCell("ID", "<code>" + esc(it.name) + "</code>")); meta.push(metaCell("Status", ts[1]));
      if (it.milestone) meta.push(metaCell("Milestone", esc(it.milestone)));
    } else if (c.type === "session") {
      b.push(badge("", c.scope)); b.push(badge("", (it.turns || 0) + " turns"));
      var tot = (it.input || 0) + (it.output || 0) + (it.cc || 0) + (it.cr || 0);
      var mx = Math.max(it.input || 0, it.output || 0, it.cc || 0, it.cr || 0, 1);
      function bar(l, v, col) {
        return '<div class="row"><span class="tl">' + l + '</span><span class="track"><i style="width:' +
          Math.max(0.4, (v || 0) / mx * 100) + "%;background:" + col + '"></i></span><span class="tv">' + de(v || 0) + "</span></div>";
      }
      secs.push({ h: "Token-Verteilung", html: '<div class="tbar">' +
        bar("Input", it.input, "var(--cyan)") + bar("Output", it.output, "var(--green)") +
        bar("Cache create", it.cc, "var(--amber)") + bar("Cache read", it.cr, "var(--mag)") + "</div>" });
      meta.push(metaCell("Session", "<code>" + esc(it.name) + "</code>")); meta.push(metaCell("Turns", it.turns || 0)); meta.push(metaCell("Total", de(tot)));
      desc = "";
    } else {
      b.push(badge(c.accent || "", c.title.toLowerCase()));
      if (c.type === "lesson" && it.desc) { secs.push({ h: "Lektion", html: '<div class="prose">' + esc(it.desc) + "</div>" }); desc = ""; }
    }

    var title = c.type === "decision" ? String(it.name).replace(/^\d+\s—\s/, "") : it.name;
    detail.innerHTML = '<div class="dt">' +
      '<div class="dt-eyebrow">' + esc(eyebrow) + "</div>" +
      '<h2><span class="mono">' + esc(title) + "</span></h2>" +
      (b.length ? '<div class="dt-badges">' + b.join("") + "</div>" : "") +
      (descHtml ? '<p class="dt-desc">' + descHtml + "</p>"
        : (desc ? '<p class="dt-desc">' + esc(desc) + "</p>" : "")) +
      (meta.length ? '<div class="dt-meta">' + meta.join("") + "</div>" : "") +
      secs.map(function (s) { return '<div class="dt-sec"><div class="sh">' + esc(s.h) + "</div>" + s.html + "</div>"; }).join("") +
    "</div>";
  }

  /* ---------- Git (status + gated POST action forms) ---------- */
  function renderGit() {
    if (!GIT || GIT.available === false) {
      detail.innerHTML = '<div class="dt dt-empty">Git nicht verfügbar' + (GIT && GIT.reason ? ": " + esc(GIT.reason) : "") + "</div>";
      return;
    }
    var br = esc(GIT.branch || "?");
    var sync = [];
    if (GIT.ahead_origin != null) sync.push("↑" + GIT.ahead_origin + "/↓" + (GIT.behind_origin || 0) + " origin");
    if (GIT.ahead_main != null) sync.push("↑" + GIT.ahead_main + " main");
    var meta = [
      metaCell("Branch", '<code>' + br + "</code>" + (sync.length ? " " + esc(sync.join(" · ")) : "")),
      metaCell("Status", "staged " + (GIT.staged || 0) + " · unstaged " + (GIT.unstaged || 0) + " · untracked " + (GIT.untracked || 0)),
      metaCell("Branches", (GIT.branches || []).length)
    ];
    if (GIT.shortstat) meta.push(metaCell("Diff vs HEAD", esc(GIT.shortstat)));

    var branchTags = '<div class="tags">' + (GIT.branches || []).map(function (b2) {
      return '<span class="tag' + (b2 === GIT.branch ? " g" : "") + '">' + esc(b2) + "</span>";
    }).join("") + "</div>";

    var forms =
      '<div class="gitforms">' +
        '<form class="gf" method="post" action="/action/commit">' +
          '<input name="message" placeholder="commit message" required>' +
          '<button type="submit">Commit rest (lokal)</button></form>' +
        '<form class="gf" method="post" action="/action/push">' +
          '<input type="hidden" name="branch" value="' + br + '">' +
          '<input name="confirm" placeholder="tippe PUSH" autocomplete="off">' +
          '<button type="submit" class="danger">Push → origin/' + br + '</button>' +
          '<span class="gn">nach Review!</span></form>' +
        '<form class="gf" method="post" action="/action/merge">' +
          '<input name="branch" value="' + br + '">' +
          '<input name="confirm" placeholder="tippe MERGE" autocomplete="off">' +
          '<button type="submit" class="danger">Merge → main</button>' +
          '<span class="gn">nach Review!</span></form>' +
        '<form class="gf" method="post" action="/action/delete" onsubmit="return confirm(\'Branch wirklich löschen?\')">' +
          '<input name="branch" placeholder="branch">' +
          '<input name="confirm" placeholder="Branch-Name zur Bestätigung" autocomplete="off">' +
          '<button type="submit">Delete branch (-d)</button></form>' +
      "</div>";

    detail.innerHTML = '<div class="dt">' +
      '<div class="dt-eyebrow">Git</div>' +
      '<h2><span class="mono">' + br + "</span></h2>" +
      '<div class="dt-meta">' + meta.join("") + "</div>" +
      '<div class="dt-sec"><div class="sh">Empfohlen</div><div class="prose">' + esc(GIT.recommend || "") + "</div></div>" +
      '<div class="dt-sec"><div class="sh">Branches <span class="ct">' + (GIT.branches || []).length + "</span></div>" + branchTags + "</div>" +
      '<div class="dt-sec"><div class="sh">Actions <span class="ct">localhost · push/merge brauchen Tipp-Token</span></div>' + forms + "</div>" +
    "</div>";
  }

  /* ---------- Cost (account-wide $) ---------- */
  function renderCost() {
    if (!COST || COST.available === false) {
      detail.innerHTML = '<div class="dt dt-empty">Kosten nicht verfügbar' + (COST && COST.reason ? ": " + esc(COST.reason) : "") + "</div>";
      return;
    }
    function fmt(v) { v = Number(v || 0); return v >= 1000 ? "$" + (v / 1000).toFixed(2) + "k" : "$" + v.toFixed(2); }
    var meta = [
      metaCell("Heute", fmt(COST.today)), metaCell("Gestern", fmt(COST.yesterday)),
      metaCell("Woche (seit Fr)", fmt(COST.week)), metaCell("Monat", fmt(COST.month)),
      metaCell("Total", fmt(COST.total))
    ];
    var secs = "";
    [["5h-Limit", COST.five_hour], ["7d-Limit", COST.seven_day]].forEach(function (p) {
      var rl = p[1];
      var body = rl
        ? '<div class="kv"><span class="kk">Used → Prognose</span><span class="vv">' + esc(rl.used_pct) + "% → " + esc(rl.projected_pct) + '%</span></div>' +
          '<div class="prog"><i style="width:' + Math.max(0, Math.min(100, Number(rl.used_pct) || 0)) + '%"></i></div>' +
          '<div class="kv"><span class="kk">Reset in</span><span class="vv">' + esc(rl.resets_in) + " · " + esc(rl.elapsed_pct) + '% Zeit</span></div>'
        : '<div class="dt-empty">n/a</div>';
      secs += '<div class="dt-sec"><div class="sh">' + p[0] + "</div>" + body + "</div>";
    });
    detail.innerHTML = '<div class="dt">' +
      '<div class="dt-eyebrow">Usage · Kosten (account-weit)</div>' +
      '<h2><span class="mono">' + fmt(COST.total) + "</span></h2>" +
      '<p class="dt-desc">Echte $ über alle Maschinen (ccusage). Quelle wie claude-watch-tui.py — nicht repo-scoped.</p>' +
      '<div class="dt-meta">' + meta.join("") + "</div>" + secs +
    "</div>";
  }

  /* ---------- overview (tmux grid) ---------- */
  function ovTile(go, dot, title, body) {
    return '<div class="pane w3 link" data-go="' + go + '"><div class="p-head"><span class="dot' + dotCls(dot) + '"' +
      dotStyle(dot) + '></span><span class="pt">' + esc(title) + '</span><span class="sp"></span></div>' + body + "</div>";
  }
  function renderOverview() {
    var grid =
      ovTile("skills", "g", "Global",
        '<div class="duo"><div class="n" style="color:var(--green)">' + (OV.skills || 0) + '<small>Skills</small></div>' +
        '<div class="n" style="color:var(--cyan)">' + (OV.agents || 0) + '<small>Agents</small></div>' +
        '<div class="n">' + (OV.hooks || 0) + '<small>Hooks</small></div></div>') +
      ovTile("git", "g", "Git",
        '<div class="scan" style="color:var(--green)">' + esc(OV.branch || "?") +
        '<small> · ' + (OV.dirty ? "dirty" : "clean") + "</small></div>" +
        '<div style="margin-top:9px;color:var(--dim);font-size:11px">' + esc(OV.git_recommend || "") + "</div>") +
      ovTile("backlog", "a", "Backlog",
        '<div class="scan" style="color:var(--amber)">' + (OV.backlog_inprogress || 0) + '<small> in progress</small></div>' +
        '<div style="margin-top:9px">' + (OV.milestones || []).map(function (m) { return '<span class="badge a">' + esc(m) + "</span> "; }).join("") + "</div>") +
      ovTile("cost", "m", "Kosten · 7d",
        '<div class="scan" style="color:var(--mag)">' + esc(OV.cost_week || "$0") + '<small> Woche</small></div>' +
        '<div style="margin-top:9px;color:var(--dim);font-size:11px">heute ' + esc(OV.cost_today || "$0") + " · total " + esc(OV.cost_total || "$0") + "</div>") +
      ovTile("decisions", "g", "Decisions",
        '<ul class="list">' + (OV.decisions || []).map(function (d) {
          return '<li><span class="ix">' + esc(d.id) + '</span><span class="tx">' + esc(d.title) + "</span></li>";
        }).join("") + "</ul>") +
      ovTile("sessions", "m", "Tokens",
        '<div class="scan" style="color:var(--mag)">' + esc(OV.tok_last || "—") + '<small> letzte Session</small></div>' +
        '<div style="margin-top:9px;color:var(--dim);font-size:11px">7-Tage: ' + esc(OV.tok_week || "—") + "</div>");
    detail.innerHTML =
      '<div class="ov-wrap"><div class="ov-head"><h2>Übersicht</h2><span class="dc">' + esc(OV.subtitle || "") + "</span>" +
      '<span class="hint">Kachel anklicken → <b>Sektion</b></span></div>' +
      '<div class="panes" style="grid-auto-rows:min-content">' + grid + "</div></div>";
    [].forEach.call(detail.querySelectorAll("[data-go]"), function (t) {
      t.addEventListener("click", function () { select(t.dataset.go); });
    });
  }

  /* ---------- keyboard nav within list ---------- */
  document.addEventListener("keydown", function (e) {
    if (mp.classList.contains("is-overview")) return;
    if (e.target.tagName === "INPUT") return;
    if (!state.coll || !COLL[state.coll]) return;
    var n = COLL[state.coll].items.length;
    if (e.key === "ArrowDown") { e.preventDefault(); selectItem(Math.min(n - 1, state.idx + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); selectItem(Math.max(0, state.idx - 1)); }
  });

  /* boot — land on the overview grid */
  select("ov");
})();
