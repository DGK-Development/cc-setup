// Tests for native collectTokens (B1 — kein session_analyze.py/uv).
// Fixture-basiert: schreibt temporaere JSONL-Dateien und prueft die aggregierten Werte.

import { assertEquals } from "@std/assert";
import { collectTokens } from "../src/collectors/tokens.ts";
import { join } from "@std/path";

// ---------------------------------------------------------------------------
// Fixture-Hilfsfunktion
// ---------------------------------------------------------------------------

async function writeJsonl(path: string, lines: unknown[]): Promise<void> {
  await Deno.mkdir(path.split("/").slice(0, -1).join("/"), { recursive: true });
  await Deno.writeTextFile(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

/** Baut ein temp-Verzeichnis, setzt CLAUDE_PROJECTS_DIR und gibt den CWD zurueck. */
async function makeProjectsBase(): Promise<{ base: string; cwd: string; dir: string }> {
  const base = await Deno.makeTempDir();
  const cwd = "/test/my-project";
  // encodeCwd ersetzt non-alnum mit '-'
  const encoded = cwd.replace(/[^A-Za-z0-9]/g, "-");
  const dir = join(base, encoded);
  await Deno.mkdir(dir, { recursive: true });
  return { base, cwd, dir };
}

// ---------------------------------------------------------------------------
// Basisfall: leeres Verzeichnis
// ---------------------------------------------------------------------------

Deno.test("collectTokens: leeres Sessions-Verzeichnis gibt last_session:null zurueck", async () => {
  const { base, cwd } = await makeProjectsBase();
  Deno.env.set("CLAUDE_PROJECTS_DIR", base);
  const result = await collectTokens(cwd);
  Deno.env.delete("CLAUDE_PROJECTS_DIR");
  assertEquals(result.available, true);
  assertEquals(result.last_session, null);
  assertEquals(Array.isArray(result.sessions), true);
  assertEquals((result.sessions as unknown[]).length, 0);
});

Deno.test("collectTokens: nicht-existentes Verzeichnis gibt available:true + leer zurueck", async () => {
  Deno.env.set("CLAUDE_PROJECTS_DIR", "/tmp/no-such-dir-xyz123");
  const result = await collectTokens("/nonexistent/repo");
  Deno.env.delete("CLAUDE_PROJECTS_DIR");
  assertEquals(result.available, true);
  assertEquals(result.last_session, null);
});

// ---------------------------------------------------------------------------
// Token-Summen
// ---------------------------------------------------------------------------

Deno.test("collectTokens: summiert input/output/cache-tokens korrekt", async () => {
  const { base, cwd, dir } = await makeProjectsBase();
  Deno.env.set("CLAUDE_PROJECTS_DIR", base);

  const sessionLines = [
    // assistant-entry mit usage → wird als turn gezaehlt
    {
      type: "assistant",
      message: {
        usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 200, cache_creation_input_tokens: 100 },
        content: [],
      },
    },
    // user-entry ohne usage → kein turn
    { type: "user", message: { content: [] } },
    // zweiter turn
    {
      type: "assistant",
      message: {
        usage: { input_tokens: 2000, output_tokens: 300 },
        content: [],
      },
    },
  ];
  await writeJsonl(join(dir, "sess-abc1.jsonl"), sessionLines);

  const result = await collectTokens(cwd);
  Deno.env.delete("CLAUDE_PROJECTS_DIR");

  assertEquals(result.available, true);
  const last = result.last_session as Record<string, unknown>;
  assertEquals(last.input, 3000); // 1000 + 2000
  assertEquals(last.output, 800); // 500 + 300
  assertEquals(last.cache_read, 200);
  assertEquals(last.cache_creation, 100);
  assertEquals(last.turns, 2);
  assertEquals(typeof last.cost, "number");
});

// ---------------------------------------------------------------------------
// Rolling 7-day window
// ---------------------------------------------------------------------------

Deno.test("collectTokens: week.total zaehlt nur Sessions aus den letzten 7 Tagen", async () => {
  const { base, cwd, dir } = await makeProjectsBase();
  Deno.env.set("CLAUDE_PROJECTS_DIR", base);

  const entry = {
    type: "assistant",
    message: {
      usage: { input_tokens: 1000, output_tokens: 0 },
      content: [],
    },
  };

  const recentPath = join(dir, "sess-recent.jsonl");
  const oldPath = join(dir, "sess-old.jsonl");
  await writeJsonl(recentPath, [entry]);
  await writeJsonl(oldPath, [entry]);

  // Alte Datei: 8 Tage zurueck
  const now = Date.now();
  const eightDaysAgo = new Date(now - 8 * 24 * 3600 * 1000);
  await Deno.utime(oldPath, eightDaysAgo, eightDaysAgo);

  const result = await collectTokens(cwd);
  Deno.env.delete("CLAUDE_PROJECTS_DIR");

  const week = result.week as Record<string, unknown>;
  assertEquals(week.session_count, 1); // nur recent
  assertEquals(week.input, 1000);
  assertEquals(week.total, 1000);
});

// ---------------------------------------------------------------------------
// Sessions-Cap + Sortierung
// ---------------------------------------------------------------------------

Deno.test("collectTokens: sessions capped at 30, newest first", async () => {
  const { base, cwd, dir } = await makeProjectsBase();
  Deno.env.set("CLAUDE_PROJECTS_DIR", base);

  // Erstelle 35 Session-Dateien
  const now = Date.now();
  for (let i = 0; i < 35; i++) {
    const p = join(dir, `sess-${String(i).padStart(3, "0")}.jsonl`);
    await writeJsonl(p, [{
      type: "assistant",
      message: { usage: { input_tokens: i * 10 }, content: [] },
    }]);
    // Weise aufsteigende mtimes zu
    const t = new Date(now - (35 - i) * 1000);
    await Deno.utime(p, t, t);
  }

  const result = await collectTokens(cwd);
  Deno.env.delete("CLAUDE_PROJECTS_DIR");

  const sessions = result.sessions as Array<Record<string, unknown>>;
  // Cap: max 30
  assertEquals(sessions.length, 30);
  // Sortierung: neueste zuerst → erste Session hat hoehere mtime als letzte
  // (Pruefen ueber input-token-wert: Session 34 hat 340 Tokens, Session 5 hat 50)
  assertEquals(sessions[0].input, 340); // neuesste (i=34)
});

// ---------------------------------------------------------------------------
// errors: tool_result mit is_error
// ---------------------------------------------------------------------------

Deno.test("collectTokens: zaehlt is_error tool_results als errors", async () => {
  const { base, cwd, dir } = await makeProjectsBase();
  Deno.env.set("CLAUDE_PROJECTS_DIR", base);

  const lines = [
    // assistant: tool_use
    {
      type: "assistant",
      message: {
        usage: { input_tokens: 100, output_tokens: 50 },
        content: [{
          type: "tool_use",
          id: "tu-001",
          name: "Bash",
          input: { command: "ls /nonexistent" },
        }],
      },
    },
    // user: tool_result mit is_error
    {
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: "tu-001",
          is_error: true,
          content: "ls: /nonexistent: No such file or directory",
        }],
      },
    },
  ];
  await writeJsonl(join(dir, "sess-err1.jsonl"), lines);

  const result = await collectTokens(cwd);
  Deno.env.delete("CLAUDE_PROJECTS_DIR");

  assertEquals(result.errors_total, 1);
  const sessions = result.sessions as Array<Record<string, unknown>>;
  assertEquals(sessions[0].error_count, 1);
  const errors = sessions[0].errors as Array<Record<string, unknown>>;
  assertEquals(errors[0].tool, "Bash");
  assertEquals(errors[0].command, "ls /nonexistent");
});

