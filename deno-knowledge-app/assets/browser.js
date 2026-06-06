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
  var ACTIVE = DATA.active_project || "";  // current project — threaded into all sub-requests

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
  function ktok(n) { n = Number(n) || 0; return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(Math.round(n)); }
  function extractScript(cmd) {
    var m = String(cmd || "").match(/(\/?[^\s'"]+\.(?:py|sh|bash|zsh|js|mjs|cjs|ts|rb|pl|lua))/);
    return m ? m[1] : null;
  }
  function statusFromXY(xy) {
    var c = String(xy || "");
    if (c.indexOf("D") >= 0) return ["r", "gelöscht"];
    if (c.indexOf("R") >= 0) return ["c", "umbenannt"];
    if (c.indexOf("A") >= 0) return ["g", "staged"];
    if (c.indexOf("M") >= 0) return ["c", "geändert"];
    return ["", c.trim() || "?"];
  }

  function qs(params) {
    return Object.keys(params || {}).filter(function (k) { return params[k] != null && params[k] !== ""; })
      .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); }).join("&");
  }

  /* fetch a whitelisted file (/read) and inject it escaped into `host` */
  function loadFile(kind, params, host) {
    host.innerHTML = '<div class="filebody loading">lädt…</div>';
    fetch("/read?" + qs(Object.assign({ kind: kind, project: ACTIVE }, params || {}))).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) { host.innerHTML = '<div class="dt-empty">konnte nicht laden' + (d && d.error ? ": " + esc(d.error) : "") + "</div>"; return; }
      var mtimeSeg = d.mtime ? " · geändert " + esc(d.mtime) : "";
      var head = '<div class="fmeta">~' + ktok(d.tokens) + " tok · " + de(d.size) + " B" + mtimeSeg + "</div>";
      var note = d.truncated ? '<div class="ftrunc">… gekürzt auf 60k Zeichen</div>' : "";
      host.innerHTML = head + '<pre class="filebody">' + esc(d.content) + "</pre>" + note;
    }).catch(function (e) { host.innerHTML = '<div class="dt-empty">Fehler: ' + esc(String(e)) + "</div>"; });
  }

  /* parse a unified diff into aligned side-by-side rows (left = HEAD, right = working) */
  function splitDiffRows(diff) {
    var rows = [], rem = [], add = [], ln = 0, rn = 0;
    function flush() {
      var n = Math.max(rem.length, add.length);
      for (var k = 0; k < n; k++) {
        var L = rem[k], R = add[k];
        rows.push({
          ltype: L ? "dm" : "empty", ln: L ? L.n : "", ltext: L ? L.t : "",
          rtype: R ? "dp" : "empty", rn: R ? R.n : "", rtext: R ? R.t : ""
        });
      }
      rem = []; add = [];
    }
    String(diff).split("\n").forEach(function (line) {
      if (/^@@/.test(line)) {
        flush();
        var m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (m) { ln = parseInt(m[1], 10); rn = parseInt(m[2], 10); }
        rows.push({ hunk: line });
        return;
      }
      if (/^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode|Binary )/.test(line)) return;
      var c = line.charAt(0);
      if (c === "-") rem.push({ n: ln++, t: line.slice(1) });
      else if (c === "+") add.push({ n: rn++, t: line.slice(1) });
      else { flush(); var t = c === " " ? line.slice(1) : line; rows.push({ ltype: "ctx", ln: ln++, ltext: t, rtype: "ctx", rn: rn++, rtext: t }); }
    });
    flush();
    return rows;
  }
  function renderSplitDiff(diff) {
    var rows = splitDiffRows(diff);
    if (!rows.length || (rows.length === 1 && !rows[0].hunk && !rows[0].ltext && !rows[0].rtext))
      return '<div class="dt-empty">(keine Änderungen)</div>';
    var body = rows.map(function (r) {
      if (r.hunk) return '<div class="sd-hunk">' + esc(r.hunk) + "</div>";
      return '<div class="sd-row">' +
        '<div class="sd-ln">' + (r.ln || "") + "</div>" +
        '<div class="sd-code ' + r.ltype + '">' + esc(r.ltext) + "</div>" +
        '<div class="sd-ln">' + (r.rn || "") + "</div>" +
        '<div class="sd-code ' + r.rtype + '">' + esc(r.rtext) + "</div></div>";
    }).join("");
    return '<div class="splitdiff">' +
      '<div class="sd-headrow"><div class="sd-h">aktuell · HEAD</div><div class="sd-h">Änderungen · Arbeitsbaum</div></div>' +
      body + "</div>";
  }

  /* fetch a read-only git diff and render it side-by-side into `host` */
  function loadDiff(path, host) {
    host.innerHTML = '<div class="filebody loading">lädt…</div>';
    fetch("/gitdiff?" + qs({ path: path, project: ACTIVE })).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) { host.innerHTML = '<div class="dt-empty">Diff fehlgeschlagen' + (d && d.error ? ": " + esc(d.error) : "") + "</div>"; return; }
      var note = d.truncated ? '<div class="ftrunc">… gekürzt auf 200k Zeichen</div>' : "";
      host.innerHTML = renderSplitDiff(d.diff) + note;
    }).catch(function (e) { host.innerHTML = '<div class="dt-empty">Fehler: ' + esc(String(e)) + "</div>"; });
  }

  var nav = document.getElementById("mp-nav");
  var list = document.getElementById("mp-list");
  var detail = document.getElementById("mp-detail");
  var mp = document.getElementById("mp");
  var state = { coll: null, idx: 0 };

  // suppressPush: set to true during boot replaceState and popstate handler so
  // select() does not push an extra history entry in those cases (CCS-034).
  var suppressPush = false;

  /** Map a view ID to the canonical path for history.pushState (CCS-034).
   *  - With active project: /<project>[/<view>] (omit /ov as that is the default)
   *  - Without active project (overview): always "/" (overview sub-views stay at /)
   */
  function viewToPath(id) {
    if (!ACTIVE) return "/";
    var base = "/" + encodeURIComponent(ACTIVE);
    return (id && id !== "ov") ? base + "/" + encodeURIComponent(id) : base;
  }

  // Breadcrumb elements (may be null in server_test minimal HTML)
  var crumbHere  = document.getElementById("crumb-here");
  var crumbScope = document.getElementById("crumb-scope");
  function setCrumb(here, scope) {
    if (crumbHere)  crumbHere.textContent  = here;
    if (crumbScope) crumbScope.textContent = scope;
  }

  // Bullet-journal minimal status glyphs (open/wip/done — no deleg)
  function statusIcon(s, size) {
    size = size || 14;
    var ico = function(inner) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 16 16" aria-hidden="true" style="display:block">' + inner + '</svg>';
    };
    var ring = '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4"/>';
    if (s === "done") return ico('<circle cx="8" cy="8" r="6.2" fill="currentColor"/>');
    if (s === "wip" || s === "in progress" || s === "in-progress")
      return ico(ring + '<path d="M8 1.8 A6.2 6.2 0 0 0 8 14.2 Z" fill="currentColor"/>');
    return ico(ring); // todo / open
  }
  function msOpenCount(m) {
    return (m.sub || []).filter(function(t) { return t.status !== "done"; }).length;
  }

  var SPECIAL = { ov: 1, cost: 1, boards: 1, milestones: 1, context: 1 };

  /* ---------- nav ---------- */
  NAV.forEach(function (grp) {
    nav.appendChild(el('<div class="nav-g">' + esc(grp.g) + "</div>"));
    (grp.items || []).forEach(function (it) {
      var c;
      if (it.id === "ov") c = "grid";
      else if (it.id === "git") c = GIT && GIT.files_struct ? GIT.files_struct.length : "·";
      else if (it.id === "cost") c = "$";
      else if (it.id === "context") c = COLL.context && COLL.context.categories ? COLL.context.categories.length : 0;
      else if (it.cnt != null) c = it.cnt;
      else c = COLL[it.id] ? (COLL[it.id].items ? COLL[it.id].items.length : 0) : 0;
      var ncInner = esc(c) + (it.tok ? '<small>~' + esc(it.tok) + " tok</small>" : "");
      // is-empty: dim entries whose count is exactly the number 0 (not strings like "grid"/"$")
      var isEmpty = (typeof c === "number" && c === 0) || (typeof c === "string" && c === "0");
      var row = el(
        '<div class="nav-i' + (isEmpty ? " is-empty" : "") + '" data-id="' + esc(it.id) + '">' +
          '<span class="nn">' + esc(it.label) + "</span>" +
          '<span class="nc">' + ncInner + "</span>" +
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
    mp.classList.remove("is-board");
    if (id === "backlog") {
      mp.classList.remove("is-overview");
      mp.classList.add("is-board");
      state.coll = "backlog";
      state.idx = 0;
      setCrumb("Backlog", "· Projekt");
      renderBoard();
    } else if (id === "tn") {
      mp.classList.remove("is-overview");
      mp.classList.add("is-board");
      state.coll = "tn";
      state.idx = 0;
      setCrumb("tn-Board", "· Projekt");
      renderTnBoard();
    } else if (id === "git") {
      mp.classList.remove("is-overview"); state.coll = null;
      setCrumb("Git", "· Projekt");
      renderGit();
    } else if (id === "context") {
      // Context view: hide list column (full-width detail panel)
      mp.classList.add("is-overview"); state.coll = null;
      setCrumb("Kontext", "· Projekt");
      renderContext();
    } else if (SPECIAL[id]) {
      mp.classList.add("is-overview");
      if (id === "ov") {
        // Route: project view → renderProjectOverview; overview view → renderOverview
        if (ACTIVE) {
          setCrumb(ACTIVE, "· Projekt");
          renderProjectOverview();
        } else {
          setCrumb("Überblick", "· alle Projekte · global");
          renderOverview();
        }
      } else if (id === "cost") {
        setCrumb("Kosten", "· alle Projekte");
        renderCost();
      } else if (id === "boards") {
        setCrumb("Boards", "· Projekt");
        renderCombinedBoard();
      } else if (id === "milestones") {
        setCrumb("Backlog projektweit", "· alle Projekte");
        renderMilestonesBoard();
      }
    } else {
      mp.classList.remove("is-overview");
      state.coll = id; state.idx = 0;
      // Update breadcrumb label from the collection title
      var coll = COLL[id];
      if (coll) {
        var scopeLabel = coll.scope === "global" ? "· alle Projekte · global"
          : coll.scope === "projekt" ? "· Projekt"
          : coll.scope === "wissen" ? "· Projekt"
          : coll.scope === "backlog" ? "· Projekt"
          : coll.scope === "usage" ? "· Projekt"
          : "· Projekt";
        setCrumb(coll.title || id, scopeLabel);
      }
      renderList(""); selectItem(0);
    }

    // Push a new history entry for this view unless we are suppressing (boot or popstate).
    // Only push when the path would actually change — avoids duplicate entries.
    if (!suppressPush) {
      try {
        var newPath = viewToPath(id);
        if (newPath !== window.location.pathname) {
          history.pushState({ view: id }, "", newPath);
        }
      } catch (e) { /* history API not available in test env */ }
    }
  }

  /* ---------- backlog: kanban board (drag-drop → status persist) ---------- */
  var BOARD_STATUSES = ["To Do", "In Progress", "Done"];

  function renderBoard() {
    var c = COLL["backlog"];
    list.innerHTML = "";
    detail.innerHTML = "";
    if (!c) return;
    var head = el(
      '<div class="kn-board-head"><b>' + esc(c.title) + '</b>' +
        '<span class="lc">' + c.items.length + "</span>" +
        '<span class="bh-hint">Drag → Status ändern · Doppelklick → Detail</span></div>',
    );
    detail.appendChild(head);
    var board = el('<div class="kn-board"></div>');
    BOARD_STATUSES.forEach(function (st) {
      var key = st.toLowerCase();
      var items = c.items.filter(function (it) { return String(it.status || "").toLowerCase() === key; });
      var col = el(
        '<div class="kn-col" data-status="' + esc(st) + '">' +
          '<div class="kn-col-h">' + esc(st) + ' <span class="kn-col-c">' + items.length + "</span></div>" +
          '<div class="kn-col-body"></div></div>',
      );
      var body = col.querySelector(".kn-col-body");
      items.forEach(function (it) {
        var card = el(
          '<div class="kn-card" draggable="true" data-id="' + esc(it.name) + '">' +
            '<div class="kn-card-id">' + esc(it.name) + "</div>" +
            '<div class="kn-card-t">' + esc(it.title || "") + "</div>" +
            (it.milestone && it.milestone !== "—"
              ? '<div class="kn-card-ms">' + esc(it.milestone) + "</div>"
              : "") +
          "</div>",
        );
        card.addEventListener("dragstart", function (e) {
          e.dataTransfer.setData("text/plain", String(it.name));
          card.classList.add("dragging");
        });
        card.addEventListener("dragend", function () { card.classList.remove("dragging"); });
        card.addEventListener("dblclick", function () { openTaskDetail(it); });
        body.appendChild(card);
      });
      col.addEventListener("dragover", function (e) { e.preventDefault(); col.classList.add("dragover"); });
      col.addEventListener("dragleave", function () { col.classList.remove("dragover"); });
      col.addEventListener("drop", function (e) {
        e.preventDefault();
        col.classList.remove("dragover");
        var id = e.dataTransfer.getData("text/plain");
        if (id) moveTask(id, st);
      });
      board.appendChild(col);
    });
    detail.appendChild(board);
  }

  function moveTask(id, status) {
    var fd = new FormData();
    fd.append("id", id);
    fd.append("status", status);
    fd.append("project", ACTIVE || "");
    fetch("/action/task-status", { method: "POST", body: fd })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) {
          var items = (COLL["backlog"] || {}).items || [];
          for (var i = 0; i < items.length; i++) {
            if (items[i].name === id) items[i].status = status.toLowerCase();
          }
          renderBoard();
        } else {
          window.alert("Status-Wechsel fehlgeschlagen: " + ((d && d.error) || "?"));
        }
      })
      .catch(function () { window.alert("Status-Wechsel fehlgeschlagen (Netzwerk)"); });
  }

  /* ---------- tn: read-only kanban (NEXT / BLOCKED / OVERDUE) ----------
     Display only — tn tasks are the vault's domain; the dashboard never writes
     them. Columns come from each item's `col` field set in buildData. */
  var TN_COLS = [["next", "NEXT"], ["blocked", "BLOCKED"], ["overdue", "OVERDUE"]];

  function renderTnBoard() {
    var c = COLL["tn"];
    list.innerHTML = "";
    detail.innerHTML = "";
    if (!c) return;
    var head = el(
      '<div class="kn-board-head"><b>' + esc(c.title) + '</b>' +
        '<span class="lc">' + c.items.length + "</span></div>",
    );
    detail.appendChild(head);
    var board = el('<div class="kn-board"></div>');
    TN_COLS.forEach(function (pair) {
      var key = pair[0], label = pair[1];
      var items = c.items.filter(function (it) { return it.col === key; });
      var col = el(
        '<div class="kn-col" data-col="' + key + '">' +
          '<div class="kn-col-h">' + label + ' <span class="kn-col-c">' + items.length + "</span></div>" +
          '<div class="kn-col-body"></div></div>',
      );
      var body = col.querySelector(".kn-col-body");
      if (!items.length) {
        body.appendChild(el('<div class="kn-col-empty">—</div>'));
      }
      items.forEach(function (it) {
        var tag = (key === "overdue" && it.desc)
          ? '<div class="kn-card-ms">' + esc(it.desc) + "</div>"
          : "";
        var card = el(
          '<div class="kn-card ro' + (it.id ? " has-note" : "") + '">' +
            '<div class="kn-card-t">' + esc(it.name) + "</div>" + tag + "</div>",
        );
        if (it.id) {
          card.title = "Doppelklick → tn-Note öffnen";
          card.addEventListener("dblclick", function () { openTnDetail(it); });
        }
        body.appendChild(card);
      });
      board.appendChild(col);
    });
    detail.appendChild(board);
  }

  function openTaskDetail(it) {
    if (!it || !it.file) return;
    fetch("/read?" + qs({ kind: "taskfile", name: it.file, project: ACTIVE }))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var body = (d && d.ok) ? d.content : ("Konnte Task nicht laden: " + ((d && d.error) || "?"));
        showModal(it.name + (it.title ? " — " + it.title : ""), body);
      })
      .catch(function () { showModal(String(it.name), "Laden fehlgeschlagen (Netzwerk)"); });
  }

  /* CCS-027: tn-Note modal via /tn-note?id=<id> (project-scoped, read-only) */
  function openTnDetail(it) {
    if (!it || !it.id) return;
    var title = String(it.id) + (it.name ? " — " + String(it.name) : "");
    showModal(title, "lädt…");
    fetch("/tn-note?" + qs({ id: String(it.id), project: ACTIVE }))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) {
          updateModal(title, "Konnte tn-Note nicht laden" + (d && d.error ? ": " + esc(d.error) : "."));
        } else {
          updateModal(d.title ? esc(String(it.id)) + " — " + esc(String(d.title)) : title, String(d.body || "(kein Inhalt)"));
        }
      })
      .catch(function (e) { updateModal(title, "Fehler: " + String(e)); });
  }

  /* ---------- minimal, XSS-safe markdown → HTML (task modal) ---------- */
  function mdEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function mdInline(s) {
    // input is already HTML-escaped; we only add safe tags + sanitized links
    s = s.replace(/`([^`]+)`/g, function (_m, c) { return "<code>" + c + "</code>"; });
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_m, t, u) {
      return /^(https?:\/\/|\/)/.test(u)
        ? '<a href="' + u + '" target="_blank" rel="noopener">' + t + "</a>"
        : t;
    });
    return s;
  }
  function stripFrontmatter(src) {
    return String(src).replace(/^﻿?---\n[\s\S]*?\n---\n?/, "");
  }
  function mdToHtml(src) {
    var lines = String(src).split("\n"), out = [], para = [], listType = null, items = [];
    var inFence = false, fence = [];
    function flushPara() {
      if (para.length) { out.push("<p>" + mdInline(para.join(" ")) + "</p>"); para = []; }
    }
    function flushList() {
      if (listType) {
        out.push("<" + listType + ">" + items.join("") + "</" + listType + ">");
        items = [];
        listType = null;
      }
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^\s*```/.test(line)) {
        if (inFence) {
          out.push("<pre><code>" + fence.join("\n") + "</code></pre>");
          fence = [];
          inFence = false;
        } else {
          flushPara();
          flushList();
          inFence = true;
        }
        continue;
      }
      if (inFence) { fence.push(mdEsc(line)); continue; }
      var h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        flushPara();
        flushList();
        var lvl = Math.min(h[1].length + 1, 6);
        out.push("<h" + lvl + ">" + mdInline(mdEsc(h[2])) + "</h" + lvl + ">");
        continue;
      }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        flushPara();
        flushList();
        out.push("<hr>");
        continue;
      }
      var ol = line.match(/^\s*\d+\.\s+(.*)$/);
      var ul = line.match(/^\s*[-*]\s+(.*)$/);
      if (ol || ul) {
        flushPara();
        var t = ol ? "ol" : "ul";
        if (listType && listType !== t) flushList();
        listType = t;
        var item = (ol ? ol[1] : ul[1]).replace(/^\[ \]\s?/, "☐ ").replace(/^\[[xX]\]\s?/, "☑ ");
        items.push("<li>" + mdInline(mdEsc(item)) + "</li>");
        continue;
      }
      flushList();
      var bq = line.match(/^\s*>\s?(.*)$/);
      if (bq) {
        flushPara();
        out.push("<blockquote>" + mdInline(mdEsc(bq[1])) + "</blockquote>");
        continue;
      }
      if (line.trim() === "") { flushPara(); continue; }
      para.push(mdEsc(line));
    }
    flushPara();
    flushList();
    if (inFence && fence.length) out.push("<pre><code>" + fence.join("\n") + "</code></pre>");
    return out.join("\n");
  }

  function showModal(title, content) {
    var prev = document.getElementById("kn-modal");
    if (prev) prev.remove();
    var ov = el(
      '<div class="kn-modal" id="kn-modal"><div class="kn-modal-box">' +
        '<div class="kn-modal-h"><b></b>' +
        '<button class="kn-modal-x" type="button" aria-label="schliessen">✕</button></div>' +
        '<div class="kn-modal-body kn-md"></div></div></div>',
    );
    ov.querySelector("b").textContent = title;
    // Content is markdown-rendered to a SAFE subset (all HTML escaped first).
    ov.querySelector(".kn-modal-body").innerHTML = mdToHtml(stripFrontmatter(content));
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    ov.querySelector(".kn-modal-x").addEventListener("click", function () { ov.remove(); });
    document.body.appendChild(ov);
  }

  /* CCS-027: update an already-open modal (used after async tn-note fetch) */
  function updateModal(title, content) {
    var ov = document.getElementById("kn-modal");
    if (!ov) { showModal(title, content); return; }
    ov.querySelector("b").textContent = title;
    ov.querySelector(".kn-modal-body").innerHTML = mdToHtml(stripFrontmatter(content));
  }

  /* ---------- list (col 2) ---------- */
  function renderList(q) {
    var c = COLL[state.coll];
    if (!c) { list.innerHTML = ""; return; }
    var rows = c.items.map(function (it, i) { return { it: it, i: i }; });
    if (q) {
      var ql = q.toLowerCase();
      rows = rows.filter(function (r) {
        return (r.it.name + " " + (r.it.title || "") + " " + (r.it.cat || r.it.role || r.it.milestone || r.it.type || "")).toLowerCase().indexOf(ql) > -1;
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

    // Types that show an init-load token count on the right (no status dot)
    var TOK_TYPES = { skill: true, agent: true };
    // Types with no status dot at all (clean list rows)
    var NO_DOT_TYPES = { skill: true, agent: true, know: true, lesson: true, memory: true };

    function makeRow(r) {
      var sub;
      if (c.type === "session") {
        sub = (r.it.date ? r.it.date + " · " : "") + "~" + ktok(r.it.total || 0) + " tok · $" + (Number(r.it.cost || 0)).toFixed(2) +
          (r.it.error_count ? " · " + r.it.error_count + " Fehler" : "");
      } else {
        sub = r.it.cat || r.it.role || r.it.date ||
          (c.type === "skill" ? r.it.desc : "") ||
          (c.type === "task" ? r.it.title : "") ||
          r.it.type || r.it.scope || "";
      }
      var nm = c.type === "decision" ? String(r.it.name).replace(/^\d+\s—\s/, "") : r.it.name;

      // Right side: init-load token for skill/agent; decision index for decisions; nothing otherwise
      var right = "";
      if (TOK_TYPES[c.type] && r.it.metaTokens) {
        right = '<div class="li-tok">~' + ktok(r.it.metaTokens) + '<small>tok · init</small></div>';
      } else if (c.type === "decision") {
        right = '<span class="li-ix">' + esc(r.it.id) + "</span>";
      }

      // Lead: no dot for NO_DOT_TYPES; decision uses right instead; others show dot
      var lead = "";
      if (!NO_DOT_TYPES[c.type] && c.type !== "decision") {
        lead = '<span class="dot li-dot' + dotCls(statusDot(c, r.it)) + '"' + dotStyle(c.accent) + "></span>";
      }

      var row = el(
        '<div class="li" data-i="' + r.i + '">' + lead +
          '<div><div class="li-n">' + esc(nm) + "</div>" +
          (sub ? '<div class="li-s">' + esc(sub) + "</div>" : "") + "</div>" +
          right +
        "</div>"
      );
      row.addEventListener("click", function () { selectItem(r.i); });
      return row;
    }

    if (c.type === "task") {
      // group by milestone; collapse the Done group at the bottom
      var curGroup = null, doneBody = null;
      rows.forEach(function (r) {
        var grp = r.it.group || "—";
        if (r.it.done) {
          if (!doneBody) {
            var doneN = rows.filter(function (x) { return x.it.done; }).length;
            var det = el('<details class="done-grp"><summary>Done <span class="ct">' + doneN + "</span></summary><div class=\"done-body\"></div></details>");
            list.appendChild(det);
            doneBody = det.querySelector(".done-body");
          }
          doneBody.appendChild(makeRow(r));
          return;
        }
        if (grp !== curGroup) {
          curGroup = grp;
          list.appendChild(el('<div class="li-group">' + esc(grp) + "</div>"));
        }
        list.appendChild(makeRow(r));
      });
    } else {
      rows.forEach(function (r) { list.appendChild(makeRow(r)); });
    }

    var has = rows.some(function (r) { return r.i === state.idx; });
    if (!has && rows.length) { selectItem(rows[0].i); } else { markActive(); }
  }

  // dot colour follows task status (green=done, cyan=in progress, amber=to do, red=blocked)
  function statusDot(c, it) {
    if (c.type !== "task") return c.accent;
    var s = String(it.status || "").toLowerCase();
    if (s === "done") return "g";
    if (s.indexOf("progress") >= 0) return "c";
    if (s === "blocked") return "r";
    return "a";
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
      b.push(badge("g", "scope: " + c.scope));
      if (it.tokens) b.push(badge("c", "~" + ktok(it.tokens) + " tok"));
      meta.push(metaCell("Scope", esc(c.scope)));
      meta.push(metaCell("Token (≈)", "~" + ktok(it.tokens || 0)));
      meta.push(metaCell("Größe", de(it.size || 0) + " B"));
      meta.push(metaCell("Quelle", "<code>~/.claude/skills/" + esc(it.name) + "</code>"));
      var scripts = it.scripts || [];
      meta.push(metaCell("Scripts", scripts.length));
      if (it.desc) { descHtml = esc(it.desc); desc = ""; }
      // SKILL.md wrapped in collapsible <details> to avoid duplicating the description
      if (it.has_md) secs.push({ raw: true, h: "SKILL.md", html: '<div class="filehost" data-read="skill" data-name="' + esc(it.name) + '"></div>' });
      else secs.push({ raw: true, h: "SKILL.md", html: '<div class="dt-empty">keine SKILL.md gefunden</div>' });
      if (scripts.length) {
        var chips = scripts.map(function (sc) {
          return '<button class="fchip" data-read="skillfile" data-name="' + esc(it.name) +
            '" data-path="' + esc(sc.path) + '"><span class="fl">' + esc(sc.lang) + "</span>" +
            esc(sc.path) + ' <span class="fz">' + de(sc.size) + "B</span></button>";
        }).join("");
        secs.push({ h: "Scripts <span class=\"ct\">" + scripts.length + "</span>", html: '<div class="fchips">' + chips + '</div><div class="filehost2"></div>' });
      }
    } else if (c.type === "claude") {
      var doc = c.doc || {};
      b.push(badge("c", "CLAUDE.md")); b.push(badge("", c.scope));
      if (doc.tokens) b.push(badge("c", "~" + ktok(doc.tokens) + " tok"));
      if (doc.managed) b.push(badge("g", "managed-block"));
      meta.push(metaCell("Scope", esc(c.scope)));
      meta.push(metaCell("Token (≈)", "~" + ktok(doc.tokens || 0)));
      meta.push(metaCell("Größe", de(doc.size || 0) + " B"));
      descHtml = "Section <code>" + esc(it.name) + "</code> — voller Inhalt unten."; desc = "";
      secs.push({ h: "CLAUDE.md (" + esc(c.scope) + ")", html: '<div class="filehost" data-read="' + esc(doc.kind || "") + '"></div>' });
    } else if (c.type === "agent") {
      b.push(badge("c", "agent")); b.push(badge("", c.scope));
      if (it.tokens) b.push(badge("c", "~" + ktok(it.tokens) + " tok"));
      meta.push(metaCell("Token (≈)", "~" + ktok(it.tokens || 0)));
      meta.push(metaCell("Größe", de(it.size || 0) + " B"));
      meta.push(metaCell("Quelle", "<code>~/.claude/agents/" + esc(it.name) + ".md</code>"));
      descHtml = it.role ? esc(it.role) : ""; desc = "";
      // Agent definition wrapped in collapsible <details>
      secs.push({ raw: true, h: "Agent-Definition", html: '<div class="filehost" data-read="agent" data-name="' + esc(it.name) + '"></div>' });
    } else if (c.type === "hook") {
      b.push(badge("", "event")); b.push(badge((it.count || 0) > 2 ? "a" : "g", (it.count || 0) + " hook(s)"));
      meta.push(metaCell("Event", "<code>" + esc(it.name) + "</code>")); meta.push(metaCell("Hooks", it.count || 0));
      var entries = it.entries || [];
      var hookScripts = [];
      if (entries.length) {
        var rows = entries.map(function (e) {
          var sp = extractScript(e.command);
          if (sp && hookScripts.indexOf(sp) < 0) hookScripts.push(sp);
          return '<div class="hookrow"><div class="hh">' +
            '<code>' + esc(e.matcher || "*") + "</code>" +
            '<span class="ht">' + esc(e.type || "command") + "</span></div>" +
            '<div class="hc">' + esc(e.command || "(kein Command)") + "</div></div>";
        }).join("");
        secs.push({ h: "Hooks", html: '<div class="hookrows">' + rows + "</div>" });
      }
      if (hookScripts.length) {
        var hchips = hookScripts.map(function (sp) {
          return '<button class="fchip" data-read="homefile" data-path="' + esc(sp) + '">' + esc(sp) + "</button>";
        }).join("");
        secs.push({ h: "Referenzierte Scripts <span class=\"ct\">unter ~/.claude lesbar</span>", html: '<div class="fchips">' + hchips + '</div><div class="filehost2"></div>' });
      }
      descHtml = "Hook-Event <code>" + esc(it.name) + "</code> mit " + (it.count || 0) + " registrierten Script(s)."; desc = "";
    } else if (c.type === "setting") {
      b.push(badge("c", it.scope || ""));
      meta.push(metaCell("Key", "<code>" + esc(it.name) + "</code>"));
      if (it.scope) meta.push(metaCell("Scope", esc(it.scope)));
    } else if (c.type === "know") {
      b.push(badge("c", "knowledge/")); if (it.type) b.push(badge("", it.type));
      if (it.type) meta.push(metaCell("Typ", esc(it.type)));
      meta.push(metaCell("Pfad", "<code>knowledge/" + esc(it.path || "") + "</code>"));
      if (it.desc) { descHtml = esc(it.desc); desc = ""; }
      if (it.path && /\.(md|txt|csv|json|ya?ml|html)$/i.test(it.path)) {
        secs.push({ h: "Inhalt", html: '<div class="filehost" data-read="knowfile" data-path="' + esc(it.path) + '"></div>' });
      }
    } else if (c.type === "memory") {
      b.push(badge("", "memory"));
      meta.push(metaCell("Datei", "<code>" + esc(it.name) + "</code>"));
      meta.push(metaCell("Pfad", "<code>knowledge/memory/</code>"));
      secs.push({ h: "Inhalt", html: '<div class="filehost" data-read="memory" data-name="' + esc(it.name) + '"></div>' });
      desc = "";
    } else if (c.type === "lesson") {
      b.push(badge("a", "Lektion"));
      meta.push(metaCell("Datei", "<code>" + esc(it.name) + "</code>"));
      meta.push(metaCell("Pfad", "<code>knowledge/</code>"));
      secs.push({ h: "Inhalt", html: '<div class="filehost" data-read="lektion" data-name="' + esc(it.name) + '"></div>' });
      desc = "";
    } else if (c.type === "changelog") {
      b.push(badge("", "CHANGELOG"));
      eyebrow = "CHANGELOG · " + c.scope; desc = "";
      var clBody = it.body ? String(it.body) : "";
      secs.push({ h: "Eintrag", html: '<div class="prose">' + esc(it.name) + "</div>" +
        (clBody ? '<pre class="filebody" style="margin-top:8px">' + esc(clBody) + "</pre>" : "") });
    } else if (c.type === "decision") {
      var st = statusPair(it.status); b.push(badge(st[0], st[1])); b.push(badge("", "ADR " + esc(it.id)));
      meta.push(metaCell("ID", esc(it.id))); meta.push(metaCell("Status", st[1]));
      if (it.ctx) secs.push({ h: "Kontext", html: '<div class="prose">' + esc(it.ctx) + "</div>" });
      if (it.dec) secs.push({ h: "Entscheidung", html: '<div class="prose">' + esc(it.dec) + "</div>" });
      if (it.body) secs.push({ h: "Inhalt", html: '<pre class="filebody">' + esc(it.body) + "</pre>" });
      desc = "";
    } else if (c.type === "doc") {
      b.push(badge("c", "doc")); b.push(badge("", c.scope));
      meta.push(metaCell("ID", "<code>" + esc(it.id || it.name) + "</code>"));
      meta.push(metaCell("Datei", "<code>backlog/docs/" + esc(it.name) + "</code>"));
      secs.push({ h: "Inhalt", html: '<div class="filehost" data-read="docfile" data-name="' + esc(it.name) + '"></div>' });
      desc = "";
    } else if (c.type === "task") {
      var ts = statusPair(it.status); b.push(badge(ts[0], ts[1]));
      if (it.milestone && it.milestone !== "—") b.push(badge("", it.milestone));
      meta.push(metaCell("ID", "<code>" + esc(it.name) + "</code>")); meta.push(metaCell("Status", ts[1]));
      if (it.milestone) meta.push(metaCell("Milestone", esc(it.milestone)));
      desc = it.desc || "";
      if (it.file) secs.push({ h: "Task-Datei <span class=\"ct\">AC · Plan · Notes · Summary</span>", html: '<div class="filehost" data-read="taskfile" data-name="' + esc(it.file) + '"></div>' });
    } else if (c.type === "session") {
      b.push(badge("", c.scope));
      if (it.date) b.push(badge("c", it.date));
      b.push(badge("", (it.turns || 0) + " turns"));
      if (it.error_count) b.push(badge("r", it.error_count + " Fehler"));
      if (it.repeat_count) b.push(badge("a", it.repeat_count + " Repeats"));
      var tot = it.total || ((it.input || 0) + (it.output || 0) + (it.cc || 0) + (it.cr || 0));
      var mx = Math.max(it.input || 0, it.output || 0, it.cc || 0, it.cr || 0, 1);
      function bar(l, v, col) {
        return '<div class="row"><span class="tl">' + l + '</span><span class="track"><i style="width:' +
          Math.max(0.4, (v || 0) / mx * 100) + "%;background:" + col + '"></i></span><span class="tv">' + de(v || 0) + "</span></div>";
      }
      secs.push({ h: "Token-Verteilung", html: '<div class="tbar">' +
        bar("Input", it.input, "var(--cyan)") + bar("Output", it.output, "var(--green)") +
        bar("Cache create", it.cc, "var(--amber)") + bar("Cache read", it.cr, "var(--mag)") + "</div>" });
      // clustering: failed commands + repeated commands (from session_analyze)
      if ((it.errors || []).length) {
        var erows = it.errors.map(function (e) {
          return '<div class="clrow cl-err"><div class="clh"><span class="clt r">' + esc(e.tool || "?") + "</span>" +
            (e.command ? '<code>' + esc(e.command) + "</code>" : "") + "</div>" +
            (e.preview ? '<div class="clp">' + esc(e.preview) + "</div>" : "") + "</div>";
        }).join("");
        secs.push({ h: "Fehler <span class=\"ct\">" + it.error_count + "</span>", html: '<div class="clrows">' + erows + "</div>" });
      }
      if ((it.repeats || []).length) {
        var rrows = it.repeats.map(function (r) {
          return '<div class="clrow"><div class="clh"><span class="clt a">' + (r.count || 0) + "×</span>" +
            '<code>' + esc(r.command || "") + "</code></div></div>";
        }).join("");
        secs.push({ h: "Gleiche Commands <span class=\"ct\">projektweit, diese Session beteiligt</span>", html: '<div class="clrows">' + rrows + "</div>" });
      }
      meta.push(metaCell("Session", "<code>" + esc(it.name) + "</code>"));
      if (it.date) meta.push(metaCell("Datum", esc(it.date)));
      meta.push(metaCell("Turns", it.turns || 0)); meta.push(metaCell("Total", de(tot)));
      meta.push(metaCell("Kosten (≈)", "$" + (Number(it.cost || 0)).toFixed(2)));
      desc = "";
    } else {
      b.push(badge(c.accent || "", c.title.toLowerCase()));
    }

    var title = c.type === "decision"
      ? String(it.name).replace(/^\d+\s—\s/, "")
      : c.type === "changelog"
        ? String(it.name).replace(/^#{1,3}\s+/, "")
        : (c.type === "task" && it.title ? it.title : it.name);
    detail.innerHTML = '<div class="dt">' +
      '<div class="dt-eyebrow">' + esc(eyebrow) + "</div>" +
      '<h2><span class="mono">' + esc(title) + "</span></h2>" +
      (b.length ? '<div class="dt-badges">' + b.join("") + "</div>" : "") +
      (descHtml ? '<p class="dt-desc">' + descHtml + "</p>"
        : (desc ? '<p class="dt-desc">' + esc(desc) + "</p>" : "")) +
      (meta.length ? '<div class="dt-meta">' + meta.join("") + "</div>" : "") +
      // section headers: raw=true → collapsed <details>; otherwise normal dt-sec
      secs.map(function (s) {
        if (s.raw) {
          return '<details class="dt-raw">' +
            '<summary><span class="tw">▶</span><span class="rt">' + s.h + '</span></summary>' +
            s.html + "</details>";
        }
        return '<div class="dt-sec"><div class="sh">' + s.h + "</div>" + s.html + "</div>";
      }).join("") +
    "</div>";
    wireFileHosts(detail);
  }

  /* auto-load inline hosts + wire clickable file/script chips */
  function wireFileHosts(root) {
    var fhost = root.querySelector(".filehost[data-read]");
    if (fhost) loadFile(fhost.dataset.read, { name: fhost.dataset.name, path: fhost.dataset.path }, fhost);
    [].forEach.call(root.querySelectorAll(".fchip[data-read]"), function (chip) {
      chip.addEventListener("click", function () {
        var sec = chip.closest(".dt-sec") || root;
        var host = sec.querySelector(".filehost2") || root.querySelector(".filehost2");
        if (!host) return;
        [].forEach.call((sec.querySelectorAll(".fchip")), function (x) { x.classList.remove("is-active"); });
        chip.classList.add("is-active");
        loadFile(chip.dataset.read, { name: chip.dataset.name, path: chip.dataset.path }, host);
      });
    });
  }

  /* ---------- Git: file-list column (col 2) + diff (col 3) ---------- */
  function gFileRow(f) {
    var st = f.untracked ? ["a", "U"] : statusFromXY(f.xy);
    var delta = "";
    if (f.untracked) delta = '<span class="gd-new">neu</span>';
    else {
      if (f.added != null) delta += '<span class="gd-add">+' + f.added + "</span>";
      if (f.deleted != null) delta += '<span class="gd-del">−' + f.deleted + "</span>";
    }
    return '<button class="gfile" data-path="' + esc(f.path) + '" title="' + esc(f.path) + '">' +
      '<span class="badge ' + st[0] + '">' + esc(st[1]) + "</span>" +
      '<span class="gfp">' + esc(f.path) + "</span>" +
      '<span class="gdelta">' + delta + "</span></button>";
  }

  function renderGit() {
    if (!GIT || GIT.available === false) {
      list.innerHTML = "";
      detail.innerHTML = '<div class="dt dt-empty">Git nicht verfügbar' + (GIT && GIT.reason ? ": " + esc(GIT.reason) : "") + "</div>";
      return;
    }
    var br = esc(GIT.branch || "?");
    var sync = [];
    if (GIT.ahead_origin != null) sync.push("↑" + GIT.ahead_origin + "/↓" + (GIT.behind_origin || 0) + " origin");
    if (GIT.ahead_main != null) sync.push("↑" + GIT.ahead_main + " main");

    var fstruct = GIT.files_struct || [];
    var tracked = fstruct.filter(function (f) { return !f.untracked; });
    var untrk = fstruct.filter(function (f) { return f.untracked; });

    var pj = '<input type="hidden" name="project" value="' + esc(ACTIVE) + '">';
    var forms =
      '<form class="gf" method="post" action="/action/commit">' + pj +
        '<input name="message" placeholder="commit message" required>' +
        '<button type="submit">Commit (lokal)</button></form>' +
      '<form class="gf" method="post" action="/action/push">' + pj +
        '<input type="hidden" name="branch" value="' + br + '">' +
        '<input name="confirm" placeholder="tippe PUSH" autocomplete="off">' +
        '<button type="submit" class="danger">Push → origin/' + br + "</button></form>" +
      '<form class="gf" method="post" action="/action/merge">' + pj +
        '<input name="branch" value="' + br + '">' +
        '<input name="confirm" placeholder="tippe MERGE" autocomplete="off">' +
        '<button type="submit" class="danger">Merge → main</button></form>' +
      '<form class="gf" method="post" action="/action/delete" onsubmit="return confirm(\'Branch wirklich löschen?\')">' + pj +
        '<input name="branch" placeholder="branch">' +
        '<input name="confirm" placeholder="Branch-Name" autocomplete="off">' +
        '<button type="submit">Delete branch</button></form>';

    list.innerHTML =
      '<div class="list-head"><div class="lt"><b>Änderungen</b><span class="lc">' + fstruct.length + "</span>" +
        '<span class="ls">' + br + (sync.length ? " · " + esc(sync.join(" · ")) : "") + "</span></div>" +
        (GIT.shortstat ? '<div class="gss">' + esc(GIT.shortstat) + "</div>" : "") + "</div>" +
      (tracked.length ? '<div class="li-group">Tracked</div>' + tracked.map(gFileRow).join("") : "") +
      (untrk.length ? '<div class="li-group">Untracked</div>' + untrk.map(gFileRow).join("") : "") +
      (!fstruct.length ? '<div class="li-empty">clean — keine Änderungen</div>' : "") +
      '<details class="git-actions"><summary>Git-Aktionen <span class="ct">localhost · push/merge: Tipp-Token</span></summary>' +
        '<div class="gitforms">' + forms + "</div></details>";

    function showDiff(path, elBtn) {
      [].forEach.call(list.querySelectorAll(".gfile"), function (x) { x.classList.remove("is-active"); });
      if (elBtn) elBtn.classList.add("is-active");
      detail.innerHTML =
        '<div class="gitdiff"><div class="gitdiff-head"><code>' + (path ? esc(path) : "Gesamt-Diff (HEAD)") + "</code>" +
        (GIT.recommend ? '<span class="gdh-rec">' + esc(GIT.recommend) + "</span>" : "") +
        "</div><div class=\"diffhost\"></div></div>";
      loadDiff(path, detail.querySelector(".diffhost"));
    }

    [].forEach.call(list.querySelectorAll(".gfile[data-path]"), function (btn) {
      btn.addEventListener("click", function () { showDiff(btn.dataset.path, btn); });
    });

    var first = list.querySelector(".gfile");
    if (first) showDiff(first.dataset.path, first);
    else detail.innerHTML = '<div class="dt dt-empty">Arbeitsbaum sauber — kein Diff.</div>';
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

  /* ---------- combined tn + backlog board ---------- */
  function renderCombinedBoard() {
    list.innerHTML = "";
    detail.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.style.cssText = "overflow:auto;height:100%;padding:14px 16px;display:flex;flex-direction:column;gap:20px;";

    // Boards overall header with open counts (AC 2)
    var blOpen = (OV.backlog_open != null) ? OV.backlog_open : "?";
    var tnOpen = (OV.tn_open != null) ? OV.tn_open : "?";
    wrap.appendChild(el(
      '<div class="kn-board-head" style="background:var(--bg-grid,#0a0b0d);border-bottom:1px solid var(--line,#1c2229)">' +
        '<b>Boards</b>' +
        '<span class="lc" style="margin-left:8px">backlog: <b>' + esc(String(blOpen)) + '</b> offen</span>' +
        '<span class="lc" style="margin-left:12px">tn: <b>' + esc(String(tnOpen)) + '</b> offen</span>' +
      "</div>",
    ));

    // Graceful fallback when called from Overview context (no active project → colls empty)
    if (!COLL["tn"] && !COLL["backlog"]) {
      wrap.appendChild(el(
        '<div style="padding:32px 16px;color:var(--dim);font-size:13px">' +
          'Kein aktives Projekt — links ein Projekt wählen.</div>',
      ));
      detail.appendChild(wrap);
      return;
    }

    // --- tn board (read-only) ---
    var tnC = COLL["tn"];
    if (tnC) {
      // open count = next + blocked + overdue (consistent with OV.tn_open)
      var tnOpenCount = tnC.items.filter(function (it) {
        return it.col === "next" || it.col === "blocked" || it.col === "overdue";
      }).length;
      var tnSec = document.createElement("div");
      var tnHead = el(
        '<div class="kn-board-head"><b>' + esc(tnC.title) + '</b>' +
          '<span class="lc">' + tnOpenCount + ' offen</span>' +
          '<span class="bh-hint">read-only (NEXT / BLOCKED / OVERDUE)</span></div>',
      );
      tnSec.appendChild(tnHead);
      var tnBoard = el('<div class="kn-board" style="flex-wrap:wrap;height:auto;overflow:visible;"></div>');
      TN_COLS.forEach(function (pair) {
        var key = pair[0], label = pair[1];
        var items = tnC.items.filter(function (it) { return it.col === key; });
        var col = el(
          '<div class="kn-col" style="min-width:200px;max-height:none;" data-col="' + key + '">' +
            '<div class="kn-col-h">' + label + ' <span class="kn-col-c">' + items.length + "</span></div>" +
            '<div class="kn-col-body"></div></div>',
        );
        var body = col.querySelector(".kn-col-body");
        if (!items.length) body.appendChild(el('<div class="kn-col-empty">—</div>'));
        items.forEach(function (it) {
          var tag = (key === "overdue" && it.desc)
            ? '<div class="kn-card-ms">' + esc(it.desc) + "</div>" : "";
          var card = el(
            '<div class="kn-card ro' + (it.id ? " has-note" : "") + '">' +
              '<div class="kn-card-t">' + esc(it.name) + "</div>" + tag + "</div>",
          );
          if (it.id) {
            card.title = "Doppelklick → tn-Note öffnen";
            card.addEventListener("dblclick", function () { openTnDetail(it); });
          }
          body.appendChild(card);
        });
        tnBoard.appendChild(col);
      });
      tnSec.appendChild(tnBoard);
      wrap.appendChild(tnSec);
    }

    // --- backlog board (drag-drop + double-click detail) ---
    var blC = COLL["backlog"];
    if (blC) {
      // open count = tasks whose status != "done" (consistent with OV.backlog_open)
      var blOpenCount = blC.items.filter(function (it) {
        return String(it.status || "").trim().toLowerCase() !== "done";
      }).length;
      var blSec = document.createElement("div");
      var blHead = el(
        '<div class="kn-board-head"><b>' + esc(blC.title) + '</b>' +
          '<span class="lc">' + blOpenCount + ' offen</span>' +
          '<span class="bh-hint">Drag → Status · Doppelklick → Detail</span></div>',
      );
      blSec.appendChild(blHead);
      var blBoard = el('<div class="kn-board" style="flex-wrap:wrap;height:auto;overflow:visible;"></div>');
      BOARD_STATUSES.forEach(function (st) {
        var key = st.toLowerCase();
        var items = blC.items.filter(function (it) { return String(it.status || "").toLowerCase() === key; });
        var col = el(
          '<div class="kn-col" style="min-width:200px;max-height:none;" data-status="' + esc(st) + '">' +
            '<div class="kn-col-h">' + esc(st) + ' <span class="kn-col-c">' + items.length + "</span></div>" +
            '<div class="kn-col-body"></div></div>',
        );
        var body = col.querySelector(".kn-col-body");
        items.forEach(function (it) {
          var card = el(
            '<div class="kn-card" draggable="true" data-id="' + esc(it.name) + '">' +
              '<div class="kn-card-id">' + esc(it.name) + "</div>" +
              '<div class="kn-card-t">' + esc(it.title || "") + "</div>" +
              (it.milestone && it.milestone !== "—"
                ? '<div class="kn-card-ms">' + esc(it.milestone) + "</div>" : "") +
            "</div>",
          );
          card.addEventListener("dragstart", function (e) {
            e.dataTransfer.setData("text/plain", String(it.name));
            card.classList.add("dragging");
          });
          card.addEventListener("dragend", function () { card.classList.remove("dragging"); });
          card.addEventListener("dblclick", function () { openTaskDetail(it); });
          body.appendChild(card);
        });
        col.addEventListener("dragover", function (e) { e.preventDefault(); col.classList.add("dragover"); });
        col.addEventListener("dragleave", function () { col.classList.remove("dragover"); });
        col.addEventListener("drop", function (e) {
          e.preventDefault(); col.classList.remove("dragover");
          var id = e.dataTransfer.getData("text/plain");
          if (id) moveTask(id, st);
        });
        blBoard.appendChild(col);
      });
      blSec.appendChild(blBoard);
      wrap.appendChild(blSec);
    }

    detail.appendChild(wrap);
  }

  /* ---------- cross-project kanban board (CCS-026, read-only) ----------
     Shows all non-done backlog tasks from all projects, grouped by status column.
     Read-only: cross-project drag-drop would require per-card project routing;
     that is out of scope for this task. Each card shows project label. */
  // Backlog.md standard statuses: To Do / In Progress / Done. "Blocked" is not a
  // standard column → removed to avoid a permanently empty column.
  var MS_BOARD_STATUSES = ["To Do", "In Progress"];
  function renderMilestonesBoard() {
    list.innerHTML = "";
    detail.innerHTML = "";
    var c = COLL["milestones"];
    var items = (c && c.items) ? c.items : [];
    var wrap = document.createElement("div");
    wrap.style.cssText = "overflow:auto;height:100%;padding:0;display:flex;flex-direction:column;";
    var total = items.length;
    wrap.appendChild(el(
      '<div class="kn-board-head" style="background:var(--bg-grid,#0a0b0d);border-bottom:1px solid var(--line,#1c2229)">' +
        '<b>Backlog projektweit</b>' +
        '<span class="lc" style="margin-left:8px">' + total + ' offen</span>' +
        '<span class="bh-hint">read-only · cross-project (kein Drag-drop)</span>' +
      "</div>",
    ));
    if (!total) {
      wrap.appendChild(el('<div style="padding:28px 16px;color:var(--dim);font-size:13px">Keine offenen Tasks gefunden.</div>'));
      detail.appendChild(wrap);
      return;
    }
    var board = el('<div class="kn-board" style="flex-wrap:wrap;height:auto;overflow:visible;padding:14px 16px;align-items:flex-start;"></div>');
    MS_BOARD_STATUSES.forEach(function (st) {
      var key = st.toLowerCase();
      var colItems = items.filter(function (it) {
        return String(it.status || "").trim().toLowerCase() === key;
      });
      var col = el(
        '<div class="kn-col" style="min-width:220px;max-height:none;" data-status="' + esc(st) + '">' +
          '<div class="kn-col-h">' + esc(st) + ' <span class="kn-col-c">' + colItems.length + "</span></div>" +
          '<div class="kn-col-body"></div></div>',
      );
      var body = col.querySelector(".kn-col-body");
      if (!colItems.length) body.appendChild(el('<div class="kn-col-empty">—</div>'));
      colItems.forEach(function (it) {
        body.appendChild(el(
          '<div class="kn-card ro">' +
            '<div class="kn-card-id">' + esc(it.name) + "</div>" +
            '<div class="kn-card-t">' + esc(it.title || "") + "</div>" +
            '<div class="kn-card-ms">' + esc(it.project || it.group || "") +
              (it.milestone && it.milestone !== "(ohne Milestone)" ? " · " + esc(it.milestone) : "") +
            "</div>" +
          "</div>",
        ));
      });
      board.appendChild(col);
    });
    wrap.appendChild(board);
    detail.appendChild(wrap);
  }

  /* ---------- Kontext: /context-style initial-session token breakdown ----------
     Static categories come from window.DATA (coll.context). The hook-injection
     category is filled LIVE via /hook-inject (single-flight + TTL on the server).
     All numbers are estimates; the two fixed categories are flagged. */
  var CTX_COLORS = ["var(--cyan)", "var(--green)", "var(--amber)", "var(--mag)", "var(--cyan)", "var(--green)"];

  function ctxPct(tokens, window) {
    if (!window) return 0;
    return Math.max(0, Math.min(100, (Number(tokens) || 0) / window * 100));
  }

  function renderContext() {
    list.innerHTML = "";
    var C = COLL["context"];
    if (!C) {
      detail.innerHTML = '<div class="dt dt-empty">Kontext nicht verfügbar — links ein Projekt wählen.</div>';
      return;
    }
    var win = Number(C.window) || 1000000;
    // Render shell (rebuilt on each hook update). `cats` is a working copy so the
    // live hook tokens can mutate the hooks category without touching DATA.
    var cats = (C.categories || []).map(function (c) {
      return { key: c.key, label: c.label, tokens: Number(c.tokens) || 0, fixed: c.fixed, live: c.live, items: c.items || [], output: c.output || "" };
    });

    function paint() {
      var measured = cats.reduce(function (s, c) { return s + (Number(c.tokens) || 0); }, 0);
      var pctTotal = (measured / win * 100);
      var free = Math.max(0, win - measured);

      // stacked bar segments (one per category with tokens > 0)
      var segs = cats.map(function (c, i) {
        if (!(c.tokens > 0)) return "";
        var w = ctxPct(c.tokens, win);
        return '<span class="ctx-seg" title="' + esc(c.label) + ": ~" + ktok(c.tokens) + ' tok" style="width:' +
          w + "%;background:" + CTX_COLORS[i % CTX_COLORS.length] + '"></span>';
      }).join("");

      var rows = cats.map(function (c, i) {
        var pct = ctxPct(c.tokens, win);
        var badge = c.fixed ? '<span class="ctx-tag fix">fix</span>'
          : (c.live ? '<span class="ctx-tag live">live</span>' : "");
        var swatch = '<span class="ctx-sw" style="background:' + CTX_COLORS[i % CTX_COLORS.length] + '"></span>';
        // hooks live category: body = raw output (escaped) once loaded
        var body;
        if (c.live) {
          body = c.output
            ? '<pre class="ctx-hookout">' + esc(c.output) + "</pre>"
            : '<div class="ctx-item ctx-loading">' + (c.loaded ? "(kein Output)" : "Hook wird live ausgeführt…") + "</div>";
        } else if (c.items.length) {
          // Items nach Gruppe rendern (Project → User → Plugin → Built-in).
          // Wenn kein item.group gesetzt → flache Liste wie bisher.
          var hasGroups = c.items.some(function(it) { return it.group; });
          if (hasGroups) {
            // Gruppen sammeln in stabiler Reihenfolge
            var groupOrder = ["Project", "User", "Built-in"];
            var grouped = {};
            var orderedGroups = [];
            c.items.forEach(function(it) {
              var g = it.group || "";
              if (!grouped[g]) {
                grouped[g] = [];
                // Plugin-Gruppen (nicht in groupOrder) am Ende vor Built-in einsortieren
                if (groupOrder.indexOf(g) < 0) {
                  // Plugin-Gruppen nach User, vor Built-in
                  orderedGroups.push(g);
                }
              }
              grouped[g].push(it);
            });
            // Finale Reihenfolge: Project, User, Plugin-Gruppen (sortiert), Built-in
            var finalOrder = [];
            ["Project", "User"].forEach(function(g) { if (grouped[g]) finalOrder.push(g); });
            orderedGroups.sort().forEach(function(g) { finalOrder.push(g); });
            if (grouped["Built-in"]) finalOrder.push("Built-in");

            body = finalOrder.map(function(grp) {
              var items = grouped[grp] || [];
              if (!items.length) return "";
              var header = '<div class="ctx-grp">' + esc(grp) + '</div>';
              var rows = items.map(function(it) {
                if (it.read) {
                  var detailId = "ctx-rd-" + esc(it.name).replace(/[^A-Za-z0-9]/g, "-");
                  return '<details class="ctx-readable" id="' + detailId + '">' +
                    '<summary><span class="ctx-in">' + esc(it.name) + "</span>" +
                    (it.desc ? '<span class="ctx-id">' + esc(it.desc) + "</span>" : "") +
                    '<span class="ctx-it">~' + ktok(it.tokens) + " tok</span></summary>" +
                    '<div class="ctx-readable-body" data-read="' + esc(it.read) + '"' +
                      (it.readPath ? ' data-path="' + esc(it.readPath) + '"' : '') +
                    '></div>' +
                    "</details>";
                }
                return '<div class="ctx-item"><span class="ctx-in">' + esc(it.name) + "</span>" +
                  (it.desc ? '<span class="ctx-id">' + esc(it.desc) + "</span>" : "") +
                  '<span class="ctx-it">~' + ktok(it.tokens) + " tok</span></div>";
              }).join("");
              return header + rows;
            }).join("");
          } else {
            body = c.items.map(function (it) {
              if (it.read) {
                var detailId = "ctx-rd-" + esc(it.name).replace(/[^A-Za-z0-9]/g, "-");
                return '<details class="ctx-readable" id="' + detailId + '">' +
                  '<summary><span class="ctx-in">' + esc(it.name) + "</span>" +
                  (it.desc ? '<span class="ctx-id">' + esc(it.desc) + "</span>" : "") +
                  '<span class="ctx-it">~' + ktok(it.tokens) + " tok</span></summary>" +
                  '<div class="ctx-readable-body" data-read="' + esc(it.read) + '"' +
                    (it.readPath ? ' data-path="' + esc(it.readPath) + '"' : '') +
                  '></div>' +
                  "</details>";
              }
              return '<div class="ctx-item"><span class="ctx-in">' + esc(it.name) + "</span>" +
                (it.desc ? '<span class="ctx-id">' + esc(it.desc) + "</span>" : "") +
                '<span class="ctx-it">~' + ktok(it.tokens) + " tok</span></div>";
            }).join("");
          }
        } else {
          body = '<div class="ctx-item ctx-empty">— keine Einzel-Items</div>';
        }
        // Alle Kategorien default eingeklappt — kein auto-open für live-Kategorie
        // (Live-Hook läuft trotzdem im Hintergrund, öffnet sich aber nicht automatisch).
        return '<details class="ctx-cat">' +
          '<summary>' + swatch + '<span class="ctx-l">' + esc(c.label) + "</span>" + badge +
            '<span class="ctx-bar-mini"><i style="width:' + pct + '%;background:' + CTX_COLORS[i % CTX_COLORS.length] + '"></i></span>' +
            '<span class="ctx-t">~' + ktok(c.tokens) + " tok</span>" +
            '<span class="ctx-p">' + pct.toFixed(1) + "%</span>" +
          "</summary><div class=\"ctx-body\">" + body + "</div></details>";
      }).join("");

      // free space row (non-collapsible)
      var freeRow = '<div class="ctx-free"><span class="ctx-sw ctx-sw-free"></span>' +
        '<span class="ctx-l">Free space</span>' +
        '<span class="ctx-t">~' + ktok(free) + " tok</span>" +
        '<span class="ctx-p">' + (free / win * 100).toFixed(1) + "%</span></div>";

      detail.innerHTML = '<div class="dt ctx-wrap">' +
        '<div class="dt-eyebrow">Session · statischer Initial-Kontext (≈ geschätzt)</div>' +
        '<h2><span class="mono">~' + ktok(measured) + " / " + ktok(win) + "</span>" +
          ' <span class="ctx-sum-p">(' + pctTotal.toFixed(1) + "%)</span></h2>" +
        '<p class="dt-desc">Was jede neue Session in diesem Projekt lädt. System prompt + tools sind fixe ' +
          'Näherungen (harness-abhängig); der Rest ist aus den Dateien geschätzt. Bei Skills/Agents zählt ' +
          'nur die je Skill/Agent geladene Metadaten (Name + Beschreibung), nicht die volle Datei ' +
          '(progressive disclosure). Hook-Injektion wird live ausgeführt.</p>' +
        '<div class="ctx-bar">' + segs + '<span class="ctx-seg ctx-seg-free" style="width:' +
          (free / win * 100) + '%"></span></div>' +
        '<div class="ctx-cats">' + rows + freeRow + "</div>" +
      "</div>";
      // Re-bind after every paint: detail.innerHTML was replaced, old listeners gone.
      // `toggle` does not bubble, so event delegation on `detail` would not work.
      // dataset.loaded guard prevents re-fetching already-loaded content.
      [].forEach.call(detail.querySelectorAll("details.ctx-readable"), function (det) {
        det.addEventListener("toggle", function () {
          if (!det.open) return;
          var host = det.querySelector(".ctx-readable-body");
          if (!host || host.dataset.loaded) return;
          host.dataset.loaded = "1";
          loadFile(host.dataset.read, { path: host.dataset.path || "" }, host);
        });
      });
    }

    paint();

    // Live hook injection — fetch once, then repaint with tokens + raw output.
    var hooksCat = null;
    for (var k = 0; k < cats.length; k++) { if (cats[k].live) hooksCat = cats[k]; }
    if (hooksCat) {
      fetch("/hook-inject?" + qs({ project: ACTIVE }))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          hooksCat.loaded = true;
          if (d && d.ok) {
            hooksCat.tokens = Number(d.tokens) || 0;
            hooksCat.output = String(d.output || "");
          } else {
            hooksCat.output = "Hook-Ausführung fehlgeschlagen" + (d && d.error ? ": " + d.error : "") + ".";
          }
          paint();
        })
        .catch(function (e) {
          hooksCat.loaded = true;
          hooksCat.output = "Fehler: " + String(e);
          paint();
        });
    }
  }

  /* ---------- project overview page (new landing for project view) ----------
     All data from window.DATA: COLL (coll), OV (overview), ACTIVE.
     tn-Org-Block: tn contents only from COLL.tn (active project). Cross-project
     only uses counts (OV.tn_total, header). */
  function renderProjectOverview() {
    var d = detail;
    d.innerHTML = "";
    d.className = "";

    // ---- helpers ----
    function fmtTok(n) { n = Number(n) || 0; return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(Math.round(n)); }
    function fmtCostLocal(v) { v = Number(v || 0); return v >= 1000 ? "$" + (v / 1000).toFixed(2) + "k" : "$" + v.toFixed(2); }
    function tag(cls, txt) { return '<span class="tag' + (cls ? " " + cls : "") + '">' + esc(txt) + "</span>"; }
    function prow(l, r, cls) { return '<div class="prow"><span class="pl">' + l + '</span><span class="pr' + (cls ? " " + cls : "") + '">' + r + "</span></div>"; }

    // ---- project meta ----
    var projName = ACTIVE || "Projekt";
    var branch = String((DATA.meta || {}).branch || "?");
    var psections = COLL["psections"] || {};
    var pdoc = psections.doc || {};
    var claudeTok = Number(pdoc.tokens || OV.claude_tok_project || 0);

    // ---- KPI data ----
    var tnItems = (COLL["tn"] || {}).items || [];
    var tnCount = tnItems.length;
    var tnOverdue = tnItems.filter(function(t) { return t.col === "overdue"; }).length;
    var tnBlocked = tnItems.filter(function(t) { return t.col === "blocked"; }).length;

    var msTotal = Number(OV.ms_total || 0);
    var msDone  = Number(OV.ms_done  || 0);
    var backlogOpen = Number(OV.backlog_open || 0);
    var proj7d = 0;
    // find per-project cost from DATA.projects array
    var projects = DATA.projects || [];
    for (var pi = 0; pi < projects.length; pi++) {
      if (projects[pi].name === ACTIVE) { proj7d = Number(projects[pi].cost_7d || 0); break; }
    }
    var projInitTok = OV.proj_init_tok || "0";

    // ---- decisions/changelog from knowledge ----
    var decisionItems = (COLL["decisions"] || {}).items || [];
    var changelogItems = (COLL["changelog"] || {}).items || [];
    var knowCounts = OV.know_counts || {};

    // ---- backlog milestones (COLL.backlog.items grouped by milestone) ----
    var blItems = (COLL["backlog"] || {}).items || [];
    // Group non-done tasks by milestone
    var msMap = {}, msOrder = [];
    blItems.forEach(function(it) {
      if (it.done) return;
      var msName = it.milestone || "(ohne Milestone)";
      if (!msMap[msName]) { msMap[msName] = []; msOrder.push(msName); }
      msMap[msName].push(it);
    });
    var blDoneItems = blItems.filter(function(it) { return it.done; });

    // milestone block HTML
    function msBlock(msName, tasks) {
      var openN = tasks.filter(function(t) { return !t.done; }).length;
      var totalN = tasks.length;
      var allDone = openN === 0;
      var cls = allDone ? " ms-done" : "";
      var countStr = allDone ? "fertig" : (openN + "/" + totalN + " offen");
      var subs = tasks.map(function(t) {
        var st = String(t.status || "").toLowerCase();
        var stCls = (st === "done") ? "done"
          : (st.indexOf("progress") >= 0) ? "wip" : "todo";
        var subCls = st === "done" ? " sub-done" : "";
        return '<div class="sub' + subCls + '">' +
          '<span class="ico st-' + stCls + '">' + statusIcon(stCls, 11) + "</span>" +
          '<span class="t">' + esc(t.title || t.name || "") + "</span></div>";
      }).join("");
      return '<div class="ms' + cls + '">' +
        '<div class="ms-head">' +
        '<span class="ms-t">' + esc(msName) + "</span>" +
        '<span class="ms-count">' + countStr + "</span></div>" +
        (subs ? '<div class="ms-sub">' + subs + "</div>" : "") +
        "</div>";
    }

    // tn section HTML (Überfällig/Next/Blockiert)
    var TN_SECS_DEF = [
      { key: "overdue", label: "Überfällig", cls: "sec-over"  },
      { key: "next",    label: "Next",        cls: "sec-next"  },
      { key: "blocked", label: "Blockiert",   cls: "sec-block" },
    ];
    function tnSectionHtml(secDef) {
      var items = tnItems.filter(function(t) { return t.col === secDef.key; });
      if (!items.length) return "";
      var rows = items.map(function(t) {
        var meta = secDef.key === "blocked"
          ? esc(t.desc || "blockiert")
          : esc(t.desc || "");
        return '<div class="tn-row">' +
          '<span class="tn-t">' + esc(t.name || "") + "</span>" +
          '<span class="tn-meta">' + meta + "</span></div>";
      }).join("");
      return '<div class="tn-sec ' + secDef.cls + '">' +
        '<div class="tn-sh">' + secDef.label + ' <span class="tn-shc">' + items.length + "</span></div>" +
        rows + "</div>";
    }

    // ---- CLAUDE.md sections as tags ----
    var sectionItems = psections.items || [];
    var sectionTags = sectionItems.map(function(s) { return tag("", s.name); }).join("");
    if (!sectionTags && claudeTok > 0) sectionTags = tag("", "(ganze Datei)");

    // ---- init-load token bar rows ----
    function tloadRows(items) {
      var max = 1;
      items.forEach(function(i) { if (Number(i.tok) > max) max = Number(i.tok); });
      return items.map(function(i) {
        return '<div class="row">' +
          '<div class="tl">' + esc(i.l) + "</div>" +
          '<div class="track"><i style="width:' + (Number(i.tok) / max * 100).toFixed(1) + '%;background:' + esc(i.color) + '"></i></div>' +
          '<div class="tv">' + fmtTok(i.tok) + '<small> tok</small></div>' +
          "</div>";
      }).join("");
    }
    var tloadItems = [];
    if (claudeTok) tloadItems.push({ l: "CLAUDE.md (Projekt)", tok: claudeTok, color: "var(--green)" });
    var ctxCats = (COLL["context"] || {}).categories || [];
    var memCat = null;
    ctxCats.forEach(function(c) { if (c.key === "memory") memCat = c; });
    var memTok = memCat ? Number(memCat.tokens || 0) : 0;
    if (memTok) tloadItems.push({ l: "Memory / CLAUDE.md", tok: memTok, color: "var(--mag)" });
    var initTotal = tloadItems.reduce(function(s, i) { return s + Number(i.tok); }, 0);

    // ---- assemble HTML ----
    var html =
      '<div class="ovwrap">' +
      // bar header
      '<div class="ovbar">' +
      '<h2><b>' + esc(projName) + "</b></h2>" +
      '<span class="branch">branch <code>' + esc(branch) + "</code></span>" +
      (claudeTok ? '<span class="hint">CLAUDE.md <b>~' + fmtTok(claudeTok) + " tok</b></span>" : "") +
      "</div>" +

      // 5 KPI tiles
      '<div class="ov-kpis">' +
      '<div class="ov-kpi c"><div class="k-l">tn-Tasks</div><div class="k-v">' + tnCount + '</div>' +
        '<div class="k-s">' + tnOverdue + ' überfällig · ' + tnBlocked + ' blockiert</div></div>' +
      '<div class="ov-kpi"><div class="k-l">Meilensteine</div><div class="k-v">' + msTotal + '</div>' +
        '<div class="k-s">' + msDone + ' fertig · Backlog.md</div></div>' +
      '<div class="ov-kpi a"><div class="k-l">Offene Subtasks</div><div class="k-v">' + backlogOpen + '</div>' +
        '<div class="k-s">über ' + (msTotal - msDone) + ' Meilensteine</div></div>' +
      '<div class="ov-kpi g"><div class="k-l">Kosten · 7 Tage</div><div class="k-v">' + fmtCostLocal(proj7d) + '</div>' +
        '<div class="k-s">dieses Projekt</div></div>' +
      '<div class="ov-kpi m"><div class="k-l">Projekt Init-Load</div><div class="k-v">' + fmtTok(projInitTok) + '<small> tok</small></div>' +
        '<div class="k-s">CLAUDE.md + memory</div></div>' +
      "</div>" +

      // Wissens-Reihe
      '<div class="panes">' +
      '<div class="pane w7">' +
        '<div class="p-head"><span class="pt">CLAUDE.md · Abschnitte</span>' +
          (claudeTok ? '<span class="pc">~' + fmtTok(claudeTok) + " tok</span>" : "") +
        '<span class="sp"></span></div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;">' + (sectionTags || '<span style="color:var(--faint);font-size:11px">keine Abschnitte</span>') + "</div>" +
        (tloadItems.length ? '<div class="p-head" style="margin-top:18px;"><span class="pt">Projekt Init-Load</span><span class="sp"></span></div>' +
          '<div class="tload">' + tloadRows(tloadItems) + "</div>" +
          '<div class="tload-foot"><span class="tf-l">Summe bei Projekt-Load</span><span class="tf-v">' + fmtTok(initTotal) + " tok</span></div>" : "") +
      "</div>" +

      '<div class="pane w5">' +
        '<div class="p-head"><span class="pt">Wissens-Index</span><span class="sp"></span></div>' +
        prow("<b>Decisions</b>", String(knowCounts.decisions || 0), "c") +
        prow("<b>Lektionen</b>", String(knowCounts.lektionen || 0), "") +
        prow("<b>Memory</b>", String(knowCounts.memory || 0), "") +
        prow("<b>Docs</b>", String(knowCounts.docs || 0), "") +
        (decisionItems.length
          ? '<div class="p-head" style="margin-top:18px;"><span class="pt">Decisions</span><span class="sp"></span></div>' +
            decisionItems.slice(0, 5).map(function(x) {
              return prow("<b>#" + esc(String(x.id || "")) + "</b> " + esc(x.name ? String(x.name).replace(/^\d+\s—\s/, "") : ""), esc(x.status || ""), "g");
            }).join("")
          : "") +
        (changelogItems.length
          ? '<div class="p-head" style="margin-top:18px;"><span class="pt">Changelog</span><span class="pc">' + changelogItems.length + "</span><span class=\"sp\"></span></div>" +
            changelogItems.slice(0, 5).map(function(x) {
              return prow(esc(x.name || ""), esc(x.desc ? String(x.desc).split("\n")[0] : ""), "");
            }).join("")
          : "") +
      "</div>" +

      // Aufgaben-Reihe — tn links, backlog rechts
      '<div class="pane w5">' +
        '<div class="p-head"><span class="pt">Tasknotes · tn</span><span class="pc">' + tnCount + "</span>" +
          '<span class="sp"></span><span class="src-tag">Tasknotes</span></div>' +
        (tnCount
          ? TN_SECS_DEF.map(tnSectionHtml).join("")
          : '<div style="color:var(--faint);font-size:11px;padding:6px 0">Keine tn-Tasks</div>') +
      "</div>" +

      '<div class="pane w7">' +
        '<div class="p-head"><span class="pt">Backlog · Meilensteine &amp; Subtasks</span>' +
          '<span class="pc">' + backlogOpen + " offen</span>" +
          '<span class="sp"></span><span class="src-tag">Backlog.md</span></div>' +
        (msOrder.length
          ? msOrder.map(function(msName) { return msBlock(msName, msMap[msName]); }).join("")
          : '<div style="color:var(--faint);font-size:11px;padding:6px 0">Keine offenen Meilensteine</div>') +
        (blDoneItems.length
          ? '<details style="margin-top:8px"><summary style="font-size:10px;color:var(--dim);cursor:pointer;padding:4px 0">Done <span style="color:var(--faint)">' + blDoneItems.length + "</span></summary>" +
            blDoneItems.map(function(t) {
              return '<div class="sub sub-done"><span class="ico st-done">' + statusIcon("done", 11) + "</span>" +
                '<span class="t">' + esc(t.title || t.name || "") + "</span></div>";
            }).join("") + "</details>"
          : "") +
      "</div>" +

      "</div></div>"; // panes + ovwrap

    d.innerHTML = html;
    list.innerHTML = "";
  }

  /* ---------- overview (tmux grid) ---------- */
  function ovTile(go, dot, title, body) {
    return '<div class="pane w3 link" data-go="' + go + '"><div class="p-head"><span class="dot' + dotCls(dot) + '"' +
      dotStyle(dot) + '></span><span class="pt">' + esc(title) + '</span><span class="sp"></span></div>' + body + "</div>";
  }
  function miniRL(label, rl) {
    if (!rl) return '<div class="rlm-row"><span class="rlm-l">' + label + '</span><span class="rlm-na">n/a</span></div>';
    var p = Math.max(0, Math.min(100, Number(rl.used_pct) || 0));
    return '<div><div class="rlm-row"><span class="rlm-l">' + label + '</span>' +
      '<span class="rlm-v">' + esc(rl.used_pct) + "% → " + esc(rl.projected_pct) + "% · " + esc(rl.resets_in) + "</span></div>" +
      '<div class="prog"><i style="width:' + p + '%"></i></div></div>';
  }
  function renderOverview() {
    var grid =
      ovTile("skills", "g", "Global",
        '<div class="duo"><div class="n" style="color:var(--green)">' + (OV.skills || 0) + '<small>Skills</small></div>' +
        '<div class="n" style="color:var(--cyan)">' + (OV.agents || 0) + '<small>Agents</small></div>' +
        '<div class="n">' + (OV.hooks || 0) + '<small>Hooks</small></div></div>' +
        '<div style="margin-top:9px;color:var(--dim);font-size:11px">Skills ~' + esc(OV.skills_tok || "0") +
        " tok · Agents ~" + esc(OV.agents_tok || "0") + " tok (SKILL.md/Definition gesamt)</div>") +
      ovTile("git", "g", "Git",
        '<div class="scan" style="color:var(--green)">' + esc(OV.branch || "?") +
        '<small> · ' + (OV.dirty ? "dirty" : "clean") + "</small></div>" +
        '<div style="margin-top:9px;color:var(--dim);font-size:11px">' + esc(OV.git_recommend || "") + "</div>") +
      ovTile("boards", "a", "Backlog",
        '<div class="duo"><div class="n" style="color:var(--green)">' + (OV.ms_done || 0) + "/" + (OV.ms_total || 0) +
        '<small>Meilensteine fertig</small></div>' +
        '<div class="n" style="color:var(--cyan)">' + (OV.tasks_done || 0) + "/" + (OV.tasks_total || 0) +
        '<small>Tasks done</small></div>' +
        '<div class="n" style="color:var(--amber)">' + (OV.backlog_inprogress || 0) + '<small>in progress</small></div></div>' +
        '<div style="margin-top:9px">' + (OV.milestones || []).map(function (m) { return '<span class="badge a">' + esc(m) + "</span> "; }).join("") + "</div>") +
      ovTile("cost", "m", "Kosten · Limits",
        '<div class="scan" style="color:var(--mag)">' + esc(OV.cost_week || "$0") + '<small> Woche</small></div>' +
        '<div style="margin:7px 0 10px;color:var(--dim);font-size:11px">heute ' + esc(OV.cost_today || "$0") + " · total " + esc(OV.cost_total || "$0") + "</div>" +
        '<div class="rlwrap">' + miniRL("5h-Limit", OV.cost_5h) + miniRL("7d-Limit", OV.cost_7d) + "</div>") +
      ovTile("decisions", "g", "Decisions",
        '<ul class="list">' + (OV.decisions || []).map(function (d) {
          return '<li><span class="ix">' + esc(d.id) + '</span><span class="tx">' + esc(d.title) + "</span></li>";
        }).join("") + "</ul>") +
      ovTile("sessions", "m", "Tokens · Sessions",
        '<div class="scan" style="color:var(--mag)">' + esc(OV.tok_last || "—") + '<small> letzte (' + esc(OV.cost_last || "—") + " ≈)</small></div>" +
        '<div style="margin-top:9px;color:var(--dim);font-size:11px">7-Tage: ' + esc(OV.tok_week || "—") +
        " · alle Sessions: " + esc(OV.tok_sessions || "—") + " (" + esc(OV.cost_sessions || "—") + " ≈)</div>") +
      (function () {
        var kc = OV.know_counts || {};
        return ovTile("memory", "g", "Wissen",
          '<div class="duo"><div class="n" style="color:var(--green)">' + (kc.decisions || 0) + '<small>Decisions</small></div>' +
          '<div class="n">' + (kc.memory || 0) + '<small>Memory</small></div>' +
          '<div class="n" style="color:var(--amber)">' + (kc.lektionen || 0) + '<small>Lektionen</small></div></div>' +
          '<div style="margin-top:9px;color:var(--dim);font-size:11px">knowledge/ ' + (kc.pknow || 0) +
          " · CHANGELOG " + (kc.changelog || 0) + " · CLAUDE.md ~" + esc(OV.claude_tok_project || "0") + " tok</div>");
      })() +
      ovTile("sessions", "r", "Sessions · Health",
        '<div class="scan" style="color:' + ((OV.errors_total || 0) > 0 ? "var(--red)" : "var(--green)") + '">' + (OV.errors_total || 0) + '<small> Fehler</small></div>' +
        '<div style="margin-top:9px;color:var(--dim);font-size:11px">' + (OV.repeats_total || 0) + " wiederholte Commands</div>" +
        ((OV.top_tools || []).length ? '<div style="margin-top:6px;color:var(--faint);font-size:10.5px">Top: ' +
          (OV.top_tools || []).map(function (t) { return esc(t[0]) + " " + t[1]; }).join(" · ") + "</div>" : "")) +
      ovTile("boards", "c", "tn · TaskNotes",
        OV.tn_available
          ? '<div class="duo"><div class="n" style="color:var(--cyan)">' + (OV.tn_next || 0) + '<small>next</small></div>' +
            '<div class="n" style="color:var(--red)">' + (OV.tn_blocked || 0) + '<small>blocked</small></div></div>' +
            '<div style="margin-top:9px;color:var(--dim);font-size:11px">projektübergreifend gesamt: <b style="color:var(--fg)">' + (OV.tn_total || 0) + '</b> tn-Tasks</div>'
          : '<div class="scan" style="color:var(--faint);font-size:15px">n/a<small> kein Vault</small></div>') +
      // "psections" has no SPECIAL handler — clicking falls through to renderList,
      // which shows the CLAUDE.md sections list. That is intentional.
      (ACTIVE ? ovTile("psections", "a", "Projekt-Settings",
        '<div class="duo"><div class="n" style="color:var(--green)">' + (OV.proj_skills || 0) + '<small>Skills</small></div>' +
        '<div class="n">' + (OV.proj_hooks || 0) + '<small>Hooks</small></div>' +
        '<div class="n" style="color:var(--cyan)">' + (OV.proj_agents || 0) + '<small>Agents</small></div></div>' +
        '<div style="margin-top:9px;color:var(--dim);font-size:11px">Init-Context ~' + esc(OV.proj_init_tok || "0") + ' tok/Session (global+projekt CLAUDE.md) · Projekt-CLAUDE.md ~' + esc(OV.claude_tok_project || "0") + ' tok</div>') : "");
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

  /* ---------- theme toggle (Catppuccin Mocha ⇄ Latte) ---------- */
  (function () {
    var btn = document.getElementById("kn-theme-toggle");
    if (!btn) return;
    function eff() {
      var e = document.documentElement.dataset.theme;
      if (e === "light" || e === "dark") return e;
      try { return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"; }
      catch (x) { return "dark"; }
    }
    function sync() {
      var cur = eff();
      // show the icon for the mode you'd switch TO
      btn.textContent = cur === "light" ? "☾" : "☀";
      btn.title = "Theme: " + cur + " · klick → " + (cur === "light" ? "dark" : "light");
    }
    btn.addEventListener("click", function () {
      var next = eff() === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("kn-theme", next); } catch (x) {}
      sync();
    });
    sync();
  })();

  /* popstate: user pressed Back/Forward — restore the view from the history state (CCS-034).
     If the popped URL belongs to a different project, reload the full page so the server
     can build DATA for that project. */
  window.addEventListener("popstate", function (e) {
    var state = e.state;
    var viewId = state && state.view ? String(state.view) : "";
    // Parse the current pathname to detect a project change
    var segs = window.location.pathname.slice(1).split("/").filter(function (s) { return s.length > 0; });
    var pathProject = segs.length >= 1 ? decodeURIComponent(segs[0]) : "";
    // If the path project differs from the active project, reload (server builds DATA for that project)
    if (ACTIVE && pathProject && pathProject !== ACTIVE) {
      window.location.reload();
      return;
    }
    if (!ACTIVE && pathProject) {
      window.location.reload();
      return;
    }
    // Same project — restore view client-side without adding another history entry
    suppressPush = true;
    try { select(viewId || ((NAV[0] && NAV[0].items && NAV[0].items[0] && NAV[0].items[0].id) || "ov")); }
    finally { suppressPush = false; }
  });

  /* boot — determine initial view:
   *  1. window.INITIAL_VIEW (set by server for path-URL loads, CCS-034)
   *  2. fallback to first nav entry (existing behaviour)
   * Use replaceState so the initial load doesn't add an extra history entry. */
  (function () {
    var firstNavId = (NAV[0] && NAV[0].items && NAV[0].items[0] && NAV[0].items[0].id) || "ov";
    // Collect all known nav IDs for validation
    var allNavIds = {};
    NAV.forEach(function (grp) {
      (grp.items || []).forEach(function (it) { if (it.id) allNavIds[it.id] = true; });
    });
    // SPECIAL IDs are also valid targets (boards, milestones, cost, context, ov)
    var allSpecial = { ov: true, cost: true, boards: true, milestones: true, context: true };

    var hint = (typeof window !== "undefined" && window.INITIAL_VIEW) ? String(window.INITIAL_VIEW) : "";
    var bootId = (hint && (allNavIds[hint] || allSpecial[hint] || hint === "backlog" || hint === "tn" || hint === "git")) ? hint : firstNavId;

    suppressPush = true;
    try {
      select(bootId);
      // Replace the initial history entry with the canonical path for this view
      try {
        history.replaceState({ view: bootId }, "", viewToPath(bootId));
      } catch (e) { /* history API not available in test env */ }
    } finally {
      suppressPush = false;
    }
  })();
})();
