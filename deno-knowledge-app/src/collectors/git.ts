// collect_git — mirrors knowledge.py collect_git
// Read-only git state: branch, branches, status, diff stat, recommendation.
// Also exports git action helpers (commit/delete/merge/push) for POST routes.

import { run } from "../shared.ts";
import { repoRoot } from "./project.ts";

function git(cwd: string, ...args: string[]): Promise<string | null> {
  return run(["git", "-C", cwd, ...args], { cwd });
}

async function gitLines(cwd: string, ...args: string[]): Promise<string[]> {
  const out = await git(cwd, ...args);
  return (out ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
}

async function aheadBehind(
  cwd: string,
  base: string,
  ref: string,
): Promise<[number, number] | null> {
  const out = await git(cwd, "rev-list", "--left-right", "--count", `${base}...${ref}`);
  if (!out) return null;
  const parts = out.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const behind = parseInt(parts[0], 10);
  const ahead = parseInt(parts[1], 10);
  if (isNaN(behind) || isNaN(ahead)) return null;
  return [ahead, behind];
}

function gitRecommend(
  branch: string,
  dirty: boolean,
  aheadOrigin: number | null,
  aheadMain: number | null,
): string {
  if (dirty) return "Uncommittete Änderungen → erst committen (dann nach Review push/merge).";
  if (branch !== "main" && (aheadMain ?? 0) > 0) {
    return `'${branch}' ist ${aheadMain} Commit(s) vor main → nach Review nach main mergen.`;
  }
  if (branch !== "main" && aheadMain === 0) {
    return `'${branch}' ist vollständig in main → Branch kann gelöscht werden.`;
  }
  if ((aheadOrigin ?? 0) > 0) {
    return `${aheadOrigin} Commit(s) vor origin → nach Review pushen.`;
  }
  return "Clean & in sync — nichts zu tun.";
}

async function collectGit(cwd: string): Promise<Record<string, unknown>> {
  try {
    const repo = await repoRoot(cwd);
    const branchOut = await git(repo, "rev-parse", "--abbrev-ref", "HEAD");
    if (branchOut === null) return { available: false, reason: "kein git-Repo" };
    const branch = branchOut.trim();

    const branches = await gitLines(repo, "branch", "--format=%(refname:short)");

    // numstat for per-file added/deleted
    const numstatOut = await git(repo, "diff", "--numstat", "HEAD") ?? "";
    const numstat = new Map<string, [number | null, number | null]>();
    for (const ln of numstatOut.split("\n")) {
      const parts = ln.split("\t");
      if (parts.length !== 3) continue;
      const [a, d, p] = parts;
      const ai = /^\d+$/.test(a) ? parseInt(a, 10) : null;
      const di = /^\d+$/.test(d) ? parseInt(d, 10) : null;
      numstat.set(p.trim(), [ai, di]);
    }

    const statusOut = await git(repo, "status", "--porcelain") ?? "";
    let staged = 0, unstaged = 0, untracked = 0;
    const files: string[] = [];
    const filesStruct: Array<Record<string, unknown>> = [];

    for (const ln of statusOut.split("\n")) {
      if (!ln) continue;
      const isUntracked = ln.startsWith("??");
      if (isUntracked) {
        untracked++;
      } else {
        if (ln[0] !== " ") staged++;
        if (ln.length > 1 && ln[1] !== " ") unstaged++;
      }
      files.push(ln.trimEnd());
      const xy = ln.slice(0, 2);
      let path = ln.slice(3).trim();
      if (path.includes(" -> ")) path = path.split(" -> ").pop()!.trim();
      path = path.replace(/^"|"$/g, "");
      const [added, deleted] = numstat.get(path) ?? [null, null];
      filesStruct.push({ xy, path, untracked: isUntracked, added, deleted });
    }
    const dirty = statusOut.trim().length > 0;
    const shortstat = (await git(repo, "diff", "--shortstat", "HEAD") ?? "").trim();

    let aheadOrigin: number | null = null, behindOrigin: number | null = null;
    const abO = await aheadBehind(repo, `origin/${branch}`, branch);
    if (abO) [aheadOrigin, behindOrigin] = abO;
    let aheadMain: number | null = null;
    if (branch !== "main") {
      const abM = await aheadBehind(repo, "main", branch);
      if (abM) aheadMain = abM[0];
    }

    return {
      available: true,
      branch,
      branches,
      staged,
      unstaged,
      untracked,
      files: files.slice(0, 40),
      files_struct: filesStruct.slice(0, 60),
      dirty,
      shortstat,
      ahead_origin: aheadOrigin,
      behind_origin: behindOrigin,
      ahead_main: aheadMain,
      recommend: gitRecommend(branch, dirty, aheadOrigin, aheadMain),
    };
  } catch (exc) {
    return { available: false, reason: `collect_git failed: ${exc}` };
  }
}

// ---------------------------------------------------------------------------
// Mutating git actions (used by POST /action/* routes)
// ---------------------------------------------------------------------------

const GIT_DIFF_MAX = 200000;

async function gitCapture(args: string[]): Promise<string> {
  const proc = new Deno.Command("git", { args, stdout: "piped", stderr: "piped" });
  const { stdout, stderr } = await proc.output();
  return new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr);
}

