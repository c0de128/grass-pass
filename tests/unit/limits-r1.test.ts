/**
 * Audit round 1 (SEC-1-02, SEC-1-03, SEC-1-05): store command cost, hashed client keys, the IPv6 /48
 * bucket, the reserved AI slice, the in-process pre-limiter and the Upstash monthly budget alerts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { MemoryStore, UpstashStore, type Store } from "@/lib/cache/store";
import { setLogSink } from "@/lib/log";
import {
  aiCapFor,
  hashedKey,
  hitRateLimit,
  limiterSecretSource,
  limitsConfig,
  networkKey,
  preLimit,
  reserveQuota,
  resetBudget,
  resetPreLimit,
  restingState,
} from "@/lib/limits";
import { proxy, config as proxyConfig } from "@/proxy";

const T0 = Date.UTC(2026, 9, 5, 22, 0, 0);
const ENV = { LIMITER_KEY_SECRET: "unit-test-secret-0123456789" };

/** A MemoryStore that counts every operation, the way Upstash bills commands. */
function countingStore(opts: { withScripts?: boolean } = {}) {
  let t = T0;
  const mem = new MemoryStore({ now: () => t });
  const ops: string[] = [];
  const store: Store = {
    kind: "memory",
    get: (k) => (ops.push("GET"), mem.get(k)),
    set: (k, v, ttl) => (ops.push("SET"), mem.set(k, v, ttl)),
    del: (k) => (ops.push("DEL"), mem.del(k)),
    incr: (k, by, ttl) => (ops.push("EVAL"), mem.incr(k, by, ttl)),
    ...(opts.withScripts === false
      ? {}
      : {
          rateHit: (c: string, p: string, e: number, l: number, ttl: number) => (ops.push("EVAL"), mem.rateHit(c, p, e, l, ttl)),
          reserve: (k: readonly string[], c: readonly number[], ttl: number) => (ops.push("EVAL"), mem.reserve(k, c, ttl)),
        }),
  };
  return { store, ops, now: () => t, advance: (ms: number) => (t += ms) };
}

type Line = { event: string; level: string; fields: Record<string, unknown> };
let lines: Line[] = [];
let restore: () => void;
beforeEach(() => {
  lines = [];
  restore = setLogSink((level, line) => {
    const { event, ...fields } = JSON.parse(line) as { event: string } & Record<string, unknown>;
    lines.push({ event, level, fields });
  });
  resetPreLimit();
});
afterEach(() => restore());

describe("hashed client keys (SEC-1-03) and the IPv6 /48 network (SEC-1-05)", () => {
  it("IPv4: one HMAC key, no address in it, depends on the secret", () => {
    const k = hashedKey("203.0.113.9", ENV);
    expect(k).toMatch(/^4:[\w-]{22}$/);
    expect(k).not.toContain("203");
    expect(hashedKey("203.0.113.9", { LIMITER_KEY_SECRET: "another-secret-0123456789" })).not.toBe(k);
    expect(networkKey(k)).toBeNull();
    expect(hashedKey("::ffff:203.0.113.9", ENV)).toBe(k); // IPv4-mapped IPv6 is the same client
  });

  it("IPv6: same /64 -> same key; another /64 in the same /48 -> another key, same network", () => {
    const a = hashedKey("2001:db8:1:2::1", ENV);
    const b = hashedKey("2001:db8:1:2:ffff::9", ENV);
    const c = hashedKey("2001:db8:1:3::1", ENV);
    const d = hashedKey("2001:db8:2:3::1", ENV);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^6:[\w-]{22}:[\w-]{22}$/);
    expect(networkKey(a)).toBe(networkKey(c));
    expect(networkKey(a)).not.toBe(networkKey(d));
    expect(a).not.toContain("2001");
  });

  it("secret: LIMITER_KEY_SECRET (16+ chars), else derived from the Upstash token, else random per process", () => {
    expect(limiterSecretSource(ENV)).toBe("env");
    expect(limiterSecretSource({ LIMITER_KEY_SECRET: "short", UPSTASH_REDIS_REST_TOKEN: "tok" })).toBe("upstash-token");
    expect(limiterSecretSource({})).toBe("random");
    // The token-derived key is stable (every instance computes the same one).
    const t = { UPSTASH_REDIS_REST_TOKEN: "same-token" };
    const k1 = hashedKey("198.51.100.1", t);
    hashedKey("198.51.100.1", ENV);
    expect(hashedKey("198.51.100.1", t)).toBe(k1);
  });
});

