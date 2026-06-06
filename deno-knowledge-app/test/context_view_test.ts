import { assertEquals } from "@std/assert";
import { buildData } from "../src/context.ts";
import {
  CTX_WINDOW,
  memoryMdTokens,
  SYS_PROMPT_TOK,
  SYS_TOOLS_TOK,
} from "../src/collectors/context_view.ts";
import { estTokens } from "../src/md.ts";

// CCS-031: coll.context structure + measured_total.
function ctxCtx() {
  return {
    cards: {
      global: {
        available: true,
        skills: {
          count: 2,
          names: ["a", "b"],
          items: [
            // tokens = full SKILL.md (corpus); meta_tokens = name+description (session-start load).
            {
              name: "a",
              description: "Skill A",
              tokens: 100,
              meta_tokens: 10,
              size_bytes: 0,
              has_md: true,
              scripts: [],
            },
            {
              name: "b",
              description: "Skill B",
              tokens: 200,
              meta_tokens: 20,
              size_bytes: 0,
              has_md: true,
              scripts: [],
            },
          ],
        },
        agents: ["dev"],
        agent_items: [{
          name: "dev",
          description: "Developer",
          tokens: 50,
          meta_tokens: 5,
          size_bytes: 0,
        }],
        claude_md: { headers: [], tokens: 1000, size_bytes: 0, managed_block: false },
        settings: { hook_events: {}, hook_detail: {} },
      },
      project: {
        available: true,
        repo: "x",
        branch: "main",
        claude_md_headers: [],
        claude_md_tokens: 400,
        claude_md_size: 0,
        knowledge_index: [],
      },
      memory_md: { available: true, tokens: 300, path: "/x/MEMORY.md" },
    },
    projects: [],
    active_project: "",
  };
}

Deno.test("buildData coll.context has expected shape + category keys", () => {
  const coll = buildData(ctxCtx(), "project").coll as Record<string, Record<string, unknown>>;
  const ctx = coll.context;
  assertEquals(ctx.type, "context");
  assertEquals(ctx.window, CTX_WINDOW);
  const cats = ctx.categories as Array<{ key: string; tokens: number; items: unknown[] }>;
  assertEquals(
    cats.map((c) => c.key),
    ["system_prompt", "system_tools", "agents", "skills", "memory", "hooks"],
  );
});

Deno.test("buildData coll.context: fixed constants are exact", () => {
  const coll = buildData(ctxCtx(), "project").coll as Record<string, Record<string, unknown>>;
  const cats = coll.context.categories as Array<{ key: string; tokens: number; fixed?: boolean }>;
  const sys = cats.find((c) => c.key === "system_prompt")!;
  const tools = cats.find((c) => c.key === "system_tools")!;
  assertEquals(sys.tokens, SYS_PROMPT_TOK);
  assertEquals(sys.fixed, true);
  assertEquals(tools.tokens, SYS_TOOLS_TOK);
  assertEquals(tools.fixed, true);
});

Deno.test("buildData coll.context: agents/skills items use META tokens (session-start load), not full file", () => {
  const coll = buildData(ctxCtx(), "project").coll as Record<string, Record<string, unknown>>;
  const cats = coll.context.categories as Array<
    { key: string; tokens: number; items: Array<{ name: string; tokens: number }> }
  >;
  const agents = cats.find((c) => c.key === "agents")!;
  assertEquals(agents.tokens, 5); // meta_tokens of "dev" (NOT full 50)
  assertEquals(agents.items.map((i) => i.name), ["dev"]);
  assertEquals(agents.items.map((i) => i.tokens), [5]);
  const skills = cats.find((c) => c.key === "skills")!;
  assertEquals(skills.tokens, 30); // 10 + 20 meta (NOT full 100 + 200)
  assertEquals(skills.items.length, 2);
  assertEquals(skills.items.map((i) => i.tokens), [10, 20]);
});

