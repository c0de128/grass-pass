/**
 * Audit round 3 (security): the daily command pace (SEC-3-03), the counters a new instance reads first
 * and resting at 90% (SEC-3-04), and the per-request background refresh scope with its queue cap
 * (SEC-3-06).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore, resetStores, UpstashStore, type Store } from "@/lib/cache/store";
import { resetMemo } from "@/lib/cache/memo";
import { setLogSink } from "@/lib/log";
import { dailyPace, dailyPaceState, daysInMonth, noteDailyCommands, noteMonthlyCommands, resetBudget, restingState, RESTING_PCT } from "@/lib/limits/budget";
import { loadPass, makePass, resetPassMaking } from "@/lib/pass/make";
import { resetParksSearch, searchParks } from "@/lib/parks/search";
import { MAX_PENDING_REFRESHES, osmRefreshIdle, refreshLater, setBackgroundRefreshForTests, withRefreshScope } from "@/lib/sources/osm-refresh";
import { localDay } from "@/lib/time";
import { osmReplay } from "./support/osm-replay";
import { PARKS, passReplay } from "./support/pass-replay";

vi.setConfig({ testTimeout: 30_000 });

type Line = { event: string; level: string; fields: Record<string, unknown> };
let lines: Line[] = [];
let restoreLog: () => void;
beforeEach(() => {
  resetBudget();
  resetStores();
  resetMemo();
  resetPassMaking();
  resetParksSearch();
  lines = [];
  restoreLog = setLogSink((level, line) => {
    const { event, ...fields } = JSON.parse(line) as { event: string } & Record<string, unknown>;
    lines.push({ event, level, fields });
  });
});
afterEach(() => {
  resetBudget();
  restoreLog();
  setBackgroundRefreshForTests(false);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Mark today (Chicago) as having used its whole share of the free month. */
function useTodaysPace(now = Date.now()): number {
  const pace = dailyPace(500_000, now);
  noteMonthlyCommands(pace, 500_000, new Date(now).toISOString().slice(0, 7));
  noteDailyCommands(pace, localDay(now));
  return pace;
}