describe("store command cost (SEC-1-02)", () => {
  it("rate limit: 1 command per hit; after a refusal, 0 commands until Retry-After", async () => {
    const { store, ops, now, advance } = countingStore();
    const opts = { name: "parks", key: "4:abc", limit: 2, windowSec: 60 };
    expect((await hitRateLimit(store, { ...opts, now: now() })).ok).toBe(true);
    expect((await hitRateLimit(store, { ...opts, now: now() })).ok).toBe(true);
    expect(ops).toEqual(["EVAL", "EVAL"]);
    const refused = await hitRateLimit(store, { ...opts, now: now() });
    expect(refused.ok).toBe(false);
    expect(ops).toHaveLength(3);
    for (let i = 0; i < 100; i++) expect((await hitRateLimit(store, { ...opts, now: now() })).ok).toBe(false);
    expect(ops).toHaveLength(3); // the flood cost nothing
    // After Retry-After the store is asked again (one command).
    advance(((refused as { retryAfter: number }).retryAfter + 1) * 1000);
    await hitRateLimit(store, { ...opts, now: now() });
    expect(ops).toHaveLength(4);
  });

  it("rate limit without the one-command script still works (fallback)", async () => {
    const { store, now } = countingStore({ withScripts: false });
    const opts = { name: "p", key: "k", limit: 1, windowSec: 60 };
    expect((await hitRateLimit(store, { ...opts, now: now() })).ok).toBe(true);
    expect((await hitRateLimit(store, { ...opts, now: now() })).ok).toBe(false);
  });

  it("quota: 1 command per reserve; a refusal is remembered (no command) for up to 60 s", async () => {
    const { store, ops, now, advance } = countingStore();
    const q = { name: "pass-new", key: "4:abc", perKey: 1, global: 100, period: { kind: "day" as const } };
    expect((await reserveQuota(store, { ...q, now: now() })).ok).toBe(true);
    expect(ops).toEqual(["EVAL"]);
    expect(await reserveQuota(store, { ...q, now: now() })).toMatchObject({ ok: false, scope: "key" });
    expect(ops).toHaveLength(2);
    for (let i = 0; i < 50; i++) await reserveQuota(store, { ...q, now: now() });
    expect(ops).toHaveLength(2);
    advance(61_000);
    expect(await reserveQuota(store, { ...q, now: now() })).toMatchObject({ ok: false, scope: "key" });
    expect(ops).toHaveLength(3);
  });
});

describe("IPv6 /48 bucket and the reserved AI slice (SEC-1-05)", () => {
  it("one /48 can use at most 2x the per-key share, however many /64s it has", async () => {
    for (const withScripts of [true, false]) {
      const { store, now } = countingStore({ withScripts });
      const q = { name: "pass-new", perKey: 3, global: 1000, period: { kind: "day" as const } };
      let ok = 0;
      for (let i = 0; i < 20; i++) {
        const key = hashedKey(`2001:db8:1:${(i + 1).toString(16)}::1`, ENV);
        const r = await reserveQuota(store, { ...q, key, now: now() });
        if (r.ok) ok++;
        else expect(r.scope).toBe("key");
      }
      expect(ok).toBe(6);
      // Another /48 is not affected.
      expect((await reserveQuota(store, { ...q, key: hashedKey("2001:db8:2::1", ENV), now: now() })).ok).toBe(true);
    }
  });

  it("a release gives back the /64, /48 and global slots", async () => {
    const { store, now } = countingStore();
    const q = { name: "x", perKey: 1, global: 1, period: { kind: "day" as const } };
    const key = hashedKey("2001:db8:9:1::1", ENV);
    const r = await reserveQuota(store, { ...q, key, now: now() });
    expect(r.ok).toBe(true);
    if (r.ok) await r.ticket.release();
    expect((await reserveQuota(store, { ...q, key: hashedKey("2001:db8:9:2::1", ENV), now: now() })).ok).toBe(true);
  });

  it("aiCapFor keeps 10% of AI_DAILY_CAP for the example parks and the pre-warm", () => {
    const cfg = limitsConfig({});
    expect(aiCapFor(cfg, true)).toBe(400);
    expect(aiCapFor(cfg, false)).toBe(360);
    expect(aiCapFor(limitsConfig({ AI_RESERVE_PCT: "0" }), false)).toBe(400);
    expect(aiCapFor(limitsConfig({ AI_RESERVE_PCT: "90" }), false)).toBe(200); // capped at 50%
    expect(aiCapFor(limitsConfig({ AI_DAILY_CAP: "1" }), false)).toBe(1);
  });

  it("a global refusal at the public cap does not block a caller with the full cap", async () => {
    const { store, now } = countingStore();
    const base = { name: "ai-calls", key: "all", perKey: Infinity, period: { kind: "day" as const } };
    expect((await reserveQuota(store, { ...base, global: 1, now: now() })).ok).toBe(true);
    expect(await reserveQuota(store, { ...base, global: 1, now: now() })).toMatchObject({ ok: false, scope: "global" });
    expect((await reserveQuota(store, { ...base, global: 2, now: now() })).ok).toBe(true);
  });

  it("logs once when a global cap reaches 50% and 90%", async () => {
    const { store, now } = countingStore();
    const q = { name: "ai-calls", key: "all", perKey: Infinity, global: 10, period: { kind: "day" as const } };
    for (let i = 0; i < 10; i++) await reserveQuota(store, { ...q, now: now() });
    const alerts = lines.filter((l) => l.event === "quota_alert");
    expect(alerts.map((a) => [a.fields.pct, a.fields.used, a.level])).toEqual([
      [50, 5, "warn"],
      [90, 9, "error"],
    ]);
  });
});

