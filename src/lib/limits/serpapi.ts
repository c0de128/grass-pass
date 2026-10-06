/**
 * SerpApi search caps (SPEC §5.5, §7, F8). Kevin's key is a SerpApi Free Plan: 250 searches a month
 * (checked on serpapi.com/account.json 2026-10-06). Every search Grass Pass sends counts against:
 *   - SERPAPI_DAILY_CAP (default 12) per Chicago day, all users together;
 *   - SERPAPI_MONTHLY_CAP (default 200, hard-clamped to the free 250 in ./config.ts) per plan cycle: SerpApi's
 *     free searches reset on the plan's renewal day (Kevin's account: the 16th), so the "month" starts on
 *     SERPAPI_RENEWS_DAY (1-28, default 1) at Chicago midnight. A calendar month would let up to 2 x 200
 *     searches fall inside one SerpApi cycle.
 * Both are checked and reserved BEFORE the request is sent. Once a request is sent its slot stays spent,
 * whatever happens next (an error, a timeout, our deadline): pattern charge-started-paid-calls. A slot is
 * given back only when nothing was sent. SerpApi does not bill errored or cached searches, so our count is
 * a little conservative, never low.
 * A circuit breaker (shared store) stops all searches after SerpApi says the key is bad (401/403) or the
 * plan is used up / rate limited (429), until its reset time.
 */
import type { Store } from "@/lib/cache/store";
import { breakerRetryAfter, tripBreaker } from "./breaker";
import { intFromEnv, limitsConfig } from "./config";
import { reserveQuota, type QuotaTicket } from "./quota";

type Env = Record<string, string | undefined>;

export const SERPAPI_BREAKER = "serpapi";
export const SERPAPI_DAY_QUOTA = "serpapi-day";
export const SERPAPI_MONTH_QUOTA = "serpapi-month";

/** Why a search was not sent (each has its own on-screen copy in src/lib/pool/lucky.ts). */
export type SearchRefusal = "daily_cap" | "monthly_cap" | "breaker";

export type SearchSlot = { ok: true; ticket: QuotaTicket } | { ok: false; reason: SearchRefusal; retryAfter: number };

/** The caps in force (env, with the free-plan clamp) and the day the monthly cycle starts. */
export function serpapiCaps(env: Env = process.env): { daily: number; monthly: number; renewsDay: number } {
  const cfg = limitsConfig(env);
  return { daily: cfg.serpapiDailyCap, monthly: cfg.serpapiMonthlyCap, renewsDay: Math.min(28, intFromEnv(env.SERPAPI_RENEWS_DAY, 1)) };
}

/**
 * Reserve ONE search on both caps (all or nothing). The ticket's commit() must be called right before the
 * request is sent; release() gives both slots back only if it never was.
 */
export async function reserveSearch(store: Store, opts: { env?: Env; now: number }): Promise<SearchSlot> {
  const wait = await breakerRetryAfter(store, SERPAPI_BREAKER, opts.now);
  if (wait > 0) return { ok: false, reason: "breaker", retryAfter: wait };
  const caps = serpapiCaps(opts.env);
  const month = await reserveQuota(store, {
    name: SERPAPI_MONTH_QUOTA,
    key: "server",
    perKey: Infinity,
    global: caps.monthly,
    period: { kind: "cycle", startDay: caps.renewsDay },
    now: opts.now,
  });
  if (!month.ok) return { ok: false, reason: "monthly_cap", retryAfter: month.retryAfter };
  const day = await reserveQuota(store, {
    name: SERPAPI_DAY_QUOTA,
    key: "server",
    perKey: Infinity,
    global: caps.daily,
    period: { kind: "day" },
    now: opts.now,
  });
  if (!day.ok) {
    await month.ticket.release();
    return { ok: false, reason: "daily_cap", retryAfter: day.retryAfter };
  }
  let committed = false;
  return {
    ok: true,
    ticket: {
      commit() {
        committed = true;
        month.ticket.commit();
        day.ticket.commit();
      },
      async release() {
        await day.ticket.release();
        await month.ticket.release();
      },
      get committed() {
        return committed;
      },
    },
  };
}

/** SerpApi said the key is bad or the plan/hour is used up: stop every search until `retryAfterSec` has passed. */
export async function tripSerpapi(store: Store, now: number, retryAfterSec: number): Promise<void> {
  await tripBreaker(store, SERPAPI_BREAKER, now, retryAfterSec);
}
