package collectors

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"go-knowledge-app/internal/md"
)

const (
	hookTTLMs     int64 = 60_000
	hookTimeoutMs       = 5_000
)

// HookInjectResult reports the SessionStart hook's live token cost.
type HookInjectResult struct {
	Ok     bool   `json:"ok"`
	Tokens int    `json:"tokens"`
	Output string `json:"output"`
	Error  string `json:"error,omitempty"`
}

// hookRun is one runner invocation's raw result.
type hookRun struct {
	ok     bool
	output string
	err    string
}

// HookRunner spawns the hook; tests pass a fake.
type HookRunner func(cwd string) hookRun

func hookPath() string {
	return filepath.Join(filepath.Dir(ScriptsDir()), "hooks", "inject-project-context.sh")
}

// realRunner spawns `bash <hook>` in cwd with the log override + timeout.
func realRunner(cwd string) hookRun {
	path := hookPath()
	if _, err := os.Stat(path); err != nil {
		return hookRun{ok: false, output: "", err: fmt.Sprintf("Hook nicht gefunden: %s", path)}
	}
	ctx, cancel := context.WithTimeout(context.Background(), hookTimeoutMs*time.Millisecond)
	defer cancel()
	cmd := exec.CommandContext(ctx, "bash", path)
	cmd.Dir = cwd
	// Override the hook's log target so the canonical session log is untouched.
	cmd.Env = append(os.Environ(), "CC_HOOK_LOG_FILE=/dev/null")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return hookRun{ok: false, output: "", err: err.Error()}
	}
	return hookRun{ok: true, output: stdout.String() + stderr.String()}
}

type hookCacheEntry struct {
	at    int64
	value HookInjectResult
}

type hookCall struct {
	done  chan struct{}
	value HookInjectResult
}

var (
	hookMu       sync.Mutex
	hookCache    = map[string]hookCacheEntry{}
	hookInflight = map[string]*hookCall{}
)

// CollectHookInject runs the SessionStart hook for cwd, returning {ok, tokens,
// output}. Cached per cwd for hookTTLMs; concurrent calls share one in-flight run.
func CollectHookInject(cwd string) HookInjectResult {
	return collectHookInjectWith(cwd, realRunner)
}

func collectHookInjectWith(cwd string, runner HookRunner) HookInjectResult {
	nowMs := time.Now().UnixMilli()
	hookMu.Lock()
	if e, ok := hookCache[cwd]; ok && nowMs-e.at < hookTTLMs {
		hookMu.Unlock()
		return e.value
	}
	if c, ok := hookInflight[cwd]; ok {
		hookMu.Unlock()
		<-c.done
		return c.value
	}
	c := &hookCall{done: make(chan struct{})}
	hookInflight[cwd] = c
	hookMu.Unlock()

	r := runner(cwd)
	var value HookInjectResult
	if r.ok {
		value = HookInjectResult{Ok: true, Tokens: md.EstTokens(r.output), Output: r.output}
	} else {
		value = HookInjectResult{Ok: false, Tokens: 0, Output: r.output, Error: r.err}
	}

	hookMu.Lock()
	hookCache[cwd] = hookCacheEntry{at: time.Now().UnixMilli(), value: value}
	c.value = value
	delete(hookInflight, cwd)
	close(c.done)
	hookMu.Unlock()
	return value
}

// ResetHookCache drops the per-cwd cache so TTL/single-flight tests start clean.
func ResetHookCache() {
	hookMu.Lock()
	hookCache = map[string]hookCacheEntry{}
	hookInflight = map[string]*hookCall{}
	hookMu.Unlock()
}
