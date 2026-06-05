import { assertEquals } from "@std/assert";
import { countOpenTasks, discoverProjectsIn } from "../src/collectors/sidebar.ts";
import { join } from "@std/path";

async function tmpProject(root: string, name: string, withBacklog: boolean): Promise<string> {
  const p = join(root, name);
  await Deno.mkdir(p, { recursive: true });
  if (withBacklog) await Deno.mkdir(join(p, "backlog", "tasks"), { recursive: true });
  return p;
}

Deno.test("discoverProjectsIn finds backlog dirs across multiple roots + dedupes", async () => {
  const base = await Deno.makeTempDir();
  const r1 = join(base, "dg"), r2 = join(base, "priv");
  await tmpProject(r1, "alpha", true);
  await tmpProject(r1, "no-backlog", false);
  await tmpProject(r2, "beta", true);
  await tmpProject(r2, "alpha", true); // same name in 2nd root → first wins, no dup

  const got = await discoverProjectsIn([r1, r2], join(r1, "alpha"));
  assertEquals(got.map((p) => p.name), ["alpha", "beta"]);
  assertEquals(got.find((p) => p.name === "alpha")?.path, join(r1, "alpha"));
});

Deno.test("discoverProjectsIn always includes the active repo", async () => {
  const base = await Deno.makeTempDir();
  const active = join(base, "solo");
  await Deno.mkdir(active, { recursive: true }); // no backlog/, not discovered by scan
  const got = await discoverProjectsIn([join(base, "missing-root")], active);
  assertEquals(got.map((p) => p.name), ["solo"]);
});

Deno.test("countOpenTasks counts non-Done task files", async () => {
  const repo = await Deno.makeTempDir();
  const tasks = join(repo, "backlog", "tasks");
  await Deno.mkdir(tasks, { recursive: true });
  await Deno.writeTextFile(join(tasks, "t1.md"), "---\nid: t1\nstatus: To Do\n---\n");
  await Deno.writeTextFile(join(tasks, "t2.md"), "---\nid: t2\nstatus: In Progress\n---\n");
  await Deno.writeTextFile(join(tasks, "t3.md"), "---\nid: t3\nstatus: Done\n---\n");
  assertEquals(await countOpenTasks(repo), 2);
});

Deno.test("countOpenTasks returns 0 without a backlog dir", async () => {
  const repo = await Deno.makeTempDir();
  assertEquals(await countOpenTasks(repo), 0);
});
