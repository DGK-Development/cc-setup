import { parseArgs } from "@std/cli/parse-args";
import { resolve } from "@std/path";
import { createHandler } from "./src/server.ts";
import { startCache } from "./src/cache.ts";

/** Static assets are reused from the existing python app (single source). */
function assetsDir(): string {
  return resolve(import.meta.dirname!, "..", "scripts", "knowledge_assets");
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
  startCache(cwd, claudeHome).catch(() => {});

  console.log(`knowledge dashboard (deno) → ${url}  (cwd=${cwd})`);
  Deno.serve({ port, hostname: "127.0.0.1" }, createHandler({ cwd, assetsDir: assetsDir() }));
}