describe("in-process pre-limiter (SEC-1-02)", () => {
  const cfg = { preLimitBurst: 5, preLimitPerSec: 1 };

  it("a burst, then refill per second, per key", () => {
    for (let i = 0; i < 5; i++) expect(preLimit("a", T0, cfg).ok).toBe(true);
    expect(preLimit("a", T0, cfg)).toEqual({ ok: false, retryAfter: 1 });
    expect(preLimit("b", T0, cfg).ok).toBe(true);
    expect(preLimit("a", T0 + 1000, cfg).ok).toBe(true);
    expect(preLimit("a", T0 + 1000, cfg).ok).toBe(false);
  });

  it("proxy: 429 with Retry-After before any store call; JSON on /api, text on pages; matcher covers store pages", () => {
    process.env.PRELIMIT_BURST = "3";
    process.env.PRELIMIT_PER_SEC = "1";
    // SEC-2-01: pages have their own (slower) bucket.
    process.env.PRELIMIT_PAGE_BURST = "3";
    try {
      const req = (path: string) => new NextRequest(`http://localhost:3123${path}`, { headers: { "x-forwarded-for": "192.0.2.200" } });
      for (let i = 0; i < 3; i++) expect(proxy(req("/")).status).toBe(200);
      const page = proxy(req("/pass/w1-6to10-20261005-1"));
      expect(page.status).toBe(429);
      expect(Number(page.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(page.headers.get("content-type")).toMatch(/text\/plain/);
      for (let i = 0; i < 3; i++) expect(proxy(req("/api/nothing")).status).toBe(200);
      const api = proxy(req("/api/pass"));
      expect(api.status).toBe(429);
      expect(api.headers.get("content-type")).toMatch(/json/);
      // Another client is not affected.
      expect(proxy(new NextRequest("http://localhost:3123/", { headers: { "x-forwarded-for": "192.0.2.201" } })).status).toBe(200);
      expect(proxyConfig.matcher).toEqual(["/", "/signin", "/pass/:path*", "/api/:path*"]);
    } finally {
      delete process.env.PRELIMIT_BURST;
      delete process.env.PRELIMIT_PER_SEC;
      delete process.env.PRELIMIT_PAGE_BURST;
    }
  });
});

describe("Upstash: one EVAL per check, monthly budget alerts", () => {
  function fakeUpstash(answer: (cmd: unknown[]) => unknown) {
    const sent: unknown[][] = [];
    const fetchImpl = async (_u: string, init?: RequestInit) => {
      const cmd = JSON.parse(String(init?.body)) as unknown[];
      sent.push(cmd);
      return Response.json({ result: answer(cmd) });
    };
    return { sent, fetchImpl };
  }

  it("rateHit and reserve are one EVAL each, with prefixed keys", async () => {
    const f = fakeUpstash((cmd) => (String(cmd[1]).includes("DECRBY") ? [0, 3, 2] : [0, 1, 1]));
    const s = new UpstashStore({ url: "https://x.upstash.io", token: "t", fetch: f.fetchImpl });
    expect(await s.rateHit("a", "b", 0.5, 3, 121)).toEqual({ allowed: false, current: 3, previous: 2 });
    expect(f.sent[0].slice(2, 8)).toEqual([2, "gp:a", "gp:b", "0.5", 3, 121]);
    expect(await s.reserve(["g", "k"], [10, 2], 100)).toEqual({ failed: 0, counts: [1, 1] });
    expect(f.sent[1].slice(2)).toEqual([2, "gp:g", "gp:k", 10, 2, 100]);
    expect(f.sent).toHaveLength(2);
  });

  it("adds commands to shared monthly + daily counters every 10 and logs at 50%, 80% and 90% of UPSTASH_MONTHLY_COMMANDS", async () => {
    let total = 0;
    let day = 0;
    const f = fakeUpstash((cmd) => {
      // SEC-3-03/04: one EVAL adds the batch to the monthly (UTC) and the daily (Chicago) counter.
      if (String(cmd[3]).includes("meta:commands:2026-10") && String(cmd[4]).includes("meta:commands-day:2026-10")) {
        total += Number(cmd[5]);
        day += Number(cmd[5]);
        return [total, day];
      }
      return null;
    });
    const s = new UpstashStore({ url: "https://x.upstash.io", token: "t", fetch: f.fetchImpl, monthlyBudget: 200, now: () => T0 });
    for (let i = 0; i < 200; i++) await s.get(`k${i}`);
    await s.flushBudget();
    const budget = lines.filter((l) => l.event === "upstash_budget");
    expect(budget.map((b) => [b.fields.pct, b.level])).toEqual([
      [50, "warn"],
      [80, "error"],
      [90, "error"],
    ]);
    expect(total).toBeGreaterThanOrEqual(200);
    // Every flush is 10 commands + itself.
    expect(f.sent.filter((c) => c[0] === "EVAL").length).toBeGreaterThanOrEqual(18);
    // SEC-2-01 / SEC-3-04: past 90% the app rests (read-only) instead of failing closed at 100%.
    expect(restingState(T0).resting).toBe(true);
    resetBudget();
  });
});
