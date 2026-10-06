import { describe, expect, it } from "vitest";
import { MemoryStore, StoreError, type Store } from "@/lib/cache/store";
import {
  breakerRetryAfter,
  clientIp,
  createSemaphore,
  createSpacedQueue,
  hitRateLimit,
  limiterKey,
  limitsConfig,
  periodOf,
  quotaUsage,
  QueueAbortedError,
  reserveQuota,
  resetBreaker,
  takeSecondSlot,
  tripBreaker,
} from "@/lib/limits";

// 2026-10-05 22:00 UTC = 5:00 PM CDT.
const T0 = Date.UTC(2026, 9, 5, 22, 0, 0);

function clockStore() {
  let t = T0;
  const store = new MemoryStore({ now: () => t });
  return { store, now: () => t, advance: (ms: number) => (t += ms) };
}

describe("hitRateLimit (sliding estimate over fixed buckets)", () => {
  it("allows `limit` hits per window, then 429s with a Retry-After inside the window", async () => {
    const { store, now } = clockStore();
    const opts = { name: "pass", key: "1.2.3.4", limit: 3, windowSec: 60 };
    for (let i = 0; i < 3; i++) expect(await hitRateLimit(store, { ...opts, now: now() })).toEqual({ ok: true });
    const r = await hitRateLimit(store, { ...opts, now: now() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.retryAfter).toBeGreaterThanOrEqual(1);
      expect(r.retryAfter).toBeLessThanOrEqual(60);
    }
  });

  it("keys are independent", async () => {
    const { store, now } = clockStore();
    for (let i = 0; i < 3; i++) await hitRateLimit(store, { name: "pass", key: "a", limit: 3, windowSec: 60, now: now() });
    expect((await hitRateLimit(store, { name: "pass", key: "b", limit: 3, windowSec: 60, now: now() })).ok).toBe(true);
  });

  it("does not allow a 2x burst across a bucket boundary", async () => {
    const { store, now, advance } = clockStore();
    const opts = { name: "pass", key: "k", limit: 3, windowSec: 60 };
    // Move to 1 s before a bucket edge, use the limit, then step just past the edge.
    advance(60_000 - (T0 % 60_000) - 1_000);
    for (let i = 0; i < 3; i++) expect((await hitRateLimit(store, { ...opts, now: now() })).ok).toBe(true);
    advance(2_000);
    expect((await hitRateLimit(store, { ...opts, now: now() })).ok).toBe(false);
    // A full window later it is open again.
    advance(60_000);
    expect((await hitRateLimit(store, { ...opts, now: now() })).ok).toBe(true);
  });

  it("rejected hits are not counted", async () => {
    const { store, now, advance } = clockStore();
    const opts = { name: "pass", key: "k", limit: 1, windowSec: 60 };
    advance(60_000 - (T0 % 60_000)); // start of a bucket
    await hitRateLimit(store, { ...opts, now: now() });
    for (let i = 0; i < 5; i++) await hitRateLimit(store, { ...opts, now: now() });
    advance(120_000);
    expect((await hitRateLimit(store, { ...opts, now: now() })).ok).toBe(true);
  });
});

