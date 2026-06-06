import { assertEquals } from "@std/assert";
import { buildData } from "../src/context.ts";
import {
  CTX_CALIB,
  CTX_WINDOW,
  ctxTok,
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

Deno.test("buildData coll.context: agents/skills items use calibrated META tokens (ctxTok)", () => {
  // CCS-034C: ctxTok(metaTokens) = round(meta_tokens * CTX_CALIB) wird in der Kontext-View
  // angewendet. meta_tokens der Fixtures: dev=5, a=10, b=20.
  // Full-file-tokens (50/100/200) dürfen NICHT verwendet werden.
  const coll = buildData(ctxCtx(), "project").coll as Record<string, Record<string, unknown>>;
  const cats = coll.context.categories as Array<
    { key: string; tokens: number; items: Array<{ name: string; tokens: number }> }
  >;
  const agents = cats.find((c) => c.key === "agents")!;
  // User-Agent "dev" hat meta_tokens=5 → ctxTok(5)=round(5*1.7)=9; kein Plugin/Project-Agent
  assertEquals(agents.tokens, ctxTok(5));
  // items: nur User-Agent (keine Plugin- / Project-Agents in Fixture)
  assertEquals(agents.items.map((i) => i.name), ["dev"]);
  assertEquals(agents.items.map((i) => i.tokens), [ctxTok(5)]);
  const skills = cats.find((c) => c.key === "skills")!;
  // User-Skills a(10), b(20) + Built-in(1700 fix); ctxTok(10)=17, ctxTok(20)=34
  const BUILTIN = 1700;
  assertEquals(skills.tokens, ctxTok(10) + ctxTok(20) + BUILTIN);
  // items: 2 User-Skills + 1 Built-in (no plugins in fixture)
  assertEquals(skills.items.length, 3);
  const userSkills = (skills.items as Array<{ name: string; tokens: number }>).filter(
    (i) => i.name !== "(Built-in ≈)",
  );
  assertEquals(userSkills.map((i) => i.tokens), [ctxTok(10), ctxTok(20)]);
  // Verify CTX_CALIB is exported and equals 1.7
  assertEquals(CTX_CALIB, 1.7);
});

Deno.test("buildData coll.context: memory category uses ctxTok calibration", () => {
  // CCS-034C: Memory-Tokens werden mit ctxTok kalibriert (×1.7).
  // Fixture: global=1000, projekt=400, MEMORY.md=300 (alle raw estTokens).
  const coll = buildData(ctxCtx(), "project").coll as Record<string, Record<string, unknown>>;
  const cats = coll.context.categories as Array<
    { key: string; tokens: number; items: Array<{ name: string }> }
  >;
  const mem = cats.find((c) => c.key === "memory")!;
  assertEquals(mem.tokens, ctxTok(1000) + ctxTok(400) + ctxTok(300));
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
  // CCS-034C: ohne MEMORY.md nur global+projekt, beide kalibriert
  assertEquals(mem.tokens, ctxTok(1000) + ctxTok(400)); // no MEMORY.md
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

// CCS-034C: ctxTok unit tests
Deno.test("ctxTok applies CTX_CALIB factor and rounds", () => {
  assertEquals(ctxTok(0), 0);
  assertEquals(ctxTok(100), Math.round(100 * CTX_CALIB));
  assertEquals(ctxTok(5), Math.round(5 * CTX_CALIB));
  // Faktor ist 1.7 — nicht ändern ohne Kalibrierung gegen /context
  assertEquals(CTX_CALIB, 1.7);
});

// CCS-034C: collectPluginItems — enabled-Filter + installPath-Auflösung + group-Zuordnung
Deno.test("collectPluginItems: reads enabled plugins from settings.json and enumerates skills/agents", async () => {
  const { collectPluginItems } = await import("../src/collectors/plugins.ts");
  const tmp = await Deno.makeTempDir();

  // settings.json mit einem enabled + einem disabled Plugin
  await Deno.writeTextFile(
    tmp + "/settings.json",
    JSON.stringify({
      enabledPlugins: {
        "myplugin@marketplace": true,
        "disabled@marketplace": false,
      },
    }),
  );

  // installed_plugins.json mit installPath für beide
  const pluginBase = tmp + "/plugins";
  await Deno.mkdir(pluginBase, { recursive: true });
  const enabledPath = tmp + "/enabled-install";
  const disabledPath = tmp + "/disabled-install";
  await Deno.writeTextFile(
    pluginBase + "/installed_plugins.json",
    JSON.stringify({
      plugins: {
        "myplugin@marketplace": [{ installPath: enabledPath }],
        "disabled@marketplace": [{ installPath: disabledPath }],
      },
    }),
  );

  // Skill im enabled Plugin anlegen
  await Deno.mkdir(enabledPath + "/skills/my-skill", { recursive: true });
  await Deno.writeTextFile(
    enabledPath + "/skills/my-skill/SKILL.md",
    "---\nname: my-skill\ndescription: Does something useful.\n---\n# My Skill\n",
  );

  // Skill im disabled Plugin — darf NICHT erscheinen
  await Deno.mkdir(disabledPath + "/skills/hidden-skill", { recursive: true });
  await Deno.writeTextFile(
    disabledPath + "/skills/hidden-skill/SKILL.md",
    "---\nname: hidden-skill\ndescription: Hidden.\n---\n",
  );

  // Agent im enabled Plugin
  await Deno.mkdir(enabledPath + "/agents", { recursive: true });
  await Deno.writeTextFile(
    enabledPath + "/agents/my-agent.md",
    "---\ndescription: An agent.\n---\n",
  );

  const result = await collectPluginItems(tmp);

  // Nur Einträge aus enabled Plugin
  assertEquals(result.skills.length, 1);
  assertEquals(result.skills[0].name, "my-skill");
  assertEquals(result.skills[0].group, "Plugin · myplugin");
  assertEquals(result.skills[0].read, "homefile");
  // meta_tokens = ctxTok(estTokens("my-skill\nDoes something useful."))
  assertEquals(result.skills[0].meta_tokens > 0, true);

  assertEquals(result.agents.length, 1);
  assertEquals(result.agents[0].name, "my-agent");
  assertEquals(result.agents[0].group, "Plugin · myplugin");
});

// CCS-034C: collectProjectAgents — liest .claude/agents/*.md aus cwd
Deno.test("collectProjectAgents: reads .claude/agents from cwd", async () => {
  const { collectProjectAgents } = await import("../src/collectors/plugins.ts");
  const tmp = await Deno.makeTempDir();
  await Deno.mkdir(tmp + "/.claude/agents", { recursive: true });
  await Deno.writeTextFile(
    tmp + "/.claude/agents/project-manager.md",
    "---\ndescription: Manages project tasks.\n---\n",
  );
  // Ungültiger Name (Traversal-Versuch) — darf nicht erscheinen
  await Deno.writeTextFile(
    tmp + "/.claude/agents/../evil.md",
    "evil",
  ).catch(() => { /* erwartet: Schreiben außerhalb des Dirs schlägt ggf. fehl */ });

  const agents = await collectProjectAgents(tmp);
  assertEquals(agents.length, 1);
  assertEquals(agents[0].name, "project-manager");
  assertEquals(agents[0].group, "Project");
  assertEquals(agents[0].read, "project-agent");
});
