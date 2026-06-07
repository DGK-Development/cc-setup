// collect_cost — mirrors knowledge.py collect_cost
// Account-wide $ from usage/*.json + *_rl.json (env PKM_USAGE_DIR).
// Week starts Friday (Claude 7d reset Thu->Fri).

import { readText } from "../shared.ts";
import { join } from "@std/path";

function usageDir(): string {
  const env = Deno.env.get("PKM_USAGE_DIR");
  if (env) return env;
  return `${Deno.env.get("HOME")}/GITHUB/ObsidianPKM/skripte/usage`;
}

interface DailyRow {
  date: string;
  cost: number;
}

async function loadDailyCosts(dir: string): Promise<DailyRow[]> {
  const rows: DailyRow[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile || !e.name.endsWith(".json")) continue;
      if (e.name.endsWith("_rl.json") || e.name.endsWith(".migrated")) continue;
      const text = await readText(join(dir, e.name));
      if (!text) continue;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (typeof data !== "object" || "ccusage_daily" in data) continue;
      const d = String(data.date ?? "");
      if (!d) continue;
      const ccusage = (data.ccusage as Record<string, unknown>) ?? {};
      const cost = parseFloat(String(ccusage.total_cost ?? "0")) || 0;
      rows.push({ date: d, cost });
    }
  } catch { /* dir not readable */ }
  return rows;
}

interface RlSnapshot {
  ts?: string;
  five_hour_pct?: number;
  five_hour_resets_at?: number;
  seven_day_pct?: number;
  seven_day_resets_at?: number;
}

async function latestRlSnapshot(dir: string): Promise<RlSnapshot> {
  let bestTs = "";
  let best: RlSnapshot = {};
  try {
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile || !e.name.endsWith("_rl.json")) continue;
      const text = await readText(join(dir, e.name));
      if (!text) continue;
      let data: RlSnapshot;
      try {
        data = JSON.parse(text) as RlSnapshot;
      } catch {
        continue;
      }
      const ts = String(data.ts ?? "");
      if (ts > bestTs) {
        bestTs = ts;
        best = data;
      }
    }
  } catch { /* ok */ }
  return best;
}

interface RlInfo {
  used_pct: number;
  elapsed_pct: number;
  projected_pct: number;
  resets_in: string;
}

function rateLimitFromSnapshot(
  pct: number | undefined,
  resetsAt: number | undefined,
  windowSecs: number,
  nowTs: number,
): RlInfo | null {
  if (pct === undefined || resetsAt === undefined) return null;
  const remaining = resetsAt - nowTs;
  if (remaining <= 0 || remaining > windowSecs) return null;
  const elapsed = windowSecs - remaining;
  if (elapsed <= 0) return null;
  const frac = elapsed / windowSecs;
  const projected = frac > 0 ? pct / frac : 0;
  const d = Math.floor(remaining / 86400);
  const rem1 = remaining % 86400;
  const h = Math.floor(rem1 / 3600);
  const m = Math.floor((rem1 % 3600) / 60);
  const countdown = d ? `${d}d${h}h` : (h ? `${h}h${m}m` : `${m}m`);
  return {
    used_pct: Math.round(pct * 10) / 10,
    elapsed_pct: Math.round(frac * 1000) / 10,
    projected_pct: Math.round(projected * 10) / 10,
    resets_in: countdown,
  };
}

export async function collectCost(dir?: string): Promise<Record<string, unknown>> {
  try {
    const udir = dir ?? usageDir();
    try {
      await Deno.stat(udir);
    } catch {
      return { available: false, reason: `usage/ nicht gefunden: ${udir}` };
    }
    const rows = await loadDailyCosts(udir);
    if (!rows.length) {
      return { available: false, reason: `keine ccusage-JSON in ${udir}` };
    }

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const yestStr = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    // Week starts Friday (Mon=0..Sun=6, Fri=4 in JS Sun=0, so Fri=5)
    const dow = now.getDay(); // 0=Sun..6=Sat
    const daysFromFri = (dow - 5 + 7) % 7;
    const weekStart = new Date(now.getTime() - daysFromFri * 86400000);
    const weekStr = weekStart.toISOString().slice(0, 10);
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

    let todayC = 0, yestC = 0, weekC = 0, monthC = 0, totalC = 0;
    for (const r of rows) {
      totalC += r.cost;
      if (r.date === todayStr) todayC += r.cost;
      if (r.date === yestStr) yestC += r.cost;
      if (r.date >= weekStr) weekC += r.cost;
      if (r.date >= monthStr) monthC += r.cost;
    }

    const result: Record<string, unknown> = {
      available: true,
      today: todayC,
      yesterday: yestC,
      week: weekC,
      month: monthC,
      total: totalC,
      five_hour: null,
      seven_day: null,
    };

    const rl = await latestRlSnapshot(udir);
    if (rl.ts) {
      const nowTs = Math.floor(now.getTime() / 1000);
      result.five_hour = rateLimitFromSnapshot(
        rl.five_hour_pct,
        rl.five_hour_resets_at,
        5 * 3600,
        nowTs,
      );
      result.seven_day = rateLimitFromSnapshot(
        rl.seven_day_pct,
        rl.seven_day_resets_at,
        7 * 24 * 3600,
        nowTs,
      );
    }

    return result;
  } catch (exc) {
    return { available: false, reason: `collect_cost failed: ${exc}` };
  }
}
