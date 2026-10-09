/**
 * Round 11 core fixes, through the real routes with recorded upstream answers only (support/pass-replay.ts):
 * - Q-11-01: a failed FREE source (Overpass 504/429/503) or a keyless server (MODEL_NOT_CONFIGURED) never uses the
 *   signed-out free pass, an account's daily pass or the judge demo's pool; a paid model call that starts does. The
 *   per-connection flood shares (pass-new, anon-new) still count, as before.
 * - SEC-11-02: a charge after Chicago midnight gives no receipt for the new day.
 * - SEC-11-03: the receipt schema is strict.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as route from "@/app/api/pass/route";
import * as freePassRoute from "@/app/api/free-pass/route";
import * as passesLeftRoute from "@/app/api/passes-left/route";
import { getStore, resetStores } from "@/lib/cache/store";
import { clientIp, createSpacedQueue, quotaUsage } from "@/lib/limits";
import { freePassReceipt, verifyFreePass } from "@/lib/limits/free-pass";
import { resetPassMaking } from "@/lib/pass/make";
import { PassErrorResponseSchema, PassLineSchema } from "@/lib/pass/schema";
import { resetPassReads } from "@/lib/limits/pass-read";
import { disableSavedOsmForTests, resetSavedOsm } from "@/lib/sources/osm-snapshot";
import { localDay } from "@/lib/time";
import { PARKS, passReplay } from "./support/pass-replay";
import { judgeCookie, newAccountCookie } from "./support/session";

let n = 0;
const nextIp = () => `198.20.0.${(++n % 250) + 1}`;
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

type Out = { status: number; type: string; code?: string; free?: { left: number; receipt?: string }; setCookie: string | null };
async function outcome(res: Response): Promise<Out> {
  const setCookie = res.headers.get("set-cookie");
  if ((res.headers.get("content-type") ?? "").includes("ndjson")) {
    const ls = (await res.text())
      .trim()
      .split("\n")
      .map((l) => PassLineSchema.parse(JSON.parse(l)));
    const last = ls[ls.length - 1];
    const free = last.type === "result" || last.type === "error" ? last.free : undefined;
    return { status: res.status, type: last.type, free, setCookie, ...(last.type === "error" ? { code: last.error.code } : {}) };
  }
  const e = PassErrorResponseSchema.parse(await res.json());
  return { status: res.status, type: "json-error", code: e.error.code, free: e.free, setCookie };
}

const connemara = { parkId: PARKS.connemara.id, ageBand: "6-10" as const };
const usage = async (name: string, key: string) => (await quotaUsage(getStore("limits"), { name, key, period: { kind: "day" }, now: Date.now() })).key;
const ipKey = (ip: string) => clientIp(new Request("http://x/", { headers: { "x-forwarded-for": ip } }));

describe("Q-11-01: only a paid model call that starts uses a pass", () => {
  let replay: ReturnType<typeof passReplay>;
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
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetSavedOsm();
  });

  /** Overpass answers `status`; everything else is the recorded replay. */
  const overpassDown = (status: number) => {
    const base = passReplay();
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push(new URL(url).host);
      if (new URL(url).pathname.endsWith("/interpreter")) return new Response("busy", { status });
      return base.fetchImpl(url, init);
    });
    return calls;
  };

  it.each([504, 429, 503])("signed out, Overpass %i: an honest failure, NO free-pass receipt or cookie, and the free pass is still there", async (status) => {
    const calls = overpassDown(status);
    const ip = nextIp();
    const o = await outcome(await route.POST(post("/api/pass", connemara, null, ip)));
    expect(o.type).not.toBe("result");
    expect(o.code).toMatch(/^(OSM_UNAVAILABLE|DATA_TOO_SLOW|BUSY_HERE)$/);
    expect(o.free).toBeUndefined();
    expect(o.setCookie).toBeNull();
    // A free source really was called (the old code charged here), and no model call was made.
    expect(calls.length).toBeGreaterThan(0);
    expect(replay.calls.filter((c) => c.host.includes("digitalocean"))).toHaveLength(0);
    // The wizard reads the cookie: still 1 free pass left.
    expect(await (await passesLeftRoute.GET(get("/api/passes-left", null, ip))).json()).toMatchObject({ kind: "free", left: 1 });
  });

  it("signed out, keyless server (MODEL_NOT_CONFIGURED): no receipt, no charge", async () => {
    vi.stubEnv("DO_INFERENCE_API_KEY", "");
    vi.stubEnv("MODEL_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const o = await outcome(await route.POST(post("/api/pass", connemara, null)));
    expect(o.code).toBe("MODEL_NOT_CONFIGURED");
    expect(o.free).toBeUndefined();
    expect(o.setCookie).toBeNull();
  });

  it("signed out: a model call that starts DOES use the free pass (made, or failed after it started)", async () => {
    const made = await outcome(await route.POST(post("/api/pass", connemara, null)));
    expect(made.type).toBe("result");
    expect(verifyFreePass(made.free?.receipt, Date.now())).toBe(1);

    resetPassMaking();
    resetStores();
    const r = passReplay({ model: () => new Response("busy", { status: 503 }) });
    vi.stubGlobal("fetch", r.fetchImpl);
    const failed = await outcome(await route.POST(post("/api/pass", { ...connemara, ageBand: "4-6" }, null)));
    expect(failed.code).toMatch(/^MODEL_/);
    expect(verifyFreePass(failed.free?.receipt, Date.now())).toBe(1);
  });

  it("signed out, Overpass 504: the per-connection flood share (anon-new, pass-new) still counts", async () => {
    overpassDown(504);
    const ip = nextIp();
    await route.POST(post("/api/pass", connemara, null, ip)).then(outcome);
    expect(await usage("anon-new", ipKey(ip))).toBe(1);
    expect(await usage("pass-new", ipKey(ip))).toBe(1);
  });

  it("an account, Overpass 504: its daily pass is given back (a made pass counting: tests/unit/accounts.test.ts)", async () => {
    overpassDown(504);
    const a = await newAccountCookie();
    const o = await outcome(await route.POST(post("/api/pass", connemara, a.cookie)));
    expect(o.type).not.toBe("result");
    expect(await usage("acct-new", a.key)).toBe(0);
  });

  it("the judge demo, Overpass 504: its shared pool and per-connection share are not used", async () => {
    overpassDown(504);
    const j = await judgeCookie();
    const ip = nextIp();
    const before = (await (await passesLeftRoute.GET(get("/api/passes-left", j.cookie, ip))).json()) as { left: number; leftForYou: number };
    const o = await outcome(await route.POST(post("/api/pass", connemara, j.cookie, ip)));
    expect(o.type).not.toBe("result");
    const after = (await (await passesLeftRoute.GET(get("/api/passes-left", j.cookie, ip))).json()) as { left: number; leftForYou: number };
    expect([after.left, after.leftForYou]).toEqual([before.left, before.leftForYou]);
  });
});

