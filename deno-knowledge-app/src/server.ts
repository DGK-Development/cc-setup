import { serveDir } from "@std/http/file-server";
import { readDoc, renderPage, resultPage } from "./render.ts";
import { buildContext, discoverProjects, repoRoot, resolveProjectCwd } from "./context.ts";
import { gitCommit, gitDelete, gitDiff, gitMerge, gitPush } from "./collectors/index.ts";
import { getAggregate } from "./cache.ts";

const HOME = Deno.env.get("HOME") ?? "/tmp";

export interface AppOptions {
  /** Repo directory to inspect (the `--cwd` flag). */
  cwd: string;
  /** Directory of static assets (reused from scripts/knowledge_assets). */
  assetsDir: string;
}

/** Reject cross-origin POSTs: Origin must be localhost if present. */
function csrfOk(origin: string | null): boolean {
  if (!origin) return true; // same-origin form posts / curl often omit Origin
  return origin.startsWith("http://127.0.0.1") || origin.startsWith("http://localhost");
}

/**
 * Build the request handler. Native routing via URL pathname + method — no web
 * framework. Mirrors knowledge.py's FastAPI routes:
 *   GET  /            -> dashboard HTML
 *   GET  /assets/*    -> static css/js (serveDir)
 *   GET  /read        -> doc JSON
 *   GET  /gitdiff     -> diff JSON
 *   POST /action/*    -> gated git actions (localhost + Origin check)
 */
export function createHandler(opts: AppOptions): (req: Request) => Response | Promise<Response> {
  const claudeHome = `${HOME}/.claude`;

  async function getProjects(): Promise<Array<{ name: string; path: string }>> {
    return discoverProjects(await repoRoot(opts.cwd));
  }

  async function getTarget(project: string): Promise<string> {
    const projects = await getProjects();
    return resolveProjectCwd(project, projects, opts.cwd);
  }

  return async (req) => {
    const url = new URL(req.url);
    const { pathname } = url;

    // Static assets
    if (pathname.startsWith("/assets/")) {
      return serveDir(req, { fsRoot: opts.assetsDir, urlRoot: "assets" });
    }

    // GET /
    if (req.method === "GET" && pathname === "/") {
      const project = url.searchParams.get("project") ?? "";
      // Projects + global come from the cached aggregate (cheap, refreshed in the
      // background). Fallback (e.g. cache not primed) discovers without stats.
      const agg = getAggregate();
      const sidebar = agg?.projects ??
        (await getProjects()).map((p) => ({ ...p, open_tasks: 0, cost_7d: 0 }));
      const target = resolveProjectCwd(project, sidebar, opts.cwd);
      const active = sidebar.some((p) => p.name === project)
        ? project
        : (await repoRoot(opts.cwd)).split("/").pop()!;
      const context = await buildContext(target, claudeHome, {
        projects: sidebar,
        active_project: active,
        global: agg?.global,
      });
      const html = await renderPage({ cwd: target, context, sidebar, active });
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // GET /read
    if (req.method === "GET" && pathname === "/read") {
      const project = url.searchParams.get("project") ?? "";
      const target = await getTarget(project);
      const kind = url.searchParams.get("kind") ?? "";
      const name = url.searchParams.get("name") ?? "";
      const path = url.searchParams.get("path") ?? "";
      const result = await readDoc(target, claudeHome, kind, name, path);
      return Response.json(result);
    }

    // GET /gitdiff
    if (req.method === "GET" && pathname === "/gitdiff") {
      const project = url.searchParams.get("project") ?? "";
      const target = await getTarget(project);
      const path = url.searchParams.get("path") ?? "";
      const result = await gitDiff(target, path);
      return Response.json(result);
    }

    // POST /action/*
    if (req.method === "POST" && pathname.startsWith("/action/")) {
      const origin = req.headers.get("origin");
      if (!csrfOk(origin)) {
        return new Response(
          resultPage("blocked", { ok: false, cmd: "-", output: "CSRF: fremde Origin blockiert" }),
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }

      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return new Response("Bad Request", { status: 400 });
      }

      const project = String(form.get("project") ?? "");
      const target = await getTarget(project);
      const action = pathname.slice("/action/".length);

      let result: Record<string, unknown>;
      switch (action) {
        case "commit": {
          const message = String(form.get("message") ?? "");
          result = await gitCommit(target, message);
          break;
        }
        case "delete": {
          const branch = String(form.get("branch") ?? "").trim();
          const confirm = String(form.get("confirm") ?? "").trim();
          if (!branch || confirm !== branch) {
            result = {
              ok: false,
              cmd: "git branch -d",
              output: "Bestätigung: tippe den exakten Branch-Namen.",
            };
          } else {
            result = await gitDelete(target, branch);
          }
          break;
        }
        case "merge": {
          const confirm = String(form.get("confirm") ?? "").trim();
          if (confirm !== "MERGE") {
            result = { ok: false, cmd: "git merge", output: "Bestätigung: tippe MERGE." };
          } else {
            result = await gitMerge(target, String(form.get("branch") ?? ""));
          }
          break;
        }
        case "push": {
          const confirm = String(form.get("confirm") ?? "").trim();
          if (confirm !== "PUSH") {
            result = { ok: false, cmd: "git push", output: "Bestätigung: tippe PUSH." };
          } else {
            result = await gitPush(target, String(form.get("branch") ?? ""));
          }
          break;
        }
        default:
          return new Response("Not found", { status: 404 });
      }

      return new Response(resultPage(action, result), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  };
}
