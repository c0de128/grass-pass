/**
 * Pass limits and pass feedback (Kevin, 2026-10-08):
 * - signed out: 1 free new pass per Chicago day, counted by an httpOnly, SameSite=Lax, HMAC-signed cookie (date + count,
 *   no id) that is set ONLY when the free pass is charged and expires at the next Chicago midnight; a forged, edited,
 *   other-day or missing cookie means 0 used; ANON_PASSES_PER_IP_PER_DAY (default 3) backs it up per connection;
 * - signed in: 5 a day (ACCOUNT_DAILY_PASSES; tests/unit/accounts.test.ts);
 * - a pass already made today is free for anyone; a park without enough data never uses the free pass;
 * - feedback: 1-5 stars + tags, no free text, signed in only, one per account per pass (latest wins), per-park reporter
 *   id, 90 days, the judge demo logged only.
 * Every upstream answer is a recorded fixture (support/pass-replay.ts); no real model or SerpApi call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as route from "@/app/api/pass/route";
import * as feedbackRoute from "@/app/api/feedback/route";
import * as freePassRoute from "@/app/api/free-pass/route";
import * as passesLeftRoute from "@/app/api/passes-left/route";
import { anonIpLimitCopy, freePassRule, freePassUsedCopy, signInNextCopy } from "@/lib/accounts/config";
import { reporterId } from "@/lib/accounts/key";
import { getStore, MemoryStore, resetStores } from "@/lib/cache/store";
import { clientIp, quotaUsage } from "@/lib/limits";
import {
  FREE_PASS_COOKIES,
  freePassesUsed,
  freePassSetCookie,
  isHttps,
  signFreePass,
  verifyFreePass,
} from "@/lib/limits/free-pass";
import { requestCost, COSTS } from "@/lib/limits/prelimit";
import { setLogSink } from "@/lib/log";
import { makePass, resetPassMaking } from "@/lib/pass/make";
import { PassErrorResponseSchema, PassLineSchema, type PassLine } from "@/lib/pass/schema";
import { resetPassReads } from "@/lib/limits/pass-read";
import { disableSavedOsmForTests, resetSavedOsm } from "@/lib/sources/osm-snapshot";
import { localDay, secondsUntilLocalMidnight } from "@/lib/time";
import {
  FEEDBACK_COPY,
  FEEDBACK_KEEP_DAYS,
  FEEDBACK_TAGS,
  feedbackFromHash,
  feedbackKeys,
  feedbackReport,
  FeedbackRequestSchema,
  recordFeedback,
  summarizeFeedback,
  tagMask,
  tagsOf,
} from "@/lib/feedback";
import { formatFeedbackReport, NO_RATINGS_REPORT } from "@/lib/feedback/report";
import { accountLeftLine, freeLeftLine, signInPromptFor } from "@/components/account/PassesLeft";
import { PARKS, passReplay } from "./support/pass-replay";
import { judgeCookie, newAccountCookie, TEST_AUTH_SECRET } from "./support/session";
import { serpReplay } from "./support/serpapi-replay";

const ENV = { AUTH_SECRET: TEST_AUTH_SECRET };
/** 2026-10-08 20:00 CDT (01:00 UTC on Oct 9): 4 hours to Chicago midnight. */
const EVENING = Date.UTC(2026, 9, 9, 1, 0, 0);

