package collectors

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"go-knowledge-app/internal/md"
	"go-knowledge-app/internal/shared"
)

// TaskStatuses are the backlog Kanban columns / allowed statuses.
var TaskStatuses = []string{"To Do", "In Progress", "Done"}

var taskIDRe = regexp.MustCompile(`^[A-Za-z]+-\d+(?:\.\d+)*$`)

// SetTaskStatus moves a backlog task to a new status via `backlog task edit -s`.
// Validates id + status to avoid injection. Used by the Kanban board.
func SetTaskStatus(cwd, id, status string) map[string]any {
	if !taskIDRe.MatchString(id) {
		return map[string]any{"ok": false, "error": "ungültige Task-ID"}
	}
	if !contains(TaskStatuses, status) {
		return map[string]any{"ok": false, "error": "ungültiger Status"}
	}
	repo := RepoRoot(cwd)
	_, ok := shared.Run([]string{"backlog", "task", "edit", id, "-s", status}, shared.RunOptions{Cwd: repo, TimeoutMs: 30000})
	if !ok {
		return map[string]any{"ok": false, "id": id, "status": status, "error": "backlog edit fehlgeschlagen"}
	}
	return map[string]any{"ok": true, "id": id, "status": status}
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

// TaskRecord mirrors the TS TaskRecord interface (JSON keys are byte-identical).
type TaskRecord struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Status    string `json:"status"`
	Milestone string `json:"milestone"`
	Parent    string `json:"parent"`
	Desc      string `json:"desc"`
	File      string `json:"file"`
}

var sectionRe = regexp.MustCompile(`(?s)SECTION:DESCRIPTION:BEGIN\s*-->\s*(.*?)\s*<!--\s*SECTION:DESCRIPTION:END`)
var descHeaderRe = regexp.MustCompile(`(?m)^##\s+Description\s*$`)
var nextHeadingRe = regexp.MustCompile(`(?m)^##\s`)

func taskDescription(text string) string {
	if m := sectionRe.FindStringSubmatch(text); m != nil {
		return strings.TrimSpace(m[1])
	}
	// Fallback for tasks without SECTION markers: the `## Description` section up
	// to the next `## ` heading or EOF. (The Deno regex's `\Z` alternative is a
	// JS no-op/literal-Z quirk; we intentionally use the sensible end-of-section.)
	loc := descHeaderRe.FindStringIndex(text)
	if loc == nil {
		return ""
	}
	rest := text[loc[1]:]
	if nx := nextHeadingRe.FindStringIndex(rest); nx != nil {
		return strings.TrimSpace(rest[:nx[0]])
	}
	return strings.TrimSpace(rest)
}

// sliceRunes returns at most n runes (mirrors String.slice(0, n) on code units;
// task descriptions are small so rune-based slicing is a faithful approximation).
func sliceRunes(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

func parseTaskFile(fpath, filename string) (TaskRecord, bool) {
	text, ok := shared.ReadText(fpath)
	if !ok || text == "" {
		return TaskRecord{}, false
	}
	id := md.FrontmatterField(text, "id")
	if id == "" {
		id = strings.TrimSuffix(filename, ".md")
	}
	title := md.FrontmatterField(text, "title")
	if title == "" {
		title = id
	}
	return TaskRecord{
		ID:        id,
		Title:     title,
		Status:    md.FrontmatterField(text, "status"),
		Milestone: md.FrontmatterField(text, "milestone"),
		Parent:    md.FrontmatterField(text, "parent_task_id"),
		Desc:      sliceRunes(taskDescription(text), 2000),
		File:      filename,
	}, true
}

func mdFilesSorted(dir string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	names := []string{}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".md") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	return names
}

// CollectBacklog reads backlog/tasks/*.md + backlog/completed/*.md (read-only).
func CollectBacklog(cwd string) map[string]any {
	repo := RepoRoot(cwd)
	tasksDir := filepath.Join(repo, "backlog", "tasks")
	if _, err := os.Stat(tasksDir); err != nil {
		return map[string]any{"available": false, "reason": "backlog not initialized (no backlog/tasks)"}
	}

	tasks := []TaskRecord{}
	seenIDs := map[string]bool{}

	for _, fname := range mdFilesSorted(tasksDir) {
		if t, ok := parseTaskFile(filepath.Join(tasksDir, fname), fname); ok {
			tasks = append(tasks, t)
			seenIDs[t.ID] = true
		}
	}

	completedDir := filepath.Join(repo, "backlog", "completed")
	for _, fname := range mdFilesSorted(completedDir) {
		if t, ok := parseTaskFile(filepath.Join(completedDir, fname), fname); ok && !seenIDs[t.ID] {
			t.Status = "Done" // completed/ folder is the truth
			tasks = append(tasks, t)
			seenIDs[t.ID] = true
		}
	}

	// Milestone aggregation
	type slot struct{ done, total int }
	agg := map[string]*slot{}
	names := []string{}
	for _, t := range tasks {
		name := t.Milestone
		if name == "" {
			name = "—"
		}
		s := agg[name]
		if s == nil {
			s = &slot{}
			agg[name] = s
			names = append(names, name)
		}
		s.total++
		if strings.ToLower(strings.TrimSpace(t.Status)) == "done" {
			s.done++
		}
	}
	sort.Slice(names, func(i, j int) bool { return localeLess(names[i], names[j]) })
	milestones := make([]Milestone, 0, len(names))
	for _, name := range names {
		milestones = append(milestones, Milestone{Name: name, Done: agg[name].done, Total: agg[name].total})
	}

	inProgress := 0
	for _, t := range tasks {
		if strings.ToLower(strings.TrimSpace(t.Status)) == "in progress" {
			inProgress++
		}
	}

	return map[string]any{
		"available":         true,
		"tasks":             tasks,
		"milestones":        milestones,
		"in_progress_count": inProgress,
	}
}
