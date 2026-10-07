/**
 * Pre-prod fixes (2026-10-07), from the first Vercel preview (reports/preview-deploy-2026-10-07b.md in the factory repo):
 *  1. serverless-safe warm-up: nothing outside a request on Vercel, one example per page request, time budgets,
 *     a daily cron route, store trouble never fatal and logged once;
 *  2. one second try for an example whose pass came out short with no complete pass saved;
 *  3. the warm-up may use at most half of the daily SerpApi cap;
 *  4. engines.node "22.x".
 * Park data and model answers are the LIVE recordings (support/pass-replay.ts, support/serpapi-replay.ts). Failures
 * that can't be recorded on demand (a store that never answers) are built here and say so.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore, resetStores, STORE_ERROR_LOG_EVERY_MS, UpstashStore, type Store } from "@/lib/cache/store";
import { setLogSink } from "@/lib/log";
import { quotaUsage } from "@/lib/limits";
import { reserveSearch, SERPAPI_DAY_QUOTA, SERPAPI_WARMUP_QUOTA, serpapiWarmupCap } from "@/lib/limits/serpapi";
import { PASS_DEADLINE_MS } from "@/lib/pass/budget";
import { resetPassMaking } from "@/lib/pass/make";
import { LUCKY_COPY, loadLucky } from "@/lib/pool/lucky";
import {
  CRON_BUDGET_MS,
  CRON_MAX_DURATION_SEC,
  EXAMPLE_PARKS,
  exampleStatuses,
  HOME_MAX_DURATION_SEC,
  prewarmIdle,
  REFRESH_WORST_MS,
  resetPrewarm,
  serverlessWarmup,
  STORE_WARN_EVERY_MS,
  warmExamples,
  WARMUP_BUDGET_MS,
  type ExamplePark,
} from "@/lib/prewarm";
import { cronAuth, cronWarmResponse } from "@/lib/prewarm-cron";
import { resetSavedOsm } from "@/lib/sources/osm-snapshot";
import { passReplay, type Call } from "./support/pass-replay";
import { serpFixture, serpReplay } from "./support/serpapi-replay";

const CONNEMARA: ExamplePark = { slug: "connemara", parkId: "way/306191453", name: "Connemara Meadow Preserve", place: "Allen TX", blurb: "recorded test park" };
const CELEBRATION = EXAMPLE_PARKS.find((e) => e.slug === "celebration")!;
const EXAMPLES = [CONNEMARA, CELEBRATION];
const SECRET = "a-test-cron-secret-0123456789";

let replay: ReturnType<typeof passReplay>;
let logs: string[];
let restoreLog: () => void;
const modelCalls = () => replay.calls.filter((c: Call) => c.host === "inference.do-ai.run").length;
const events = (name: string) => logs.filter((l) => l.includes(`"event":"${name}"`));
const src = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

beforeEach(() => {
  resetStores();
  resetPassMaking();
  resetPrewarm();
  replay = passReplay();
  vi.stubGlobal("fetch", replay.fetchImpl);
  vi.stubEnv("DO_INFERENCE_API_KEY", "test-key-not-real");
  vi.stubEnv("MODEL_BASE_URL", "");
  vi.stubEnv("MODEL_ID", "");
  vi.stubEnv("AI_DAILY_CAP", "");
  vi.stubEnv("PREWARM_EXAMPLES", "");
  vi.stubEnv("SERPAPI_API_KEY", "");
  vi.stubEnv("VERCEL", "");
  logs = [];
  restoreLog = setLogSink((_l, line) => logs.push(line));
});
afterEach(async () => {
  await prewarmIdle();
  resetSavedOsm();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  restoreLog();
}, 90_000);

/** Built failure: a store whose every command fails (as a paused instance's timed-out Upstash calls did). */
function deadStore(): Store {
  const fail = async (): Promise<never> => {
    throw Object.assign(new Error("The shared store did not answer."), { name: "StoreError" });
  };
  return { kind: "upstash", get: fail, set: fail, del: fail, incr: fail };
}

