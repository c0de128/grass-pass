/**
 * SEC-2-01: what each request really costs in Upstash commands, measured by running the app's real
 * UpstashStore against a command-counting stand-in (tests/unit/support/counting-upstash.ts) with the
 * recorded upstream answers. The pre-limiter's COSTS and EXTRA (src/lib/limits/prelimit.ts) must be at
 * least these numbers, or the per-month math there would not hold.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getStore, resetStores } from "@/lib/cache/store";
import { resetMemo } from "@/lib/cache/memo";
import { setLogSink } from "@/lib/log";
import { COSTS, EXTRA } from "@/lib/limits/prelimit";
import { resetPassReads } from "@/lib/limits/pass-read";
import { loadPass, resetPassMaking } from "@/lib/pass/make";
import { resetParksSearch } from "@/lib/parks/search";
import { disableSavedOsmForTests, resetSavedOsm } from "@/lib/sources/osm-snapshot";
import { breakerName, overpassEndpoints } from "@/lib/sources/overpass";
import { EXAMPLE_PARKS } from "@/lib/prewarm";
import { resetBudget } from "@/lib/limits/budget";
import * as passRoute from "@/app/api/pass/route";
import * as parksRoute from "@/app/api/parks/route";
import { countingUpstash, FAKE_UPSTASH_TOKEN, FAKE_UPSTASH_URL } from "./support/counting-upstash";
import { osmReplay } from "./support/osm-replay";
import { PARKS, passReplay } from "./support/pass-replay";
import { judgeCookie, newAccountCookie, nextAccountCookie, primeAccountCookies } from "./support/session";
import * as reportRoute from "@/app/api/report/route";
import { forgetReportStats, passItemStats } from "@/lib/reports/stats";
import { signInRate } from "@/lib/accounts/signin-rate";
import { localDay } from "@/lib/time";
import { clientIp } from "@/lib/limits";
import { recordedSerp, serpBody, serpFixture, serpReplay } from "./support/serpapi-replay";
import { judgePassesResponse, meResponse } from "@/lib/accounts/endpoints";

beforeAll(() => primeAccountCookies(300));

/** Signed in as a new account each time (accounts: a new pass needs one; tests/unit/support/session.ts). */
const req = (path: string, body: unknown, ip: string) =>
  new Request(`http://localhost:3123${path}`, {
    method: "POST",
    headers: { cookie: nextAccountCookie(), host: "localhost:3123", "sec-fetch-site": "same-origin", "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
};

/** STORE_COST_REPORT=1 prints the measured numbers (README "Limits" and prelimit.ts quote them). */
const report = (label: string, n: number) => {
  if (process.env.STORE_COST_REPORT) console.log(`[store-cost] ${label}: ${n}`);
};

let up: ReturnType<typeof countingUpstash>;
let restoreLog: () => void;
beforeEach(() => {
  resetStores();
  resetMemo();
  resetPassReads();
  resetPassMaking();
  resetParksSearch();
  resetBudget();
  disableSavedOsmForTests();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", FAKE_UPSTASH_URL);
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", FAKE_UPSTASH_TOKEN);
  vi.stubEnv("DO_INFERENCE_API_KEY", "test-key-not-real");
  vi.stubEnv("MODEL_BASE_URL", "");
  vi.stubEnv("MODEL_ID", "");
  up = countingUpstash();
  restoreLog = setLogSink(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetSavedOsm();
  resetStores();
  restoreLog();
});

describe("Upstash commands per request (measured)", () => {
  it("a new pass, the same pass again, a refusal, and the saved-pass page read", async () => {
    vi.stubGlobal("fetch", up.fetchWith(passReplay().fetchImpl));
    const body = { parkId: PARKS.connemara.id, ageBand: "6-10" };

    let before = up.counts.total;
    const first = await passRoute.POST(req("/api/pass", body, "203.0.113.10"));
    const text = await first.text();
    await settle();
    const newPass = up.counts.total - before;
    expect(text).toContain('"type":"result"');
    // The cheap part is charged up front (COSTS.apiPass); the rest is bounded per IP per day.
    expect(newPass).toBeGreaterThan(0);
    expect(newPass).toBeLessThanOrEqual(COSTS.apiPass + EXTRA.newPass);
    report("new pass (Connemara, incl. budget bookkeeping)", newPass);

    before = up.counts.total;
    const again = await passRoute.POST(req("/api/pass", body, "203.0.113.11"));
    expect(await again.text()).toContain('"cached":true');
    expect(up.counts.total - before).toBeLessThanOrEqual(COSTS.apiPass);
    report("same pass again (cache hit)", up.counts.total - before);

    // A per-IP refusal: one EVAL, then none while the refusal is remembered.
    const ip = "203.0.113.12";
    for (let i = 0; i < 25; i++) await (await passRoute.POST(req("/api/pass", body, ip))).text();
    before = up.counts.total;
    const refused = await passRoute.POST(req("/api/pass", body, ip));
    expect(refused.status).toBe(429);
    expect(up.counts.total - before).toBeLessThanOrEqual(COSTS.apiPass);
    report("per-IP pass refusal", up.counts.total - before);

    // The saved-pass page: one GET the first time, none while it is memoized.
    const id = JSON.parse(text.trim().split("\n").at(-1)!).pass.id as string;
    resetPassReads();
    before = up.counts.total;
    expect(await loadPass(id)).not.toBeNull();
    expect(up.counts.total - before).toBeLessThanOrEqual(COSTS.passPage + 1); // + a possible budget flush
    before = up.counts.total;
    for (let i = 0; i < 10; i++) await loadPass(id);
    expect(up.counts.total - before).toBe(0);
    // An id that can't exist: no command at all.
    before = up.counts.total;
    expect(await loadPass("w123-6to10-20200101-1")).toBeNull();
    expect(await loadPass("w123-6to10-20261006-9")).toBeNull();
    expect(up.counts.total - before).toBe(0);
  });

  it("an uncached park search, the same search again, and a refusal", async () => {
    vi.stubGlobal("fetch", up.fetchWith(osmReplay().fetchImpl));
    let before = up.counts.total;
    const res = await parksRoute.POST(req("/api/parks", { q: "Allen TX" }, "198.51.100.20"));
    expect(res.status).toBe(200);
    await settle();
    const uncached = up.counts.total - before;
    expect(uncached).toBeLessThanOrEqual(COSTS.apiParks + EXTRA.search);
    report("uncached park search", uncached);

    before = up.counts.total;
    expect((await parksRoute.POST(req("/api/parks", { q: "Allen TX" }, "198.51.100.21"))).status).toBe(200);
    const cached = up.counts.total - before;
    expect(cached).toBeLessThanOrEqual(COSTS.apiParks);
    report("cached park search", cached);

    const ip = "198.51.100.22";
    for (let i = 0; i < 12; i++) await parksRoute.POST(req("/api/parks", { q: "Allen TX" }, ip));
    before = up.counts.total;
    expect((await parksRoute.POST(req("/api/parks", { q: "Allen TX" }, ip))).status).toBe(429);
    expect(up.counts.total - before).toBeLessThanOrEqual(COSTS.apiParks);
  });
});

/**
 * SEC-3-02: the cached-failure paths. Before the fix a negative-cached park cost 9 commands and a
 * cached "too heavy" one 14-15 (a reserve and its release, plus 4 example GETs every time). Now one MGET
 * reads every features cache and Overpass breaker before anything is reserved, and readyExample() is
 * memoized, so each is <= COSTS.apiPass and makes no reserve at all.
 */
/**
 * SEC-4-07: a new pass that also starts a fresh Lucky Finds lookup (SerpApi: 1 place search + up to 3
 * review searches, each with its caps, breaker and caches). Replayed from the live SerpApi recordings.
 * Celebration Park has every recording (a complete lookup). Connemara (the biggest test park: 25
 * iNaturalist taxa) has only its place recording; for the worst case (the biggest park AND a complete
 * lookup) its review searches are answered with Celebration's real dog-review recording. That only feeds
 * the command count here; no test checks Connemara's Lucky content.
 */
describe("a new pass with a fresh Lucky Finds lookup (SEC-4-07)", () => {
  const SERP_KEY = "fedcba9876543210".repeat(4);
  for (const park of ["celebration", "connemara"] as const) {
    it(`${park}: within COSTS.apiPass + EXTRA.newPass`, async () => {
      vi.stubEnv("SERPAPI_API_KEY", SERP_KEY);
      vi.stubEnv("SERPAPI_DAILY_CAP", "12");
      const stand = serpBody(serpFixture("google-maps-reviews-celebration-park-dog"));
      const serp = serpReplay({
        next: passReplay().fetchImpl,
        answer: (c) =>
          park === "connemara" && c.params.engine === "google_maps_reviews" && !recordedSerp(c.params)
            ? new Response(JSON.stringify(stand), { status: 200, headers: { "content-type": "application/json" } })
            : undefined,
      });
      vi.stubGlobal("fetch", up.fetchWith(serp.fetchImpl));
      await getStore("limits").prime?.();
      const before = up.work();
      const res = await passRoute.POST(req("/api/pass", { parkId: PARKS[park].id, ageBand: "6-10" }, `203.0.113.${park === "celebration" ? 80 : 81}`));
      expect(await res.text()).toContain('"type":"result"');
      await settle();
      const n = up.work() - before;
      expect(serp.calls.length).toBeGreaterThan(0); // the lookup really ran
      report(`new pass with a Lucky lookup (${park}, ${serp.calls.length} SerpApi searches)`, n);
      expect(n).toBeLessThanOrEqual(COSTS.apiPass + EXTRA.newPass);
    });
  }
});

describe("cached failures cost no more than COSTS.apiPass (SEC-3-02)", () => {
  const seed = (key: string, v: unknown) => up.mem.set(`gp:${key}`, JSON.stringify({ v, at: Date.now() }), 900);
  const reserves = () => [...up.counts.byCmd.entries()].filter(([k]) => k.startsWith("EVAL:local n = #KEYS")).reduce((n, [, c]) => n + c, 0);

  async function measure(parkId: string, ip: string): Promise<{ first: number; again: number[]; status: number; code: string }> {
    // The once-per-process counter read (SEC-3-04) is part of the instance-wide term, not this path.
    await getStore("limits").prime?.();
    let before = up.work();
    const res = await passRoute.POST(req("/api/pass", { parkId, ageBand: "6-10" }, ip));
    const body = (await res.json()) as { error: { code: string } };
    await settle();
    const first = up.work() - before;
    const again: number[] = [];
    for (let i = 0; i < 4; i++) {
      before = up.work();
      await (await passRoute.POST(req("/api/pass", { parkId, ageBand: "6-10" }, ip))).text();
      again.push(up.work() - before);
    }
    return { first, again, status: res.status, code: body.error.code };
  }

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      up.fetchWith(async (url) => {
        throw new Error(`no upstream call expected on a cached failure: ${url}`);
      }),
    );
  });

  it("not a park (negative cache): 4 commands, no reserve, no upstream", async () => {
    await seed("c:park-features-neg:way/900000001", { none: true });
    const r0 = reserves();
    const m = await measure("way/900000001", "203.0.113.40");
    expect([m.status, m.code]).toEqual([404, "NOT_A_PARK"]);
    report("cached NOT_A_PARK", Math.max(m.first, ...m.again));
    for (const n of [m.first, ...m.again]) expect(n).toBeLessThanOrEqual(COSTS.apiPass);
    expect(reserves()).toBe(r0);
  });

  it("too heavy (heavy cache, no saved answer): 4 commands after the first; the example offer is memoized", async () => {
    await seed("c:park-heavy:way/900000002", true);
    const r0 = reserves();
    const m = await measure("way/900000002", "203.0.113.41");
    expect([m.status, m.code]).toEqual([503, "PARK_TOO_BIG"]);
    // The first map-data failure of this process also looks for a ready example (4 GETs, then memoized
    // READY_EXAMPLE_MEMO_MS: the instance-wide term of the math in prelimit.ts).
    expect(m.first).toBeLessThanOrEqual(COSTS.apiPass + EXAMPLE_PARKS.length);
    report("cached PARK_TOO_BIG (first in process, with example lookup)", m.first);
    report("cached PARK_TOO_BIG (after)", Math.max(...m.again));
    for (const n of m.again) expect(n).toBeLessThanOrEqual(COSTS.apiPass);
    expect(reserves()).toBe(r0);
  });

  it("too slow (slow cache, no saved answer) and every Overpass mirror resting: 4 commands each, no reserve", async () => {
    await seed("c:park-slow:way/900000003", true);
    const r0 = reserves();
    const slow = await measure("way/900000003", "203.0.113.42");
    expect([slow.status, slow.code]).toEqual([503, "OSM_UNAVAILABLE"]);
    for (const n of slow.again) expect(n).toBeLessThanOrEqual(COSTS.apiPass);
    report("cached slow (after)", Math.max(...slow.again));

    const until = String(Date.now() + 120_000);
    for (const e of overpassEndpoints({})) await up.mem.set(`gp:br:${breakerName(e)}`, until, 120);
    const open = await measure("way/900000004", "203.0.113.43");
    expect([open.status, open.code]).toEqual([503, "OSM_UNAVAILABLE"]);
    for (const n of open.again) expect(n).toBeLessThanOrEqual(COSTS.apiPass);
    report("every Overpass breaker open (after)", Math.max(...open.again));
    expect(reserves()).toBe(r0);
  });

  it("a new instance reads the shared counters once (1 MGET), then never again", async () => {
    const before = up.counts.total;
    await getStore("limits").prime?.();
    await getStore("limits").prime?.();
    expect(up.counts.total - before).toBe(1);
    expect([...up.counts.byCmd.keys()].some((k) => k.startsWith("MGET gp:meta:commands:"))).toBe(true);
  });
});

