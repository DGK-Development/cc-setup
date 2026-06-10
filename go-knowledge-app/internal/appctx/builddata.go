package appctx

import (
	"sort"
	"strings"

	"go-knowledge-app/internal/collectors"
	"go-knowledge-app/internal/md"
)

const builtinSkillsTok = 1700

// BuildData maps collector cards into the browser DATA object (mirrors build_data).
// view is "overview" or "project".
func BuildData(context map[string]any, view string) map[string]any {
	ctx := aMap(dyn(context))
	cards := aMap(ctx["cards"])

	av := func(key string) map[string]any {
		c := aMap(cards[key])
		if c != nil && aBool(c["available"]) {
			return c
		}
		return map[string]any{}
	}

	g, p, kn := av("global"), av("project"), av("knowledge")
	bl, tnc, tok := av("backlog"), av("tn"), av("tokens")
	gitc := aMap(cards["git"])
	if gitc == nil {
		gitc = map[string]any{}
	}
	costc := aMap(cards["cost"])
	if costc == nil {
		costc = map[string]any{}
	}

	// --- Skills ---
	skillsCard := aMap(g["skills"])
	var skillItems []any
	if it, ok := skillsCard["items"].([]any); ok {
		skillItems = it
	} else {
		for _, n := range aArr(skillsCard["names"]) {
			skillItems = append(skillItems, map[string]any{"name": n})
		}
	}
	skills := make([]map[string]any, 0, len(skillItems))
	for _, raw := range skillItems {
		s := aMap(raw)
		skills = append(skills, map[string]any{
			"name":       s["name"],
			"cat":        "",
			"desc":       aStr(s["description"]),
			"tokens":     aNum(s["tokens"]),
			"metaTokens": aNum(s["meta_tokens"]),
			"size":       aNum(s["size_bytes"]),
			"has_md":     aBool(s["has_md"]),
			"scripts":    orEmptyArr(s["scripts"]),
		})
	}
	skillsTok := sumField(skills, "tokens")

	// --- Agents ---
	var agentItems []any
	if it, ok := g["agent_items"].([]any); ok {
		agentItems = it
	} else {
		for _, n := range aArr(g["agents"]) {
			agentItems = append(agentItems, map[string]any{"name": n})
		}
	}
	agents := make([]map[string]any, 0, len(agentItems))
	for _, raw := range agentItems {
		a := aMap(raw)
		agents = append(agents, map[string]any{
			"name":       a["name"],
			"role":       aStr(a["description"]),
			"tools":      []any{},
			"tokens":     aNum(a["tokens"]),
			"metaTokens": aNum(a["meta_tokens"]),
			"size":       aNum(a["size_bytes"]),
		})
	}
	agentsTok := sumField(agents, "tokens")

	// --- Hooks ---
	settings := aMap(g["settings"])
	hookEvents := aMap(settings["hook_events"])
	hookDetail := aMap(settings["hook_detail"])
	hookNames := sortedKeys(hookEvents)
	hooks := make([]map[string]any, 0, len(hookNames))
	for _, name := range hookNames {
		entries := orEmptyArr(hookDetail[name])
		hooks = append(hooks, map[string]any{"name": name, "count": hookEvents[name], "entries": entries})
	}

	// --- Project knowledge ---
	pknow := []map[string]any{}
	for _, raw := range aArr(p["knowledge_index"]) {
		e := aMap(raw)
		path := aStr(e["path"])
		typ := ""
		if path != "" {
			parts := strings.Split(path, ".")
			typ = parts[len(parts)-1]
		}
		pknow = append(pknow, map[string]any{"name": e["title"], "type": typ, "desc": nc(e["desc"], ""), "path": nc(e["path"], "")})
	}

	// --- Project CLAUDE.md ---
	psections := []map[string]any{}
	for _, raw := range aArr(p["claude_md_headers"]) {
		psections = append(psections, map[string]any{"name": raw, "type": "section", "desc": ""})
	}
	pdoc := map[string]any{
		"kind":   "claude-project",
		"tokens": aNum(p["claude_md_tokens"]),
		"size":   aNum(p["claude_md_size"]),
	}
	psectionsEff := psections
	if len(psectionsEff) == 0 && (aBool(pdoc["tokens"]) || aBool(pdoc["size"])) {
		psectionsEff = []map[string]any{{"name": "(ganze Datei)", "type": "section", "desc": ""}}
	}

	// --- Global CLAUDE.md ---
	gmd := aMap(g["claude_md"])
	gsections := []map[string]any{}
	for _, raw := range aArr(gmd["headers"]) {
		gsections = append(gsections, map[string]any{"name": raw, "type": "section", "desc": ""})
	}
	gdoc := map[string]any{
		"kind":    "claude-global",
		"tokens":  aNum(gmd["tokens"]),
		"size":    aNum(gmd["size_bytes"]),
		"managed": aBool(gmd["managed_block"]),
	}
	gsectionsEff := gsections
	if len(gsectionsEff) == 0 && (aBool(gdoc["tokens"]) || aBool(gdoc["size"])) {
		gsectionsEff = []map[string]any{{"name": "(ganze Datei)", "type": "section", "desc": ""}}
	}

	// --- Knowledge ---
	decisions := []map[string]any{}
	for _, raw := range aArr(kn["decisions"]) {
		d := aMap(raw)
		decisions = append(decisions, map[string]any{
			"name":   aStr(d["id"]) + " — " + aStr(d["title"]),
			"id":     d["id"],
			"status": aStr(d["status"]),
			"ctx":    "",
			"dec":    "",
			"body":   aStr(d["body"]),
			"date":   md.FmtMtime(numOr0(d["mtime"])),
		})
	}
	memory := []map[string]any{}
	for _, raw := range aArr(kn["memory"]) {
		if s, ok := raw.(string); ok {
			memory = append(memory, map[string]any{"name": s, "desc": "", "date": ""})
		} else {
			m := aMap(raw)
			memory = append(memory, map[string]any{"name": aStr(m["name"]), "desc": "", "date": md.FmtMtime(numOr0(m["mtime"]))})
		}
	}
	lessons := []map[string]any{}
	for _, raw := range aArr(kn["lektionen"]) {
		if s, ok := raw.(string); ok {
			lessons = append(lessons, map[string]any{"name": s, "desc": "", "date": ""})
		} else {
			x := aMap(raw)
			lessons = append(lessons, map[string]any{"name": aStr(x["name"]), "desc": "", "date": md.FmtMtime(numOr0(x["mtime"]))})
		}
	}
	changelog := []map[string]any{}
	for _, raw := range aArr(kn["changelog"]) {
		if s, ok := raw.(string); ok {
			changelog = append(changelog, map[string]any{"name": s, "body": "", "type": "changelog", "desc": ""})
		} else {
			c := aMap(raw)
			body := nc(c["body"], "")
			descParts := []string{}
			for _, ln := range strings.Split(body, "\n") {
				if ln != "" {
					descParts = append(descParts, ln)
				}
				if len(descParts) >= 2 {
					break
				}
			}
			changelog = append(changelog, map[string]any{
				"name": c["heading"], "body": body, "type": "changelog",
				"desc": strings.Join(descParts, " · "),
			})
		}
	}
	docs := []map[string]any{}
	for _, raw := range aArr(kn["docs"]) {
		d := aMap(raw)
		docs = append(docs, map[string]any{
			"name":  d["file"],
			"title": d["title"],
			"id":    d["id"],
			"desc":  d["title"],
			"date":  md.FmtMtime(numOr0(d["mtime"])),
		})
	}

	// --- Backlog tasks ---
	statusOrder := map[string]int{"in progress": 0, "to do": 1, "blocked": 2, "done": 9}
	statusRank := func(v any) int {
		if r, ok := statusOrder[lowerTrim(v)]; ok {
			return r
		}
		return 5
	}
	blTasks := aArr(bl["tasks"])

	// Milestone-Definer-Erkennung: Ein Task, dessen id == parent_task_id der
	// Subtasks eines Milestones ist, *definiert* diesen Milestone. Sein Titel
	// verlinkt die Gruppen-Ueberschrift (milestoneLinks); er selbst wird aus der
	// Task-Liste ausgeblendet, statt faelschlich als "ohne Milestone" zu erscheinen.
	taskByID := map[string]map[string]any{}
	for _, raw := range blTasks {
		t := aMap(raw)
		if id := aStr(t["id"]); id != "" {
			taskByID[id] = t
		}
	}
	msParent := map[string]string{}
	msParentConflict := map[string]bool{}
	for _, raw := range blTasks {
		t := aMap(raw)
		ms, par := aStr(t["milestone"]), aStr(t["parent"])
		if ms == "" || ms == "—" || par == "" {
			continue
		}
		if prev, ok := msParent[ms]; ok {
			if prev != par {
				msParentConflict[ms] = true
			}
		} else {
			msParent[ms] = par
		}
	}
	milestoneLinks := map[string]any{}
	hideIDs := map[string]bool{}
	for ms, par := range msParent {
		if msParentConflict[ms] {
			continue // mehrdeutiger Parent → kein eindeutiger Definer, nicht verlinken
		}
		pt, ok := taskByID[par]
		if !ok {
			continue // Parent-Task existiert nicht als Datei → nichts zu verlinken
		}
		milestoneLinks[ms] = map[string]any{"id": par, "file": aStr(pt["file"]), "title": aStr(pt["title"])}
		hideIDs[par] = true
	}

	openTasks := []map[string]any{}
	doneTasks := []map[string]any{}
	for _, raw := range blTasks {
		t := aMap(raw)
		if hideIDs[aStr(t["id"])] {
			continue // Milestone-Definer → erscheint als Gruppen-Header-Link, nicht als Zeile
		}
		if lowerTrim(t["status"]) == "done" {
			doneTasks = append(doneTasks, t)
		} else {
			openTasks = append(openTasks, t)
		}
	}
	sort.SliceStable(openTasks, func(i, j int) bool {
		a, b := openTasks[i], openTasks[j]
		ma, mb := nc(a["milestone"], "~"), nc(b["milestone"], "~")
		if ma != mb {
			return localeLess(ma, mb)
		}
		sa, sb := statusRank(a["status"]), statusRank(b["status"])
		if sa != sb {
			return sa < sb
		}
		return localeLess(aStr(a["id"]), aStr(b["id"]))
	})
	sort.SliceStable(doneTasks, func(i, j int) bool { return localeLess(aStr(doneTasks[i]["id"]), aStr(doneTasks[j]["id"])) })

	taskItem := func(t map[string]any, group string, done bool) map[string]any {
		ms := aStr(t["milestone"])
		if ms == "" {
			ms = "—"
		}
		return map[string]any{
			"name":      t["id"],
			"title":     aStr(t["title"]),
			"status":    lowerTrim(t["status"]),
			"milestone": ms,
			"group":     group,
			"done":      done,
			"desc":      aStr(t["desc"]),
			"file":      aStr(t["file"]),
			"mtime":     aNum(t["mtime"]),
		}
	}
	tasks := []map[string]any{}
	for _, t := range openTasks {
		ms := aStr(t["milestone"])
		if ms == "" {
			ms = "—"
		}
		tasks = append(tasks, taskItem(t, ms, false))
	}
	for _, t := range doneTasks {
		tasks = append(tasks, taskItem(t, "Done", true))
	}

	// --- tn items ---
	tnItems := []map[string]any{}
	for _, raw := range aArr(tnc["next"]) {
		t := aMap(raw)
		tnItems = append(tnItems, map[string]any{"id": t["id"], "name": t["title"], "status": nc(t["status"], "action"), "desc": aStr(t["next_action"]), "project": t["project"], "col": "next"})
	}
	for _, raw := range aArr(tnc["blocked"]) {
		t := aMap(raw)
		tnItems = append(tnItems, map[string]any{"id": t["id"], "name": t["title"], "status": "blocked", "desc": "", "project": t["project"], "col": "blocked"})
	}
	for _, raw := range aArr(tnc["overdue"]) {
		t := aMap(raw)
		tnItems = append(tnItems, map[string]any{"id": t["id"], "name": t["title"], "status": "overdue", "desc": aStr(t["scheduled"]), "project": t["project"], "col": "overdue"})
	}

	// --- Sessions ---
	var last map[string]any
	if lm, ok := tok["last_session"].(map[string]any); ok {
		last = lm
	}
	sessSrc := aArr(tok["sessions"])
	if sessSrc == nil && last != nil {
		sessSrc = []any{last}
	}
	sessions := []map[string]any{}
	for _, raw := range sessSrc {
		s := aMap(raw)
		if s == nil {
			continue
		}
		total := s["total"]
		var totalVal float64
		if total != nil {
			totalVal = aNum(total)
		} else {
			totalVal = aNum(s["input"]) + aNum(s["output"]) + aNum(s["cache_read"]) + aNum(s["cache_creation"])
		}
		sessions = append(sessions, map[string]any{
			"name":         s["session_id"],
			"date":         aStr(s["date"]),
			"turns":        aNum(s["turns"]),
			"input":        aNum(s["input"]),
			"output":       aNum(s["output"]),
			"cc":           aNum(s["cache_creation"]),
			"cr":           aNum(s["cache_read"]),
			"total":        totalVal,
			"cost":         aNum(s["cost"]),
			"error_count":  aNum(s["error_count"]),
			"errors":       orEmptyArr(s["errors"]),
			"repeat_count": aNum(s["repeat_count"]),
			"repeats":      orEmptyArr(s["repeats"]),
		})
	}
	sessionsTok := sumField(sessions, "total")
	sessionsCost := sumField(sessions, "cost")
	week := aMap(tok["week"])

	// --- Cross-project open tasks (Überblick Kanban) ---
	msItems := []map[string]any{}
	for _, raw := range aArr(ctx["projects"]) {
		pr := aMap(raw)
		openT, hasOpenT := pr["openTasks"]
		if hasOpenT && openT != nil {
			for _, traw := range aArr(openT) {
				t := aMap(traw)
				proj := aStr(t["project"])
				if proj == "" {
					proj = aStr(pr["name"])
				}
				mst := aStr(t["milestone"])
				if mst == "" {
					mst = "(ohne Milestone)"
				}
				msItems = append(msItems, map[string]any{
					"name": t["id"], "title": t["title"], "status": t["status"],
					"group": proj, "milestone": mst, "done": false,
					"desc": proj + " · " + aStr(t["id"]), "file": t["file"], "project": proj,
				})
			}
			continue
		}
		// Fallback: old milestone+looseTasks approach
		prName := aStr(pr["name"])
		for _, mraw := range aArr(pr["milestones"]) {
			m := aMap(mraw)
			status := "in progress"
			if aNum(m["done"]) == aNum(m["total"]) {
				status = "done"
			}
			msItems = append(msItems, map[string]any{
				"name": m["name"], "title": fmtInt(m["done"]) + "/" + fmtInt(m["total"]) + " Tasks",
				"status": status, "group": prName, "milestone": "Milestone", "done": false,
				"desc": prName + " · Milestone · " + fmtInt(m["done"]) + "/" + fmtInt(m["total"]) + " Tasks", "project": prName,
			})
		}
		for _, lraw := range aArr(pr["looseTasks"]) {
			t := aMap(lraw)
			msItems = append(msItems, map[string]any{
				"name": t["id"], "title": t["title"], "status": t["status"],
				"group": prName, "milestone": "(ohne Milestone)", "done": false,
				"desc": prName + " · " + aStr(t["id"]) + " (ohne Milestone)", "file": t["file"], "project": prName,
			})
		}
	}

	// --- Kontext view (CCS-034C) ---
	pluginSkills := aArr(ctx["plugin_skills"])
	pluginAgents := aArr(ctx["plugin_agents"])
	projAgents := aArr(ctx["project_agents"])

	memCard := aMap(cards["memory_md"])
	memMdAvail := aBool(memCard["available"])
	memMdTok := aNum(memCard["tokens"])

	memoryItems := []map[string]any{}
	if aBool(gdoc["tokens"]) {
		memoryItems = append(memoryItems, map[string]any{
			"name": "CLAUDE.md (global)", "tokens": collectors.CtxTok(int(aNum(gdoc["tokens"]))),
			"desc": "~/.claude/CLAUDE.md", "read": "claude-global",
		})
	}
	if aBool(pdoc["tokens"]) {
		repoName := nc(aMap(cards["project"])["repo"], "Projekt")
		memoryItems = append(memoryItems, map[string]any{
			"name": "CLAUDE.md (Projekt)", "tokens": collectors.CtxTok(int(aNum(pdoc["tokens"]))),
			"desc": repoName + "/CLAUDE.md", "read": "claude-project",
		})
	}
	if memMdAvail && memMdTok != 0 {
		memPath := aStr(memCard["path"])
		claudeDir := collectors.Home() + "/.claude"
		item := map[string]any{"name": "MEMORY.md", "tokens": collectors.CtxTok(int(memMdTok)), "desc": memPath}
		if strings.HasPrefix(memPath, claudeDir) && memPath != "" {
			item["read"] = "homefile"
			item["readPath"] = memPath
		}
		memoryItems = append(memoryItems, item)
	}
	memoryTok := sumField(memoryItems, "tokens")

	// Agents context (Project → User → Plugin)
	agentItemsCtx := []map[string]any{}
	for _, raw := range projAgents {
		a := aMap(raw)
		agentItemsCtx = append(agentItemsCtx, map[string]any{
			"name": a["name"], "tokens": aNum(a["meta_tokens"]), "desc": a["description"],
			"group": a["group"], "read": a["read"], "readPath": a["readPath"],
		})
	}
	for _, a := range agents {
		agentItemsCtx = append(agentItemsCtx, map[string]any{
			"name": aStr(a["name"]), "tokens": collectors.CtxTok(int(aNum(a["metaTokens"]))),
			"desc": a["role"], "group": "User", "read": "agent",
		})
	}
	for _, raw := range pluginAgents {
		a := aMap(raw)
		agentItemsCtx = append(agentItemsCtx, map[string]any{
			"name": a["name"], "tokens": aNum(a["meta_tokens"]), "desc": a["description"],
			"group": a["group"], "read": a["read"], "readPath": a["readPath"],
		})
	}
	agentsCtxTok := sumField(agentItemsCtx, "tokens")

	// Skills context (User → Plugin → Built-in)
	skillItemsCtx := []map[string]any{}
	for _, s := range skills {
		skillItemsCtx = append(skillItemsCtx, map[string]any{
			"name": aStr(s["name"]), "tokens": collectors.CtxTok(int(aNum(s["metaTokens"]))),
			"desc": s["desc"], "group": "User", "read": "skill",
		})
	}
	for _, raw := range pluginSkills {
		s := aMap(raw)
		skillItemsCtx = append(skillItemsCtx, map[string]any{
			"name": s["name"], "tokens": aNum(s["meta_tokens"]), "desc": s["description"],
			"group": s["group"], "read": s["read"], "readPath": s["readPath"],
		})
	}
	skillItemsCtx = append(skillItemsCtx, map[string]any{
		"name": "(Built-in ≈)", "tokens": float64(builtinSkillsTok),
		"desc": "run / browser / verify-ui u.a. — nicht lesbar", "group": "Built-in",
	})
	skillsCtxTok := sumField(skillItemsCtx, "tokens")

	contextCategories := []map[string]any{
		{"key": "system_prompt", "label": "System prompt", "tokens": float64(collectors.SysPromptTok), "fixed": true, "items": []any{}},
		{"key": "system_tools", "label": "System tools", "tokens": float64(collectors.SysToolsTok), "fixed": true, "items": []any{}},
		{"key": "agents", "label": "Custom agents", "tokens": agentsCtxTok, "items": agentItemsCtx},
		{"key": "skills", "label": "Skills", "tokens": skillsCtxTok, "items": skillItemsCtx},
		{"key": "memory", "label": "Memory files", "tokens": memoryTok, "items": memoryItems},
		{"key": "hooks", "label": "Hook-Injektion", "tokens": float64(0), "live": true, "items": []any{}},
	}
	contextMeasuredTotal := 0.0
	for _, c := range contextCategories {
		if c["live"] == true {
			continue
		}
		contextMeasuredTotal += aNum(c["tokens"])
	}

	coll := map[string]any{
		"milestones": map[string]any{"title": "Backlog projektweit", "scope": "alle Projekte", "type": "task", "accent": "a", "items": msItems},
		"context": map[string]any{
			"title": "Kontext", "scope": "session", "type": "context", "accent": "m",
			"window": collectors.CtxWindow, "categories": contextCategories, "measured_total": contextMeasuredTotal,
		},
		"skills":    map[string]any{"title": "Skills", "scope": "global", "type": "skill", "accent": "g", "items": skills},
		"agents":    map[string]any{"title": "Agents", "scope": "global", "type": "agent", "accent": "c", "items": agents},
		"hooks":     map[string]any{"title": "Hooks", "scope": "global", "type": "hook", "accent": "", "items": hooks},
		"gclaude":   map[string]any{"title": "CLAUDE.md", "scope": "global", "type": "claude", "accent": "c", "items": gsectionsEff, "doc": gdoc},
		"pknow":     map[string]any{"title": "knowledge/", "scope": "projekt", "type": "know", "accent": "c", "items": pknow},
		"psections": map[string]any{"title": "CLAUDE.md", "scope": "projekt", "type": "claude", "accent": "c", "items": psectionsEff, "doc": pdoc},
		"decisions": map[string]any{"title": "Decisions", "scope": "wissen", "type": "decision", "accent": "g", "items": decisions},
		"memory":    map[string]any{"title": "Memory", "scope": "wissen", "type": "memory", "accent": "", "items": memory},
		"lessons":   map[string]any{"title": "Lektionen", "scope": "wissen", "type": "lesson", "accent": "a", "items": lessons},
		"changelog": map[string]any{"title": "CHANGELOG", "scope": "wissen", "type": "changelog", "accent": "", "items": changelog},
		"docs":      map[string]any{"title": "Docs", "scope": "wissen", "type": "doc", "accent": "c", "items": docs},
		"backlog":   map[string]any{"title": "Tasks", "scope": "backlog", "type": "task", "accent": "a", "items": tasks, "milestoneLinks": milestoneLinks},
		"tn":        map[string]any{"title": "tn", "scope": "backlog", "type": "task", "accent": "c", "items": tnItems},
		"sessions":  map[string]any{"title": "Sessions", "scope": "usage", "type": "session", "accent": "m", "items": sessions},
	}

	// open counts
	backlogOpenN := 0
	for _, raw := range aArr(bl["tasks"]) {
		if lowerTrim(aMap(raw)["status"]) != "done" {
			backlogOpenN++
		}
	}
	tnOpenN := len(aArr(tnc["next"])) + len(aArr(tnc["blocked"])) + len(aArr(tnc["overdue"]))

	ovItem := map[string]any{"id": "ov", "label": "Übersicht", "dot": "g"}
	globalGroup := map[string]any{
		"g": "Global · alle Projekte",
		"items": []any{
			map[string]any{"id": "skills", "label": "Skills", "dot": "g", "tok": FmtCompact(skillsTok)},
			map[string]any{"id": "agents", "label": "Agents", "dot": "c", "tok": FmtCompact(agentsTok)},
			map[string]any{"id": "hooks", "label": "Hooks", "dot": ""},
			map[string]any{"id": "gclaude", "label": "CLAUDE.md", "dot": "c", "tok": FmtCompact(gdoc["tokens"])},
		},
	}
	projectGroups := []any{
		map[string]any{"g": "Wissen", "items": []any{
			map[string]any{"id": "pknow", "label": "knowledge/", "dot": "c"},
			map[string]any{"id": "psections", "label": "CLAUDE.md", "dot": "c", "tok": FmtCompact(pdoc["tokens"])},
			map[string]any{"id": "decisions", "label": "Decisions", "dot": "g"},
			map[string]any{"id": "memory", "label": "Memory", "dot": ""},
			map[string]any{"id": "lessons", "label": "Lektionen", "dot": "a"},
			map[string]any{"id": "changelog", "label": "CHANGELOG", "dot": ""},
			map[string]any{"id": "docs", "label": "Docs", "dot": "c"},
		}},
		map[string]any{"g": "Git", "items": []any{map[string]any{"id": "git", "label": "Git Status", "dot": "g"}}},
		map[string]any{"g": "Backlog", "items": []any{
			map[string]any{"id": "boards", "label": "Boards", "dot": "c", "cnt": itoa(backlogOpenN) + " / " + itoa(tnOpenN)},
		}},
		map[string]any{"g": "Usage", "items": []any{
			map[string]any{"id": "sessions", "label": "Sessions", "dot": "m", "tok": FmtCompact(sessionsTok)},
		}},
		map[string]any{"g": "Kontext", "items": []any{
			map[string]any{"id": "context", "label": "Kontext", "dot": "m", "tok": FmtCompact(contextMeasuredTotal)},
		}},
	}
	var nav []any
	if view == "overview" {
		nav = []any{
			map[string]any{"g": "Überblick · alle Projekte", "items": []any{
				map[string]any{"id": "milestones", "label": "Backlog projektweit", "dot": "a"}, ovItem,
			}},
			globalGroup,
		}
	} else {
		nav = append([]any{map[string]any{"g": "Übersicht", "items": []any{ovItem}}}, projectGroups...)
	}

	branch := ncChain(gitc["branch"], p["branch"], "?")
	// milestones overview
	namedMs := []map[string]any{}
	for _, raw := range aArr(bl["milestones"]) {
		m := aMap(raw)
		name := aStr(m["name"])
		if name != "" && name != "—" {
			namedMs = append(namedMs, m)
		}
	}
	msTotal := len(namedMs)
	msDone := 0
	msLabels := []any{}
	for _, m := range namedMs {
		if aBool(m["total"]) && aNum(m["done"]) == aNum(m["total"]) {
			msDone++
		}
		if aNum(m["done"]) != aNum(m["total"]) {
			msLabels = append(msLabels, aStr(m["name"])+" "+fmtInt(m["done"])+"/"+fmtInt(m["total"]))
		}
	}

	allTasks := aArr(bl["tasks"])
	tasksTotal := len(allTasks)
	tasksDone := 0
	for _, raw := range allTasks {
		if lowerTrim(aMap(raw)["status"]) == "done" {
			tasksDone++
		}
	}

	lastTotal := 0.0
	if last != nil {
		lastTotal = aNum(last["input"]) + aNum(last["output"]) + aNum(last["cache_read"]) + aNum(last["cache_creation"])
	}
	costAv := aBool(costc["available"])

	// decisions overview (first 3)
	decisionsOv := []any{}
	for i, raw := range aArr(kn["decisions"]) {
		if i >= 3 {
			break
		}
		d := aMap(raw)
		decisionsOv = append(decisionsOv, map[string]any{"id": d["id"], "title": d["title"]})
	}

	// top tools
	toolFreq := aMap(tok["tool_freq"])
	type kv struct {
		k string
		v float64
	}
	pairs := make([]kv, 0, len(toolFreq))
	for k, v := range toolFreq {
		pairs = append(pairs, kv{k, aNum(v)})
	}
	sort.SliceStable(pairs, func(i, j int) bool {
		if pairs[i].v != pairs[j].v {
			return pairs[i].v > pairs[j].v
		}
		return pairs[i].k < pairs[j].k
	})
	topTools := []any{}
	for i, pr := range pairs {
		if i >= 4 {
			break
		}
		topTools = append(topTools, []any{pr.k, pr.v})
	}

	tnTotal := 0.0
	for _, raw := range aArr(ctx["projects"]) {
		tnTotal += aNum(aMap(raw)["tn"])
	}

	costVal := func(key string) any {
		if costAv {
			return FmtCost(costc[key])
		}
		return "n/a"
	}
	rlVal := func(key string) any {
		if !costAv {
			return nil
		}
		if v, ok := costc[key]; ok && v != nil {
			return v
		}
		return nil
	}

	weekTotalStr := "—"
	if _, ok := week["total"]; ok {
		weekTotalStr = FmtCompact(week["total"])
	}

	overview := map[string]any{
		"subtitle":           nc(p["repo"], "cc-setup") + " · " + branch + " · " + aStr(ctx["generated_at"]),
		"skills":             len(skills),
		"agents":             len(agents),
		"hooks":              sumField(hooks, "count"),
		"skills_tok":         FmtCompact(skillsTok),
		"agents_tok":         FmtCompact(agentsTok),
		"branch":             branch,
		"dirty":              aBool(gitc["dirty"]),
		"git_recommend":      aStr(gitc["recommend"]),
		"backlog_inprogress": aNum(bl["in_progress_count"]),
		"milestones":         msLabels,
		"ms_done":            msDone,
		"ms_total":           msTotal,
		"tasks_done":         tasksDone,
		"tasks_total":        tasksTotal,
		"cost_today":         costVal("today"),
		"cost_week":          costVal("week"),
		"cost_total":         costVal("total"),
		"cost_5h":            rlVal("five_hour"),
		"cost_7d":            rlVal("seven_day"),
		"decisions":          decisionsOv,
		"tok_last":           dashIf(last == nil, FmtCompact(lastTotal)),
		"tok_week":           weekTotalStr,
		"cost_last":          dashIf(last == nil, FmtCost(lastCost(last))),
		"tok_sessions":       FmtCompact(sessionsTok),
		"cost_sessions":      FmtCost(sessionsCost),
		"know_counts": map[string]any{
			"decisions": len(decisions), "memory": len(memory), "lektionen": len(lessons),
			"changelog": len(changelog), "pknow": len(pknow),
		},
		"errors_total":       aNum(tok["errors_total"]),
		"repeats_total":      aNum(tok["repeats_total"]),
		"top_tools":          topTools,
		"tn_next":            len(aArr(tnc["next"])),
		"tn_blocked":         len(aArr(tnc["blocked"])),
		"tn_available":       len(tnc) > 0,
		"tn_total":           tnTotal,
		"backlog_open":       backlogOpenN,
		"tn_open":            tnOpenN,
		"claude_tok_global":  FmtCompact(gdoc["tokens"]),
		"claude_tok_project": FmtCompact(pdoc["tokens"]),
		"proj_skills":        aNum(p["proj_skills_count"]),
		"proj_agents":        aNum(p["proj_agents_count"]),
		"proj_hooks":         aNum(p["proj_hooks_count"]),
		"proj_init_tok":      FmtCompact(aNum(gmd["tokens"]) + aNum(p["claude_md_tokens"])),
	}

	turns := 0.0
	if last != nil {
		turns = aNum(last["turns"])
	}
	meta := map[string]any{
		"cwd":          ctx["cwd"],
		"generated_at": ctx["generated_at"],
		"branch":       branch,
		"turns":        turns,
		"tok":          weekTotalStr,
	}

	return map[string]any{
		"meta":           meta,
		"nav":            nav,
		"coll":           coll,
		"git":            gitc,
		"cost":           costc,
		"overview":       overview,
		"projects":       orEmptyArr(ctx["projects"]),
		"active_project": aStr(ctx["active_project"]),
	}
}