describe("1. serverless-safe warm-up", { timeout: 90_000 }, () => {
  it("budgets fit under maxDuration; the page and the cron route export the literals the budgets assume", () => {
    expect(WARMUP_BUDGET_MS).toBeGreaterThanOrEqual(REFRESH_WORST_MS);
    expect(WARMUP_BUDGET_MS).toBeLessThan(HOME_MAX_DURATION_SEC * 1000 - 10_000);
    expect(CRON_BUDGET_MS).toBeLessThan(CRON_MAX_DURATION_SEC * 1000 - 10_000);
    expect(REFRESH_WORST_MS).toBeGreaterThan(PASS_DEADLINE_MS);
    expect(CRON_MAX_DURATION_SEC).toBeLessThanOrEqual(300); // Vercel Hobby maximum (docs, 2026-10-07)
    expect(src("src/app/page.tsx")).toContain(`export const maxDuration = ${HOME_MAX_DURATION_SEC};`);
    expect(src("src/app/page.tsx")).toContain("after(() => prewarmIdle({ budgetMs: WARMUP_BUDGET_MS }))");
    expect(src("src/app/api/cron/warm-examples/route.ts")).toContain(`export const maxDuration = ${CRON_MAX_DURATION_SEC};`);
  });

  it("instrumentation starts no warm-up on Vercel (work outside a request is frozen there)", () => {
    expect(serverlessWarmup({ VERCEL: "1" })).toBe(true);
    expect(serverlessWarmup({})).toBe(false);
    expect(serverlessWarmup({ VERCEL: "" })).toBe(false);
    expect(src("src/instrumentation.ts")).toMatch(/if \(!prewarmEnabled\(\) \|\| serverlessWarmup\(\)\) return;/);
  });

  it("on Vercel a page request starts at most ONE example, none while one runs here, and the next request resumes", async () => {
    vi.stubEnv("VERCEL", "1");
    const now = Date.now();
    const first = await exampleStatuses({ examples: EXAMPLES, now: () => now });
    expect(first.map((s) => [s.example.slug, s.refreshing])).toEqual([["connemara", true], ["celebration", false]]);
    expect(first.find((s) => s.example.slug === "celebration")!.missing).toBe("No data available yet: no pass has been made for it today.");
    // Another request while that pass is still being made: nothing new starts in this instance.
    const during = await exampleStatuses({ examples: EXAMPLES, now: () => now + 1000 });
    expect(during.find((s) => s.example.slug === "celebration")!.refreshing).toBe(false);
    await prewarmIdle();
    expect(modelCalls()).toBe(3); // Connemara only: first call + two refills
    // Next request: Connemara came out short with nothing complete, so its ONE second try goes first (config order).
    const second = await exampleStatuses({ examples: EXAMPLES, now: () => now + 2000 });
    const conn = second.find((s) => s.example.slug === "connemara")!;
    expect(conn.refreshing).toBe(true);
    expect(conn.pass).toBeNull(); // a short pass is never shown
    expect(conn.missing).toMatch(/^No data available yet: today's first pass came out with \d of 8 finds, so a second one is being made right now \(about 15-30 seconds\)\.$/);
    expect(second.find((s) => s.example.slug === "celebration")!.refreshing).toBe(false);
    await prewarmIdle();
    expect(modelCalls()).toBe(6);
    // Next request: Celebration.
    const third = await exampleStatuses({ examples: EXAMPLES, now: () => now + 3000 });
    expect(third.find((s) => s.example.slug === "celebration")!.refreshing).toBe(true);
    await prewarmIdle();
    expect(modelCalls()).toBe(7);
    // Everything done for today: no more model calls from page requests.
    const done = await exampleStatuses({ examples: EXAMPLES, now: () => now + 4000 });
    expect(done.every((s) => !s.refreshing && s.fresh)).toBe(true);
    await prewarmIdle();
    expect(modelCalls()).toBe(7);
    expect(events("prewarm_ok").filter((l) => l.includes('"retry":true'))).toHaveLength(1);
  });

  it("not on Vercel: one page request may start every stale example (a long-running server keeps them alive)", async () => {
    const now = Date.now();
    const s = await exampleStatuses({ examples: EXAMPLES, now: () => now });
    expect(s.every((x) => x.refreshing)).toBe(true);
  });

  it("prewarmIdle with a budget stops waiting at the budget and says so (the build may still finish later)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // Built delay: the recorded model answer, held back until the test releases it.
    const slow = passReplay({
      model: async () => {
        await gate;
        return undefined;
      },
    });
    replay = slow;
    vi.stubGlobal("fetch", slow.fetchImpl);
    await exampleStatuses({ examples: [CELEBRATION], now: () => Date.now() });
    const t = Date.now();
    await prewarmIdle({ budgetMs: 50 });
    expect(Date.now() - t).toBeLessThan(5_000);
    expect(events("prewarm_budget_reached")).toHaveLength(1);
    release();
    await prewarmIdle();
    expect(events("prewarm_ok")).toHaveLength(1);
  });

  it("a warm-up round starts a new attempt only while a whole pass still fits its budget", async () => {
    const now = Date.now();
    // The wall clock moves 50 s per model call (a slow day), so after Connemara's 3 calls the second try no longer fits.
    const out = await warmExamples({ examples: EXAMPLES, now: () => now, clock: () => modelCalls() * 50_000 }, { budgetMs: REFRESH_WORST_MS + 5_000 });
    expect(out).toEqual({ enabled: true, attempts: [{ example: "connemara", need: "refresh" }], stopped: "budget" });
    expect(modelCalls()).toBe(3);
    expect(events("prewarm_budget_stop")).toHaveLength(1);
  });

  it("store trouble is never fatal: the round stops, nothing is made blind, and it is logged once per 10 minutes", async () => {
    const store = deadStore();
    let t = 1_000_000;
    const deps = { examples: EXAMPLES, now: () => Date.now(), store, clock: () => t };
    expect(await warmExamples(deps)).toEqual({ enabled: true, attempts: [], stopped: "store" });
    expect(await warmExamples(deps)).toEqual({ enabled: true, attempts: [], stopped: "store" });
    const s = await exampleStatuses(deps);
    expect(s.every((x) => x.pass === null && !x.refreshing)).toBe(true);
    expect(replay.calls).toHaveLength(0);
    expect(events("prewarm_store_unavailable")).toHaveLength(1);
    t += STORE_WARN_EVERY_MS + 1;
    await warmExamples(deps);
    expect(events("prewarm_store_unavailable")).toHaveLength(2);
  });

  it("Upstash network errors (timeouts) are logged once a minute with how many were left out; each still fails safe", async () => {
    // Built failure: every fetch times out, as on the paused preview instance.
    const timeout = async (): Promise<Response> => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    };
    const store = new UpstashStore({ url: "https://example-db.upstash.io", token: "t", fetch: timeout });
    for (let i = 0; i < 5; i++) await expect(store.get("k")).rejects.toMatchObject({ name: "StoreError" });
    const lines = events("store_error");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"errName":"TimeoutError"');
    expect(lines[0]).not.toContain('"t"'); // never the token
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + STORE_ERROR_LOG_EVERY_MS + 1);
      await expect(store.get("k")).rejects.toMatchObject({ name: "StoreError" });
    } finally {
      vi.useRealTimers();
    }
    expect(events("store_error")).toHaveLength(2);
    expect(events("store_error")[1]).toContain('"notLogged":4');
  });
});

