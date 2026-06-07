/**
 * damage-control.ts — Safety/Observability Extension fuer cc-setup pi-Orchestrator
 *
 * Portiert aus reference/pi-vs-claude-code/extensions/damage-control.ts.
 * themeMap.ts-Dependency entfernt (nicht in cc-setup verfuegbar).
 *
 * Laedt .pi/damage-control-rules.yaml beim session_start.
 * Interceptiert jeden tool_call via pi.on("tool_call", ...) und blockt
 * Regelverstoesse (block:true) oder fragt nach (ask:true).
 *
 * pi-Invocation (beide Extensions):
 *   pi --provider ollama --model gemma4:12b-mlx \
 *      -e .pi/extensions/damage-control.ts \
 *      -e .pi/extensions/cc-orchestrator.ts \
 *      --no-builtin-tools -p "Start orchestrator pipeline"
 *
 * Org-Compliance:
 *   - rm -rf / git reset --hard → blocked
 *   - .env / *.pem / ~/.ssh     → zeroAccessPaths
 *   - git push (alle)           → blocked (CCS-008 kein Auto-Push)
 */

import type { ExtensionAPI, ToolCallEvent } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { parse as yamlParse } from "yaml";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface Rule {
  pattern: string;
  reason: string;
  ask?: boolean;
}

interface Rules {
  bashToolPatterns: Rule[];
  zeroAccessPaths: string[];
  readOnlyPaths: string[];
  noDeletePaths: string[];
}

