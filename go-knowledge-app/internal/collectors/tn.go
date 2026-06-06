package collectors

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"go-knowledge-app/internal/shared"
)

// TnTask mirrors the TS TnTask interface. Values are heterogeneous (any) and
// serialized verbatim; JSON keys are byte-identical.
type TnTask struct {
	ID         any `json:"id"`
	Title      any `json:"title"`
	Status     any `json:"status"`
	Project    any `json:"project"`
	NextAction any `json:"next_action"`
	Scheduled  any `json:"scheduled"`
}

func extractTnTasks(payload map[string]any) []TnTask {
	tasks := []TnTask{}
	if payload == nil {
		return tasks
	}
	arr, _ := payload["tasks"].([]any)
	for _, item := range arr {
		t, ok := item.(map[string]any)
		if !ok {
			continue
		}
		proj, _ := t["project"].(map[string]any)
		meta, _ := t["metadata"].(map[string]any)
		var projName, nextAction any
		if proj != nil {
			projName = proj["name"]
		}
		if meta != nil {
			nextAction = meta["nextAction"]
		}
		tasks = append(tasks, TnTask{
			ID:         t["id"],
			Title:      t["title"],
			Status:     t["status"],
			Project:    projName,
			NextAction: nextAction,
			Scheduled:  t["scheduled"],
		})
	}
	return tasks
}

func sliceStr10(s string) string {
	if len(s) >= 10 {
		return s[:10]
	}
	return s
}

// PickOverdue keeps tasks that are not done, have a `scheduled` date strictly
// before today, and are not in the BLOCKED set. Sorted by scheduled ascending.
func PickOverdue(tasks []TnTask, todayIso string, blockedIDs map[string]bool) []TnTask {
	today := sliceStr10(todayIso)
	out := []TnTask{}
	for _, t := range tasks {
		st := strings.ToLower(asStr(t.Status))
		if st == "done" || st == "completed" {
			continue
		}
		if blockedIDs[idKey(t.ID)] {
			continue
		}
		sd := sliceStr10(asStr(t.Scheduled))
		if sd != "" && sd < today {
			out = append(out, t)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return localeLess(sliceStr10(asStr(out[i].Scheduled)), sliceStr10(asStr(out[j].Scheduled)))
	})
	return out
}

func idKey(v any) string {
	if v == nil {
		return ""
	}
	return asStr(v)
}

func tnJSON(repo string, args ...string) map[string]any {
	tnPath := filepath.Join(ScriptsDir(), "tasknotes_cli.py")
	if _, err := os.Stat(tnPath); err != nil {
		return nil
	}
	out, ok := shared.Run(append([]string{"uv", "run", "--script", tnPath}, args...), shared.RunOptions{Cwd: repo})
	if !ok {
		return nil
	}
	parsed, _ := shared.ParseJSON[map[string]any](out)
	return parsed
}

// CollectTn calls tasknotes_cli.py via uv run --script; degrades cleanly if
// unavailable. Never aggregates cross-project tn data (see deno-knowledge-tn-org-block).
func CollectTn(cwd string) map[string]any {
	repo := RepoRoot(cwd)
	nxt := tnJSON(repo, "next", "--format", "json", "--limit", "5")
	if nxt == nil {
		return map[string]any{"available": false, "reason": "tn unavailable (no tasknotes_cli.py or no vault)"}
	}
	blocked := tnJSON(repo, "list", "--status", "blocked", "--format", "json")
	blockedTasks := extractTnTasks(blocked)
	listAll := tnJSON(repo, "list", "--format", "json", "--limit", "200")
	allTasks := extractTnTasks(listAll)

	projNames := map[string]bool{}
	for _, t := range allTasks {
		if p := asStr(t.Project); p != "" {
			projNames[p] = true
		}
	}
	blockedIDs := map[string]bool{}
	for _, t := range blockedTasks {
		blockedIDs[idKey(t.ID)] = true
	}
	today := time.Now().UTC().Format("2006-01-02")
	overdue := []TnTask{}
	if len(projNames) <= 1 {
		overdue = PickOverdue(allTasks, today, blockedIDs)
	}
	return map[string]any{
		"available": true,
		"next":      extractTnTasks(nxt),
		"blocked":   blockedTasks,
		"overdue":   overdue,
	}
}
