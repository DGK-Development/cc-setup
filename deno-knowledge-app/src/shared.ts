// Shared low-level helpers — Deno-native replacements for knowledge.py's
// subprocess/filesystem primitives. Intentionally framework-free so collectors
// stay unit-testable in isolation (mirrors the Python `_run`/`read_text` split).

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
}

/**
 * Run a command and return its trimmed stdout on success (exit code 0), or
 * `null` on non-zero exit, missing binary, or timeout. Replaces
 * `subprocess.run(..., capture_output=True)` + the broad except in knowledge.py.
 */
export async function run(cmd: string[], opts: RunOptions = {}): Promise<string | null> {
  const [bin, ...args] = cmd;
  try {
    const command = new Deno.Command(bin, {
      args,
      cwd: opts.cwd,
      stdout: "piped",
      stderr: "piped",
      signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
    });
    const { code, stdout } = await command.output();
    if (code !== 0) return null;
    return new TextDecoder().decode(stdout).replace(/\s+$/, "");
  } catch {
    return null;
  }
}

/** Read a UTF-8 file, returning `null` instead of throwing on any error. */
export async function readText(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return null;
  }
}

/** Parse JSON, returning `null` on malformed input (mirrors a guarded json.loads). */
export function parseJson<T = unknown>(text: string | null | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