describe("SEC-11-02: a free pass started before Chicago midnight never uses the next day's", () => {
  // 2026-10-09 23:59:58 CDT = 2026-10-10 04:59:58 UTC.
  const BEFORE = Date.UTC(2026, 9, 10, 4, 59, 58);
  const AFTER = BEFORE + 3_000;
  it("same day: a receipt for used + 1 on that day; across midnight: no receipt", () => {
    expect(localDay(BEFORE)).not.toBe(localDay(AFTER));
    const same = freePassReceipt(0, BEFORE - 60_000, BEFORE);
    expect(verifyFreePass(same, BEFORE)).toBe(1);
    expect(freePassReceipt(0, BEFORE, AFTER)).toBeNull();
  });
});

describe("SEC-11-03: POST /api/free-pass body handling", () => {
  beforeEach(() => resetStores());
  it("an unknown field is refused (strict schema), never silently ignored", async () => {
    const res = await freePassRoute.POST(post("/api/free-pass", { receipt: "x", extra: 1 }, null));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("BAD_INPUT");
  });
  it("an oversized chunked body (no Content-Length) is 413, like a Content-Length one", async () => {
    const big = "x".repeat(4096);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 25; i++) c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    const req = new Request("http://localhost:3123/api/free-pass", { method: "POST", headers: headers(null, nextIp()), body, duplex: "half" } as RequestInit);
    expect((await freePassRoute.POST(req)).status).toBe(413);
  });
});

describe("Q-11-06: the spaced queue never asks setTimeout for more than one interval", () => {
  it("a clock that moved backwards waits at most minIntervalMs (no TimeoutOverflowWarning)", async () => {
    let t = 5_000_000_000;
    const slept: number[] = [];
    const q = createSpacedQueue(1000, { now: () => t, sleep: async (ms) => void slept.push(ms) });
    await q.run(async () => 1);
    t = 0; // the clock jumps back (the recording clock in tests does this)
    await q.run(async () => 2);
    expect(slept.length).toBe(1);
    expect(slept[0]).toBeLessThanOrEqual(1000);
  });
});
