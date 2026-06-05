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
      var head = '<div class="fmeta">~' + ktok(d.tokens) + " tok · " + de(d.size) + " B</div>";
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

  var SPECIAL = { ov: 1, cost: 1 };

  /* ---------- nav ---------- */
  NAV.forEach(function (grp) {
    nav.appendChild(el('<div class="nav-g">' + esc(grp.g) + "</div>"));
    (grp.items || []).forEach(function (it) {
      var c;
      if (it.id === "ov") c = "grid";
      else if (it.id === "git") c = GIT && GIT.files_struct ? GIT.files_struct.length : "·";
      else if (it.id === "cost") c = "$";
      else c = COLL[it.id] ? COLL[it.id].items.length : 0;
      var ncInner = esc(c) + (it.tok ? '<small>~' + esc(it.tok) + " tok</small>" : "");
      var row = el(
        '<div class="nav-i" data-id="' + esc(it.id) + '">' +
          '<span class="dot' + dotCls(it.dot) + '"' + dotStyle(it.dot) + "></span>" +
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
      renderBoard();
      return;
    }
    if (id === "git") { mp.classList.remove("is-overview"); state.coll = null; renderGit(); return; }
    if (SPECIAL[id]) {
      mp.classList.add("is-overview");
      if (id === "ov") renderOverview();
      else if (id === "cost") renderCost();
      return;
    }
    mp.classList.remove("is-overview");
    state.coll = id; state.idx = 0;
    renderList(""); selectItem(0);
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
        '<span class="bh-hint">Drag eine Karte in eine andere Spalte → Status</span></div>',
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
      var lead = c.type === "decision"
        ? '<span class="li-ix">' + esc(r.it.id) + "</span>"
        : '<span class="dot li-dot' + dotCls(statusDot(c, r.it)) + '"' + dotStyle(c.accent) + "></span>";
      var nm = c.type === "decision" ? String(r.it.name).replace(/^\d+\s—\s/, "") : r.it.name;
      var row = el(
        '<div class="li" data-i="' + r.i + '">' + lead +
          '<div><div class="li-n">' + esc(nm) + "</div>" +
          (sub ? '<div class="li-s">' + esc(sub) + "</div>" : "") + "</div>" +
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
      if (it.has_md) secs.push({ h: "SKILL.md", html: '<div class="filehost" data-read="skill" data-name="' + esc(it.name) + '"></div>' });
      else secs.push({ h: "SKILL.md", html: '<div class="dt-empty">keine SKILL.md gefunden</div>' });
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
      secs.push({ h: "Agent-Definition", html: '<div class="filehost" data-read="agent" data-name="' + esc(it.name) + '"></div>' });
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
      secs.push({ h: "Eintrag", html: '<div class="prose">' + esc(it.name) + "</div>" });
      eyebrow = "CHANGELOG · " + c.scope; desc = "";
    } else if (c.type === "decision") {
      var st = statusPair(it.status); b.push(badge(st[0], st[1])); b.push(badge("", "ADR " + esc(it.id)));
      meta.push(metaCell("ID", esc(it.id))); meta.push(metaCell("Status", st[1]));
      if (it.ctx) secs.push({ h: "Kontext", html: '<div class="prose">' + esc(it.ctx) + "</div>" });
      if (it.dec) secs.push({ h: "Entscheidung", html: '<div class="prose">' + esc(it.dec) + "</div>" });
      if (it.body) secs.push({ h: "Inhalt", html: '<pre class="filebody">' + esc(it.body) + "</pre>" });
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
        ? "Eintrag"
        : (c.type === "task" && it.title ? it.title : it.name);
    detail.innerHTML = '<div class="dt">' +
      '<div class="dt-eyebrow">' + esc(eyebrow) + "</div>" +
      '<h2><span class="mono">' + esc(title) + "</span></h2>" +
      (b.length ? '<div class="dt-badges">' + b.join("") + "</div>" : "") +
      (descHtml ? '<p class="dt-desc">' + descHtml + "</p>"
        : (desc ? '<p class="dt-desc">' + esc(desc) + "</p>" : "")) +
      (meta.length ? '<div class="dt-meta">' + meta.join("") + "</div>" : "") +
      // section headers are code-built (dynamic parts already esc()'d) -> emit raw
      secs.map(function (s) { return '<div class="dt-sec"><div class="sh">' + s.h + "</div>" + s.html + "</div>"; }).join("") +
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
      ovTile("backlog", "a", "Backlog",
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
      ovTile("tn", "c", "tn · TaskNotes",
        OV.tn_available
          ? '<div class="duo"><div class="n" style="color:var(--cyan)">' + (OV.tn_next || 0) + '<small>next</small></div>' +
            '<div class="n" style="color:var(--red)">' + (OV.tn_blocked || 0) + '<small>blocked</small></div></div>'
          : '<div class="scan" style="color:var(--faint);font-size:15px">n/a<small> kein Vault</small></div>');
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

  /* boot — land on the first nav entry (overview view: Milestones; project view: Übersicht) */
  select((NAV[0] && NAV[0].items && NAV[0].items[0] && NAV[0].items[0].id) || "ov");
})();
