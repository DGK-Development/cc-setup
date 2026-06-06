// Package cache is the file-backed aggregate cache + per-project context cache —
// Go-native port of cache.ts. The Deno single-flight (shared promise) becomes a
// mutex + done-channel; otherwise behavior (TTL, lazy refresh, generation-guarded
// writes) matches.
//
// NOTE: tn (TaskNotes) is intentionally NOT aggregated here (Org rule) — the
// cross-project view stays limited to repo backlog + token cost.
package cache

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"go-knowledge-app/internal/appctx"
	"go-knowledge-app/internal/collectors"
)

// Aggregate caches the expensive shared data: the global layer + the
// multi-project sidebar.
type Aggregate struct {
	GeneratedAt int64                       `json:"generated_at"` // epoch ms
	Global      map[string]any              `json:"global"`
	Projects    []collectors.SidebarProject `json:"projects"`
}

func nowMs() int64 { return time.Now().UnixMilli() }

// CacheFile returns the on-disk cache path (CC_KNOWLEDGE_CACHE overrides).
func CacheFile() string {
	if env := os.Getenv("CC_KNOWLEDGE_CACHE"); env != "" {
		return env
	}
	return filepath.Join(collectors.Home(), ".cache", "cc-knowledge", "cache.json")
}

// TTLMs returns the cache TTL (CC_KNOWLEDGE_TTL_MS overrides; default 15 min).
func TTLMs() int64 {
	if env := os.Getenv("CC_KNOWLEDGE_TTL_MS"); env != "" {
		if v, err := strconv.ParseInt(env, 10, 64); err == nil && v > 0 {
			return v
		}
		if f, err := strconv.ParseFloat(env, 64); err == nil && f > 0 {
			return int64(f)
		}
	}
	return 15 * 60 * 1000
}

// IsFresh is a pure freshness predicate.
func IsFresh(agg *Aggregate, ttl, now int64) bool {
	return agg != nil && (now-agg.GeneratedAt) < ttl
}

func isProjectContextFresh(e *projEntry, ttl, now int64) bool {
	return e != nil && (now-e.generatedAt) < ttl
}

// ReadCacheFile loads a cache file, returning nil if missing/invalid.
func ReadCacheFile(path string) *Aggregate {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var agg Aggregate
	if json.Unmarshal(b, &agg) != nil {
		return nil
	}
	if agg.Projects == nil {
		return nil // mirrors the Array.isArray(projects) guard
	}
	return &agg
}

// WriteCacheFile persists the aggregate (best-effort).
func WriteCacheFile(agg *Aggregate, path string) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	b, err := json.Marshal(agg)
	if err != nil {
		return
	}
	_ = os.WriteFile(path, b, 0o644)
}

// ComputeAggregate collects the global layer + sidebar fresh.
func ComputeAggregate(activeRepo, home string, now int64) Aggregate {
	return Aggregate{
		GeneratedAt: now,
		Global:      collectors.CollectGlobal(home),
		Projects:    collectors.CollectSidebar(activeRepo),
	}
}

var (
	mu          sync.Mutex
	current     *Aggregate
	refreshing  bool
	refreshDone chan struct{}
	started     bool
)

// GetAggregate returns the latest in-memory aggregate (or nil).
func GetAggregate() *Aggregate {
	mu.Lock()
	defer mu.Unlock()
	return current
}

// IsRefreshing reports whether an aggregate refresh is in flight.
func IsRefreshing() bool {
	mu.Lock()
	defer mu.Unlock()
	return refreshing
}

// RefreshAggregate runs a single-flight aggregate computation, blocking until it
// completes (concurrent callers wait on the same run). Call in a goroutine for
// fire-and-forget behavior.
func RefreshAggregate(activeRepo, home string) {
	mu.Lock()
	if refreshing {
		ch := refreshDone
		mu.Unlock()
		<-ch
		return
	}
	refreshing = true
	refreshDone = make(chan struct{})
	ch := refreshDone
	mu.Unlock()

	next := ComputeAggregate(activeRepo, home, nowMs())

	mu.Lock()
	current = &next
	refreshing = false
	refreshDone = nil
	mu.Unlock()

	WriteCacheFile(&next, CacheFile())
	close(ch)
}

