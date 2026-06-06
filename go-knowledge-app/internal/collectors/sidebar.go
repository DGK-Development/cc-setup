package collectors

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"go-knowledge-app/internal/md"
	"go-knowledge-app/internal/shared"
)

// ParseTnProjects reads ONLY working_dir + tasks from `tn projects`
// ({count, projects:[…]} or a bare array). working_dir may be a comma list and
// use `~`. The kunde field, project names and customer-only entries (no
// working_dir) are deliberately ignored — only a count for repos the sidebar
// already lists is ever surfaced. Returns counts keyed by absolute working_dir.
func ParseTnProjects(jsonText string) map[string]int {
	out := map[string]int{}
	if jsonText == "" {
		return out
	}
	var raw any
	if json.Unmarshal([]byte(jsonText), &raw) != nil {
		return out
	}
	var arr []any
	switch v := raw.(type) {
	case []any:
		arr = v
	case map[string]any:
		if pj, ok := v["projects"].([]any); ok {
			arr = pj
		}
	}
	for _, item := range arr {
		p, ok := item.(map[string]any)
		if !ok {
			continue
		}
		wd, ok := p["working_dir"].(string)
		if !ok || wd == "" {
			continue // skip entries without a repo
		}
		count := toInt(p["tasks"])
		for _, part := range strings.Split(wd, ",") {
			t := strings.TrimSpace(part)
			if t == "" {
				continue
			}
			abs := t
			if strings.HasPrefix(t, "~") {
				abs = Home() + t[1:]
			}
			out[stripTrailingSlashes(abs)] = count
		}
	}
	return out
}

// toInt mirrors JS Number(x ?? 0) for the values tn emits (number or string).
func toInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(n), 64)
		if err != nil {
			return 0
		}
		return int(f)
	default:
		return 0
	}
}

func tnTaskCounts() map[string]int {
	tnPath := filepath.Join(ScriptsDir(), "tasknotes_cli.py")
	if _, err := os.Stat(tnPath); err != nil {
		return map[string]int{}
	}
	out, ok := shared.Run([]string{"uv", "run", "--script", tnPath, "projects", "--format", "json"}, shared.RunOptions{})
	if !ok {
		return map[string]int{}
	}
	return ParseTnProjects(out)
}

// ProjectRoots returns the scan roots: CC_KNOWLEDGE_ROOTS (comma-separated)
// overrides; default DG + private.
func ProjectRoots() []string {
	if env := os.Getenv("CC_KNOWLEDGE_ROOTS"); env != "" {
		parts := strings.Split(env, ",")
		out := []string{}
		for _, p := range parts {
			if t := strings.TrimSpace(p); t != "" {
				out = append(out, t)
			}
		}
		return out
	}
	return []string{filepath.Join(Home(), "GITHUB_DG"), filepath.Join(Home(), "GITHUB")}
}

// DiscoverProjectsIn scans roots for directories containing backlog/. Dedupe by
// name; the active repo is always included.
func DiscoverProjectsIn(roots []string, activeRepo string) []ProjectRef {
	found := map[string]string{}
	order := []string{}
	for _, root := range roots {
		entries, err := os.ReadDir(root)
		if err != nil {
			continue // root not readable
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			full := filepath.Join(root, e.Name())
			if _, err := os.Stat(filepath.Join(full, "backlog")); err != nil {
				continue // no backlog/ in this dir
			}
			if _, ok := found[e.Name()]; !ok {
				found[e.Name()] = full
				order = append(order, e.Name())
			}
		}
	}
	activeName := lastPathSegment(activeRepo)
	if _, ok := found[activeName]; !ok {
		found[activeName] = activeRepo
		order = append(order, activeName)
	}
	names := make([]string, len(order))
	copy(names, order)
	sort.Slice(names, func(i, j int) bool { return localeLess(names[i], names[j]) })
	out := make([]ProjectRef, 0, len(names))
	for _, name := range names {
		out = append(out, ProjectRef{Name: name, Path: found[name]})
	}
	return out
}

// lastPathSegment mirrors `path.split("/").pop()` (the final non-empty? no — JS
// pop returns the last element even if empty; here paths have no trailing slash).
func lastPathSegment(p string) string {
	parts := strings.Split(p, "/")
	return parts[len(parts)-1]
}

// CountOpenTasks counts non-Done tasks for a project — mirrors collectBacklog:
// scans backlog/tasks/ (frontmatter status) PLUS backlog/completed/ (always Done).
func CountOpenTasks(repoPath string) int {
	tasksDir := filepath.Join(repoPath, "backlog", "tasks")
	open := 0
	seenIDs := map[string]bool{}
	if entries, err := os.ReadDir(tasksDir); err == nil {
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
				continue
			}
			text, ok := shared.ReadText(filepath.Join(tasksDir, e.Name()))
			if !ok {
				continue
			}
			id := md.FrontmatterField(text, "id")
			if id == "" {
				id = e.Name()
			}
			seenIDs[id] = true
			if strings.ToLower(strings.TrimSpace(md.FrontmatterField(text, "status"))) != "done" {
				open++
			}
		}
	}
	if entries, err := os.ReadDir(filepath.Join(repoPath, "backlog", "completed")); err == nil {
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
				continue
			}
			text, ok := shared.ReadText(filepath.Join(repoPath, "backlog", "completed", e.Name()))
			if !ok {
				continue
			}
			id := md.FrontmatterField(text, "id")
			if id == "" {
				id = e.Name()
			}
			if !seenIDs[id] {
				seenIDs[id] = true // completed/ tasks are always Done → open unchanged
			}
		}
	}
	return open
}

