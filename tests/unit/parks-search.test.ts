import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore, resetStores } from "@/lib/cache/store";
import { breakerRetryAfter, quotaUsage, tripBreaker } from "@/lib/limits";
import { setLogSink } from "@/lib/log";
import { FIELD_COPY, parseSearchParams, resetParksSearch, searchParks, type SearchDeps } from "@/lib/parks/search";
import { PARKS_COPY, ParksResultSchema } from "@/lib/parks/schema";
import { NOMINATIM_SOURCE } from "@/lib/sources/nominatim";
import { breakerName, OVERPASS_DEFAULT_URLS } from "@/lib/sources/overpass";
import { aroundPoint, osmReplay, recordedResponse } from "./support/osm-replay";

// 2026-10-05 22:45 UTC (5:45 PM CDT).
const T0 = Date.UTC(2026, 9, 5, 22, 45, 0);
let ipCounter = 0;
const freshIp = () => `203.0.113.${++ipCounter % 250}`;
let restoreLog: () => void;
let store: MemoryStore;
/** A clock anchored at T0 that moves with real time (the 1 req/s slot waits for the next second). */
let startedAt = 0;
const clock = () => T0 + (Date.now() - startedAt);

beforeEach(() => {
  resetStores();
  resetParksSearch();
  startedAt = Date.now();
  store = new MemoryStore({ now: clock });
  restoreLog = setLogSink(() => undefined);
});
afterEach(() => restoreLog());

function deps(fetchImpl: SearchDeps["fetchImpl"], extra: Partial<SearchDeps> = {}): SearchDeps {
  return { ip: freshIp(), store, fetchImpl, env: {}, now: clock, ...extra };
}
const usage = (key?: string) => quotaUsage(store, { name: "parks-upstream", key, period: { kind: "day" }, now: clock() });

describe("parseSearchParams (field errors)", () => {
  const p = (s: string) => parseSearchParams(new URLSearchParams(s));
  it("accepts a place name and cleans it", () => {
    expect(p("q=%20%20Allen%20%20TX%20")).toEqual({ ok: true, input: { kind: "text", q: "Allen TX" } });
  });
  it("names the field and the fix", () => {
    expect(p("q=")).toMatchObject({ ok: false, error: { field: "q", message: FIELD_COPY.qEmpty } });
    expect(p("q=%20%20")).toMatchObject({ ok: false, error: { field: "q", message: FIELD_COPY.qEmpty } });
    expect(p("q=a")).toMatchObject({ ok: false, error: { field: "q", message: FIELD_COPY.qShort } });
    expect(p(`q=${"a".repeat(101)}`)).toMatchObject({ ok: false, error: { field: "q", message: FIELD_COPY.qLong } });
    expect(p("q=%3F%3F%3F")).toMatchObject({ ok: false, error: { field: "q", code: "QUERY_EMPTY" } });
    expect(p("")).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
    expect(p("q=Allen&lat=1&lng=2")).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
  });
  it("rounds a location to 2 decimals on the server too (~1 km)", () => {
    expect(p("lat=33.085123&lng=-96.702071")).toEqual({ ok: true, input: { kind: "location", lat: 33.09, lng: -96.7 } });
    expect(p("lat=91&lng=0")).toMatchObject({ ok: false, error: { field: "location" } });
    expect(p("lat=abc&lng=0")).toMatchObject({ ok: false, error: { field: "location" } });
    expect(p("lat=1e2&lng=0")).toMatchObject({ ok: false, error: { field: "location" } });
    expect(p("lat=33.1")).toMatchObject({ ok: false, error: { field: "location" } });
  });
});

