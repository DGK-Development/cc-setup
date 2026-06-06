import { parseArgs } from "@std/cli/parse-args";
import { resolve } from "@std/path";
import { createHandler } from "./src/server.ts";
import { getAggregate, primeProjectContext, startCache } from "./src/cache.ts";

/** Static assets (dash.css/browser.css/browser.js) live with the Deno app. */
function assetsDir(): string {
  return resolve(import.meta.dirname!, "assets");
}

if (import.meta.main) {
  const flags = parseArgs(Deno.args, {
    string: ["cwd", "port"],
    boolean: ["no-open"],
    default: { cwd: ".", port: "8765" },
  });

  const cwd = resolve(flags.cwd);
  const port = Number(flags.port);
  const url = `http://127.0.0.1:${port}/`;

  if (!flags["no-open"]) {
    try {
      new Deno.Command("open", { args: [url] }).spawn();
    } catch {
      // best-effort; ignore if `open` is unavailable
    }
  }

  // Prime + periodically refresh the aggregate cache in the background so the
  // server boots instantly; the sidebar/global fill in once the first scan lands.
  const claudeHome = `${Deno.env.get("HOME") ?? "/tmp"}/.claude`;
  // Aggregate-Prime zuerst (Sidebar + Global), dann Boot-Prime fuer das Start-Projekt.
  // Nach dem Aggregate-Prime ist getAggregate() gesetzt → primeProjectContext nutzt
  // global/projects aus dem Aggregat statt sie nochmal zu sammeln.
  startCache(cwd, claudeHome)
    .then(() => primeProjectContext(cwd, claudeHome, getAggregate()))
    .catch(() => {});

  console.log(`knowledge dashboard (deno) → ${url}  (cwd=${cwd})`);
  Deno.serve({ port, hostname: "127.0.0.1" }, createHandler({ cwd, assetsDir: assetsDir() }));
}
