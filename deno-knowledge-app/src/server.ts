import { serveDir } from "@std/http/file-server";
import { readDoc, renderPage, resultPage } from "./render.ts";
import { buildContext, discoverProjects, repoRoot, resolveProjectCwd } from "./context.ts";
import {
  gitCommit,
  gitDelete,
  gitDiff,
  gitMerge,
  gitPush,
  setTaskStatus,
} from "./collectors/index.ts";
import { ensureFresh, getAggregate, getProjectContext, invalidateProjectContext } from "./cache.ts";
import { collectHookInject } from "./collectors/hook_inject.ts";
import { fmtMtime } from "./md.ts";
import { join } from "@std/path";
import { parseJson, run } from "./shared.ts";

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

  // Reserved path segments that conflict with known API routes. A project with
  // the same name as one of these would be shadowed by the route above — document
  // that here so it's visible. These names are not blocked; they just can't be
  // reached via path-form URL (use ?project= query-param as fallback if needed).
  const RESERVED_SEGMENTS = new Set(["assets", "read", "tn-note", "hook-inject", "gitdiff", "action"]);

  /** Shared page-render logic for GET / and GET /<project>[/<view>]. */
  async function servePage(projectParam: string, initialView: string): Promise<Response> {
    // Lazy, single-flight refresh: only fires if the cache is stale AND no
    // refresh is already running — so never more than one session_analyze batch.
    ensureFresh(opts.cwd, claudeHome);
    // Projects + global come from the cached aggregate. Fallback (cache not yet
    // primed) discovers without stats.
    const agg = getAggregate();
    const sidebar = agg?.projects ??
      (await getProjects()).map((p) => ({
        ...p,
        open_tasks: 0,
        cost_7d: 0,
        milestones: [],
        looseTasks: [],
        tn: 0,
      }));
    // No (valid) project selected → cross-project Überblick view (global + sidebar).
    const selected = sidebar.some((p) => p.name === projectParam) ? projectParam : "";
    const view = selected ? "project" as const : "overview" as const;
    const target = resolveProjectCwd(selected, sidebar, opts.cwd);
    const activeName = selected || (await repoRoot(opts.cwd)).split("/").pop()!;
    // Per-Projekt-Cache (B2): buildContext wird gecacht (TTL+single-flight) um den
    // 6.7s JSONL-Scan nicht bei jedem Request neu auszufuehren.
    // Overview (skipProject=true) wird nicht gecacht — ist ohnehin <15ms.
    const context = view === "overview"
      ? await buildContext(target, claudeHome, {
        projects: sidebar,
        active_project: activeName,
        global: agg?.global,
        skipProject: true,
      })
      : await getProjectContext(target, () =>
        buildContext(target, claudeHome, {
          projects: sidebar,
          active_project: activeName,
          global: agg?.global,
          skipProject: false,
        }));
    const html = await renderPage({
      cwd: target,
      context,
      sidebar,
      active: selected,
      view,
      initialView: initialView || undefined,
      generatedAt: agg ? fmtMtime(agg.generated_at / 1000) : undefined,
      loading: !agg,
    });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
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
      return servePage(project, "");
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

    // GET /tn-note — CCS-027: fetch tn task note body via tn show <id> --format json.
    // Returns {ok, body} where body is the raw Markdown body (no frontmatter).
    // id is strictly validated (alphanumeric + hyphen/underscore) to prevent injection.
    if (req.method === "GET" && pathname === "/tn-note") {
      const tnId = url.searchParams.get("id") ?? "";
      const project = url.searchParams.get("project") ?? "";
      // Whitelist: tn task IDs are alphanumeric + hyphens/underscores, no path chars
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(tnId)) {
        return Response.json({ ok: false, error: "ungültige Task-ID" });
      }
      const target = await getTarget(project);
      const scriptsDir = join(new URL("../../scripts", import.meta.url).pathname);
      const tnPath = join(scriptsDir, "tasknotes_cli.py");
      try {
        await Deno.stat(tnPath);
      } catch {
        return Response.json({ ok: false, error: "tn nicht verfügbar" });
      }
      const out = await run(["uv", "run", "--script", tnPath, "show", tnId, "--format", "json"], {
        cwd: target,
      });
      const parsed = parseJson<{ task?: { body?: string; title?: string } }>(out);
      if (!parsed?.task) {
        return Response.json({ ok: false, error: "Task nicht gefunden" });
      }
      return Response.json({
        ok: true,
        body: parsed.task.body ?? "",
        title: parsed.task.title ?? tnId,
      });
    }

    // GET /hook-inject — CCS-031: run the SessionStart hook LIVE for the selected
    // project and return its token cost. project comes from the known-projects
    // whitelist (resolveProjectCwd) — no user input reaches the command. The
    // collector single-flights + TTL-caches + times out, so this never spawns a
    // subprocess per request or runs away. CC_HOOK_LOG_FILE=/dev/null inside the
    // collector keeps the canonical session log untouched.
    if (req.method === "GET" && pathname === "/hook-inject") {
      const project = url.searchParams.get("project") ?? "";
      const target = await getTarget(project);
      const r = await collectHookInject(target);
      return Response.json(r);
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

      // Kanban drag-drop: change a task's status, return JSON (not the HTML page).
      if (action === "task-status") {
        const result = await setTaskStatus(
          target,
          String(form.get("id") ?? ""),
          String(form.get("status") ?? ""),
        );
        // Invalidiere Projekt-Cache nach Task-Statuswechsel (Backlog-Stand veraendert)
        if (result.ok) invalidateProjectContext(target);
        return Response.json(result);
      }

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

      // Invalidiere Projekt-Cache nach erfolgreichen Git-Mutationen, damit
      // Git-Status und Backlog-Board sofort frisch sind (kein Stale bis TTL-Ablauf).
      if (result.ok) invalidateProjectContext(target);

      return new Response(resultPage(action, result), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // Path-based project routing: GET /<project>[/<view>]
    // Must be a GET and the first segment must not be a reserved API route.
    if (req.method === "GET") {
      // Strip leading slash, split into segments (ignore empty trailing segments)
      const segments = pathname.slice(1).split("/").filter((s) => s.length > 0);
      if (segments.length >= 1 && !RESERVED_SEGMENTS.has(segments[0])) {
        const projectName = decodeURIComponent(segments[0]);
        const viewHint = segments.length >= 2 ? decodeURIComponent(segments[1]) : "";
        return servePage(projectName, viewHint);
      }
    }

    return new Response("Not found", { status: 404 });
  };
}