describe("reserveQuota (daily per-key share under a global cap)", () => {
  const day = { kind: "day" } as const;

  it("refuses the key's share with scope 'key' and the global cap with scope 'global'", async () => {
    const { store } = clockStore();
    const base = { name: "ai", perKey: 2, global: 3, period: day, now: T0 };
    expect((await reserveQuota(store, { ...base, key: "a" })).ok).toBe(true);
    expect((await reserveQuota(store, { ...base, key: "a" })).ok).toBe(true);
    const a3 = await reserveQuota(store, { ...base, key: "a" });
    expect(a3).toMatchObject({ ok: false, scope: "key" });
    expect((await reserveQuota(store, { ...base, key: "b" })).ok).toBe(true);
    const b2 = await reserveQuota(store, { ...base, key: "b" });
    expect(b2).toMatchObject({ ok: false, scope: "global" });
    // Retry-After points at the next Chicago midnight (5 PM CDT -> 7 h).
    if (!b2.ok) expect(b2.retryAfter).toBe(7 * 3600);
    expect(await quotaUsage(store, { name: "ai", key: "a", period: day, now: T0 })).toEqual({ global: 3, key: 2 });
  });

  it("commit keeps the slot spent; release only refunds when nothing started", async () => {
    const { store } = clockStore();
    const base = { name: "ai", key: "a", perKey: 5, global: 5, period: day, now: T0 };
    const r1 = await reserveQuota(store, base);
    const r2 = await reserveQuota(store, base);
    if (!r1.ok || !r2.ok) throw new Error("expected ok");
    r1.ticket.commit(); // upstream call started: stays charged even if it then fails
    await r1.ticket.release(); // no-op after commit
    await r2.ticket.release(); // refused before any upstream call: refunded
    await r2.ticket.release(); // idempotent
    expect(r1.ticket.committed).toBe(true);
    expect(await quotaUsage(store, { name: "ai", key: "a", period: day, now: T0 })).toEqual({ global: 1, key: 1 });
  });

  it("concurrent reservations never overshoot the global cap", async () => {
    const { store } = clockStore();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => reserveQuota(store, { name: "ai", key: `ip${i}`, perKey: 5, global: 7, period: day, now: T0 })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(7);
    expect((await quotaUsage(store, { name: "ai", period: day, now: T0 })).global).toBe(7);
  });

  it("perKey Infinity counts only against the global cap (server pre-warm)", async () => {
    const { store } = clockStore();
    for (let i = 0; i < 4; i++) {
      expect((await reserveQuota(store, { name: "ai", key: "server", perKey: Infinity, global: 4, period: day, now: T0 })).ok).toBe(true);
    }
    expect((await reserveQuota(store, { name: "ai", key: "server", perKey: Infinity, global: 4, period: day, now: T0 })).ok).toBe(false);
  });

  it("resets at Chicago midnight, not UTC midnight", async () => {
    const { store } = clockStore();
    const base = { name: "ai", key: "a", perKey: 1, global: 10, period: day };
    const beforeUtcMidnight = Date.UTC(2026, 9, 5, 23, 59);
    const afterUtcMidnight = Date.UTC(2026, 9, 6, 0, 1); // still Oct 5 in Chicago (7:01 PM)
    const afterLocalMidnight = Date.UTC(2026, 9, 6, 5, 1); // 12:01 AM CDT Oct 6
    expect((await reserveQuota(store, { ...base, now: beforeUtcMidnight })).ok).toBe(true);
    expect((await reserveQuota(store, { ...base, now: afterUtcMidnight })).ok).toBe(false);
    expect((await reserveQuota(store, { ...base, now: afterLocalMidnight })).ok).toBe(true);
  });

  it("monthly and hourly periods", () => {
    expect(periodOf({ kind: "month" }, T0).id).toBe("2026-10");
    const w = periodOf({ kind: "window", seconds: 3600 }, T0);
    expect(w.resetSec).toBe(3600); // T0 is on the hour
  });

  it("a store failure throws (callers answer 503 and call nothing upstream)", async () => {
    const broken: Store = {
      kind: "upstash",
      get: async () => {
        throw new StoreError("down");
      },
      set: async () => {
        throw new StoreError("down");
      },
      del: async () => {
        throw new StoreError("down");
      },
      incr: async () => {
        throw new StoreError("down");
      },
    };
    await expect(reserveQuota(broken, { name: "ai", key: "a", perKey: 1, global: 1, period: { kind: "day" }, now: T0 })).rejects.toBeInstanceOf(StoreError);
    await expect(hitRateLimit(broken, { name: "p", key: "a", limit: 1, windowSec: 60, now: T0 })).rejects.toBeInstanceOf(StoreError);
  });
});

describe("circuit breaker", () => {
  it("opens for Retry-After seconds, never shortens, then closes", async () => {
    const { store, now, advance } = clockStore();
    expect(await breakerRetryAfter(store, "serpapi", now())).toBe(0);
    await tripBreaker(store, "serpapi", now(), 120);
    await tripBreaker(store, "serpapi", now(), 10); // shorter: ignored
    expect(await breakerRetryAfter(store, "serpapi", now())).toBe(120);
    advance(60_000);
    expect(await breakerRetryAfter(store, "serpapi", now())).toBe(60);
    advance(61_000);
    expect(await breakerRetryAfter(store, "serpapi", now())).toBe(0);
  });

  it("defaults to 60 s and can be reset", async () => {
    const { store, now } = clockStore();
    await tripBreaker(store, "overpass", now());
    expect(await breakerRetryAfter(store, "overpass", now())).toBe(60);
    await resetBreaker(store, "overpass");
    expect(await breakerRetryAfter(store, "overpass", now())).toBe(0);
  });
});