describe("the free-pass cookie: signed, date + count only, expires at Chicago midnight", () => {
  it("round-trips today's count, and holds nothing but the day, the count and the signature", () => {
    const v = signFreePass(1, EVENING, ENV);
    expect(v).toMatch(/^v1\.20261008\.1\.[A-Za-z0-9_-]{43}$/);
    expect(verifyFreePass(v, EVENING, ENV)).toBe(1);
    expect(verifyFreePass(signFreePass(0, EVENING, ENV), EVENING, ENV)).toBe(0);
  });

  it("a forged, edited, other-secret, other-day, malformed or oversized value means 0 used (null)", () => {
    const v = signFreePass(1, EVENING, ENV);
    const [ver, day, , sig] = v.split(".");
    // Edited count (the signature no longer matches).
    expect(verifyFreePass(`${ver}.${day}.0.${sig}`, EVENING, ENV)).toBeNull();
    // A made-up signature of the right shape.
    expect(verifyFreePass(`${ver}.${day}.1.${"A".repeat(43)}`, EVENING, ENV)).toBeNull();
    // Signed with another secret.
    expect(verifyFreePass(signFreePass(1, EVENING, { AUTH_SECRET: `${TEST_AUTH_SECRET}-other` }), EVENING, ENV)).toBeNull();
    // Yesterday's cookie (and tomorrow's) is not today's.
    expect(verifyFreePass(v, EVENING + 5 * 3600_000, ENV)).toBeNull();
    expect(verifyFreePass(signFreePass(1, EVENING - 24 * 3600_000, ENV), EVENING, ENV)).toBeNull();
    for (const bad of ["", "v1", "v2.20261008.1." + sig, `${v}x`, "x".repeat(500), `${ver}.${day}.100.${sig}`]) expect(verifyFreePass(bad, EVENING, ENV)).toBeNull();
    expect(verifyFreePass(null, EVENING, ENV)).toBeNull();
  });

  it("reads either cookie name from a Cookie header, the highest valid count wins, junk counts as 0", () => {
    const one = signFreePass(1, EVENING, ENV);
    expect(freePassesUsed(null, EVENING, ENV)).toBe(0);
    expect(freePassesUsed(`${FREE_PASS_COOKIES[1]}=${one}`, EVENING, ENV)).toBe(1);
    expect(freePassesUsed(`a=b; ${FREE_PASS_COOKIES[0]}=${one}; c=d`, EVENING, ENV)).toBe(1);
    expect(freePassesUsed(`${FREE_PASS_COOKIES[1]}=v1.20261008.5.${"A".repeat(43)}`, EVENING, ENV)).toBe(0);
    expect(freePassesUsed(`${FREE_PASS_COOKIES[1]}=${signFreePass(0, EVENING, ENV)}; ${FREE_PASS_COOKIES[0]}=${one}`, EVENING, ENV)).toBe(1);
  });

  it("works without sign-in set up too (the key then comes from the limiter secret)", () => {
    const env = { LIMITER_KEY_SECRET: "limiter-secret-for-tests-0123456789" };
    const v = signFreePass(1, EVENING, env);
    expect(verifyFreePass(v, EVENING, env)).toBe(1);
    expect(verifyFreePass(v, EVENING, ENV)).toBeNull();
  });

  it("Set-Cookie: httpOnly, SameSite=Lax, Path=/, Secure + __Host- on https only, gone at the next Chicago midnight", () => {
    const v = signFreePass(1, EVENING, ENV);
    const http = freePassSetCookie(v, EVENING, false);
    expect(http).toBe(`gp-free=${v}; Path=/; Max-Age=14400; Expires=Fri, 09 Oct 2026 05:00:00 GMT; HttpOnly; SameSite=Lax`);
    const https = freePassSetCookie(v, EVENING, true);
    expect(https.startsWith(`__Host-gp-free=${v}; Path=/; Max-Age=14400;`)).toBe(true);
    expect(https).toMatch(/; HttpOnly; SameSite=Lax; Secure$/);
    expect(https).not.toMatch(/Domain=/i);
    // Just before midnight: a few seconds. Midnight itself is a new day (the old cookie no longer counts).
    const late = Date.UTC(2026, 9, 9, 4, 59, 50);
    expect(freePassSetCookie(v, late, false)).toContain("Max-Age=10;");
    expect(secondsUntilLocalMidnight(EVENING)).toBe(14400);
  });

  it("https is read from x-forwarded-proto (Vercel), else the URL", () => {
    expect(isHttps(new Request("http://localhost/x"))).toBe(false);
    expect(isHttps(new Request("https://grass-pass.example/x"))).toBe(true);
    expect(isHttps(new Request("http://x/", { headers: { "x-forwarded-proto": "https" } }))).toBe(true);
  });
});

// ---------- through POST /api/pass (recorded upstream answers only) ----------

