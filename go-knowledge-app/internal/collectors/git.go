package collectors

import (
	"bytes"
	"fmt"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"go-knowledge-app/internal/shared"
)

func gitRun(cwd string, args ...string) (string, bool) {
	return shared.Run(append([]string{"git", "-C", cwd}, args...), shared.RunOptions{Cwd: cwd})
}

func gitLines(cwd string, args ...string) []string {
	out, _ := gitRun(cwd, args...)
	res := []string{}
	for _, l := range strings.Split(out, "\n") {
		if t := strings.TrimSpace(l); t != "" {
			res = append(res, t)
		}
	}
	return res
}

var wsSplit = regexp.MustCompile(`\s+`)

// aheadBehind returns [ahead, behind] or nil.
func aheadBehind(cwd, base, ref string) *[2]int {
	out, ok := gitRun(cwd, "rev-list", "--left-right", "--count", base+"..."+ref)
	if !ok || out == "" {
		return nil
	}
	parts := wsSplit.Split(strings.TrimSpace(out), -1)
	if len(parts) != 2 {
		return nil
	}
	behind, err1 := strconv.Atoi(parts[0])
	ahead, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		return nil
	}
	return &[2]int{ahead, behind}
}

func gitRecommend(branch string, dirty bool, aheadOrigin, aheadMain *int) string {
	if dirty {
		return "Uncommittete Änderungen → erst committen (dann nach Review push/merge)."
	}
	if branch != "main" && deref(aheadMain) > 0 {
		return fmt.Sprintf("'%s' ist %d Commit(s) vor main → nach Review nach main mergen.", branch, *aheadMain)
	}
	if branch != "main" && aheadMain != nil && *aheadMain == 0 {
		return fmt.Sprintf("'%s' ist vollständig in main → Branch kann gelöscht werden.", branch)
	}
	if deref(aheadOrigin) > 0 {
		return fmt.Sprintf("%d Commit(s) vor origin → nach Review pushen.", *aheadOrigin)
	}
	return "Clean & in sync — nichts zu tun."
}

func deref(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}

var digitsRe = regexp.MustCompile(`^\d+$`)

// CollectGit reports read-only git state: branch, branches, status, diff stat,
// recommendation.
func CollectGit(cwd string) map[string]any {
	repo := RepoRoot(cwd)
	branchOut, ok := gitRun(repo, "rev-parse", "--abbrev-ref", "HEAD")
	if !ok {
		return map[string]any{"available": false, "reason": "kein git-Repo"}
	}
	branch := strings.TrimSpace(branchOut)

	branches := gitLines(repo, "branch", "--format=%(refname:short)")

	// numstat for per-file added/deleted
	numstatOut, _ := gitRun(repo, "diff", "--numstat", "HEAD")
	type pair struct{ added, deleted *int }
	numstat := map[string]pair{}
	for _, ln := range strings.Split(numstatOut, "\n") {
		parts := strings.Split(ln, "\t")
		if len(parts) != 3 {
			continue
		}
		var ai, di *int
		if digitsRe.MatchString(parts[0]) {
			n, _ := strconv.Atoi(parts[0])
			ai = &n
		}
		if digitsRe.MatchString(parts[1]) {
			n, _ := strconv.Atoi(parts[1])
			di = &n
		}
		numstat[strings.TrimSpace(parts[2])] = pair{ai, di}
	}

	statusOut, _ := gitRun(repo, "status", "--porcelain")
	staged, unstaged, untracked := 0, 0, 0
	files := []string{}
	filesStruct := []map[string]any{}
	for _, ln := range strings.Split(statusOut, "\n") {
		if ln == "" {
			continue
		}
		isUntracked := strings.HasPrefix(ln, "??")
		if isUntracked {
			untracked++
		} else {
			if ln[0] != ' ' {
				staged++
			}
			if len(ln) > 1 && ln[1] != ' ' {
				unstaged++
			}
		}
		files = append(files, strings.TrimRight(ln, " \t\r\n"))
		xy := ""
		if len(ln) >= 2 {
			xy = ln[:2]
		} else {
			xy = ln
		}
		path := ""
		if len(ln) > 3 {
			path = strings.TrimSpace(ln[3:])
		}
		if strings.Contains(path, " -> ") {
			seg := strings.Split(path, " -> ")
			path = strings.TrimSpace(seg[len(seg)-1])
		}
		path = strings.Trim(path, "\"")
		p := numstat[path]
		filesStruct = append(filesStruct, map[string]any{
			"xy":        xy,
			"path":      path,
			"untracked": isUntracked,
			"added":     p.added,
			"deleted":   p.deleted,
		})
	}
	dirty := strings.TrimSpace(statusOut) != ""
	shortstatOut, _ := gitRun(repo, "diff", "--shortstat", "HEAD")
	shortstat := strings.TrimSpace(shortstatOut)

	var aheadOrigin, behindOrigin, aheadMain *int
	if ab := aheadBehind(repo, "origin/"+branch, branch); ab != nil {
		a, b := ab[0], ab[1]
		aheadOrigin, behindOrigin = &a, &b
	}
	if branch != "main" {
		if ab := aheadBehind(repo, "main", branch); ab != nil {
			a := ab[0]
			aheadMain = &a
		}
	}

	return map[string]any{
		"available":     true,
		"branch":        branch,
		"branches":      branches,
		"staged":        staged,
		"unstaged":      unstaged,
		"untracked":     untracked,
		"files":         sliceUpTo(files, 40),
		"files_struct":  sliceUpTo(filesStruct, 60),
		"dirty":         dirty,
		"shortstat":     shortstat,
		"ahead_origin":  intPtrToAny(aheadOrigin),
		"behind_origin": intPtrToAny(behindOrigin),
		"ahead_main":    intPtrToAny(aheadMain),
		"recommend":     gitRecommend(branch, dirty, aheadOrigin, aheadMain),
	}
}