/**
 * Accounts (2026-10-06): the new paths and what they cost. A signed-out new-pass request and an account
 * over its 2 a day stay within COSTS.apiPass; a report within COSTS.apiReport (a hidden item adds its
 * counter); a signed-in pass page within COSTS.passPage + COSTS.passStats; a sign-in attempt COSTS.apiAuth.
 */
describe("accounts: Upstash commands per request (measured)", () => {
  const reqAs = (path: string, body: unknown, ip: string, cookie: string | null) =>
    new Request(`http://localhost:3123${path}`, {
      method: "POST",
      headers: {
        ...(cookie ? { cookie } : {}),
        host: "localhost:3123",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify(body),
    });

  beforeEach(() => forgetReportStats());

  it("signed out: a new pass is refused (401) after <= COSTS.apiPass commands and no upstream call", async () => {
    vi.stubGlobal("fetch", up.fetchWith(async (url) => {
      throw new Error(`no upstream call expected: ${url}`);
    }));
    await getStore("limits").prime?.();
    const before = up.work();
    const res = await passRoute.POST(reqAs("/api/pass", { parkId: PARKS.connemara.id, ageBand: "6-10" }, "203.0.113.60", null));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("SIGN_IN_REQUIRED");
    report("signed-out new pass (401)", up.work() - before);
    expect(up.work() - before).toBeLessThanOrEqual(COSTS.apiPass);
  });

  it("an account over its 2 a day: refused (429) within COSTS.apiPass", async () => {
    vi.stubGlobal("fetch", up.fetchWith(async (url) => {
      throw new Error(`no upstream call expected: ${url}`);
    }));
    const a = await newAccountCookie();
    await up.mem.set(`gp:q:{acct-new:${localDay(Date.now())}}:k:${a.key}`, "2", 3600);
    await getStore("limits").prime?.();
    let before = up.work();
    const res = await passRoute.POST(reqAs("/api/pass", { parkId: PARKS.connemara.id, ageBand: "6-10" }, "203.0.113.61", a.cookie));
    const body = (await res.json()) as { error: { code: string } };
    expect([res.status, body.error.code]).toEqual([429, "ACCOUNT_DAILY_LIMIT"]);
    const first = up.work() - before;
    report("account over its 2 a day (first)", first);
    before = up.work();
    await (await passRoute.POST(reqAs("/api/pass", { parkId: PARKS.connemara.id, ageBand: "6-10" }, "203.0.113.61", a.cookie))).text();
    const again = up.work() - before;
    report("account over its 2 a day (again)", again);
    expect(first).toBeLessThanOrEqual(COSTS.apiPass);
    expect(again).toBeLessThanOrEqual(COSTS.apiPass);
  });

  it("reports: counted, a repeat, and a not-safe that hides the item; the signed-in pass page stats read", async () => {
    vi.stubGlobal("fetch", up.fetchWith(passReplay().fetchImpl));
    const made = await passRoute.POST(req("/api/pass", { parkId: PARKS.connemara.id, ageBand: "6-10" }, "203.0.113.62"));
    const pass = JSON.parse((await made.text()).trim().split("\n").at(-1)!).pass as { id: string; items: { ref?: string }[] };
    await settle();
    const ref = pass.items.find((i) => i.ref)!.ref!;
    const send = (cookie: string, kind: string, ip: string) => reportRoute.POST(reqAs("/api/report", { passId: pass.id, ref, kind }, ip, cookie));

    const a = await newAccountCookie();
    let before = up.work();
    expect(((await (await send(a.cookie, "found", "203.0.113.63")).json()) as { status: string }).status).toBe("counted");
    const counted = up.work() - before;
    report("report counted", counted);
    expect(counted).toBeLessThanOrEqual(COSTS.apiReport);

    before = up.work();
    expect(((await (await send(a.cookie, "notfound", "203.0.113.63")).json()) as { status: string }).status).toBe("duplicate");
    report("report repeat (same day)", up.work() - before);
    expect(up.work() - before).toBeLessThanOrEqual(COSTS.apiReport);

    const b = await newAccountCookie();
    const c = await newAccountCookie();
    await send(b.cookie, "unsafe", "203.0.113.64");
    before = up.work();
    expect((await send(c.cookie, "unsafe", "203.0.113.65")).status).toBe(200);
    const hid = up.work() - before;
    report("report not safe that hides the item", hid);
    expect(hid).toBeLessThanOrEqual(COSTS.apiReport);

    // Signed-in pass page: the pass read (memoized) + 1 HGETALL, then 0 while memoized.
    resetPassReads();
    forgetReportStats();
    before = up.work();
    const loaded = await loadPass(pass.id);
    const stats = await passItemStats(loaded!);
    expect(stats[ref]).toEqual({ found: 1, notFound: 0 });
    report("signed-in pass page (pass + report counts)", up.work() - before);
    expect(up.work() - before).toBeLessThanOrEqual(COSTS.passPage + COSTS.passStats);
    before = up.work();
    for (let i = 0; i < 5; i++) await passItemStats((await loadPass(pass.id))!);
    expect(up.work() - before).toBe(0);
  });

  it("the judge demo: a new pass counts against the shared cap with one reserve", async () => {
    vi.stubGlobal("fetch", up.fetchWith(passReplay().fetchImpl));
    const j = await judgeCookie();
    await getStore("limits").prime?.();
    const before = up.work();
    const res = await passRoute.POST(reqAs("/api/pass", { parkId: PARKS.connemara.id, ageBand: "10-13" }, "203.0.113.66", j.cookie));
    expect(await res.text()).toContain('"type":"result"');
    await settle();
    report("judge new pass", up.work() - before);
    expect(up.work() - before).toBeLessThanOrEqual(COSTS.apiPass + EXTRA.newPass);
    expect(Number(await up.mem.get(`gp:q:{judge-new:${localDay(Date.now())}}:all`))).toBe(1);
  });

  it("SEC-4-02: a judge over its 3 per connection is refused within COSTS.apiPass; the card's count costs COSTS.apiJudgePasses; /api/me costs 0", async () => {
    vi.stubGlobal("fetch", up.fetchWith(async (url) => {
      throw new Error(`no upstream call expected: ${url}`);
    }));
    const j = await judgeCookie();
    const ip = "203.0.113.68";
    const key = clientIp(new Request("http://x/", { headers: { "x-forwarded-for": ip } }));
    await up.mem.set(`gp:q:{judge-new:${localDay(Date.now())}}:k:${key}`, "3", 3600);
    await getStore("limits").prime?.();
    let before = up.work();
    const res = await passRoute.POST(reqAs("/api/pass", { parkId: PARKS.connemara.id, ageBand: "6-10" }, ip, j.cookie));
    const body = (await res.json()) as { error: { code: string } };
    expect([res.status, body.error.code]).toEqual([429, "JUDGE_DAILY_LIMIT"]);
    report("judge over its 3 per connection", up.work() - before);
    expect(up.work() - before).toBeLessThanOrEqual(COSTS.apiPass);

    before = up.work();
    const left = await judgePassesResponse(new Request("http://localhost:3123/api/judge-passes", { headers: { "x-forwarded-for": ip } }));
    expect(await left.json()).toMatchObject({ leftForYou: 0 });
    report("GET /api/judge-passes", up.work() - before);
    expect(up.work() - before).toBeLessThanOrEqual(COSTS.apiJudgePasses);

    before = up.work();
    await meResponse(new Request("http://localhost:3123/api/me", { headers: { cookie: j.cookie } }));
    expect(up.work() - before).toBe(COSTS.apiMe);
  });

  it("SEC-4-01: a judge report costs within COSTS.apiReport (one dedupe INCR, no report EVAL)", async () => {
    vi.stubGlobal("fetch", up.fetchWith(passReplay().fetchImpl));
    const made = await passRoute.POST(req("/api/pass", { parkId: PARKS.connemara.id, ageBand: "6-10" }, "203.0.113.69"));
    const pass = JSON.parse((await made.text()).trim().split("\n").at(-1)!).pass as { id: string; items: { ref?: string }[] };
    await settle();
    const ref = pass.items.find((i) => i.ref)!.ref!;
    const j = await judgeCookie();
    const before = up.work();
    const res = await reportRoute.POST(reqAs("/api/report", { passId: pass.id, ref, kind: "notfound" }, "203.0.113.70", j.cookie));
    expect(((await res.json()) as { status: string }).status).toBe("logged");
    report("judge report (logged)", up.work() - before);
    expect(up.work() - before).toBeLessThanOrEqual(COSTS.apiReport);
  });

  it("a sign-in attempt: 1 command, then none while a refusal is remembered", async () => {
    vi.stubGlobal("fetch", up.fetchWith(async (url) => {
      throw new Error(`no upstream call expected: ${url}`);
    }));
    const r = new Request("http://localhost:3123/api/auth/callback/github", { headers: { "x-forwarded-for": "203.0.113.67" } });
    await getStore("limits").prime?.();
    let before = up.work();
    expect((await signInRate(r)).ok).toBe(true);
    expect(up.work() - before).toBeLessThanOrEqual(COSTS.apiAuth);
    for (let i = 0; i < 25; i++) await signInRate(r);
    before = up.work();
    expect((await signInRate(r)).ok).toBe(false);
    expect(up.work() - before).toBe(0);
  });
});
