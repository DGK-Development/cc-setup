// Package collectors holds the data collectors — Go-native ports of the Deno
// app's src/collectors/*. Each collector mirrors one source file. Shared data
// shapes live here; JSON tags are kept byte-identical to the TS interfaces so
// the cache file and the rendered page stay wire-compatible with browser.js.
package collectors

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// ProjectRef is a discovered project (name + absolute path).
type ProjectRef struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// Milestone aggregates done/total task counts under a milestone name.
type Milestone struct {
	Name  string `json:"name"`
	Done  int    `json:"done"`
	Total int    `json:"total"`
}

// LooseTask is a backlog task without a milestone (project-wide overview).
type LooseTask struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
	File   string `json:"file"`
}

// OpenTask is a non-done backlog task for the cross-project Kanban board.
type OpenTask struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Status    string `json:"status"`
	Milestone string `json:"milestone"`
	Project   string `json:"project"`
	File      string `json:"file"`
}

// SidebarProject is one project's full sidebar aggregate.
type SidebarProject struct {
	ProjectRef
	OpenTasksCount int         `json:"open_tasks"`
	Cost7d         float64     `json:"cost_7d"`
	Milestones     []Milestone `json:"milestones"`
	LooseTasks     []LooseTask `json:"looseTasks"`
	OpenTasks      []OpenTask  `json:"openTasks"`
	Tn             int         `json:"tn"`
}

// Home returns $HOME or "/tmp" as a fallback (mirrors the Deno HOME constant).
func Home() string {
	if h := os.Getenv("HOME"); h != "" {
		return h
	}
	return "/tmp"
}

var trailingSlashes = regexp.MustCompile(`/+$`)

// ScriptsDir resolves the cc-setup scripts/ directory (home of tasknotes_cli.py).
// The Deno app resolves it from import.meta.url; a compiled Go binary has no
// source-relative path, so we search upward from the working directory (and the
// executable dir) for a `scripts/tasknotes_cli.py`. CC_KNOWLEDGE_SCRIPTS_DIR
// overrides everything.
func ScriptsDir() string {
	if env := os.Getenv("CC_KNOWLEDGE_SCRIPTS_DIR"); env != "" {
		return env
	}
	bases := []string{}
	if wd, err := os.Getwd(); err == nil {
		bases = append(bases, wd)
	}
	if exe, err := os.Executable(); err == nil {
		bases = append(bases, filepath.Dir(exe))
	}
	for _, base := range bases {
		dir := base
		for {
			cand := filepath.Join(dir, "scripts", "tasknotes_cli.py")
			if _, err := os.Stat(cand); err == nil {
				return filepath.Join(dir, "scripts")
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	// Last resort: assume sibling of the working directory.
	if wd, err := os.Getwd(); err == nil {
		return filepath.Join(wd, "..", "scripts")
	}
	return "scripts"
}

// stripTrailingSlashes removes trailing "/" runs (mirrors .replace(/\/+$/, "")).
func stripTrailingSlashes(s string) string {
	return trailingSlashes.ReplaceAllString(s, "")
}

// localeLess approximates JS String.prototype.localeCompare(b) < 0 for the
// project/task names this app sorts: case-insensitive primary order with a
// byte-order tie-break for strings that differ only in case.
func localeLess(a, b string) bool {
	la, lb := strings.ToLower(a), strings.ToLower(b)
	if la != lb {
		return la < lb
	}
	return a < b
}
