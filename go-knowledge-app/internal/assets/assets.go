// Package assets embeds the static dashboard assets (browser.js/css, dash.css)
// into the binary via go:embed, so the app ships as a single self-contained file
// (the Go-native replacement for the Deno app's on-disk assets/ + serveDir).
package assets

import (
	"embed"
	"io/fs"
)

//go:embed static/browser.css
var BrowserCSS string

//go:embed static/browser.js
var BrowserJS string

//go:embed static/dash.css
var DashCSS string

//go:embed static
var staticFS embed.FS

// FS returns the static/ subtree rooted so files are served at their bare names
// (e.g. /assets/browser.js → static/browser.js).
func FS() fs.FS {
	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		panic(err) // embed is compile-time guaranteed; this can't happen
	}
	return sub
}