describe("daily pace of the shared store (SEC-3-03)", () => {
  it("is 90% of the month spread over its days: 14,516 a day in October, 15,000 in November", () => {
    const oct = Date.UTC(2026, 9, 6, 17);
    const nov = Date.UTC(2026, 10, 6, 17);
    expect(daysInMonth(oct)).toBe(31);
    expect(dailyPace(500_000, oct)).toBe(14_516);
    expect(dailyPace(500_000, nov)).toBe(15_000);
    // 31 days at the pace stay under the resting line.
    expect(dailyPace(500_000, oct) * 31).toBeLessThanOrEqual((500_000 * RESTING_PCT) / 100);
  });

  it("pauses only for the Chicago day it was counted on; unknown counters never pause", () => {
    const now = Date.UTC(2026, 9, 6, 17);
    expect(dailyPaceState(now).paced).toBe(false);
    noteMonthlyCommands(20_000, 500_000, "2026-10");
    noteDailyCommands(14_515, "2026-10-06");
    expect(dailyPaceState(now).paced).toBe(false);
    noteDailyCommands(14_516, "2026-10-06");
    const p = dailyPaceState(now);
    expect(p).toMatchObject({ paced: true, used: 14_516, pace: 14_516 });
    // Until Chicago midnight (12:00 CDT -> 12 h).
    expect(p.paced && p.retryAfter).toBe(12 * 3600);
    // The next Chicago day starts over.
    expect(dailyPaceState(Date.UTC(2026, 9, 7, 5, 0, 1)).paced).toBe(false);
  });

  it("new visitor passes answer the honest DAILY_LIMIT copy; the example parks and saved passes still work", async () => {
    vi.stubEnv("DO_INFERENCE_API_KEY", "test-key-not-real");
    vi.stubEnv("MODEL_BASE_URL", "");
    vi.stubEnv("MODEL_ID", "");
    const replay = passReplay();
    vi.stubGlobal("fetch", replay.fetchImpl);
    const store = new MemoryStore();

    // A saved pass made before the pace was reached.
    const made = await makePass({ parkId: PARKS.connemara.id, ageBand: "6-10" }, { ip: "4:early", store, reserved: true });
    if (made.kind !== "pass") throw new Error(`expected a pass, got ${made.kind}`);

    useTodaysPace();
    const calls = replay.calls.length;
    const visitor = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, { ip: "4:visitor", store });
    expect(visitor).toMatchObject({ kind: "error", status: 429, error: { code: "DAILY_LIMIT" } });
    if (visitor.kind === "error") {
      // Review MINOR-2: the store's daily pace is the storage service's share, not the AI budget, and nothing is "free" AI.
      expect(visitor.error.message).toMatch(/^New passes are paused for today: Grass Pass used today's share of its free storage service\. Passes made earlier still work\. It resets in /);
      expect(visitor.error.retryAfter).toBeGreaterThan(0);
    }
    expect(replay.calls.length).toBe(calls); // nothing upstream
    expect(lines.some((l) => l.event === "pass_paused_daily_pace")).toBe(true);

    // The same pass again is a cache hit, the saved pass page opens, and an example park is still made.
    const again = await makePass({ parkId: PARKS.connemara.id, ageBand: "6-10" }, { ip: "4:visitor", store });
    expect(again).toMatchObject({ kind: "pass", cached: true });
    resetPassMaking();
    expect(await loadPass(made.pass.id)).not.toBeNull();
    const example = await makePass({ parkId: PARKS.celebration.id, ageBand: "10-13" }, { ip: "4:judge", store, reserved: true });
    expect(example.kind).toBe("pass");
  });

  it("uncached park searches pause too; a cached search keeps working", async () => {
    vi.stubGlobal("fetch", osmReplay().fetchImpl);
    const store = new MemoryStore();
    const first = await searchParks({ kind: "text", q: "Allen TX" }, { ip: "4:a", store });
    expect(first.ok).toBe(true);

    useTodaysPace();
    const cached = await searchParks({ kind: "text", q: "Allen TX" }, { ip: "4:b", store });
    expect(cached.ok).toBe(true);
    const fresh = await searchParks({ kind: "text", q: "Plano TX" }, { ip: "4:b", store });
    expect(fresh).toMatchObject({ ok: false, status: 429, error: { code: "DAILY_LIMIT" } });
    if (!fresh.ok) expect(fresh.error.message).toMatch(/free limit for new park searches today \(for everyone\)\. It resets in .*Searches people already made still work\./);
  });
});

describe("the budget counters a new instance reads first, resting at 90% (SEC-3-04)", () => {
  function upstash(month: number, day: number) {
    const sent: unknown[][] = [];
    const s = new UpstashStore({
      url: "https://x.upstash.io",
      token: "t",
      monthlyBudget: 500_000,
      fetch: async (_u, init) => {
        const cmd = JSON.parse(String(init?.body)) as unknown[];
        sent.push(cmd);
        if (cmd[0] === "MGET") return Response.json({ result: [String(month), String(day)] });
        if (cmd[0] === "EVAL" && String(cmd[3]).includes("meta:commands")) {
          month += Number(cmd[5]);
          day += Number(cmd[5]);
          return Response.json({ result: [month, day] });
        }
        return Response.json({ result: null });
      },
    });
    return { s, sent };
  }

  it("RESTING_PCT is 90", () => {
    expect(RESTING_PCT).toBe(90);
  });

  it("prime() reads both counters with one MGET, once, and a new instance rests at once when the month is at 90%", async () => {
    const { s, sent } = upstash(450_000, 1_000);
    expect(restingState().resting).toBe(false);
    await s.prime();
    await s.prime();
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe("MGET");
    expect(String(sent[0][1])).toMatch(/^gp:meta:commands:\d{4}-\d{2}$/);
    expect(String(sent[0][2])).toMatch(/^gp:meta:commands-day:\d{4}-\d{2}-\d{2}$/);
    expect(restingState().resting).toBe(true);
  });

  it("a new instance knows at once that today's pace is used", async () => {
    const pace = dailyPace(500_000, Date.now());
    const { s } = upstash(pace, pace);
    await s.prime();
    expect(dailyPaceState().paced).toBe(true);
  });

  it("the flush every 10 commands updates both counters, and crossing the pace is logged once", async () => {
    const pace = dailyPace(500_000, Date.now());
    const { s, sent } = upstash(pace - 5, pace - 5);
    for (let i = 0; i < 10; i++) await s.get(`k${i}`);
    await new Promise((r) => setTimeout(r, 5));
    const flushes = sent.filter((c) => c[0] === "EVAL");
    expect(flushes).toHaveLength(1);
    expect(flushes[0][5]).toBe(11); // 10 commands + the flush itself
    expect(dailyPaceState().paced).toBe(true);
    expect(lines.filter((l) => l.event === "upstash_daily_pace")).toHaveLength(1);
  });

  it("makePass primes the store before deciding (a new instance never starts blind)", async () => {
    const store: Store = new MemoryStore();
    let primed = 0;
    store.prime = async () => {
      primed++;
      noteMonthlyCommands(460_000, 500_000, new Date().toISOString().slice(0, 7));
    };
    const out = await makePass({ parkId: PARKS.connemara.id, ageBand: "6-10" }, { ip: "4:x", store });
    expect(primed).toBe(1);
    expect(out).toMatchObject({ kind: "error", status: 503, error: { code: "RESTING" } });
  });
});

