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
 */
import type { Store } from "@/lib/cache/store";
import { localDay, localMonth, secondsUntilLocalMidnight, secondsUntilNextLocalMonth } from "@/lib/time";

export type Period = { kind: "day" } | { kind: "month" } | { kind: "window"; seconds: number };

export function periodOf(period: Period, now: number): { id: string; resetSec: number } {
  if (period.kind === "day") return { id: localDay(now), resetSec: secondsUntilLocalMidnight(now) };
  if (period.kind === "month") return { id: localMonth(now), resetSec: secondsUntilNextLocalMonth(now) };
  const ms = period.seconds * 1000;
  const bucket = Math.floor(now / ms);
  return { id: `w${period.seconds}-${bucket}`, resetSec: Math.max(1, Math.ceil(((bucket + 1) * ms - now) / 1000)) };
}

export type QuotaTicket = { commit(): void; release(): Promise<void>; readonly committed: boolean };
export type QuotaResult = { ok: true; ticket: QuotaTicket } | { ok: false; scope: "key" | "global"; retryAfter: number };

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
  const globalKey = `q:${opts.name}:${id}:all`;
  const ownKey = `q:${opts.name}:${id}:k:${opts.key}`;
  const trackKey = Number.isFinite(opts.perKey);

  const g = await store.incr(globalKey, 1, ttl);
  if (g > opts.global) {
    await store.incr(globalKey, -1, ttl);
    return { ok: false, scope: "global", retryAfter: resetSec };
  }
  if (trackKey) {
    let mine: number;
    try {
      mine = await store.incr(ownKey, 1, ttl);
    } catch (err) {
      await store.incr(globalKey, -1, ttl).catch(() => undefined);
      throw err;
    }
    if (mine > opts.perKey) {
      await store.incr(ownKey, -1, ttl);
      await store.incr(globalKey, -1, ttl);
      return { ok: false, scope: "key", retryAfter: resetSec };
    }
  }

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
        await store.incr(globalKey, -1, ttl).catch(() => undefined);
        if (trackKey) await store.incr(ownKey, -1, ttl).catch(() => undefined);
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
  const global = Number(await store.get(`q:${opts.name}:${id}:all`)) || 0;
  const key = opts.key === undefined ? undefined : Number(await store.get(`q:${opts.name}:${id}:k:${opts.key}`)) || 0;
  return { global, key };
}