describe("searchParks with live recordings", () => {
  it("Allen TX -> 10 real parks nearest first; the repeat comes from the cache with its real time", async () => {
    const { fetchImpl, calls } = osmReplay();
    const first = await searchParks({ kind: "text", q: "Allen TX" }, deps(fetchImpl));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const r = ParksResultSchema.parse(first.result);
    expect(r.query).toEqual({ kind: "text", text: "Allen TX", matched: "Allen, Collin County, Texas, United States" });
    expect(r.parks).toHaveLength(10);
    expect(r.parks[0].name).toBe("Heritage Village");
    expect(r.totalFound).toBe(53);
    expect(r.empty).toBeNull();
    expect(r.cached).toBe(false);
    const checked = Date.parse(r.checkedAt);
    expect(checked).toBeGreaterThanOrEqual(T0);
    expect(checked).toBeLessThan(T0 + 30_000);
    expect(calls).toHaveLength(2);

    startedAt -= 3_600_000;
    const again = await searchParks({ kind: "text", q: "  allen   tx" }, deps(fetchImpl));
    expect(again.ok && again.result.cached).toBe(true);
    expect(again.ok && again.result.checkedAt).toBe(r.checkedAt);
    expect(calls).toHaveLength(2);
  });

  it("a park name lists that park first (Connemara Meadow Preserve, Celebration Park)", async () => {
    const { fetchImpl } = osmReplay();
    const c = await searchParks({ kind: "text", q: "Connemara Meadow Preserve" }, deps(fetchImpl));
    expect(c.ok && c.result.parks[0]).toMatchObject({ id: "way/306191453", name: "Connemara Meadow Preserve" });
    const cel = await searchParks({ kind: "text", q: "Celebration Park Allen TX" }, deps(fetchImpl));
    expect(cel.ok && cel.result.parks[0]).toMatchObject({ id: "way/188145317", name: "Celebration Park" });
  });

  it("no match -> the exact §5.4 copy, no Overpass call, then served from the negative cache", async () => {
    const { fetchImpl, calls } = osmReplay();
    const r = await searchParks({ kind: "text", q: "zzqxjv nowhere plorf" }, deps(fetchImpl));
    expect(r.ok && r.result.empty).toEqual({ reason: "no_place", message: "We couldn't find that place. Try a town name or ZIP." });
    expect(r.ok && r.result.parks).toEqual([]);
    expect(calls).toHaveLength(1);
    const again = await searchParks({ kind: "text", q: "zzqxjv nowhere plorf" }, deps(fetchImpl));
    expect(again.ok && again.result.empty?.reason).toBe("no_place");
    expect(calls).toHaveLength(1);
  });

  it("no parks within 5 km -> the exact §5.4 copy (real empty answer)", async () => {
    const { fetchImpl } = osmReplay();
    const r = await searchParks({ kind: "location", lat: 31, lng: -103 }, deps(fetchImpl));
    expect(r.ok && r.result.empty).toEqual({ reason: "no_parks", message: "No parks found within 5 km in OpenStreetMap." });
    expect(r.ok && r.result.query).toEqual({ kind: "location" });
  });

  it("'Use my location' queries Overpass at the rounded point only", async () => {
    // The recorded Connemara answer is replayed for the rounded point; this test is about what we SEND.
    const { fetchImpl, calls } = osmReplay({
      overpass: () => recordedResponse("overpass-parks-connemara-meadow-preserve"),
    });
    const parsed = parseSearchParams(new URLSearchParams("lat=33.085123&lng=-96.702071"));
    if (!parsed.ok) throw new Error("parse");
    const r = await searchParks(parsed.input, deps(fetchImpl));
    expect(r.ok).toBe(true);
    expect(aroundPoint(calls[0].query!)).toEqual({ lat: 33.09, lng: -96.7 });
    expect(calls[0].query).toContain("around:5000,33.09000,-96.70000");
    expect(calls.some((c) => c.url.includes("nominatim"))).toBe(false);
  });
});

describe("failures show the exact §5.4 copy and are charged honestly", () => {
  it("Nominatim down -> GEOCODER_UNAVAILABLE copy; the started call is charged", async () => {
    const ip = freshIp();
    const fetchImpl = async () => new Response("bad gateway", { status: 502 });
    const r = await searchParks({ kind: "text", q: "Allen TX" }, deps(fetchImpl, { ip }));
    expect(r).toMatchObject({ ok: false, status: 503, error: { code: "GEOCODER_UNAVAILABLE", message: PARKS_COPY.geocoderDown } });
    expect(await usage(ip)).toEqual({ global: 1, key: 1 });
    expect(await breakerRetryAfter(store, NOMINATIM_SOURCE, clock())).toBe(30);
  });

  it("breaker open -> no upstream call, and the reserved slot is given back", async () => {
    const ip = freshIp();
    await tripBreaker(store, NOMINATIM_SOURCE, clock(), 120);
    const { fetchImpl, calls } = osmReplay();
    const r = await searchParks({ kind: "text", q: "Allen TX" }, deps(fetchImpl, { ip }));
    expect(r).toMatchObject({ ok: false, status: 503, error: { code: "GEOCODER_UNAVAILABLE", retryAfter: 120 } });
    expect(calls).toHaveLength(0);
    expect(await usage(ip)).toEqual({ global: 0, key: 0 });
  });

  it("both Overpass servers busy -> OSM_UNAVAILABLE copy; the place stays cached", async () => {
    const { fetchImpl, calls } = osmReplay({ overpass: () => recordedResponse("overpass-504-too-busy") });
    const r = await searchParks({ kind: "text", q: "Allen TX" }, deps(fetchImpl));
    expect(r).toMatchObject({ ok: false, status: 503, error: { code: "OSM_UNAVAILABLE", message: PARKS_COPY.overpassDown } });
    expect(calls.map((c) => new URL(c.url).host)).toEqual([
      "nominatim.openstreetmap.org",
      ...OVERPASS_DEFAULT_URLS.map((u) => new URL(u).host),
    ]);
    for (const u of OVERPASS_DEFAULT_URLS) expect(await breakerRetryAfter(store, breakerName(u), clock())).toBe(60);

    // A minute later Overpass is back: the place comes from the cache, only Overpass is called.
    startedAt -= 61_000;
    const ok = osmReplay();
    const r2 = await searchParks({ kind: "text", q: "Allen TX" }, deps(ok.fetchImpl));
    expect(r2.ok).toBe(true);
    expect(ok.calls.map((c) => new URL(c.url).host)).toEqual(["overpass-api.de"]);
  });
});