let n = 0;
const nextIp = () => `198.19.0.${(++n % 250) + 1}`;
const headers = (cookie: string | null, ip: string) => ({
  ...(cookie ? { cookie } : {}),
  host: "localhost:3123",
  origin: "http://localhost:3123",
  "sec-fetch-site": "same-origin",
  "content-type": "application/json",
  "x-forwarded-for": ip,
});
const post = (path: string, body: unknown, cookie: string | null, ip = nextIp()) =>
  new Request(`http://localhost:3123${path}`, { method: "POST", headers: headers(cookie, ip), body: JSON.stringify(body) });
const get = (path: string, cookie: string | null, ip = nextIp()) => new Request(`http://localhost:3123${path}`, { headers: headers(cookie, ip) });

type Out = { status: number; code?: string; line?: PassLine; free?: { left: number; receipt?: string }; setCookie: string | null };
async function outcome(res: Response): Promise<Out> {
  const setCookie = res.headers.get("set-cookie");
  if ((res.headers.get("content-type") ?? "").includes("ndjson")) {
    const ls = (await res.text())
      .trim()
      .split("\n")
      .map((l) => PassLineSchema.parse(JSON.parse(l)));
    const last = ls[ls.length - 1];
    const free = last.type === "result" || last.type === "error" ? last.free : undefined;
    return { status: res.status, line: last, free, setCookie, ...(last.type === "error" ? { code: last.error.code } : {}) };
  }
  const e = PassErrorResponseSchema.parse(await res.json());
  return { status: res.status, code: e.error.code, free: e.free, setCookie };
}

const connemara = { parkId: PARKS.connemara.id, ageBand: "6-10" as const };
const cookieOf = (setCookie: string) => setCookie.split(";")[0];
const anonUsage = async (ip: string) =>
  (await quotaUsage(getStore("limits"), { name: "anon-new", key: clientIp(new Request("http://x/", { headers: { "x-forwarded-for": ip } })), period: { kind: "day" }, now: Date.now() })).key;