export default function (pi: ExtensionAPI) {
  let rules: Rules = {
    bashToolPatterns: [],
    zeroAccessPaths: [],
    readOnlyPaths: [],
    noDeletePaths: [],
  };

  function resolvePath(p: string, cwd: string): string {
    if (p.startsWith("~")) {
      p = path.join(os.homedir(), p.slice(1));
    }
    return path.resolve(cwd, p);
  }

  function expandTilde(p: string): string {
    return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
  }

  // Substring search: only hits when the char after the match is not a path-word char.
  // Prevents ~/Desktop/YT from matching ~/Desktop/YT_archive.
  function commandReferencesPath(command: string, protectedPath: string): boolean {
    if (!protectedPath) return false;
    let idx = command.indexOf(protectedPath);
    while (idx >= 0) {
      const after = command[idx + protectedPath.length];
      if (!after || !/[A-Za-z0-9_-]/.test(after)) return true;
      idx = command.indexOf(protectedPath, idx + 1);
    }
    return false;
  }

  function isPathMatch(targetPath: string, pattern: string, cwd: string): boolean {
    const resolvedPattern = pattern.startsWith("~")
      ? path.join(os.homedir(), pattern.slice(1))
      : pattern;

    if (resolvedPattern.endsWith("/")) {
      const absolutePattern = path.isAbsolute(resolvedPattern)
        ? resolvedPattern
        : path.resolve(cwd, resolvedPattern);
      return targetPath.startsWith(absolutePattern);
    }

    const regexPattern = resolvedPattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");

    const regex = new RegExp(
      `^${regexPattern}$|^${regexPattern}/|/${regexPattern}$|/${regexPattern}/`
    );

    const relativePath = path.relative(cwd, targetPath);
    return (
      regex.test(targetPath) ||
      regex.test(relativePath) ||
      targetPath.includes(resolvedPattern) ||
      relativePath.includes(resolvedPattern)
    );
  }

  pi.on("session_start", async (_event, ctx) => {
    const projectRulesPath = path.join(ctx.cwd, ".pi", "damage-control-rules.yaml");
    const globalRulesPath = path.join(os.homedir(), ".pi", "damage-control-rules.yaml");
    const rulesPath = fs.existsSync(projectRulesPath)
      ? projectRulesPath
      : fs.existsSync(globalRulesPath)
        ? globalRulesPath
        : null;

    try {
      if (rulesPath) {
        const content = fs.readFileSync(rulesPath, "utf8");
        const loaded = yamlParse(content) as Partial<Rules>;
        rules = {
          bashToolPatterns: loaded.bashToolPatterns || [],
          zeroAccessPaths: loaded.zeroAccessPaths || [],
          readOnlyPaths: loaded.readOnlyPaths || [],
          noDeletePaths: loaded.noDeletePaths || [],
        };
        const total =
          rules.bashToolPatterns.length +
          rules.zeroAccessPaths.length +
          rules.readOnlyPaths.length +
          rules.noDeletePaths.length;
        const source = rulesPath === projectRulesPath ? "project" : "global";
        ctx.ui.notify(`Damage-Control: Loaded ${total} rules (${source}).`);
        ctx.ui.setStatus("damage-control", `Active: ${total} rules`);
      } else {
        ctx.ui.notify("Damage-Control: No rules found at .pi/damage-control-rules.yaml (project or global)");
        ctx.ui.setStatus("damage-control", "no rules loaded");
      }
    } catch (err) {
      ctx.ui.notify(
        `Damage-Control: Failed to load rules: ${err instanceof Error ? err.message : String(err)}`
      );
      // Graceful fallback: continue with empty rules rather than crashing.
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    let violationReason: string | null = null;
    let shouldAsk = false;

    // ── 1. Zero-Access-Paths fuer alle File-Tools ────────────────────────────
    const checkPaths = (pathsToCheck: string[]) => {
      for (const p of pathsToCheck) {
        const resolved = resolvePath(p, ctx.cwd);
        for (const zap of rules.zeroAccessPaths) {
          if (isPathMatch(resolved, zap, ctx.cwd)) {
            return `Access to zero-access path restricted: ${zap}`;
          }
        }
      }
      return null;
    };

    const inputPaths: string[] = [];
    if (
      isToolCallEventType("read", event) ||
      isToolCallEventType("write", event) ||
      isToolCallEventType("edit", event)
    ) {
      inputPaths.push(event.input.path);
    } else if (
      isToolCallEventType("grep", event) ||
      isToolCallEventType("find", event) ||
      isToolCallEventType("ls", event)
    ) {
      inputPaths.push(event.input.path || ".");
    }

    if (isToolCallEventType("grep", event) && event.input.glob) {
      for (const zap of rules.zeroAccessPaths) {
        if (
          event.input.glob.includes(zap) ||
          isPathMatch(event.input.glob, zap, ctx.cwd)
        ) {
          violationReason = `Glob matches zero-access path: ${zap}`;
          break;
        }
      }
    }

    if (!violationReason) {
      violationReason = checkPaths(inputPaths);
    }

    // ── 2. Tool-spezifische Logik ────────────────────────────────────────────
    if (!violationReason) {
      if (isToolCallEventType("bash", event)) {
        const command = event.input.command;

        // bashToolPatterns
        for (const rule of rules.bashToolPatterns) {
          const regex = new RegExp(rule.pattern);
          if (regex.test(command)) {
            violationReason = rule.reason;
            shouldAsk = !!rule.ask;
            break;
          }
        }

        // zeroAccessPaths im Bash-Command
        if (!violationReason) {
          for (const zap of rules.zeroAccessPaths) {
            if (command.includes(zap)) {
              violationReason = `Bash command references zero-access path: ${zap}`;
              break;
            }
          }
        }

        // readOnlyPaths: Modifikations-Heuristik
        if (!violationReason) {
          for (const rop of rules.readOnlyPaths) {
            if (
              command.includes(rop) &&
              (/[\s>|]/.test(command) ||
                command.includes("rm") ||
                command.includes("mv") ||
                command.includes("sed"))
            ) {
              violationReason = `Bash command may modify read-only path: ${rop}`;
              break;
            }
          }
        }

        // noDeletePaths
        if (!violationReason) {
          const hasDeleteOrMove = /\brm\b/.test(command) || /\bmv\b/.test(command);
          if (hasDeleteOrMove) {
            for (const ndp of rules.noDeletePaths) {
              const expanded = expandTilde(ndp);
              const matched =
                commandReferencesPath(command, ndp) ||
                (expanded !== ndp && commandReferencesPath(command, expanded));
              if (matched) {
                violationReason = `Bash command attempts to delete/move protected path: ${ndp}`;
                break;
              }
            }
          }
        }
      } else if (
        isToolCallEventType("write", event) ||
        isToolCallEventType("edit", event)
      ) {
        // readOnlyPaths fuer Write/Edit
        for (const p of inputPaths) {
          const resolved = resolvePath(p, ctx.cwd);
          for (const rop of rules.readOnlyPaths) {
            if (isPathMatch(resolved, rop, ctx.cwd)) {
              violationReason = `Modification of read-only path restricted: ${rop}`;
              break;
            }
          }
          if (violationReason) break;
        }
      }
    }

    // ── 3. Enforce / Confirm ─────────────────────────────────────────────────
    if (violationReason) {
      if (shouldAsk) {
        const confirmed = await ctx.ui.confirm(
          "Damage-Control Confirmation",
          `Dangerous command detected: ${violationReason}\n\nCommand: ${
            isToolCallEventType("bash", event)
              ? event.input.command
              : JSON.stringify(event.input)
          }\n\nDo you want to proceed?`,
          { timeout: 30000 }
        );

        if (!confirmed) {
          ctx.ui.setStatus("damage-control", `Violation blocked: ${violationReason.slice(0, 40)}`);
          pi.appendEntry("damage-control-log", {
            tool: event.toolName,
            input: event.input,
            rule: violationReason,
            action: "blocked_by_user",
          });
          ctx.abort();
          return {
            block: true,
            reason: `BLOCKED by Damage-Control: ${violationReason} (User denied)\n\nDO NOT attempt to work around this restriction. Report this block to the user exactly as stated and ask how they would like to proceed.`,
          };
        } else {
          pi.appendEntry("damage-control-log", {
            tool: event.toolName,
            input: event.input,
            rule: violationReason,
            action: "confirmed_by_user",
          });
          return { block: false };
        }
      } else {
        ctx.ui.notify(`Damage-Control: Blocked ${event.toolName} — ${violationReason}`);
        ctx.ui.setStatus("damage-control", `Violation: ${violationReason.slice(0, 40)}`);
        pi.appendEntry("damage-control-log", {
          tool: event.toolName,
          input: event.input,
          rule: violationReason,
          action: "blocked",
        });
        ctx.abort();
        return {
          block: true,
          reason: `BLOCKED by Damage-Control: ${violationReason}\n\nDO NOT attempt to work around this restriction. Report this block to the user exactly as stated and ask how they would like to proceed.`,
        };
      }
    }

    return { block: false };
  });
}