describe("abuse controls", () => {
  it("per-IP: 10 searches a minute, then 429 with Retry-After (cached searches count too)", async () => {
    const { fetchImpl } = osmReplay();
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      const r = await searchParks({ kind: "text", q: "Allen TX" }, deps(fetchImpl, { ip }));
      expect(r.ok).toBe(true);
    }
    const r = await searchParks({ kind: "text", q: "Allen TX" }, deps(fetchImpl, { ip }));
    expect(r).toMatchObject({ ok: false, status: 429, error: { code: "RATE_LIMITED" } });
    expect(!r.ok && r.error.retryAfter).toBeGreaterThan(0);
  });

  it("per-IP daily share of uncached searches; cached searches still work after it", async () => {
    const { fetchImpl } = osmReplay();
    const ip = freshIp();
    const env = { PARKS_PER_IP_PER_DAY: "2" };
    expect((await searchParks({ kind: "text", q: "Allen TX" }, deps(fetchImpl, { ip, env }))).ok).toBe(true);
    expect((await searchParks({ kind: "text", q: "Connemara Meadow Preserve" }, deps(fetchImpl, { ip, env }))).ok).toBe(true);
    const third = await searchParks({ kind: "text", q: "Celebration Park Allen TX" }, deps(fetchImpl, { ip, env }));
    expect(third).toMatchObject({ ok: false, status: 429, error: { code: "IP_DAILY_LIMIT" } });
    expect((await searchParks({ kind: "text", q: "Allen TX" }, deps(fetchImpl, { ip, env }))).ok).toBe(true);
  });

  it("global daily cap covers everyone", async () => {
    const { fetchImpl, calls } = osmReplay();
    const env = { PARKS_DAILY_CAP: "1" };
    expect((await searchParks({ kind: "text", q: "Allen TX" }, deps(fetchImpl, { env }))).ok).toBe(true);
    const other = await searchParks({ kind: "text", q: "Connemara Meadow Preserve" }, deps(fetchImpl, { env }));
    expect(other).toMatchObject({ ok: false, status: 429, error: { code: "DAILY_LIMIT" } });
    expect(calls).toHaveLength(2);
  });

  it("identical concurrent searches make one set of upstream calls", async () => {
    const { fetchImpl, calls } = osmReplay();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => searchParks({ kind: "text", q: "Allen TX" }, deps(fetchImpl))),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("a client that leaves after the upstream call started does not cancel it; the result is cached", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const replay = osmReplay();
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (url.includes("overpass")) await gate;
      return replay.fetchImpl(url, init);
    };
    const ac = new AbortController();
    const p = searchParks({ kind: "text", q: "Allen TX" }, deps(fetchImpl, { signal: ac.signal }));
    // Wait until the Overpass request is on the wire.
    while (!replay.calls.some((c) => c.url.includes("nominatim"))) await new Promise((r) => setTimeout(r, 1));
    await new Promise((r) => setTimeout(r, 5));
    ac.abort();
    await expect(p).rejects.toThrow("The client went away.");
    release();
    await new Promise((r) => setTimeout(r, 20));
    const again = await searchParks({ kind: "text", q: "Allen TX" }, deps(fetchImpl));
    expect(again.ok && again.result.cached).toBe(true);
    expect(replay.calls).toHaveLength(2);
  });

  it("a store outage answers 503 and calls nothing upstream", async () => {
    const broken = new MemoryStore();
    broken.incr = async () => {
      const { StoreError } = await import("@/lib/cache/store");
      throw new StoreError("down");
    };
    const { fetchImpl, calls } = osmReplay();
    const r = await searchParks({ kind: "text", q: "Allen TX" }, deps(fetchImpl, { store: broken }));
    expect(r).toMatchObject({ ok: false, status: 503, error: { code: "STORE_UNAVAILABLE" } });
    expect(calls).toHaveLength(0);
  });
});