describe("POST /api/pass signed out: 1 free pass a day", () => {
  let replay: ReturnType<typeof passReplay>;
  let restoreLog: () => void;
  let logs: string[];
  beforeEach(() => {
    resetStores();
    resetPassMaking();
    resetPassReads();
    disableSavedOsmForTests();
    replay = passReplay();
    vi.stubGlobal("fetch", replay.fetchImpl);
    vi.stubEnv("DO_INFERENCE_API_KEY", "test-key-not-real");
    vi.stubEnv("MODEL_BASE_URL", "");
    vi.stubEnv("MODEL_ID", "");
    vi.stubEnv("PASS_PER_IP_PER_MIN", "20");
    logs = [];
    restoreLog = setLogSink((_l, line) => logs.push(line));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetSavedOsm();
    restoreLog();
  });

  it("no cookie: the free pass is made, charged once, and its signed receipt sets the cookie; the 2nd new pass is refused with no upstream call", async () => {
    const ip = nextIp();
    const first = await outcome(await route.POST(post("/api/pass", connemara, null, ip)));
    expect(first.line?.type).toBe("result");
    expect(first.setCookie).toBeNull(); // the stream had started: the cookie travels as a receipt
    expect(first.free?.left).toBe(0);
    expect(verifyFreePass(first.free?.receipt, Date.now())).toBe(1);
    expect(await anonUsage(ip)).toBe(1);

    // The page posts the receipt back; the server sets the httpOnly cookie.
    const res = await freePassRoute.POST(post("/api/free-pass", { receipt: first.free!.receipt }, null, ip));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ left: 0 });
    const set = res.headers.get("set-cookie")!;
    expect(set).toMatch(/^gp-free=v1\.\d{8}\.1\./);
    expect(set).toMatch(/HttpOnly; SameSite=Lax$/);

    // Another park, same browser: refused before any upstream call, with the friendly copy.
    const calls = replay.calls.length;
    const second = await outcome(await route.POST(post("/api/pass", { parkId: PARKS.celebration.id, ageBand: "6-10" }, cookieOf(set), ip)));
    expect([second.status, second.code]).toEqual([429, "FREE_PASS_USED"]);
    expect(replay.calls.length).toBe(calls);
    expect(second.setCookie).toBeNull();
    expect(freePassUsedCopy()).toBe("You used today's free pass. Press Try as a judge to keep going. Saved passes and examples still work.");
  });

  it("a forged or edited cookie counts as 0 used (the free pass still works)", async () => {
    const forged = `${FREE_PASS_COOKIES[1]}=v1.${localDay(Date.now()).replace(/-/g, "")}.0.${"B".repeat(43)}`;
    const o = await outcome(await route.POST(post("/api/pass", connemara, forged)));
    expect(o.line?.type).toBe("result");
    expect(o.free?.left).toBe(0);
  });

  it("today's saved pass for that park + age is served to anyone, free: no charge, no cookie, no receipt", async () => {
    const a = await newAccountCookie();
    expect((await outcome(await route.POST(post("/api/pass", connemara, a.cookie)))).line?.type).toBe("result");
    const ip = nextIp();
    const calls = replay.calls.length;
    const again = await outcome(await route.POST(post("/api/pass", connemara, null, ip)));
    expect(again.line?.type === "result" && again.line.cached).toBe(true);
    expect([again.free, again.setCookie]).toEqual([undefined, null]);
    expect(replay.calls.length).toBe(calls);
    expect(await anonUsage(ip)).toBe(0);
    // Even with today's free pass already used.
    const used = `${FREE_PASS_COOKIES[1]}=${signFreePass(1, Date.now())}`;
    const cached = await outcome(await route.POST(post("/api/pass", connemara, used)));
    expect(cached.line?.type === "result" && cached.line.cached).toBe(true);
  });

  it("a park without enough real data never uses the free pass (no receipt, the connection's count goes back)", async () => {
    const base = passReplay();
    const serp = serpReplay({
      next: async (url, init) => (new URL(url).host === "api.inaturalist.org" ? new Response("busy", { status: 503 }) : base.fetchImpl(url, init)),
    });
    let charged = 0;
    const ip = "192.0.2.77";
    const out = await makePass(connemara, {
      ip,
      fetchImpl: serp.fetchImpl,
      modelFetch: base.fetchImpl,
      env: { ...ENV, DO_INFERENCE_API_KEY: "test-key-not-real" },
      requireAccount: true,
      account: null,
      freePass: { used: 0, onCharged: () => charged++ },
    });
    expect(out.kind).toBe("empty");
    expect(charged).toBe(0);
    expect(await anonUsage(ip)).toBe(0);
  });

  it("a model failure after the paid call started DOES use it (the same rule as an account's pass)", async () => {
    const r = passReplay({ model: () => new Response("busy", { status: 503 }) });
    vi.stubGlobal("fetch", r.fetchImpl);
    const o = await outcome(await route.POST(post("/api/pass", connemara, null)));
    expect(o.code).toMatch(/^MODEL_/);
    expect(verifyFreePass(o.free?.receipt, Date.now())).toBe(1);
  });

  it("ANON_PASSES_PER_IP_PER_DAY (default 3): clearing cookies can't drain the model credit", async () => {
    const ip = nextIp();
    const parks = [connemara, { ...connemara, ageBand: "4-6" as const }, { ...connemara, ageBand: "10-13" as const }];
    for (const p of parks) expect((await outcome(await route.POST(post("/api/pass", p, null, ip)))).line?.type).toBe("result");
    expect(await anonUsage(ip)).toBe(3);
    const calls = replay.calls.length;
    const fourth = await outcome(await route.POST(post("/api/pass", { parkId: PARKS.celebration.id, ageBand: "6-10" }, null, ip)));
    expect([fourth.status, fourth.code]).toEqual([429, "ANON_IP_DAILY_LIMIT"]);
    expect(replay.calls.length).toBe(calls);
    expect(anonIpLimitCopy()).toContain("This internet connection has used its free passes for today.");
    // Another connection still gets its free pass; a signed-in account on this one is not affected.
    expect((await outcome(await route.POST(post("/api/pass", { parkId: PARKS.celebration.id, ageBand: "6-10" }, null)))).line?.type).toBe("result");
    const a = await newAccountCookie();
    expect((await outcome(await route.POST(post("/api/pass", { parkId: PARKS.celebration.id, ageBand: "4-6" }, a.cookie, ip)))).line?.type).toBe("result");
  });

  it("the env value is read: ANON_PASSES_PER_IP_PER_DAY=1", async () => {
    vi.stubEnv("ANON_PASSES_PER_IP_PER_DAY", "1");
    const ip = nextIp();
    expect((await outcome(await route.POST(post("/api/pass", connemara, null, ip)))).line?.type).toBe("result");
    const o = await outcome(await route.POST(post("/api/pass", { ...connemara, ageBand: "4-6" }, null, ip)));
    expect(o.code).toBe("ANON_IP_DAILY_LIMIT");
  });

  it("every other backstop still applies to a free pass: AI_DAILY_CAP refuses before any upstream call and nothing is charged", async () => {
    vi.stubEnv("AI_DAILY_CAP", "1");
    vi.stubEnv("AI_RESERVE_PCT", "0");
    await getStore("limits").set(`q:{ai-calls:${localDay(Date.now())}}:all`, "1", 3600);
    const ip = nextIp();
    const o = await outcome(await route.POST(post("/api/pass", connemara, null, ip)));
    expect([o.status, o.code, o.free]).toEqual([429, "DAILY_LIMIT", undefined]);
    expect(replay.calls).toHaveLength(0);
    expect(await anonUsage(ip)).toBe(0);
  });

  it("joining an identical build that is already running is not charged twice", async () => {
    const ip = nextIp();
    const [a, b] = await Promise.all([route.POST(post("/api/pass", connemara, null, ip)), route.POST(post("/api/pass", connemara, null, ip))]);
    const outs = await Promise.all([outcome(a), outcome(b)]);
    expect(outs.every((o) => o.line?.type === "result")).toBe(true);
    expect(outs.filter((o) => o.free).length).toBe(1);
    expect(await anonUsage(ip)).toBe(1);
  });
});

