/**
 * Audit round 2 (SEC-2-01, SEC-2-02): page and store-cost buckets, the /48 pre-limit bucket, impossible
 * pass ids, the pass read memo, the per-month math, and resting at 95% of the Upstash budget.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MemoryStore, resetStores, UpstashStore } from "@/lib/cache/store";
import { setLogSink } from "@/lib/log";
import {
  aiCapFor,
  COSTS,
  forgetPassRead,
  hashedKey,
  limitsConfig,
  memoPassRead,
  monthlyCommandBound,
  networkKey,
  noteMonthlyCommands,
  plausiblePassId,
  preLimitRequest,
  requestCost,
  resetBudget,
  resetPassReads,
  resetPreLimit,
  restingError,
  restingState,
} from "@/lib/limits";
import { HIT_TTL_MS, MAX_OSM_ID, PASS_MAX_VARIANT, PASS_TTL_DAYS, SHORT_TTL_MS } from "@/lib/limits/pass-read";
import { checkResting, guardJsonPost } from "@/lib/http/guard";
import { makePass, PASS_TTL_SEC, resetPassMaking } from "@/lib/pass/make";
import { MAX_VARIANTS, PASS_ID_PATTERN, PassRequestSchema } from "@/lib/pass/schema";
import { UPSTASH_FREE_MONTHLY_COMMANDS } from "@/lib/cache/store";
import { proxy } from "@/proxy";
import { PARKS, passReplay } from "./support/pass-replay";

// 2026-10-06 12:00 CDT
const T0 = Date.UTC(2026, 9, 6, 17, 0, 0);
const ENV = { LIMITER_KEY_SECRET: "unit-test-secret-0123456789" }; // gitleaks:allow
const CFG = limitsConfig({});

let restoreLog: () => void;
beforeEach(() => {
  resetPreLimit();
  resetPassReads();
  resetBudget();
  restoreLog = setLogSink(() => undefined);
});
afterEach(() => {
  resetBudget();
  restoreLog();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("impossible pass ids cost no store read (SEC-2-01)", () => {
  it("keeps the constants in step with the pass schema and TTL", () => {
    expect(PASS_MAX_VARIANT).toBe(MAX_VARIANTS);
    expect(PASS_TTL_DAYS * 24 * 3600).toBe(PASS_TTL_SEC);
  });

  it("accepts real-looking ids from 31 days ago to tomorrow (Chicago), variant 1-3", () => {
    for (const id of ["w306191453-6to10-20261006-1", "w306191453-4to6-20261007-3", "r114690-10to13-20260905-2", "n12345678901-6to10-20261001-1"]) {
      expect(PASS_ID_PATTERN.test(id), id).toBe(true);
      expect(plausiblePassId(id, T0), id).toBe(true);
    }
  });

  it("refuses a future day, a day past the TTL, a bad date, a variant above 3, leading zeros and huge OSM ids", () => {
    for (const id of [
      "w306191453-6to10-20261008-1", // the day after tomorrow
      "w306191453-6to10-20260904-1", // 32 days ago
      "w306191453-6to10-20260231-1", // no such date
      "w306191453-6to10-20261306-1",
      "w306191453-6to10-20261006-4", // variant above MAX_VARIANTS
      "w0306191453-6to10-20261006-1",
      `r${MAX_OSM_ID.r}-6to10-20261006-1`,
      `w${MAX_OSM_ID.w}-6to10-20261006-1`,
      "w999999999999999-6to10-20261006-1",
      "w1-5to9-20261006-1",
      "bogus-id",
    ]) {
      expect(plausiblePassId(id, T0), id).toBe(false);
    }
  });
});

describe("pass read memo (SEC-2-01)", () => {
  type P = { id: string; degraded: boolean };
  const stable = (p: P) => !p.degraded;

  it("a normal pass is read once per HIT_TTL_MS; a degraded pass and a miss only for SHORT_TTL_MS", async () => {
    let reads = 0;
    const load = (v: P | null) => async () => (reads++, v);
    await memoPassRead("a", T0, load({ id: "a", degraded: false }), stable);
    await memoPassRead("a", T0 + HIT_TTL_MS - 1, load({ id: "a", degraded: false }), stable);
    expect(reads).toBe(1);
    await memoPassRead("a", T0 + HIT_TTL_MS, load({ id: "a", degraded: false }), stable);
    expect(reads).toBe(2);

    reads = 0;
    await memoPassRead("b", T0, load({ id: "b", degraded: true }), stable);
    await memoPassRead("b", T0 + SHORT_TTL_MS - 1, load(null), stable);
    await memoPassRead("b", T0 + SHORT_TTL_MS, load(null), stable);
    expect(reads).toBe(2);

    reads = 0;
    expect(await memoPassRead("c", T0, load(null), stable)).toBeNull();
    expect(await memoPassRead("c", T0 + 1000, load(null), stable)).toBeNull();
    expect(reads).toBe(1);
    // Saving a pass under the id drops the memo at once.
    forgetPassRead("c");
    expect(await memoPassRead("c", T0 + 2000, load({ id: "c", degraded: false }), stable)).toEqual({ id: "c", degraded: false });
    expect(reads).toBe(2);
  });

  it("concurrent readers share one read; a failed read (store down) is not kept", async () => {
    let reads = 0;
    const slow = async () => (reads++, await new Promise((r) => setTimeout(r, 5)), { id: "d", degraded: false });
    await Promise.all([memoPassRead("d", T0, slow, stable), memoPassRead("d", T0, slow, stable), memoPassRead("d", T0, slow, stable)]);
    expect(reads).toBe(1);
    const failing = async (): Promise<P | null> => {
      reads++;
      throw new Error("down");
    };
    await expect(memoPassRead("e", T0, failing, stable)).rejects.toThrow("down");
    await expect(memoPassRead("e", T0, failing, stable)).rejects.toThrow("down");
    expect(reads).toBe(3);
  });
});

describe("page and store-cost buckets (SEC-2-01)", () => {
  const ip4 = hashedKey("198.51.100.7", ENV);
  const hit = (pathname: string, now: number, key = ip4) => preLimitRequest({ key, net48: networkKey(key), pathname, now, cfg: CFG });
  const randomId = (i: number) => `w${100000 + i}-6to10-20261006-1`;

  it("costs: home 0, a possible pass id 1, an impossible one 0, the APIs 4", () => {
    expect(requestCost("/", T0)).toEqual({ kind: "page", cost: 0 });
    expect(requestCost("/pass/w1-6to10-20261006-1", T0)).toEqual({ kind: "page", cost: 1 });
    expect(requestCost("/pass/w1-6to10-20261006-1/print", T0)).toEqual({ kind: "page", cost: 1 });
    expect(requestCost("/pass/w1-6to10-20200101-1", T0)).toEqual({ kind: "page", cost: 0 });
    expect(requestCost("/pass/%E0%A4%A", T0)).toEqual({ kind: "page", cost: 0 });
    expect(requestCost("/api/pass", T0)).toEqual({ kind: "api", cost: COSTS.apiPass });
    expect(requestCost("/api/parks", T0)).toEqual({ kind: "api", cost: COSTS.apiParks });
  });

  it("pages: a burst of 20, then one every 10 s", () => {
    for (let i = 0; i < 20; i++) expect(hit("/", T0).ok).toBe(true);
    expect(hit("/", T0)).toEqual({ ok: false, retryAfter: 10 });
    expect(hit("/", T0 + 10_000).ok).toBe(true);
    expect(hit("/", T0 + 10_000).ok).toBe(false);
  });

  it("10 minutes of a curl loop on random pass ids: store reads <= the cost burst + the hourly refill", () => {
    let allowed = 0;
    let cost = 0;
    for (let t = 0, i = 0; t < 600_000; t += 100, i++) {
      const path = `/pass/${randomId(i)}`;
      if (hit(path, T0 + t).ok) {
        allowed++;
        cost += requestCost(path, T0 + t).cost;
      }
    }
    // Page bucket: 20 + 0.1/s x 600 s = 80 requests; cost bucket 60 + 45/h x 10 min = 67.5 units.
    expect(allowed).toBeLessThanOrEqual(CFG.preLimitCostBurst + (CFG.preLimitCostPerHour * 10) / 60);
    expect(cost).toBe(allowed);
    expect(allowed).toBeGreaterThan(60);
  });

  it("impossible ids only use the page bucket (no store cost), then the page bucket stops them too", () => {
    let ok = 0;
    for (let i = 0; i < 100; i++) if (hit("/pass/w1-6to10-19990101-1", T0).ok) ok++;
    expect(ok).toBe(20);
    // The cost bucket is untouched: 60 API-cost units are still there for this client (15 x 4).
    for (let i = 0; i < 15; i++) expect(hit("/api/pass", T0).ok).toBe(true);
    expect(hit("/api/pass", T0).ok).toBe(false);
  });

  it("300 /64s in one /48 share one bucket (2 clients' worth)", () => {
    let ok = 0;
    for (let i = 0; i < 300; i++) {
      const key = hashedKey(`2001:db8:1:${i.toString(16)}::5`, ENV);
      if (hit("/", T0, key).ok) ok++;
    }
    expect(ok).toBe(CFG.preLimitPageBurst * 2);
    // Another /48 is not affected.
    expect(hit("/", T0, hashedKey("2001:db8:2::5", ENV)).ok).toBe(true);
  });

  it("proxy: a pass-page flood is refused as text, impossible ids included, without touching the store", () => {
    const req = (path: string) => new NextRequest(`http://localhost:3123${path}`, { headers: { "x-forwarded-for": "192.0.2.77" } });
    const statuses = Array.from({ length: 25 }, (_, i) => proxy(req(`/pass/${randomId(i)}`)).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(20);
    const refused = proxy(req("/pass/w1-6to10-20261006-1"));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("content-type")).toMatch(/text\/plain/);
  });

  it("per-month math: one IPv4 at the steady rate stays under 30% of the free 500K commands", () => {
    const bound = monthlyCommandBound(CFG, { passPerIpPerDay: CFG.passPerIpPerDay, parksPerIpPerDay: CFG.parksPerIpPerDay });
    expect(bound).toBe(148_043);
    expect(bound / UPSTASH_FREE_MONTHLY_COMMANDS).toBeLessThan(0.3);

    // Simulated: one address hammering every path for a day spends at most the cost bucket's day share
    // on cheap paths (the expensive extras are capped by the daily shares, counted in the bound).
    let units = 0;
    const paths = ["/", "/pass/w5-6to10-20261006-1", "/api/pass", "/api/parks"];
    for (let t = 0, i = 0; t < 24 * 3600_000; t += 500, i++) {
      const p = paths[i % paths.length];
      if (hit(p, T0 + t).ok) units += requestCost(p, T0 + t).cost;
    }
    expect(units).toBeLessThanOrEqual(CFG.preLimitCostBurst + CFG.preLimitCostPerHour * 24);
    // x 31 days, plus the daily-share extras, is still the bound above.
    expect((units * 31 + 31 * (20 * 120 + 60 * 20)) * 1.02).toBeLessThanOrEqual(bound + CFG.preLimitCostBurst * 31);
  });
});

describe("resting at 95% of the monthly Upstash budget (SEC-2-01)", () => {
  it("rests from 95% until the 1st of next month (UTC), with an honest date", () => {
    noteMonthlyCommands(474_999, 500_000, "2026-10");
    expect(restingState(T0).resting).toBe(false);
    noteMonthlyCommands(475_000, 500_000, "2026-10");
    const r = restingState(T0);
    expect(r).toMatchObject({ resting: true, untilIso: "2026-11-01T00:00:00.000Z", untilText: "November 1" });
    const err = restingError(T0)!;
    expect(err.code).toBe("RESTING");
    expect(err.message).toMatch(/^Grass Pass is resting until November 1\./);
    expect(err.message).toContain("Saved passes and the example passes still open.");
    // A lower total from a slower flush does not undo it; a new month does.
    noteMonthlyCommands(400_000, 500_000, "2026-10");
    expect(restingState(T0).resting).toBe(true);
    expect(restingState(Date.UTC(2026, 10, 1, 0, 0, 1)).resting).toBe(false);
    // December rolls over to January 1.
    noteMonthlyCommands(490_000, 500_000, "2026-12");
    expect(restingState(Date.UTC(2026, 11, 20))).toMatchObject({ resting: true, untilText: "January 1" });
  });

  it("the Upstash store's monthly flush switches it on", async () => {
    let total = 0;
    const s = new UpstashStore({
      url: "https://x.upstash.io",
      token: "t",
      monthlyBudget: 100,
      now: () => T0,
      fetch: async (_u, init) => {
        const cmd = JSON.parse(String(init?.body)) as unknown[];
        return Response.json({ result: String(cmd[3]).includes("meta:commands") ? (total += Number(cmd[4])) : null });
      },
    });
    for (let i = 0; i < 100; i++) await s.get(`k${i}`);
    await s.flushBudget();
    expect(total).toBeGreaterThanOrEqual(95);
    expect(restingState(T0).resting).toBe(true);
  });

  it("POST APIs answer 503 RESTING before reading the body or any store command", async () => {
    noteMonthlyCommands(480_000, 500_000, new Date().toISOString().slice(0, 7));
    expect(checkResting()?.status).toBe(503);
    const req = new Request("http://localhost:3123/api/pass", {
      method: "POST",
      headers: { host: "localhost:3123", "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify({ parkId: "way/1", ageBand: "6-10" }),
    });
    const g = await guardJsonPost(req, PassRequestSchema);
    expect(g).toMatchObject({ ok: false, failure: { status: 503, code: "RESTING" } });
    expect(req.bodyUsed).toBe(false);
  });

  it("makePass (visitors and the example warm-up) refuses while resting, with no store command", async () => {
    noteMonthlyCommands(480_000, 500_000, new Date().toISOString().slice(0, 7));
    const store = new MemoryStore();
    const spy = vi.spyOn(store, "get");
    const out = await makePass({ parkId: PARKS.connemara.id, ageBand: "6-10" }, { ip: "4:x", internal: true, store });
    expect(out).toMatchObject({ kind: "error", status: 503, error: { code: "RESTING" } });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("the AI reserve also covers the shared new-pass share (SEC-2-02)", () => {
  beforeEach(() => {
    resetStores();
    resetPassMaking();
    vi.stubEnv("DO_INFERENCE_API_KEY", "test-key-not-real");
    vi.stubEnv("MODEL_BASE_URL", "");
    vi.stubEnv("MODEL_ID", "");
    vi.stubEnv("AI_DAILY_CAP", "");
  });

  it("when everyone else has filled their part of pass-new, example and warm-up passes are still made", async () => {
    const replay = passReplay();
    vi.stubGlobal("fetch", replay.fetchImpl);
    const store = new MemoryStore();
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const othersCap = aiCapFor(CFG, false) * 2;
    expect(othersCap).toBe(720);
    await store.set(`q:{pass-new:${day}}:all`, String(othersCap), 3600);

    const visitor = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, { ip: "4:visitor", store });
    expect(visitor).toMatchObject({ kind: "error", status: 429, error: { code: "DAILY_LIMIT" } });

    const example = await makePass({ parkId: PARKS.connemara.id, ageBand: "6-10" }, { ip: "4:judge", reserved: true, store });
    expect(example.kind).toBe("pass");
    const warm = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, { ip: "server", internal: true, store });
    expect(warm.kind).toBe("pass");
  });
});