describe("concurrency controls", () => {
  it("semaphore runs at most N at once", async () => {
    const sem = createSemaphore(2);
    let running = 0;
    let peak = 0;
    const job = () =>
      sem.run(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
      });
    await Promise.all([job(), job(), job(), job(), job()]);
    expect(peak).toBe(2);
    expect(sem.active).toBe(0);
  });

  it("semaphore waiters can give up", async () => {
    const sem = createSemaphore(1);
    let release!: () => void;
    const first = sem.run(() => new Promise<void>((r) => (release = r)));
    const ctrl = new AbortController();
    const second = sem.run(async () => "ran", ctrl.signal);
    ctrl.abort();
    await expect(second).rejects.toBeInstanceOf(QueueAbortedError);
    release();
    await first;
    expect(sem.waiting).toBe(0);
  });

  it("spaced queue starts calls at least the interval apart, one at a time", async () => {
    let t = 0;
    const starts: number[] = [];
    const q = createSpacedQueue(1000, { now: () => t, sleep: async (ms) => void (t += ms) });
    await Promise.all([0, 1, 2].map(() => q.run(async () => void starts.push(t))));
    expect(starts).toEqual([0, 1000, 2000]);
  });

  it("spaced queue keeps going after a failed call", async () => {
    let t = 0;
    const q = createSpacedQueue(1000, { now: () => t, sleep: async (ms) => void (t += ms) });
    await expect(q.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(q.run(async () => "ok")).resolves.toBe("ok");
  });

  it("takeSecondSlot shares a per-second budget through the store and gives up after maxWaitMs", async () => {
    const { store, now, advance } = clockStore();
    const sleep = async (ms: number) => void advance(ms);
    const opts = { name: "nominatim", perSecond: 1, now, sleep };
    expect(await takeSecondSlot(store, { ...opts, maxWaitMs: 0 })).toBe(true);
    expect(await takeSecondSlot(store, { ...opts, maxWaitMs: 0 })).toBe(false); // same second, no wait allowed
    const t = now();
    expect(await takeSecondSlot(store, { ...opts, maxWaitMs: 2000 })).toBe(true); // waits for the next second
    expect(now()).toBeGreaterThan(t);
  });
});

describe("client keys", () => {
  const req = (h: Record<string, string>) => new Request("http://localhost/api/pass", { headers: h });

  it("uses the first x-forwarded-for entry, then x-real-ip, and never returns the raw address", () => {
    const env = { LIMITER_KEY_SECRET: "test-secret-0123456789" }; // gitleaks:allow (dummy test value)
    const a = clientIp(req({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }), env);
    expect(a).toMatch(/^4:[A-Za-z0-9_-]{22}$/);
    expect(a).not.toContain("203.0.113");
    expect(a).toBe(clientIp(req({ "x-forwarded-for": "203.0.113.9" }), env));
    expect(clientIp(req({ "x-real-ip": "203.0.113.7" }), env)).toMatch(/^4:/);
    expect(clientIp(req({ "x-real-ip": "203.0.113.7" }), env)).not.toBe(a);
    expect(clientIp(req({}), env)).toBe("unknown");
  });

  it("keys IPv6 by /64 and unwraps IPv4-mapped addresses", () => {
    expect(limiterKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(limiterKey("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(limiterKey("::ffff:203.0.113.5")).toBe("203.0.113.5");
    expect(limiterKey("198.51.100.1")).toBe("198.51.100.1");
    expect(limiterKey("not:an:ip:::")).toBe("not:an:ip:::");
  });
});

describe("limitsConfig", () => {
  it("uses the SPEC §5.5 defaults", () => {
    expect(limitsConfig({})).toEqual({
      aiDailyCap: 400,
      passPerIpPerMin: 3,
      passPerIpPerDay: 20,
      parksPerIpPerMin: 10,
      parksPerIpPerDay: 60,
      parksDailyCap: 2000,
      serpapiDailyCap: 12,
      serpapiMonthlyCap: 200,
      aiReservePct: 10,
      preLimitBurst: 40,
      preLimitPerSec: 4,
      preLimitPageBurst: 120,
      preLimitPagePerMin: 120,
      preLimitCostBurst: 60,
      preLimitCostPerHour: 45,
    });
  });

  it("reads env, ignores junk, and never lets the SerpApi monthly cap pass the free 250", () => {
    const c = limitsConfig({ AI_DAILY_CAP: "50", PASS_PER_IP_PER_MIN: "-1", SERPAPI_MONTHLY_CAP: "1000", PARKS_PER_IP_PER_MIN: "2.5" });
    expect(c.aiDailyCap).toBe(50);
    expect(c.passPerIpPerMin).toBe(3);
    expect(c.parksPerIpPerMin).toBe(10);
    expect(c.serpapiMonthlyCap).toBe(250);
  });
});