describe("POST /api/free-pass and GET /api/passes-left", () => {
  beforeEach(() => resetStores());

  it("a receipt that isn't a valid value for today sets no cookie (400); a lower count never lowers the cookie", async () => {
    const bad = await freePassRoute.POST(post("/api/free-pass", { receipt: `v1.20261008.1.${"C".repeat(43)}` }, null));
    expect([bad.status, bad.headers.get("set-cookie")]).toEqual([400, null]);
    const one = signFreePass(1, Date.now());
    const lower = await freePassRoute.POST(post("/api/free-pass", { receipt: signFreePass(0, Date.now()) }, `gp-free=${one}`));
    expect([lower.status, lower.headers.get("set-cookie")]).toEqual([200, null]);
    // Other fields, another site, or not JSON: refused by the shared guards.
    expect((await freePassRoute.POST(post("/api/free-pass", { nope: 1 }, null))).status).toBe(400);
    const cross = new Request("http://localhost:3123/api/free-pass", { method: "POST", headers: { ...headers(null, nextIp()), origin: "https://evil.test", "sec-fetch-site": "cross-site" }, body: JSON.stringify({ receipt: one }) });
    expect((await freePassRoute.POST(cross)).status).toBe(403);
  });

  it("on https the cookie is Secure with the __Host- name", async () => {
    const req = new Request("https://grass-pass.example/api/free-pass", {
      method: "POST",
      headers: { host: "grass-pass.example", origin: "https://grass-pass.example", "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify({ receipt: signFreePass(1, Date.now()) }),
    });
    const res = await freePassRoute.POST(req);
    expect(res.headers.get("set-cookie")).toMatch(/^__Host-gp-free=.+; HttpOnly; SameSite=Lax; Secure$/);
  });

  it("signed out: the free passes left from the cookie, and never a Set-Cookie (browsing sets no cookie)", async () => {
    const res = await passesLeftRoute.GET(get("/api/passes-left", null));
    expect(await res.json()).toEqual({ kind: "free", free: 1, left: 1, perDay: 5 });
    expect(res.headers.get("set-cookie")).toBeNull();
    const used = await passesLeftRoute.GET(get("/api/passes-left", `gp-free=${signFreePass(1, Date.now())}`));
    expect(await used.json()).toEqual({ kind: "free", free: 1, left: 0, perDay: 5 });
  });

  it("signed in: the account's real counter; the judge demo: its shared pool", async () => {
    const a = await newAccountCookie();
    await getStore("limits").set(`q:{acct-new:${localDay(Date.now())}}:k:${a.key}`, "2", 3600);
    expect(await (await passesLeftRoute.GET(get("/api/passes-left", a.cookie))).json()).toEqual({ kind: "account", perDay: 5, left: 3 });
    const j = await judgeCookie();
    const body = (await (await passesLeftRoute.GET(get("/api/passes-left", j.cookie))).json()) as { kind: string; cap: number };
    expect(body.kind).toBe("judge");
    expect(body.cap).toBe(60);
  });

  it("the pre-limiter charges each new path its measured store cost", () => {
    expect(requestCost("/api/passes-left", Date.now()).cost).toBe(COSTS.apiPassesLeft);
    expect(requestCost("/api/free-pass", Date.now()).cost).toBe(0);
    expect(requestCost("/api/feedback", Date.now()).cost).toBe(COSTS.apiFeedback);
  });
});

describe("the wizard's words", () => {
  const options = { configured: true, providers: ["github" as const], judge: true, perDay: 5, free: 1 };
  it("passes left, and the friendly step once the free pass is used (only buttons that exist)", () => {
    expect(freeLeftLine(1, 5)).toBe("No sign-in needed: you have 1 free pass left today. A grown-up who signs in gets 5 new passes a day.");
    expect(accountLeftLine(4, 5)).toBe("You have 4 of 5 new passes left today.");
    expect(accountLeftLine(0, 5)).toBe("You used your 5 new passes for today. You get 5 more after midnight Dallas time.");
    expect(signInPromptFor({ options, signedIn: false, code: null, what: "this pass" })).toEqual({
      heading: "You used today's free pass",
      lead: "Sign in for 5 new passes a day, or press Try as a judge. Saved passes and examples still work, and your free pass comes back after midnight Dallas time.",
    });
    expect(signInPromptFor({ options: { ...options, providers: [] }, signedIn: false, code: "ANON_IP_DAILY_LIMIT", what: "this pass" }).heading).toBe(
      "This connection's free passes are used for today",
    );
    expect(signInPromptFor({ options, signedIn: true, code: "SIGN_IN_REQUIRED", what: "a different pass" })).toEqual({ heading: "Please sign in again to make a different pass" });
    expect(signInPromptFor({ options: { ...options, free: 0 }, signedIn: false, code: null, what: "this pass" })).toEqual({ heading: "Sign in to make this pass" });
    expect(freePassRule(1, 5)).toBe("Without signing in you get 1 free new pass a day; a grown-up who signs in gets 5 new passes a day.");
    expect(signInNextCopy({ ...ENV, AUTH_GITHUB_ID: "x", AUTH_GITHUB_SECRET: "y" })).toBe("Sign in with GitHub for 5 new passes a day, or press Try as a judge.");
    expect(signInNextCopy({})).toBe("You get a new free pass after midnight Dallas time.");
  });
});

// ---------- feedback ----------

describe("feedback: validation (no free text), storage and auth", () => {
  let passId: string;
  let parkId: string;
  let logs: string[];
  let restoreLog: () => void;
  beforeEach(async () => {
    resetStores();
    resetPassMaking();
    resetPassReads();
    disableSavedOsmForTests();
    vi.stubGlobal("fetch", passReplay().fetchImpl);
    vi.stubEnv("DO_INFERENCE_API_KEY", "test-key-not-real");
    vi.stubEnv("MODEL_BASE_URL", "");
    vi.stubEnv("MODEL_ID", "");
    const res = await route.POST(post("/api/pass", connemara, (await newAccountCookie()).cookie));
    const last = PassLineSchema.parse(JSON.parse((await res.text()).trim().split("\n").at(-1)!));
    if (last.type !== "result") throw new Error("no pass");
    passId = last.pass.id;
    parkId = last.pass.park.id;
    logs = [];
    restoreLog = setLogSink((_l, line) => logs.push(line));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetSavedOsm();
    restoreLog();
  });

  it("the schema: 1-5 whole stars, known tags once each, and nothing else (no text field)", () => {
    const ok = { passId: "w123-6to10-20261008-1", stars: 4, tags: ["kids_loved", "too_easy"] };
    expect(FeedbackRequestSchema.safeParse(ok).success).toBe(true);
    expect(FeedbackRequestSchema.safeParse({ ...ok, tags: [] }).success).toBe(true);
    for (const bad of [
      { ...ok, stars: 0 },
      { ...ok, stars: 6 },
      { ...ok, stars: 2.5 },
      { ...ok, stars: "4" },
      { ...ok, tags: ["great"] },
      { ...ok, tags: ["too_easy", "too_easy"] },
      { ...ok, comment: "free text" },
      { ...ok, passId: "../../etc" },
      { passId: ok.passId, stars: 4 },
    ]) {
      expect(FeedbackRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("signed out: 401 and nothing stored; a pass that isn't saved: 404", async () => {
    const res = await feedbackRoute.POST(post("/api/feedback", { passId, stars: 5, tags: [] }, null));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe("Sign in to rate this pass (it's for grown-ups).");
    expect(await getStore("limits").hashGetAll!(feedbackKeys(parkId).hash)).toEqual({});
    const a = await newAccountCookie();
    expect((await feedbackRoute.POST(post("/api/feedback", { passId: "w188145317-6to10-20200101-1", stars: 5, tags: [] }, a.cookie))).status).toBe(404);
    expect((await feedbackRoute.POST(post("/api/feedback", { passId, stars: 9, tags: [] }, a.cookie))).status).toBe(400);
    expect((await feedbackRoute.POST(post("/api/feedback", { passId, stars: 3, tags: [], text: "hi" }, a.cookie))).status).toBe(400);
  });

  it("one rating per account per pass, the latest wins, under the per-park reporter id (never the account key)", async () => {
    const a = await newAccountCookie();
    const first = await feedbackRoute.POST(post("/api/feedback", { passId, stars: 3, tags: ["too_hard"] }, a.cookie));
    expect(await first.json()).toEqual({ status: "saved", message: FEEDBACK_COPY.saved });
    const again = await feedbackRoute.POST(post("/api/feedback", { passId, stars: 5, tags: ["kids_loved", "too_easy"] }, a.cookie));
    expect(await again.json()).toEqual({ status: "updated", message: FEEDBACK_COPY.updated });
    const h = await getStore("limits").hashGetAll!(feedbackKeys(parkId).hash);
    const day = localDay(Date.now()).replace(/-/g, "");
    expect(h).toEqual({ [`${passId}|${reporterId(a.key, parkId)}`]: `${day}|5|${tagMask(["too_easy", "kids_loved"])}` });
    expect(JSON.stringify(h)).not.toContain(a.key);
    // A second account adds its own rating.
    const b = await newAccountCookie();
    await feedbackRoute.POST(post("/api/feedback", { passId, stars: 2, tags: ["missing", "not_safe"] }, b.cookie));
    const entries = feedbackFromHash(await getStore("limits").hashGetAll!(feedbackKeys(parkId).hash), Date.now());
    const s = summarizeFeedback(parkId, entries);
    expect([s.ratings, s.average, s.stars, s.passes]).toEqual([2, 3.5, [0, 1, 0, 0, 1], 1]);
    expect(s.tags).toEqual({ too_easy: 1, too_hard: 0, kids_loved: 1, missing: 1, not_safe: 1 });
    expect(logs.some((l) => l.includes('"event":"feedback_not_safe"'))).toBe(true);
    expect(logs.join("\n")).not.toContain(b.key);
  });

  it("the judge demo is only logged (never stored or counted), once per judge sign-in per pass per day", async () => {
    const j = await judgeCookie();
    const r1 = await feedbackRoute.POST(post("/api/feedback", { passId, stars: 4, tags: ["kids_loved"] }, j.cookie));
    expect(await r1.json()).toEqual({ status: "logged", message: FEEDBACK_COPY.judgeLogged });
    const r2 = await feedbackRoute.POST(post("/api/feedback", { passId, stars: 1, tags: [] }, j.cookie));
    expect(((await r2.json()) as { status: string }).status).toBe("duplicate");
    // Another judge browser is its own sign-in.
    const r3 = await feedbackRoute.POST(post("/api/feedback", { passId, stars: 5, tags: [] }, (await judgeCookie()).cookie));
    expect(((await r3.json()) as { status: string }).status).toBe("logged");
    expect(await getStore("limits").hashGetAll!(feedbackKeys(parkId).hash)).toEqual({});
    expect(logs.filter((l) => l.includes('"event":"feedback_judge"'))).toHaveLength(2);
  });

  it("per-IP and per-account hourly limits answer 429", async () => {
    const a = await newAccountCookie();
    const ip = nextIp();
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await feedbackRoute.POST(post("/api/feedback", { passId, stars: 4, tags: [] }, a.cookie, ip))).status;
    expect(last).toBe(429);
  });
});

describe("feedback: the 90-day keep window and Kevin's private report", () => {
  it("ratings older than 90 days are dropped on the next write and never read", async () => {
    const t0 = Date.UTC(2026, 6, 1, 17);
    let now = t0;
    const store = new MemoryStore({ now: () => now });
    const acct = { key: "a:AAAAAAAAAAAAAAAAAAAAAA", judge: false };
    await recordFeedback(store, { passId: "w1-6to10-20260701-1", parkId: "way/1", stars: 4, tags: [], account: acct, now });
    now = t0 + (FEEDBACK_KEEP_DAYS + 1) * 24 * 3600_000;
    expect(feedbackFromHash({ [`w1-6to10-20260701-1|${reporterId(acct.key, "way/1", ENV)}`]: "20260701|4|0" }, now)).toEqual([]);
    await recordFeedback(store, { passId: "w1-6to10-20260930-1", parkId: "way/1", stars: 5, tags: ["kids_loved"], account: { ...acct, key: "a:BBBBBBBBBBBBBBBBBBBBBB" }, now });
    const h = await store.hashGetAll(feedbackKeys("way/1").hash);
    expect(Object.keys(h)).toHaveLength(1);
  });

  it("malformed fields are skipped; tags round-trip through the stored mask", () => {
    for (const t of FEEDBACK_TAGS) expect(tagsOf(tagMask([t]))).toEqual([t]);
    expect(tagsOf(tagMask([...FEEDBACK_TAGS]))).toEqual([...FEEDBACK_TAGS]);
    const day = localDay(Date.now()).replace(/-/g, "");
    const good = `w1-6to10-${day}-1|${"r".repeat(12)}`;
    const entries = feedbackFromHash({ [good]: `${day}|4|3`, "x|y": `${day}|4|0`, [`${good}x`]: `${day}|4|0`, [`w2|${"s".repeat(12)}`]: `${day}|9|0`, [`w3|${"t".repeat(12)}`]: `${day}|3|99` }, Date.now());
    expect(entries).toEqual([{ passId: `w1-6to10-${day}-1`, day: Number(day), stars: 4, tags: ["too_easy", "too_hard"] }]);
  });

  it("the report lists counts per park and per tag, or says No data available", async () => {
    const store = new MemoryStore();
    expect(await feedbackReport(store, Date.now())).toEqual([]);
    expect(formatFeedbackReport([], "Oct 8, 2026, 8:00 PM")).toContain(NO_RATINGS_REPORT);
    const now = Date.now();
    await recordFeedback(store, { passId: "w188145317-6to10-20261008-1", parkId: "way/188145317", stars: 5, tags: ["kids_loved"], account: { key: "a:CCCCCCCCCCCCCCCCCCCCCC", judge: false }, now });
    await recordFeedback(store, { passId: "w188145317-6to10-20261008-1", parkId: "way/188145317", stars: 3, tags: ["too_easy"], account: { key: "a:DDDDDDDDDDDDDDDDDDDDDD", judge: false }, now });
    const parks = await feedbackReport(store, now);
    expect(parks.map((p) => [p.parkId, p.ratings, p.average])).toEqual([["way/188145317", 2, 4]]);
    const text = formatFeedbackReport([{ ...parks[0], name: "Celebration Park" }], "Oct 8, 2026, 8:00 PM");
    expect(text).toContain("way/188145317  Celebration Park");
    expect(text).toContain("2 ratings on 1 pass, average 4.0 stars");
    expect(text).toContain("Too easy 1, Too hard 0, Kids loved it 1, Something was missing 0, Not safe 0");
    expect(text).toContain("All parks: 2 ratings in 1 park");
  });
});
