/**
 * SEC-2-01: what each request really costs in Upstash commands, measured by running the app's real
 * UpstashStore against a command-counting stand-in (tests/unit/support/counting-upstash.ts) with the
 * recorded upstream answers. The pre-limiter's COSTS and EXTRA (src/lib/limits/prelimit.ts) must be at
 * least these numbers, or the per-month math there would not hold.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetStores } from "@/lib/cache/store";
import { resetMemo } from "@/lib/cache/memo";
import { setLogSink } from "@/lib/log";
import { COSTS, EXTRA } from "@/lib/limits/prelimit";
import { resetPassReads } from "@/lib/limits/pass-read";
import { loadPass, resetPassMaking } from "@/lib/pass/make";
import { resetParksSearch } from "@/lib/parks/search";
import { disableSavedOsmForTests, resetSavedOsm } from "@/lib/sources/osm-snapshot";
import * as passRoute from "@/app/api/pass/route";
import * as parksRoute from "@/app/api/parks/route";
import { countingUpstash, FAKE_UPSTASH_TOKEN, FAKE_UPSTASH_URL } from "./support/counting-upstash";
import { osmReplay } from "./support/osm-replay";
import { PARKS, passReplay } from "./support/pass-replay";

const req = (path: string, body: unknown, ip: string) =>
  new Request(`http://localhost:3123${path}`, {
    method: "POST",
    headers: { host: "localhost:3123", "sec-fetch-site": "same-origin", "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
};

let up: ReturnType<typeof countingUpstash>;
let restoreLog: () => void;
beforeEach(() => {
  resetStores();
  resetMemo();
  resetPassReads();
  resetPassMaking();
  resetParksSearch();
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

    before = up.counts.total;
    const again = await passRoute.POST(req("/api/pass", body, "203.0.113.11"));
    expect(await again.text()).toContain('"cached":true');
    expect(up.counts.total - before).toBeLessThanOrEqual(COSTS.apiPass);

    // A per-IP refusal: one EVAL, then none while the refusal is remembered.
    const ip = "203.0.113.12";
    for (let i = 0; i < 25; i++) await (await passRoute.POST(req("/api/pass", body, ip))).text();
    before = up.counts.total;
    const refused = await passRoute.POST(req("/api/pass", body, ip));
    expect(refused.status).toBe(429);
    expect(up.counts.total - before).toBeLessThanOrEqual(COSTS.apiPass);

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

    before = up.counts.total;
    expect((await parksRoute.POST(req("/api/parks", { q: "Allen TX" }, "198.51.100.21"))).status).toBe(200);
    const cached = up.counts.total - before;
    expect(cached).toBeLessThanOrEqual(COSTS.apiParks);

    const ip = "198.51.100.22";
    for (let i = 0; i < 12; i++) await parksRoute.POST(req("/api/parks", { q: "Allen TX" }, ip));
    before = up.counts.total;
    expect((await parksRoute.POST(req("/api/parks", { q: "Allen TX" }, ip))).status).toBe(429);
    expect(up.counts.total - before).toBeLessThanOrEqual(COSTS.apiParks);
  });
});