// EnsureFresh kicks off a refresh ONLY if the cache is stale AND none is running.
// Non-blocking, fire-and-forget.
func EnsureFresh(activeRepo, home string) {
	mu.Lock()
	if !started || refreshing || IsFresh(current, TTLMs(), nowMs()) {
		mu.Unlock()
		return
	}
	mu.Unlock()
	go RefreshAggregate(activeRepo, home)
}

// StartCache primes once on boot: load a fresh cache file if present, else
// compute one aggregate (single-flight). No background timer.
func StartCache(activeRepo, home string) {
	mu.Lock()
	started = true
	mu.Unlock()
	fromFile := ReadCacheFile(CacheFile())
	if IsFresh(fromFile, TTLMs(), nowMs()) {
		mu.Lock()
		current = fromFile
		mu.Unlock()
		return
	}
	RefreshAggregate(activeRepo, home)
}

// ---------------------------------------------------------------------------
// Per-project detail cache
// ---------------------------------------------------------------------------

type projEntry struct {
	generatedAt int64
	context     map[string]any
}

type projCall struct {
	done   chan struct{}
	result map[string]any
}

var (
	pcMu                     sync.Mutex
	projectContextCache      = map[string]projEntry{}
	projectContextInFlight   = map[string]*projCall{}
	projectContextGeneration = map[string]int{}
)

// GetProjectContext returns a cached project context or starts a single-flight
// computation. projectKey is the resolved absolute project path.
func GetProjectContext(projectKey string, computeFn func() map[string]any) map[string]any {
	mu.Lock()
	st := started
	mu.Unlock()
	if !st {
		return computeFn() // test mode: always live
	}

	now := nowMs()
	ttl := TTLMs()
	pcMu.Lock()
	if e, ok := projectContextCache[projectKey]; ok && isProjectContextFresh(&e, ttl, now) {
		pcMu.Unlock()
		return e.context
	}
	if c, ok := projectContextInFlight[projectKey]; ok {
		pcMu.Unlock()
		<-c.done
		return c.result
	}
	genAtStart := projectContextGeneration[projectKey]
	c := &projCall{done: make(chan struct{})}
	projectContextInFlight[projectKey] = c
	pcMu.Unlock()

	ctx := computeFn()

	pcMu.Lock()
	if projectContextGeneration[projectKey] == genAtStart {
		projectContextCache[projectKey] = projEntry{generatedAt: nowMs(), context: ctx}
	}
	delete(projectContextInFlight, projectKey)
	c.result = ctx
	close(c.done)
	pcMu.Unlock()
	return ctx
}

// InvalidateProjectContext drops a project's cache entry + bumps its generation
// (so a late-finishing compute discards its stale result).
func InvalidateProjectContext(projectKey string) {
	pcMu.Lock()
	delete(projectContextCache, projectKey)
	projectContextGeneration[projectKey]++
	pcMu.Unlock()
}

// PrimeProjectContext computes the start project's context once on boot.
func PrimeProjectContext(cwd, claudeHome string, agg *Aggregate) {
	mu.Lock()
	st := started
	mu.Unlock()
	if !st {
		return
	}
	pcMu.Lock()
	e, ok := projectContextCache[cwd]
	fresh := ok && isProjectContextFresh(&e, TTLMs(), nowMs())
	pcMu.Unlock()
	if fresh {
		return
	}
	var projects []collectors.SidebarProject
	var global map[string]any
	if agg != nil {
		projects = agg.Projects
		global = agg.Global
	}
	GetProjectContext(cwd, func() map[string]any {
		return appctx.BuildContext(cwd, claudeHome, appctx.BuildOpts{
			Projects:      projects,
			ActiveProject: lastSeg(cwd),
			Global:        global,
			SkipProject:   false,
		})
	})
}

func lastSeg(p string) string {
	for i := len(p) - 1; i >= 0; i-- {
		if p[i] == '/' {
			return p[i+1:]
		}
	}
	return p
}

// Test helpers.
func ResetProjectContextCacheForTest() {
	pcMu.Lock()
	projectContextCache = map[string]projEntry{}
	projectContextInFlight = map[string]*projCall{}
	projectContextGeneration = map[string]int{}
	pcMu.Unlock()
}

func SetStartedForTest(v bool) {
	mu.Lock()
	started = v
	mu.Unlock()
}
