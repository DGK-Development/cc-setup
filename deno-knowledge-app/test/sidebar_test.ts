import { assertEquals } from "@std/assert";
import {
  countOpenTasks,
  discoverProjectsIn,
  parseTnProjects,
  projectLooseTasks,
  projectMilestones,
} from "../src/collectors/sidebar.ts";
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

Deno.test("parseTnProjects: {count,projects}, comma + ~ working_dirs, skips no-working_dir", () => {
  const home = Deno.env.get("HOME") ?? "/tmp";
  const json = JSON.stringify({
    count: 3,
    projects: [
      { name: "DAM X", kunde: "DSM", working_dir: null, tasks: 6 }, // no working_dir → skipped
      { name: "cc-setup", working_dir: "~/GITHUB_DG/cc-setup,~/git/cc-setup", tasks: 7 },
      { name: "inspire", working_dir: "/abs/GITHUB/inspire-ios/", tasks: 4 },
    ],
  });
  const m = parseTnProjects(json);
  assertEquals(m.get(home + "/GITHUB_DG/cc-setup"), 7); // first of comma list, ~ expanded
  assertEquals(m.get(home + "/git/cc-setup"), 7); // second of comma list
  assertEquals(m.get("/abs/GITHUB/inspire-ios"), 4); // trailing / trimmed
  assertEquals(m.has("null"), false);
});

Deno.test("projectLooseTasks returns only tasks WITHOUT a milestone (id/title/status)", async () => {
  const repo = await Deno.makeTempDir();
  const tasks = join(repo, "backlog", "tasks");
  await Deno.mkdir(tasks, { recursive: true });
  await Deno.writeTextFile(
    join(tasks, "a.md"),
    "---\nid: A-1\nstatus: To Do\nmilestone: m1\n---\n",
  );
  await Deno.writeTextFile(
    join(tasks, "b.md"),
    "---\nid: A-2\ntitle: Lose Aufgabe\nstatus: In Progress\n---\n",
  );
  const loose = await projectLooseTasks(repo);
  assertEquals(loose.length, 1);
  assertEquals(loose[0].id, "A-2");
  assertEquals(loose[0].title, "Lose Aufgabe");
  assertEquals(loose[0].status, "In Progress");
});

Deno.test("projectMilestones groups tasks by milestone with done/total", async () => {
  const repo = await Deno.makeTempDir();
  const tasks = join(repo, "backlog", "tasks");
  await Deno.mkdir(tasks, { recursive: true });
  await Deno.writeTextFile(join(tasks, "a.md"), "---\nid: a\nstatus: Done\nmilestone: m1\n---\n");
  await Deno.writeTextFile(join(tasks, "b.md"), "---\nid: b\nstatus: To Do\nmilestone: m1\n---\n");
  await Deno.writeTextFile(join(tasks, "c.md"), "---\nid: c\nstatus: Done\nmilestone: m2\n---\n");
  await Deno.writeTextFile(join(tasks, "d.md"), "---\nid: d\nstatus: To Do\n---\n"); // no milestone
  assertEquals(await projectMilestones(repo), [
    { name: "m1", done: 1, total: 2 },
    { name: "m2", done: 1, total: 1 },
  ]);
});