describe("1b. daily cron route", { timeout: 90_000 }, () => {
  const req = (auth?: string) => new Request("http://localhost/api/cron/warm-examples", { headers: auth ? { authorization: auth } : {} });

  it("needs CRON_SECRET (16+ characters) and the exact Bearer header", () => {
    expect(cronAuth(req(`Bearer ${SECRET}`), {})).toBe("not_configured");
    expect(cronAuth(req("Bearer short"), { CRON_SECRET: "short" })).toBe("not_configured");
    expect(cronAuth(req(), { CRON_SECRET: SECRET })).toBe("denied");
    expect(cronAuth(req(`Bearer ${SECRET}x`), { CRON_SECRET: SECRET })).toBe("denied");
    expect(cronAuth(req(SECRET), { CRON_SECRET: SECRET })).toBe("denied");
    expect(cronAuth(req(`Bearer ${SECRET}`), { CRON_SECRET: SECRET })).toBe("ok");
  });

  it("refuses without spending anything, and never logs the secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const off = await cronWarmResponse(req(`Bearer ${SECRET}`), { examples: EXAMPLES });
    expect(off.status).toBe(503);
    expect(off.headers.get("cache-control")).toBe("no-store");
    vi.stubEnv("CRON_SECRET", SECRET);
    const bad = await cronWarmResponse(req("Bearer nope"), { examples: EXAMPLES });
    expect(bad.status).toBe(401);
    expect(replay.calls).toHaveLength(0);
    expect(logs.join("\n")).not.toContain(SECRET);
  });

  it("with the secret: warms every example in one run (second try included) and reports what it did", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const res = await cronWarmResponse(req(`Bearer ${SECRET}`), { examples: EXAMPLES });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enabled: true,
      attempts: [{ example: "connemara", need: "refresh" }, { example: "connemara", need: "retry" }, { example: "celebration", need: "refresh" }],
      stopped: null,
    });
    expect(modelCalls()).toBe(7);
    expect(logs.join("\n")).not.toContain(SECRET);
  });

  it("vercel.json schedules it once a day, early morning Dallas time (Hobby allows daily crons only)", () => {
    const cfg = JSON.parse(src("vercel.json")) as { crons: { path: string; schedule: string }[] };
    expect(cfg.crons).toEqual([{ path: "/api/cron/warm-examples", schedule: "0 10 * * *" }]); // 10:00-10:59 UTC = 5-6 AM CDT
  });
});

