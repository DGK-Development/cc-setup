// Package shared holds low-level helpers — Go-native ports of the Deno app's
// subprocess/filesystem primitives (shared.ts). Intentionally framework-free so
// collectors stay unit-testable in isolation (mirrors the Python _run/read_text
// split).
package shared

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"strings"
	"time"
	"unicode"
)

// RunOptions configures Run. Zero values disable the respective feature.
type RunOptions struct {
	Cwd       string
	TimeoutMs int
}

// Run executes a command and returns its trimmed stdout on success (exit code
// 0), or ("", false) on non-zero exit, missing binary, or timeout. Replaces
// subprocess.run(..., capture_output=True) + the broad except in knowledge.py.
func Run(cmd []string, opts RunOptions) (string, bool) {
	if len(cmd) == 0 {
		return "", false
	}
	ctx := context.Background()
	if opts.TimeoutMs > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(opts.TimeoutMs)*time.Millisecond)
		defer cancel()
	}
	c := exec.CommandContext(ctx, cmd[0], cmd[1:]...)
	if opts.Cwd != "" {
		c.Dir = opts.Cwd
	}
	out, err := c.Output() // captures stdout; stderr discarded like the Deno version
	if err != nil {
		return "", false
	}
	// Trim trailing whitespace only, matching `.replace(/\s+$/, "")`.
	return strings.TrimRightFunc(string(out), unicode.IsSpace), true
}

// ReadText reads a UTF-8 file, returning ("", false) instead of erroring.
func ReadText(path string) (string, bool) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", false
	}
	return string(b), true
}

// ParseJSON parses JSON into T, returning (zero, false) on empty/malformed input
// (mirrors a guarded json.loads).
func ParseJSON[T any](text string) (T, bool) {
	var v T
	if text == "" {
		return v, false
	}
	if err := json.Unmarshal([]byte(text), &v); err != nil {
		return v, false
	}
	return v, true
}