describe("background refreshes: per-request scope and a queue cap (SEC-3-06)", () => {
  const deps = () => ({ store: new MemoryStore(), env: {} });

  it("a request waits only for the refreshes it queued, not for ones other requests queued later", async () => {
    setBackgroundRefreshForTests(true);
    const d = deps();
    const done: string[] = [];
    const job = (name: string, ms: number) => async () => {
      await new Promise((r) => setTimeout(r, ms));
      done.push(name);
    };
    const mine = withRefreshScope(() => {
      refreshLater({ kind: "features", parkId: "way/1" }, job("mine", 20), d);
      return "ok";
    });
    expect(mine.result).toBe("ok");
    // Another request queues a slow one after it.
    refreshLater({ kind: "features", parkId: "way/2" }, job("theirs", 300), d);
    const t0 = Date.now();
    await mine.idle();
    expect(done).toEqual(["mine"]);
    expect(Date.now() - t0).toBeLessThan(250);
    await osmRefreshIdle();
    expect(done).toEqual(["mine", "theirs"]);
  });

  it("refreshes queued deep inside async work are still in the scope", async () => {
    setBackgroundRefreshForTests(true);
    const d = deps();
    let ran = false;
    const scoped = withRefreshScope(async () => {
      await new Promise((r) => setTimeout(r, 5));
      refreshLater({ kind: "geometry", parkId: "way/3" }, async () => void (ran = true), d);
    });
    await scoped.result;
    await scoped.idle();
    expect(ran).toBe(true);
  });

  it(`holds at most ${MAX_PENDING_REFRESHES} refreshes; the rest are dropped before taking a lock`, async () => {
    setBackgroundRefreshForTests(true);
    const d = deps();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const queued: (Promise<void> | null)[] = [];
    for (let i = 0; i < MAX_PENDING_REFRESHES + 5; i++) queued.push(refreshLater({ kind: "features", parkId: `way/${100 + i}` }, () => gate, d));
    expect(queued.filter((q) => q !== null)).toHaveLength(MAX_PENDING_REFRESHES);
    expect(lines.filter((l) => l.event === "osm_refresh_dropped")).toHaveLength(5);
    // A dropped park took no lock: it can be queued again once there is room.
    release();
    await osmRefreshIdle();
    expect(await d.store.get(`osm-refresh:features:way/${100 + MAX_PENDING_REFRESHES}`)).toBeNull();
    expect(refreshLater({ kind: "features", parkId: `way/${100 + MAX_PENDING_REFRESHES}` }, async () => undefined, d)).not.toBeNull();
    await osmRefreshIdle();
  });
});