describe("2. one second try, never a short example", { timeout: 90_000 }, () => {
  it("the second try is once per example per day across instances, and a short result is still not shown", async () => {
    const now = Date.now();
    await warmExamples({ examples: [CONNEMARA], now: () => now });
    expect(modelCalls()).toBe(6); // first pass + the one second try (3 calls each in these recordings)
    resetPrewarm(); // a new instance
    await warmExamples({ examples: [CONNEMARA], now: () => now + 1000 });
    const [s] = await exampleStatuses({ examples: [CONNEMARA], now: () => now + 2000 });
    await prewarmIdle();
    expect(modelCalls()).toBe(6);
    expect(s.pass).toBeNull();
    expect(s.latest?.passId).toMatch(/-2$/); // the second try is a new variant
    expect(s.missing).toMatch(/^No data available yet: today's pass came out with \d of 8 finds/);
  });

  it("no second try when the AI daily cap is used up (it stays inside the cap)", async () => {
    const now = Date.now();
    await warmExamples({ examples: [CONNEMARA], now: () => now });
    const before = modelCalls();
    resetPrewarm();
    vi.stubEnv("AI_DAILY_CAP", "0");
    // The second-try slot was used on the first round; a fresh day with cap 0 makes nothing at all.
    const tomorrow = now + 24 * 3600 * 1000;
    await warmExamples({ examples: [CONNEMARA], now: () => tomorrow });
    expect(modelCalls()).toBe(before);
    expect(events("prewarm_failed").some((l) => l.includes('"code":"DAILY_LIMIT"'))).toBe(true);
  });
});

describe("3. the warm-up keeps at least half of the daily SerpApi cap for visitors", () => {
  const KEY = "0123456789abcdef".repeat(4);
  const ARBOR = { id: "way/38113837", name: "Arbor Hills Nature Preserve", lat: 33.04894, lng: -96.85205 };
  const REC_AT = Date.parse(serpFixture("google-maps-reviews-arbor-hills-dog")._recording.fetchedAt);

  it("share = half of SERPAPI_DAILY_CAP rounded down; SERPAPI_WARMUP_DAILY_CAP may only lower it", () => {
    expect(serpapiWarmupCap({ SERPAPI_DAILY_CAP: "6" })).toBe(3);
    expect(serpapiWarmupCap({ SERPAPI_DAILY_CAP: "25" })).toBe(12);
    expect(serpapiWarmupCap({ SERPAPI_DAILY_CAP: "1" })).toBe(0);
    expect(serpapiWarmupCap({ SERPAPI_DAILY_CAP: "0" })).toBe(0);
    expect(serpapiWarmupCap({})).toBe(6); // default daily cap 12
    expect(serpapiWarmupCap({ SERPAPI_DAILY_CAP: "6", SERPAPI_WARMUP_DAILY_CAP: "10" })).toBe(3);
    expect(serpapiWarmupCap({ SERPAPI_DAILY_CAP: "6", SERPAPI_WARMUP_DAILY_CAP: "1" })).toBe(1);
    expect(serpapiWarmupCap({ SERPAPI_DAILY_CAP: "6", SERPAPI_WARMUP_DAILY_CAP: "0" })).toBe(0);
  });

  it("with the preview cap of 6 the warm-up gets 3 searches and visitors keep the other 3", async () => {
    const store = new MemoryStore();
    const env = { SERPAPI_DAILY_CAP: "6" };
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      const r = await reserveSearch(store, { env, now, warmup: true });
      expect(r.ok).toBe(true);
      if (r.ok) r.ticket.commit();
    }
    expect(await reserveSearch(store, { env, now, warmup: true })).toMatchObject({ ok: false, reason: "warmup_share" });
    // The refused warm-up search spent nothing.
    expect((await quotaUsage(store, { name: SERPAPI_DAY_QUOTA, period: { kind: "day" }, now })).global).toBe(3);
    expect((await quotaUsage(store, { name: SERPAPI_WARMUP_QUOTA, period: { kind: "day" }, now })).global).toBe(3);
    for (let i = 0; i < 3; i++) {
      const r = await reserveSearch(store, { env, now });
      expect(r.ok).toBe(true);
      if (r.ok) r.ticket.commit();
    }
    expect(await reserveSearch(store, { env, now })).toMatchObject({ ok: false, reason: "daily_cap" });
    // A released (never sent) warm-up search gives its share back too.
    const store2 = new MemoryStore();
    const r = await reserveSearch(store2, { env, now, warmup: true });
    if (r.ok) await r.ticket.release();
    expect((await quotaUsage(store2, { name: SERPAPI_WARMUP_QUOTA, period: { kind: "day" }, now })).global).toBe(0);
  });

  it("an example pass whose Lucky Finds hit the warm-up share says so honestly (and sends nothing more)", async () => {
    const r = serpReplay();
    const env = { SERPAPI_API_KEY: KEY, SERPAPI_DAILY_CAP: "2" }; // warm-up share 1: the place search only
    const out = await loadLucky(ARBOR, { features: {} }, { store: new MemoryStore(), env, now: () => REC_AT, fetchImpl: r.fetchImpl, warmup: true });
    expect(r.calls).toHaveLength(1);
    expect(out.items).toEqual([]);
    expect(out.state).toEqual({ status: "off", message: LUCKY_COPY.warmupShare });
  });

  it("makePass marks the server's own warm-up (internal) so its searches use the warm-up share", () => {
    expect(src("src/lib/pass/make.ts")).toContain("warmup: ctx.deps.internal === true,");
    expect(src("src/lib/ai/build-pass.ts")).toContain("warmup: data.warmup,");
  });
});

describe("4. engines", () => {
  it('package.json pins Node 22 ("22.x"), so Vercel does not auto-upgrade to a new major', () => {
    expect((JSON.parse(src("package.json")) as { engines: { node: string } }).engines.node).toBe("22.x");
  });
});
