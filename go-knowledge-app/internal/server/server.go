// Package server builds the HTTP request handler — Go-native port of server.ts.
// Native routing via URL path + method (no framework), mirroring the Deno routes.
package server

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"go-knowledge-app/internal/appctx"
	"go-knowledge-app/internal/cache"
	"go-knowledge-app/internal/collectors"
	"go-knowledge-app/internal/md"
	"go-knowledge-app/internal/render"
	"go-knowledge-app/internal/shared"
)

// AppOptions configures the handler.
type AppOptions struct {
	Cwd     string        // repo directory to inspect (--cwd)
	Assets  render.Assets // embedded asset contents for inline embedding
	AssetFS fs.FS         // static asset tree for /assets/*
}

var reservedSegments = map[string]bool{
	"assets": true, "read": true, "tn-note": true, "hook-inject": true, "gitdiff": true, "action": true,
}

var tnIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)

// csrfOk rejects cross-origin POSTs: Origin must be localhost if present.
func csrfOk(origin string) bool {
	if origin == "" {
		return true
	}
	return strings.HasPrefix(origin, "http://127.0.0.1") || strings.HasPrefix(origin, "http://localhost")
}

// NewHandler builds the request handler.
func NewHandler(opts AppOptions) http.Handler {
	claudeHome := collectors.Home() + "/.claude"
	assetHandler := http.StripPrefix("/assets/", http.FileServer(http.FS(opts.AssetFS)))

	getProjects := func() []collectors.ProjectRef {
		return appctx.DiscoverProjects(collectors.RepoRoot(opts.Cwd), "")
	}
	getTarget := func(project string) string {
		return appctx.ResolveProjectCwd(project, getProjects(), opts.Cwd)
	}

	servePage := func(w http.ResponseWriter, projectParam, initialView string) {
		cache.EnsureFresh(opts.Cwd, claudeHome)
		agg := cache.GetAggregate()
		var sidebar []collectors.SidebarProject
		if agg != nil {
			sidebar = agg.Projects
		} else {
			for _, p := range getProjects() {
				sidebar = append(sidebar, collectors.SidebarProject{
					ProjectRef: p,
					Milestones: []collectors.Milestone{},
					LooseTasks: []collectors.LooseTask{},
				})
			}
		}
		selected := ""
		for _, p := range sidebar {
			if p.Name == projectParam {
				selected = projectParam
				break
			}
		}
		view := "overview"
		if selected != "" {
			view = "project"
		}
		refs := make([]collectors.ProjectRef, len(sidebar))
		for i, p := range sidebar {
			refs[i] = p.ProjectRef
		}
		target := appctx.ResolveProjectCwd(selected, refs, opts.Cwd)
		activeName := selected
		if activeName == "" {
			activeName = lastSeg(collectors.RepoRoot(opts.Cwd))
		}
		var globalMap map[string]any
		if agg != nil {
			globalMap = agg.Global
		}
		var context map[string]any
		if view == "overview" {
			context = appctx.BuildContext(target, claudeHome, appctx.BuildOpts{
				Projects: sidebar, ActiveProject: activeName, Global: globalMap, SkipProject: true,
			})
		} else {
			context = cache.GetProjectContext(target, func() map[string]any {
				return appctx.BuildContext(target, claudeHome, appctx.BuildOpts{
					Projects: sidebar, ActiveProject: activeName, Global: globalMap, SkipProject: false,
				})
			})
		}
		generatedAt := ""
		if agg != nil {
			generatedAt = md.FmtMtime(float64(agg.GeneratedAt) / 1000)
		}
		html := render.RenderPage(render.RenderOpts{
			Cwd: target, Context: context, Sidebar: sidebar, Active: selected,
			View: view, InitialView: initialView, GeneratedAt: generatedAt, Loading: agg == nil,
		}, opts.Assets)
		writeHTML(w, html)
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pathname := r.URL.Path
		q := r.URL.Query()

		// Static assets
		if strings.HasPrefix(pathname, "/assets/") {
			assetHandler.ServeHTTP(w, r)
			return
		}

		// GET /
		if r.Method == http.MethodGet && pathname == "/" {
			servePage(w, q.Get("project"), "")
			return
		}

		// GET /read
		if r.Method == http.MethodGet && pathname == "/read" {
			target := getTarget(q.Get("project"))
			result := render.ReadDoc(target, claudeHome, q.Get("kind"), q.Get("name"), q.Get("path"))
			writeJSON(w, result)
			return
		}

		// GET /tn-note
		if r.Method == http.MethodGet && pathname == "/tn-note" {
			tnID := q.Get("id")
			if !tnIDRe.MatchString(tnID) {
				writeJSON(w, map[string]any{"ok": false, "error": "ungültige Task-ID"})
				return
			}
			target := getTarget(q.Get("project"))
			tnPath := filepath.Join(collectors.ScriptsDir(), "tasknotes_cli.py")
			if _, err := os.Stat(tnPath); err != nil {
				writeJSON(w, map[string]any{"ok": false, "error": "tn nicht verfügbar"})
				return
			}
			out, ok := shared.Run([]string{"uv", "run", "--script", tnPath, "show", tnID, "--format", "json"}, shared.RunOptions{Cwd: target})
			if !ok {
				writeJSON(w, map[string]any{"ok": false, "error": "Task nicht gefunden"})
				return
			}
			parsed, _ := shared.ParseJSON[map[string]any](out)
			task, _ := parsed["task"].(map[string]any)
			if task == nil {
				writeJSON(w, map[string]any{"ok": false, "error": "Task nicht gefunden"})
				return
			}
			body, _ := task["body"].(string)
			title, _ := task["title"].(string)
			if title == "" {
				title = tnID
			}
			writeJSON(w, map[string]any{"ok": true, "body": body, "title": title})
			return
		}

		// GET /hook-inject
		if r.Method == http.MethodGet && pathname == "/hook-inject" {
			target := getTarget(q.Get("project"))
			writeJSON(w, collectors.CollectHookInject(target))
			return
		}

		// GET /gitdiff
		if r.Method == http.MethodGet && pathname == "/gitdiff" {
			target := getTarget(q.Get("project"))
			writeJSON(w, collectors.GitDiff(target, q.Get("path")))
			return
		}

		// POST /action/*
		if r.Method == http.MethodPost && strings.HasPrefix(pathname, "/action/") {
			if !csrfOk(r.Header.Get("Origin")) {
				writeHTML(w, render.ResultPage("blocked", map[string]any{"ok": false, "cmd": "-", "output": "CSRF: fremde Origin blockiert"}))
				return
			}
			if err := parseForm(r); err != nil {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			project := r.FormValue("project")
			target := getTarget(project)
			action := strings.TrimPrefix(pathname, "/action/")

			if action == "task-status" {
				result := collectors.SetTaskStatus(target, r.FormValue("id"), r.FormValue("status"))
				if result["ok"] == true {
					cache.InvalidateProjectContext(target)
				}
				writeJSON(w, result)
				return
			}

			var result map[string]any
			switch action {
			case "add":
				result = collectors.GitAdd(target)
			case "commit":
				result = collectors.GitCommit(target, r.FormValue("message"))
			case "delete":
				branch := strings.TrimSpace(r.FormValue("branch"))
				confirm := strings.TrimSpace(r.FormValue("confirm"))
				if branch == "" || confirm != branch {
					result = map[string]any{"ok": false, "cmd": "git branch -d", "output": "Bestätigung: tippe den exakten Branch-Namen."}
				} else {
					result = collectors.GitDelete(target, branch)
				}
			case "merge":
				if strings.TrimSpace(r.FormValue("confirm")) != "MERGE" {
					result = map[string]any{"ok": false, "cmd": "git merge", "output": "Bestätigung: tippe MERGE."}
				} else {
					result = collectors.GitMerge(target, r.FormValue("branch"))
				}
			case "push":
				if strings.TrimSpace(r.FormValue("confirm")) != "PUSH" {
					result = map[string]any{"ok": false, "cmd": "git push", "output": "Bestätigung: tippe PUSH."}
				} else {
					result = collectors.GitPush(target, r.FormValue("branch"))
				}
			default:
				http.Error(w, "Not found", http.StatusNotFound)
				return
			}

			if result["ok"] == true {
				cache.InvalidateProjectContext(target)
			}
			writeHTML(w, render.ResultPage(action, result))
			return
		}

		// Path-based project routing: GET /<project>[/<view>]
		if r.Method == http.MethodGet {
			segments := []string{}
			for _, s := range strings.Split(strings.TrimPrefix(pathname, "/"), "/") {
				if s != "" {
					segments = append(segments, s)
				}
			}
			if len(segments) >= 1 && !reservedSegments[segments[0]] {
				projectName := decodeURI(segments[0])
				viewHint := ""
				if len(segments) >= 2 {
					viewHint = decodeURI(segments[1])
				}
				servePage(w, projectName, viewHint)
				return
			}
		}

		http.Error(w, "Not found", http.StatusNotFound)
	})
}

func parseForm(r *http.Request) error {
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
		return r.ParseMultipartForm(32 << 20)
	}
	return r.ParseForm()
}

func decodeURI(s string) string {
	if d, err := url.PathUnescape(s); err == nil {
		return d
	}
	return s
}

func lastSeg(p string) string {
	for i := len(p) - 1; i >= 0; i-- {
		if p[i] == '/' {
			return p[i+1:]
		}
	}
	return p
}

func writeHTML(w http.ResponseWriter, html string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(html))
}

func writeJSON(w http.ResponseWriter, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		http.Error(w, "json error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(b)
}