// ---------------------------------------------------------------------------
// repeats: Bash-Commands >= THRESHOLD
// ---------------------------------------------------------------------------

Deno.test("collectTokens: zaehlt repeated Bash-Commands (>= 3 Aufrufe)", async () => {
  const { base, cwd, dir } = await makeProjectsBase();
  Deno.env.set("CLAUDE_PROJECTS_DIR", base);

  // 3 Sessions, jede mit dem gleichen Bash-Command
  for (let i = 1; i <= 3; i++) {
    await writeJsonl(join(dir, `sess-rep${i}.jsonl`), [
      {
        type: "assistant",
        message: {
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [{
            type: "tool_use",
            id: `tu-${i}`,
            name: "Bash",
            input: { command: "git status" },
          }],
        },
      },
    ]);
  }

  const result = await collectTokens(cwd);
  Deno.env.delete("CLAUDE_PROJECTS_DIR");

  // repeats_total = Anzahl Commands die >= 3× aufgerufen wurden
  assertEquals(result.repeats_total, 1);
});

Deno.test("collectTokens: Command mit nur 2 Aufrufen zaehlt NICHT als repeat", async () => {
  const { base, cwd, dir } = await makeProjectsBase();
  Deno.env.set("CLAUDE_PROJECTS_DIR", base);

  for (let i = 1; i <= 2; i++) {
    await writeJsonl(join(dir, `sess-norep${i}.jsonl`), [
      {
        type: "assistant",
        message: {
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [{
            type: "tool_use",
            id: `tu-${i}`,
            name: "Bash",
            input: { command: "echo hello" },
          }],
        },
      },
    ]);
  }

  const result = await collectTokens(cwd);
  Deno.env.delete("CLAUDE_PROJECTS_DIR");

  assertEquals(result.repeats_total, 0);
});

// ---------------------------------------------------------------------------
// tool_freq
// ---------------------------------------------------------------------------

Deno.test("collectTokens: zaehlt tool_use pro Toolname (tool_freq)", async () => {
  const { base, cwd, dir } = await makeProjectsBase();
  Deno.env.set("CLAUDE_PROJECTS_DIR", base);

  await writeJsonl(join(dir, "sess-freq1.jsonl"), [
    {
      type: "assistant",
      message: {
        usage: { input_tokens: 100, output_tokens: 50 },
        content: [
          { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
          { type: "tool_use", id: "t2", name: "Read", input: { file_path: "/x" } },
          { type: "tool_use", id: "t3", name: "Bash", input: { command: "pwd" } },
        ],
      },
    },
  ]);

  const result = await collectTokens(cwd);
  Deno.env.delete("CLAUDE_PROJECTS_DIR");

  const freq = result.tool_freq as Record<string, number>;
  assertEquals(freq.Bash, 2);
  assertEquals(freq.Read, 1);
});

// ---------------------------------------------------------------------------
// Kein Python-Spawn (Smoke-Test: Ergebnis ist available:true ohne uv/Python)
// ---------------------------------------------------------------------------

Deno.test("collectTokens: gibt available:true ohne session_analyze.py-Aufruf", async () => {
  const { base, cwd, dir } = await makeProjectsBase();
  Deno.env.set("CLAUDE_PROJECTS_DIR", base);

  await writeJsonl(join(dir, "sess-native.jsonl"), [
    {
      type: "assistant",
      message: {
        usage: { input_tokens: 500, output_tokens: 200 },
        content: [],
      },
    },
  ]);

  const result = await collectTokens(cwd);
  Deno.env.delete("CLAUDE_PROJECTS_DIR");

  // available:true (kein Fallback auf "session_analyze.py unavailable")
  assertEquals(result.available, true);
  // Kein reason-Feld (das taucht nur bei Fehler auf)
  assertEquals("reason" in result, false);
});