func intPtrToAny(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

// ---------------------------------------------------------------------------
// Mutating git actions (used by POST /action/* routes)
// ---------------------------------------------------------------------------

const gitDiffMax = 200000

func gitCapture(args ...string) string {
	cmd := exec.Command("git", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	_ = cmd.Run()
	return stdout.String() + stderr.String()
}

func gitAction(cwd string, args ...string) map[string]any {
	cmdStr := "git " + strings.Join(args, " ")
	cmd := exec.Command("git", append([]string{"-C", cwd}, args...)...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	out := strings.TrimSpace(stdout.String() + stderr.String())
	if out == "" {
		out = "(kein Output)"
	}
	ok := err == nil
	return map[string]any{"ok": ok, "cmd": cmdStr, "output": out}
}

// GitDiff returns the diff for a path (or the whole tree), guarding traversal.
func GitDiff(cwd, relpath string) map[string]any {
	repo := RepoRoot(cwd)
	var out string
	if relpath != "" {
		resolved, err := filepath.EvalSymlinks(filepath.Join(repo, relpath))
		repoReal, err2 := filepath.EvalSymlinks(repo)
		if err != nil || err2 != nil || !strings.HasPrefix(resolved, repoReal) {
			return map[string]any{"ok": false, "error": "Pfad ausserhalb des Repos"}
		}
		out = gitCapture("-C", repo, "diff", "HEAD", "--", relpath)
	} else {
		out = gitCapture("-C", repo, "diff", "HEAD")
	}
	if relpath != "" && strings.TrimSpace(out) == "" {
		// Untracked → show as additions
		out = gitCapture("-C", repo, "diff", "--no-index", "--", "/dev/null", relpath)
	}
	if out == "" {
		out = "(keine Änderungen)"
	}
	path := relpath
	if path == "" {
		path = "(gesamt)"
	}
	truncated := len(out) > gitDiffMax
	if truncated {
		out = out[:gitDiffMax]
	}
	return map[string]any{"ok": true, "path": path, "truncated": truncated, "diff": out}
}

// GitAdd stages all changes in the repo working tree (`git add .`).
func GitAdd(cwd string) map[string]any {
	return gitAction(cwd, "add", ".")
}

// GitCommit stages everything and commits with message.
func GitCommit(cwd, message string) map[string]any {
	msg := strings.TrimSpace(message)
	if msg == "" {
		return map[string]any{"ok": false, "cmd": "git commit", "output": "leere Commit-Message"}
	}
	add := gitAction(cwd, "add", "-A")
	if add["ok"] != true {
		return add
	}
	return gitAction(cwd, "commit", "-m", msg)
}

// GitDelete deletes a branch (git branch -d).
func GitDelete(cwd, branch string) map[string]any {
	b := strings.TrimSpace(branch)
	if b == "" {
		return map[string]any{"ok": false, "cmd": "git branch -d", "output": "kein Branch angegeben"}
	}
	return gitAction(cwd, "branch", "-d", b)
}

// GitMerge switches to main and merges branch with --no-ff.
func GitMerge(cwd, branch string) map[string]any {
	b := strings.TrimSpace(branch)
	if b == "" {
		return map[string]any{"ok": false, "cmd": "git merge", "output": "kein Branch angegeben"}
	}
	sw := gitAction(cwd, "switch", "main")
	if sw["ok"] != true {
		return sw
	}
	return gitAction(cwd, "merge", "--no-ff", b)
}

// GitPush pushes branch (or HEAD) to origin.
func GitPush(cwd, branch string) map[string]any {
	b := strings.TrimSpace(branch)
	if b == "" {
		b = "HEAD"
	}
	return gitAction(cwd, "push", "origin", b)
}