// ProjectMilestones returns milestones (name + done/total) from backlog/tasks.
func ProjectMilestones(repoPath string) []Milestone {
	tasksDir := filepath.Join(repoPath, "backlog", "tasks")
	type slot struct{ done, total int }
	agg := map[string]*slot{}
	names := []string{}
	if entries, err := os.ReadDir(tasksDir); err == nil {
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
				continue
			}
			text, ok := shared.ReadText(filepath.Join(tasksDir, e.Name()))
			if !ok {
				continue
			}
			ms := md.FrontmatterField(text, "milestone")
			if ms == "" {
				continue
			}
			s := agg[ms]
			if s == nil {
				s = &slot{}
				agg[ms] = s
				names = append(names, ms)
			}
			s.total++
			if strings.ToLower(strings.TrimSpace(md.FrontmatterField(text, "status"))) == "done" {
				s.done++
			}
		}
	}
	sort.Slice(names, func(i, j int) bool { return localeLess(names[i], names[j]) })
	out := make([]Milestone, 0, len(names))
	for _, name := range names {
		out = append(out, Milestone{Name: name, Done: agg[name].done, Total: agg[name].total})
	}
	return out
}

// ProjectOpenTasks returns all non-done backlog tasks for a project.
func ProjectOpenTasks(repoPath, projectName string) []OpenTask {
	tasksDir := filepath.Join(repoPath, "backlog", "tasks")
	out := []OpenTask{}
	if entries, err := os.ReadDir(tasksDir); err == nil {
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
				continue
			}
			text, ok := shared.ReadText(filepath.Join(tasksDir, e.Name()))
			if !ok {
				continue
			}
			status := md.FrontmatterField(text, "status")
			if strings.ToLower(strings.TrimSpace(status)) == "done" {
				continue
			}
			id := md.FrontmatterField(text, "id")
			if id == "" {
				id = strings.TrimSuffix(e.Name(), ".md")
			}
			title := md.FrontmatterField(text, "title")
			if title == "" {
				title = id
			}
			out = append(out, OpenTask{
				ID:        id,
				Title:     title,
				Status:    status,
				Milestone: md.FrontmatterField(text, "milestone"),
				Project:   projectName,
				File:      e.Name(),
			})
		}
	}
	sort.Slice(out, func(i, j int) bool { return localeLess(out[i].ID, out[j].ID) })
	return out
}

// ProjectLooseTasks returns backlog tasks WITHOUT a milestone and NOT done.
func ProjectLooseTasks(repoPath string) []LooseTask {
	tasksDir := filepath.Join(repoPath, "backlog", "tasks")
	out := []LooseTask{}
	if entries, err := os.ReadDir(tasksDir); err == nil {
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
				continue
			}
			text, ok := shared.ReadText(filepath.Join(tasksDir, e.Name()))
			if !ok {
				continue
			}
			if md.FrontmatterField(text, "milestone") != "" {
				continue // has a milestone → not loose
			}
			status := md.FrontmatterField(text, "status")
			if strings.ToLower(strings.TrimSpace(status)) == "done" {
				continue
			}
			id := md.FrontmatterField(text, "id")
			if id == "" {
				id = strings.TrimSuffix(e.Name(), ".md")
			}
			title := md.FrontmatterField(text, "title")
			if title == "" {
				title = id
			}
			out = append(out, LooseTask{ID: id, Title: title, Status: status, File: e.Name()})
		}
	}
	sort.Slice(out, func(i, j int) bool { return localeLess(out[i].ID, out[j].ID) })
	return out
}

// CollectSidebar builds the full sidebar aggregate: every project with open
// tasks + 7d cost + milestones + loose tasks.
func CollectSidebar(activeRepo string) []SidebarProject {
	projects := DiscoverProjectsIn(ProjectRoots(), activeRepo)
	tnCounts := tnTaskCounts() // one call; counts keyed by working_dir
	out := make([]SidebarProject, 0, len(projects))
	for _, p := range projects {
		out = append(out, SidebarProject{
			ProjectRef:     p,
			OpenTasksCount: CountOpenTasks(p.Path),
			Cost7d:         SevenDayCostNative(p.Path),
			Milestones:     ProjectMilestones(p.Path),
			LooseTasks:     ProjectLooseTasks(p.Path),
			OpenTasks:      ProjectOpenTasks(p.Path, p.Name),
			Tn:             tnCounts[stripTrailingSlashes(p.Path)],
		})
	}
	return out
}
