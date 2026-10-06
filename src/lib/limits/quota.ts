/**
 * Budgets: a per-key share under a global cap, per Chicago day, Chicago month or
 * a fixed window (e.g. per hour). Used for AI calls (AI_DAILY_CAP), SerpApi
 * (daily + monthly), and the free data APIs.
 *
 * Ticket rules (pattern: charge-started-paid-calls):
 * - `reserveQuota` counts the slot at once, so concurrent requests cannot overshoot.
 * - Call `commit()` the moment an upstream call starts. Whatever happens next
 *   (404, error, timeout, bad output, client abort) the slot stays spent.
 * - Call `release()` only when no upstream call was started (e.g. a cache hit after
 *   all, or a refusal before sending). It is a no-op after `commit()`.
 * A store failure throws StoreError; callers answer 503 and call nothing upstream.
 *
 * SEC-1-05: an IPv6 key (see ./ip.ts) also fills a coarser /48 bucket with NET48_FACTOR x the per-key
 * share, so one network with many /64s can't take a global cap alone. The global count is logged once
 * when it reaches 50% and 90% of its cap.
 * SEC-1-02: one store command per reserve when the store supports it (`reserve`, a single EVAL), and a
 * refusal is remembered in this process for up to REFUSAL_MEMO_SEC (no store command while it lasts).
 */
import type { Store } from "@/lib/cache/store";
import { log } from "@/lib/log";
import { localCycle, localDay, localMonth, secondsUntilLocalMidnight, secondsUntilNextLocalMonth } from "@/lib/time";
import { networkKey } from "./ip";
import { refusalWait, rememberRefusal } from "./rate";

/** A /48 may use this many per-key (/64) shares in total. */
export const NET48_FACTOR = 2;
/** How long a refusal is remembered in process (a released slot can free a share again). */
export const REFUSAL_MEMO_SEC = 60;
export const QUOTA_ALERT_PCTS = [50, 90] as const;

/** `cycle` (S6): a month that starts on day `startDay` (a plan's renewal day, e.g. SerpApi's). */
export type Period = { kind: "day" } | { kind: "month" } | { kind: "cycle"; startDay: number } | { kind: "window"; seconds: number };

export function periodOf(period: Period, now: number): { id: string; resetSec: number } {
  if (period.kind === "day") return { id: localDay(now), resetSec: secondsUntilLocalMidnight(now) };
  if (period.kind === "month") return { id: localMonth(now), resetSec: secondsUntilNextLocalMonth(now) };
  if (period.kind === "cycle") {
    const c = localCycle(now, period.startDay);
    return { id: `c${c.id}`, resetSec: c.resetSec };
  }
  const ms = period.seconds * 1000;
  const bucket = Math.floor(now / ms);
  return { id: `w${period.seconds}-${bucket}`, resetSec: Math.max(1, Math.ceil(((bucket + 1) * ms - now) / 1000)) };
}

export type QuotaTicket = { commit(): void; release(): Promise<void>; readonly committed: boolean };
export type QuotaResult = { ok: true; ticket: QuotaTicket } | { ok: false; scope: "key" | "global"; retryAfter: number };

type Counter = { key: string; cap: number; scope: "key" | "global" };

/** All-or-nothing add of 1 to every counter, without the store's `reserve` (older/fake stores). */
async function reserveStepwise(store: Store, counters: Counter[], ttl: number): Promise<{ failed: number; counts: number[] }> {
  const done: Counter[] = [];
  const counts: number[] = [];
  try {
    for (let i = 0; i < counters.length; i++) {
      const c = counters[i];
      const v = await store.incr(c.key, 1, ttl);
      done.push(c);
      counts.push(v);
      if (v > c.cap) {
        for (const d of done) await store.incr(d.key, -1, ttl);
        return { failed: i + 1, counts: [] };
      }
    }
  } catch (err) {
    for (const d of done) await store.incr(d.key, -1, ttl).catch(() => undefined);
    throw err;
  }
  return { failed: 0, counts };
}

function alertIfCrossed(name: string, used: number, cap: number): void {
  if (!Number.isFinite(cap) || cap <= 0) return;
  for (const pct of QUOTA_ALERT_PCTS) {
    if (used === Math.ceil((cap * pct) / 100)) log("quota_alert", { quota: name, pct, used, cap }, pct >= 90 ? "error" : "warn");
  }
}

export async function reserveQuota(
  store: Store,
  opts: {
    name: string;
    key: string;
    /** Per-key share. Infinity = global cap only (e.g. the server's own pre-warm). */
    perKey: number;
    global: number;
    period: Period;
    now: number;
  },
): Promise<QuotaResult> {
  const { id, resetSec } = periodOf(opts.period, opts.now);
  const ttl = resetSec + 3600;
  const trackKey = Number.isFinite(opts.perKey);
  const net = trackKey ? networkKey(opts.key) : null;

  const counters: Counter[] = [{ key: `q:{${opts.name}:${id}}:all`, cap: opts.global, scope: "global" }];
  if (trackKey) counters.push({ key: `q:{${opts.name}:${id}}:k:${opts.key}`, cap: opts.perKey, scope: "key" });
  if (net) counters.push({ key: `q:{${opts.name}:${id}}:${net}`, cap: opts.perKey * NET48_FACTOR, scope: "key" });

  // The global memo includes the cap: callers with a larger cap (the reserved slice) are not blocked by it.
  const memo = { global: `q|${opts.name}|${id}|all|${opts.global}`, key: `q|${opts.name}|${id}|${opts.key}` };
  if (refusalWait(store, memo.global, opts.now) > 0) return { ok: false, scope: "global", retryAfter: resetSec };
  if (trackKey && refusalWait(store, memo.key, opts.now) > 0) return { ok: false, scope: "key", retryAfter: resetSec };

  const r = store.reserve
    ? await store.reserve(
        counters.map((c) => c.key),
        counters.map((c) => c.cap),
        ttl,
      )
    : await reserveStepwise(store, counters, ttl);

  if (r.failed > 0) {
    const scope = counters[r.failed - 1].scope;
    rememberRefusal(store, scope === "global" ? memo.global : memo.key, opts.now + Math.min(resetSec, REFUSAL_MEMO_SEC) * 1000);
    return { ok: false, scope, retryAfter: resetSec };
  }
  alertIfCrossed(opts.name, r.counts[0], opts.global);

  let settled = false;
  let committed = false;
  return {
    ok: true,
    ticket: {
      commit() {
        settled = true;
        committed = true;
      },
      async release() {
        if (settled) return;
        settled = true;
        // Keys carry the period id, so a release after rollover only touches the old (expiring) counters.
        for (const c of counters) await store.incr(c.key, -1, ttl).catch(() => undefined);
      },
      get committed() {
        return committed;
      },
    },
  };
}

/** Current usage (for logs and the about page). */
export async function quotaUsage(store: Store, opts: { name: string; key?: string; period: Period; now: number }) {
  const { id } = periodOf(opts.period, opts.now);
  const global = Number(await store.get(`q:{${opts.name}:${id}}:all`)) || 0;
  const key = opts.key === undefined ? undefined : Number(await store.get(`q:{${opts.name}:${id}}:k:${opts.key}`)) || 0;
  return { global, key };
}
