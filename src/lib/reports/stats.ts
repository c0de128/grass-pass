/**
 * Report counts for a signed-in visitor's pass page ("3 found it in the last 30 days"), read from the park's
 * report hash at most once per STATS_MEMO_MS per park per instance (1 HGETALL), and forgotten in this
 * process when a report is counted. A store failure shows no stats (never made-up numbers) and the pass still opens.
 */
import "server-only";
import { getStore } from "@/lib/cache/store";
import type { Pass } from "@/lib/pass/schema";
import { parkReportStats, type ItemStats } from "./index";

export const STATS_MEMO_MS = 5 * 60_000;
const MAX_PARKS = 2_000;

/** What the screen pass shows per item ref; only items with at least one report. */
export type PassItemStats = Record<string, { found: number; notFound: number }>;

type Entry = { at: number; value: Promise<Map<string, ItemStats>> };
const HOLDER = Symbol.for("grass-pass.report-stats");
function memo(): Map<string, Entry> {
  const g = globalThis as unknown as Record<symbol, Map<string, Entry> | undefined>;
  return (g[HOLDER] ??= new Map());
}

export function forgetReportStats(parkId?: string): void {
  if (parkId === undefined) memo().clear();
  else memo().delete(parkId);
}

async function parkStats(parkId: string, now: number): Promise<Map<string, ItemStats>> {
  const m = memo();
  const hit = m.get(parkId);
  if (hit && now - hit.at < STATS_MEMO_MS) return hit.value;
  const value = parkReportStats(getStore("limits"), parkId, now);
  m.delete(parkId);
  m.set(parkId, { at: now, value });
  while (m.size > MAX_PARKS) {
    const oldest = m.keys().next().value;
    if (oldest === undefined) break;
    m.delete(oldest);
  }
  value.catch(() => {
    if (m.get(parkId)?.value === value) m.delete(parkId);
  });
  return value;
}

/** Stats for the items of one pass, or {} (no reports yet, an older pass without item refs, or the store failed). */
export async function passItemStats(pass: Pass, now: number = Date.now()): Promise<PassItemStats> {
  const refs = pass.items.map((i) => i.ref).filter((r): r is string => typeof r === "string");
  if (refs.length === 0) return {};
  let all: Map<string, ItemStats>;
  try {
    all = await parkStats(pass.park.id, now);
  } catch {
    return {};
  }
  const out: PassItemStats = {};
  for (const ref of refs) {
    const s = all.get(ref);
    if (s && s.found + s.notFound > 0) out[ref] = { found: s.found, notFound: s.notFound };
  }
  return out;
}
