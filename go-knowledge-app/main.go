// Command go-knowledge-app serves the single-pane knowledge dashboard on
// 127.0.0.1 — Go-native port of the Deno knowledge app (main.ts).
package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"path/filepath"

	"go-knowledge-app/internal/assets"
	"go-knowledge-app/internal/cache"
	"go-knowledge-app/internal/collectors"
	"go-knowledge-app/internal/render"
	"go-knowledge-app/internal/server"
)

func main() {
	cwdFlag := flag.String("cwd", ".", "repo directory to inspect")
	portFlag := flag.String("port", "8765", "listen port")
	noOpen := flag.Bool("no-open", false, "do not open the browser on start")
	flag.Parse()

	cwd, err := filepath.Abs(*cwdFlag)
	if err != nil {
		cwd = *cwdFlag
	}
	port := *portFlag
	urlStr := "http://127.0.0.1:" + port + "/"

	if !*noOpen {
		_ = exec.Command("open", urlStr).Start() // best-effort; ignore if unavailable
	}

	claudeHome := collectors.Home() + "/.claude"

	// Prime + refresh the aggregate cache in the background so the server boots
	// instantly; the sidebar/global fill in once the first scan lands. Aggregate
	// prime first, then boot-prime for the start project.
	go func() {
		cache.StartCache(cwd, claudeHome)
		cache.PrimeProjectContext(cwd, claudeHome, cache.GetAggregate())
	}()

	fmt.Printf("knowledge dashboard (go) → %s  (cwd=%s)\n", urlStr, cwd)

	handler := server.NewHandler(server.AppOptions{
		Cwd: cwd,
		Assets: render.Assets{
			DashCSS:    assets.DashCSS,
			BrowserCSS: assets.BrowserCSS,
			BrowserJS:  assets.BrowserJS,
		},
		AssetFS: assets.FS(),
	})

	srv := &http.Server{Addr: "127.0.0.1:" + port, Handler: handler}
	log.Fatal(srv.ListenAndServe())
}