async function gitAction(cwd: string, ...args: string[]): Promise<Record<string, unknown>> {
  const cmdStr = "git " + args.join(" ");
  try {
    const proc = new Deno.Command("git", {
      args: ["-C", cwd, ...args],
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout, stderr } = await proc.output();
    const out = (new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr)).trim();
    return { ok: code === 0, cmd: cmdStr, output: out || "(kein Output)" };
  } catch (exc) {
    return { ok: false, cmd: cmdStr, output: String(exc) };
  }
}

async function gitDiff(cwd: string, relpath: string): Promise<Record<string, unknown>> {
  try {
    const repo = await repoRoot(cwd);
    let args: string[];
    if (relpath) {
      // Guard traversal: resolved path must stay inside repo
      const resolved = await Deno.realPath(repo + "/" + relpath).catch(() => null);
      if (!resolved || !resolved.startsWith(await Deno.realPath(repo))) {
        return { ok: false, error: "Pfad ausserhalb des Repos" };
      }
      args = ["-C", repo, "diff", "HEAD", "--", relpath];
    } else {
      args = ["-C", repo, "diff", "HEAD"];
    }

    let out = await gitCapture(args);
    if (relpath && !out.trim()) {
      // Untracked → show as additions
      out = await gitCapture(["-C", repo, "diff", "--no-index", "--", "/dev/null", relpath]);
    }
    out = out || "(keine Änderungen)";
    return {
      ok: true,
      path: relpath || "(gesamt)",
      truncated: out.length > GIT_DIFF_MAX,
      diff: out.slice(0, GIT_DIFF_MAX),
    };
  } catch (exc) {
    return { ok: false, error: String(exc) };
  }
}

async function gitCommit(cwd: string, message: string): Promise<Record<string, unknown>> {
  const msg = message.trim();
  if (!msg) return { ok: false, cmd: "git commit", output: "leere Commit-Message" };
  const add = await gitAction(cwd, "add", "-A");
  if (!add.ok) return add;
  return gitAction(cwd, "commit", "-m", msg);
}

function gitDelete(cwd: string, branch: string): Promise<Record<string, unknown>> {
  const b = branch.trim();
  if (!b) {
    return Promise.resolve({ ok: false, cmd: "git branch -d", output: "kein Branch angegeben" });
  }
  return gitAction(cwd, "branch", "-d", b);
}

async function gitMerge(cwd: string, branch: string): Promise<Record<string, unknown>> {
  const b = branch.trim();
  if (!b) return { ok: false, cmd: "git merge", output: "kein Branch angegeben" };
  const sw = await gitAction(cwd, "switch", "main");
  if (!sw.ok) return sw;
  return gitAction(cwd, "merge", "--no-ff", b);
}

function gitPush(cwd: string, branch: string): Promise<Record<string, unknown>> {
  const b = branch.trim() || "HEAD";
  return gitAction(cwd, "push", "origin", b);
}