Deno.test("buildData coll.context: memory category sums global+project CLAUDE.md + MEMORY.md", () => {
  const coll = buildData(ctxCtx(), "project").coll as Record<string, Record<string, unknown>>;
  const cats = coll.context.categories as Array<
    { key: string; tokens: number; items: Array<{ name: string }> }
  >;
  const mem = cats.find((c) => c.key === "memory")!;
  assertEquals(mem.tokens, 1000 + 400 + 300);
  assertEquals(mem.items.map((i) => i.name), [
    "CLAUDE.md (global)",
    "CLAUDE.md (Projekt)",
    "MEMORY.md",
  ]);
});

Deno.test("buildData coll.context: MEMORY.md item omitted when unavailable", () => {
  const ctx = ctxCtx();
  (ctx.cards as Record<string, unknown>).memory_md = { available: false, tokens: 0, path: "/x" };
  const coll = buildData(ctx, "project").coll as Record<string, Record<string, unknown>>;
  const cats = coll.context.categories as Array<
    { key: string; tokens: number; items: Array<{ name: string }> }
  >;
  const mem = cats.find((c) => c.key === "memory")!;
  assertEquals(mem.tokens, 1000 + 400); // no MEMORY.md
  assertEquals(mem.items.map((i) => i.name), ["CLAUDE.md (global)", "CLAUDE.md (Projekt)"]);
});

Deno.test("buildData coll.context: measured_total = sum of non-live categories", () => {
  const coll = buildData(ctxCtx(), "project").coll as Record<string, Record<string, unknown>>;
  const ctx = coll.context;
  const cats = ctx.categories as Array<{ tokens: number; live?: boolean }>;
  const expected = cats.filter((c) => !c.live).reduce((s, c) => s + c.tokens, 0);
  assertEquals(ctx.measured_total, expected);
  // sanity: hooks (live) contributes 0 to measured_total
  const hooks = cats.find((_, i) => (cats[i] as { live?: boolean }).live);
  assertEquals(hooks!.tokens, 0);
});

Deno.test("buildData coll.context: hooks category is live with 0 tokens (filled client-side)", () => {
  const coll = buildData(ctxCtx(), "project").coll as Record<string, Record<string, unknown>>;
  const cats = coll.context.categories as Array<{ key: string; tokens: number; live?: boolean }>;
  const hooks = cats.find((c) => c.key === "hooks")!;
  assertEquals(hooks.live, true);
  assertEquals(hooks.tokens, 0);
});

Deno.test("buildData project-view nav has Kontext group with context entry", () => {
  const nav = buildData(ctxCtx(), "project").nav as Array<
    { g: string; items: Array<{ id: string }> }
  >;
  const grp = nav.find((g) => g.g === "Kontext");
  assertEquals(grp !== undefined, true);
  assertEquals(grp!.items.map((i) => i.id), ["context"]);
});

// memoryMdTokens: best-effort file reader via CLAUDE_MEMORY_DIR override.
Deno.test("memoryMdTokens reads MEMORY.md from CLAUDE_MEMORY_DIR override", async () => {
  const tmp = await Deno.makeTempDir();
  const body = "# Memory\n- item one\n- item two\n";
  await Deno.writeTextFile(tmp + "/MEMORY.md", body);
  const prev = Deno.env.get("CLAUDE_MEMORY_DIR");
  Deno.env.set("CLAUDE_MEMORY_DIR", tmp);
  try {
    const r = await memoryMdTokens("/some/cwd");
    assertEquals(r.available, true);
    assertEquals(r.tokens, estTokens(body));
  } finally {
    if (prev === undefined) Deno.env.delete("CLAUDE_MEMORY_DIR");
    else Deno.env.set("CLAUDE_MEMORY_DIR", prev);
  }
});

Deno.test("memoryMdTokens returns available:false when file is missing", async () => {
  const tmp = await Deno.makeTempDir(); // empty dir, no MEMORY.md
  const prev = Deno.env.get("CLAUDE_MEMORY_DIR");
  Deno.env.set("CLAUDE_MEMORY_DIR", tmp);
  try {
    const r = await memoryMdTokens("/some/cwd");
    assertEquals(r.available, false);
    assertEquals(r.tokens, 0);
  } finally {
    if (prev === undefined) Deno.env.delete("CLAUDE_MEMORY_DIR");
    else Deno.env.set("CLAUDE_MEMORY_DIR", prev);
  }
});
