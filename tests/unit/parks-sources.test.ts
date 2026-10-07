import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/cache/store";
import { breakerRetryAfter, createSpacedQueue } from "@/lib/limits";
import { setLogSink } from "@/lib/log";
import { contactUrl, DEFAULT_CONTACT_URL, parseRetryAfter, readTextCapped, SourceError, userAgent } from "@/lib/sources/common";
import { cleanPlaceQuery, geocode, NOMINATIM_SOURCE, nominatimUrl, PARK_QUERY_RE, parseNominatim } from "@/lib/sources/nominatim";
import { breakerName, isErrorRemark, isHeavyQueryRemark, overpassEndpoints, OVERPASS_DEFAULT_URLS, runOverpass } from "@/lib/sources/overpass";
import { parseParks, parksNear, parksQuery } from "@/lib/sources/overpass-parks";
import { distanceLabel, distanceM, roundCoord } from "@/lib/geo";
import { fixture, osmReplay, recordedResponse } from "./support/osm-replay";

const T0 = Date.UTC(2026, 9, 5, 22, 40, 0);
let restoreLog: () => void;
beforeEach(() => {
  restoreLog = setLogSink(() => undefined);
});
afterEach(() => restoreLog());

/** A spaced queue that never really sleeps (keeps unit tests fast). */
const instantQueue = () => createSpacedQueue(1000, { sleep: async () => undefined });

describe("User-Agent (OSM usage policy)", () => {
  it("names the app and the public repo, never an email", () => {
    expect(userAgent({})).toBe("GrassPass/0.1 (+https://github.com/c0de128/grass-pass)");
    expect(contactUrl({ APP_CONTACT_URL: "someone@example.com" })).toBe(DEFAULT_CONTACT_URL);
    expect(contactUrl({ APP_CONTACT_URL: "https://user@github.com/x" })).toBe(DEFAULT_CONTACT_URL);
    expect(contactUrl({ APP_CONTACT_URL: "mailto:a@b.c" })).toBe(DEFAULT_CONTACT_URL);
    expect(contactUrl({ APP_CONTACT_URL: "http://github.com/c0de128/grass-pass" })).toBe(DEFAULT_CONTACT_URL);
    expect(contactUrl({ APP_CONTACT_URL: "https://github.com/c0de128/grass-pass/" })).toBe(DEFAULT_CONTACT_URL);
    expect(userAgent({}).includes("@")).toBe(false);
  });

  it("parses Retry-After seconds and dates, clamped to 1 s..1 h", () => {
    expect(parseRetryAfter("120", T0)).toBe(120);
    expect(parseRetryAfter("0", T0)).toBe(1);
    expect(parseRetryAfter("99999", T0)).toBe(3600);
    expect(parseRetryAfter(new Date(T0 + 30_000).toUTCString(), T0)).toBe(30);
    expect(parseRetryAfter("soon", T0)).toBeUndefined();
    expect(parseRetryAfter(null, T0)).toBeUndefined();
  });
});

describe("geo helpers", () => {
  it("measures real distances (Allen centre to Connemara Meadow Preserve ~3.6 km)", () => {
    const d = distanceM({ lat: 33.1031744, lng: -96.6705503 }, { lat: 33.0848505, lng: -96.7015488 });
    expect(d).toBeGreaterThan(3_400);
    expect(d).toBeLessThan(3_800);
  });
  it("rounds GPS to 2 decimals (~1 km) and labels miles first", () => {
    expect(roundCoord(33.08512345, 2)).toBe(33.09);
    expect(roundCoord(-96.70218, 2)).toBe(-96.7);
    expect(roundCoord(-0.001, 2)).toBe(0);
    expect(distanceLabel(3_560)).toBe("2.2 mi (3.6 km)");
    expect(distanceLabel(54)).toBe("0.0 mi (0.1 km)");
  });
});

describe("Nominatim parsing (live recordings, 2026-10-05)", () => {
  it("Allen TX -> the city of Allen in Collin County", () => {
    const place = parseNominatim(fixture("nominatim-allen-tx").body);
    expect(place).not.toBeNull();
    expect(place!.name).toBe("Allen");
    expect(place!.displayName).toContain("Collin County, Texas");
    expect(place!.lat).toBeCloseTo(33.103, 2);
    expect(place!.lng).toBeCloseTo(-96.67, 2);
    expect(place!.osmRef).toMatch(/^relation\/\d+$/);
  });

  it("a park name finds the park itself", () => {
    const c = parseNominatim(fixture("nominatim-connemara-meadow-preserve").body)!;
    expect(c.name).toBe("Connemara Meadow Preserve");
    expect(c.osmRef).toBe("way/306191453");
    const cel = parseNominatim(fixture("nominatim-celebration-park-allen-tx").body)!;
    expect(cel.name).toBe("Celebration Park");
    expect(cel.osmRef).toBe("way/188145317");
  });

  it("no match -> null; wrong shape -> throws", () => {
    expect(parseNominatim(fixture("nominatim-no-match").body)).toBeNull();
    expect(() => parseNominatim({ error: "x" })).toThrow();
    // A hit with an unusable point is skipped, not trusted.
    expect(parseNominatim([{ lat: "999", lon: "0", display_name: "Nowhere" }])).toBeNull();
  });

  it("cleans the typed query and builds a submit-only, one-result URL", () => {
    expect(cleanPlaceQuery("  Allen\u0000   TX \n")).toBe("Allen TX");
    const u = new URL(nominatimUrl("Allen TX"));
    expect(u.origin).toBe("https://nominatim.openstreetmap.org");
    expect(u.searchParams.get("q")).toBe("Allen TX");
    expect(u.searchParams.get("format")).toBe("jsonv2");
    expect(u.searchParams.get("limit")).toBe("1");
  });

  it("judge R7: a query that names a park takes the first PARK hit ('Forest Park Portland OR' first matches the neighbourhood)", () => {
    const rec = fixture("nominatim-forest-park-portland-or");
    const meta = rec._recording as unknown as { url: string };
    expect(nominatimUrl("Forest Park Portland OR")).toBe(meta.url); // the recorded request is exactly ours (limit 5)
    const body = rec.body as { category: string; type: string }[];
    expect(`${body[0].category}/${body[0].type}`).toBe("boundary/administrative"); // the neighbourhood comes first
    const place = parseNominatim(rec.body, { preferPark: true })!;
    expect(place).toMatchObject({ name: "Forest Park", osmRef: "relation/1760140", parkKind: "nature_reserve" });
    // Without the preference (a town or ZIP search) the first hit stays the answer.
    expect(parseNominatim(rec.body)?.osmRef).toBe("relation/7732409");
    expect(PARK_QUERY_RE.test("Forest Park Portland OR")).toBe(true);
    expect(PARK_QUERY_RE.test("Allen TX")).toBe(false);
    expect(PARK_QUERY_RE.test("Parkville MO")).toBe(false);
  });
});

describe("geocode (Nominatim client)", () => {
  it("sends the app User-Agent, charges at send time and returns the place", async () => {
    const { fetchImpl, calls } = osmReplay();
    let started = 0;
    const place = await geocode("Allen TX", { store: new MemoryStore(), fetchImpl, queue: instantQueue(), env: {}, onStart: () => started++ });
    expect(place?.name).toBe("Allen");
    expect(started).toBe(1);
    expect(calls).toHaveLength(1);
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("user-agent")).toBe("GrassPass/0.1 (+https://github.com/c0de128/grass-pass)");
    expect(calls[0].init?.redirect).toBe("error");
  });

  it("goes through a 1 request/second queue", async () => {
    const sleeps: number[] = [];
    let t = T0;
    const queue = createSpacedQueue(1000, { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } });
    const { fetchImpl } = osmReplay();
    const store = new MemoryStore({ now: () => t });
    const now = () => t;
    await Promise.all([
      geocode("Allen TX", { store, fetchImpl, queue, env: {}, now }),
      geocode("Connemara Meadow Preserve", { store, fetchImpl, queue, env: {}, now }),
    ]);
    expect(sleeps).toEqual([1000]);
  });

  it("429 opens the breaker for Retry-After; the next search does not call Nominatim", async () => {
    // A 429 cannot be recorded on demand without abusing the service; this is its documented shape.
    const store = new MemoryStore({ now: () => T0 });
    let n = 0;
    const fetchImpl = async () => {
      n++;
      return new Response("Too Many Requests", { status: 429, headers: { "retry-after": "120" } });
    };
    const err = await geocode("Allen TX", { store, fetchImpl, queue: instantQueue(), env: {}, now: () => T0 }).catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err.code).toBe("rate_limited");
    expect(err.started).toBe(true);
    expect(await breakerRetryAfter(store, NOMINATIM_SOURCE, T0)).toBe(120);
    const again = await geocode("Allen TX", { store, fetchImpl, queue: instantQueue(), env: {}, now: () => T0 }).catch((e) => e);
    expect(again.code).toBe("not_called");
    expect(again.started).toBe(false);
    expect(n).toBe(1);
  });

  it("5xx and network errors are 'busy'/'network' and open the breaker briefly", async () => {
    const store = new MemoryStore({ now: () => T0 });
    const e1 = await geocode("Allen TX", {
      store,
      fetchImpl: async () => new Response("bad gateway", { status: 502 }),
      queue: instantQueue(),
      env: {},
      now: () => T0,
    }).catch((e) => e);
    expect(e1.code).toBe("busy");
    expect(await breakerRetryAfter(store, NOMINATIM_SOURCE, T0)).toBe(30);

    const store2 = new MemoryStore({ now: () => T0 });
    const e2 = await geocode("Allen TX", {
      store: store2,
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
      queue: instantQueue(),
      env: {},
      now: () => T0,
    }).catch((e) => e);
    expect(e2.code).toBe("network");
    expect(await breakerRetryAfter(store2, NOMINATIM_SOURCE, T0)).toBe(30);
  });

  it("a non-JSON 200 is bad_output", async () => {
    const err = await geocode("Allen TX", {
      store: new MemoryStore(),
      fetchImpl: async () => new Response("<html>maintenance</html>", { status: 200 }),
      queue: instantQueue(),
      env: {},
    }).catch((e) => e);
    expect(err.code).toBe("bad_output");
  });
});

describe("Overpass parks (live recordings, 2026-10-05)", () => {
  const allen = fixture("overpass-parks-allen-tx");
  const allenCenter = allen._recording.center!;

  it("builds a fixed query from numbers only", () => {
    expect(parksQuery({ lat: 33.1031744, lng: -96.6705503 })).toBe(
      '[out:json][timeout:25];nwr["leisure"~"^(park|nature_reserve)$"]["name"](around:5000,33.10317,-96.67055);out center tags;',
    );
    expect(() => parksQuery({ lat: Number.NaN, lng: 0 })).toThrow();
    expect(() => parksQuery({ lat: 91, lng: 0 })).toThrow();
  });

  it("Allen TX: the 10 nearest named parks, nearest first, real names", () => {
    const { parks, totalFound } = parseParks(allen.body, allenCenter);
    expect(parks).toHaveLength(10);
    expect(totalFound).toBeGreaterThan(40);
    for (let i = 1; i < parks.length; i++) expect(parks[i].distanceM).toBeGreaterThanOrEqual(parks[i - 1].distanceM);
    expect(parks.slice(0, 3).map((p) => p.name)).toEqual(["Heritage Village", "Allenwood Park", "Allen Station Park"]);
    expect(totalFound).toBe(53);
    for (const p of parks) {
      expect(p.id).toMatch(/^(node|way|relation)\/\d+$/);
      expect(p.distanceM).toBeLessThanOrEqual(5_500);
    }
  });

  it("the Allen answer contains Connemara Meadow Preserve and Celebration Park", () => {
    const elements = (allen.body as { elements: { id: number; tags?: { name?: string } }[] }).elements;
    const names = elements.map((e) => e.tags?.name);
    expect(names).toContain("Connemara Meadow Preserve");
    expect(names).toContain("Celebration Park");
  });

  it("searching the park by name puts it first", () => {
    const con = fixture("overpass-parks-connemara-meadow-preserve");
    const c = parseParks(con.body, con._recording.center!);
    expect(c.parks[0]).toMatchObject({ id: "way/306191453", name: "Connemara Meadow Preserve", kind: "park" });
    expect(c.parks[0].distanceM).toBeLessThan(200);
    const cel = fixture("overpass-parks-celebration-park-allen-tx");
    const p = parseParks(cel.body, cel._recording.center!);
    expect(p.parks[0]).toMatchObject({ id: "way/188145317", name: "Celebration Park" });
  });

  it("merges one park mapped twice under the same name (Suncreek Park)", () => {
    const elements = (allen.body as { elements: { tags?: { name?: string } }[] }).elements;
    expect(elements.filter((e) => e.tags?.name === "Suncreek Park")).toHaveLength(2);
    const con = fixture("overpass-parks-connemara-meadow-preserve");
    const { parks } = parseParks(con.body, con._recording.center!);
    expect(parks.filter((p) => p.name === "Suncreek Park").length).toBeLessThanOrEqual(1);
  });

  it("a real empty answer (West Texas desert) gives no parks", () => {
    const e = fixture("overpass-parks-empty-west-texas");
    expect(parseParks(e.body, e._recording.center!)).toEqual({ parks: [], totalFound: 0 });
  });

  it("skips unnamed or non-park elements", () => {
    const { parks } = parseParks(
      {
        elements: [
          { type: "way", id: 1, center: { lat: 33.1, lon: -96.67 }, tags: { leisure: "park" } },
          { type: "way", id: 2, center: { lat: 33.1, lon: -96.67 }, tags: { leisure: "pitch", name: "Field" } },
          { type: "way", id: 3, tags: { leisure: "park", name: "No point" } },
        ],
      },
      allenCenter,
    );
    expect(parks).toEqual([]);
  });
});

describe("runOverpass failover and breakers", () => {
  const center = fixture("overpass-parks-allen-tx")._recording.center!;
  const [first, second] = OVERPASS_DEFAULT_URLS;

  it("happy path: one POST to the first endpoint with the app User-Agent", async () => {
    const { fetchImpl, calls } = osmReplay();
    let started = 0;
    const r = await parksNear(center, { store: new MemoryStore(), fetchImpl, env: {}, onStart: () => started++ });
    expect(r.parks[0].name).toBe("Heritage Village");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(first);
    expect(calls[0].init?.method).toBe("POST");
    expect(new Headers(calls[0].init?.headers).get("user-agent")).toContain("github.com/c0de128/grass-pass");
    expect(started).toBe(1);
  });

  it("a real 504 'too busy' page fails over to the mirror and opens the first endpoint's breaker", async () => {
    const store = new MemoryStore({ now: () => T0 });
    const { fetchImpl, calls } = osmReplay({
      overpass: (c) => (c.url === first ? recordedResponse("overpass-504-too-busy") : undefined),
    });
    const r = await parksNear(center, { store, fetchImpl, env: {}, now: () => T0 });
    expect(r.parks).toHaveLength(10);
    expect(calls.map((c) => c.url)).toEqual([first, second]);
    expect(await breakerRetryAfter(store, breakerName(first), T0)).toBe(60);

    // While the breaker is open, the next query goes straight to the mirror.
    const again = osmReplay();
    await parksNear(center, { store, fetchImpl: again.fetchImpl, env: {}, now: () => T0 });
    expect(again.calls.map((c) => c.url)).toEqual([second]);
  });

  it("200 with a server-busy runtime-error remark is a failure, not data, and fails over", async () => {
    // Overpass's documented partial-result shape (remark + elements) with its "too busy" dispatcher text.
    const remark = {
      elements: [],
      remark: "runtime error: open64: 0 Success /osm3s_osm_base Dispatcher_Client::request_read_and_idx::timeout. The server is probably too busy to handle your request.",
    };
    expect(isErrorRemark(remark.remark)).toBe(true);
    expect(isHeavyQueryRemark(remark.remark)).toBe(false);
    const store = new MemoryStore({ now: () => T0 });
    const { fetchImpl, calls } = osmReplay({
      overpass: (c) => (c.url === first ? Response.json(remark) : undefined),
    });
    const r = await parksNear(center, { store, fetchImpl, env: {}, now: () => T0 });
    expect(r.parks.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(2);
    expect(await breakerRetryAfter(store, breakerName(first), T0)).toBe(60);
  });

  it("SEC-1-01: a 'Query timed out' remark is about THAT query: no shared breaker, no failover", async () => {
    const remark = { elements: [], remark: "runtime error: Query timed out in \"query\" at line 1 after 26 seconds." };
    expect(isHeavyQueryRemark(remark.remark)).toBe(true);
    const store = new MemoryStore({ now: () => T0 });
    const { fetchImpl, calls } = osmReplay({ overpass: () => Response.json(remark) });
    const err = await runOverpass(parksQuery(center), { store, fetchImpl, env: {}, now: () => T0 }).catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err.code).toBe("too_heavy");
    expect(calls).toHaveLength(1);
    for (const e of OVERPASS_DEFAULT_URLS) expect(await breakerRetryAfter(store, breakerName(e), T0)).toBe(0);
    // A different search right after still reaches Overpass (nobody else is locked out).
    const next = osmReplay();
    const r = await parksNear(center, { store, fetchImpl: next.fetchImpl, env: {}, now: () => T0 });
    expect(r.parks).toHaveLength(10);
    expect(next.calls).toHaveLength(1);
  });

  it("SEC-1-01: the body is read with a size cap; an oversized answer is too_heavy, no breaker", async () => {
    const store = new MemoryStore({ now: () => T0 });
    const big = JSON.stringify({ elements: [], pad: "x".repeat(2_000) });
    const { fetchImpl, calls } = osmReplay({ overpass: () => new Response(big, { status: 200, headers: { "content-type": "application/json" } }) });
    const err = await runOverpass(parksQuery(center), { store, fetchImpl, env: {}, now: () => T0, maxBytes: 1_000 }).catch((e) => e);
    expect(err.code).toBe("too_heavy");
    expect(calls).toHaveLength(1);
    expect(await breakerRetryAfter(store, breakerName(first), T0)).toBe(0);
    // A declared Content-Length over the cap is refused before reading.
    const res = new Response("{}", { headers: { "content-length": "999999" } });
    await expect(readTextCapped(res, 1_000)).rejects.toThrow(/larger than 1000 bytes/);
    expect(await readTextCapped(new Response("hello"), 1_000)).toBe("hello");
  });

  it("the caller's own signal (pass deadline) stops the query as 'aborted' and never trips a breaker", async () => {
    const store = new MemoryStore({ now: () => T0 });
    const ac = new AbortController();
    const { fetchImpl } = osmReplay({
      overpass: (c) =>
        new Promise<Response>((_, reject) => {
          c.init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          setTimeout(() => ac.abort(), 20);
        }),
    });
    const err = await runOverpass(parksQuery(center), { store, fetchImpl, env: {}, now: () => T0, signal: ac.signal }).catch((e) => e);
    expect(err.code).toBe("aborted");
    for (const e of OVERPASS_DEFAULT_URLS) expect(await breakerRetryAfter(store, breakerName(e), T0)).toBe(0);
  });

  it("429 honours Retry-After on that endpoint", async () => {
    const store = new MemoryStore({ now: () => T0 });
    const { fetchImpl } = osmReplay({
      overpass: (c) => (c.url === first ? new Response("rate limited", { status: 429, headers: { "retry-after": "300" } }) : undefined),
    });
    await parksNear(center, { store, fetchImpl, env: {}, now: () => T0 });
    expect(await breakerRetryAfter(store, breakerName(first), T0)).toBe(300);
  });

  it("a hung endpoint times out and fails over", async () => {
    const { fetchImpl, calls } = osmReplay({
      overpass: (c) =>
        c.url === first
          ? new Promise<Response>((_, reject) => c.init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
          : undefined,
    });
    const r = await parksNear(center, { store: new MemoryStore(), fetchImpl, env: {}, timeoutMs: 50 });
    expect(r.parks.length).toBe(10);
    expect(calls).toHaveLength(2);
  });

  it("every endpoint down -> SourceError started:true; then breakers open -> not_called with no request", async () => {
    const store = new MemoryStore({ now: () => T0 });
    const { fetchImpl, calls } = osmReplay({ overpass: () => recordedResponse("overpass-504-too-busy") });
    const err = await runOverpass(parksQuery(center), { store, fetchImpl, env: {}, now: () => T0 }).catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err.code).toBe("busy");
    expect(err.started).toBe(true);
    expect(calls.map((c) => c.url)).toEqual(OVERPASS_DEFAULT_URLS);

    const err2 = await runOverpass(parksQuery(center), { store, fetchImpl, env: {}, now: () => T0 }).catch((e) => e);
    expect(err2.code).toBe("not_called");
    expect(err2.started).toBe(false);
    expect(err2.retryAfter).toBe(60);
    expect(calls).toHaveLength(OVERPASS_DEFAULT_URLS.length);
  });

  it("the total wait is bounded: a hung first server uses the budget and no new attempt starts with < 8 s left", async () => {
    const { fetchImpl, calls } = osmReplay({
      overpass: (c) =>
        new Promise<Response>((_, reject) => c.init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    });
    const t0 = Date.now();
    // Budget 600 ms, 250 ms per attempt (the minimum attempt is then 250 ms instead of 8 s):
    // attempts 1 and 2 hang 250 ms each; ~100 ms left is too little to start the third server.
    const err = await runOverpass(parksQuery(center), { store: new MemoryStore(), fetchImpl, env: {}, timeoutMs: 250, totalBudgetMs: 600 }).catch((e) => e);
    expect(err.code).toBe("timeout");
    expect(calls).toHaveLength(2);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it("the third endpoint (live-verified mail.ru mirror) is used when the first two fail", async () => {
    const [, , third] = OVERPASS_DEFAULT_URLS;
    const { fetchImpl, calls } = osmReplay({
      overpass: (c) => (c.url === third ? undefined : recordedResponse("overpass-504-too-busy")),
    });
    const r = await parksNear(center, { store: new MemoryStore(), fetchImpl, env: {} });
    expect(r.parks).toHaveLength(10);
    expect(calls.map((c) => c.url)).toEqual(OVERPASS_DEFAULT_URLS);
  });

  it("a 400 (our query is wrong) does not fail over", async () => {
    const { fetchImpl, calls } = osmReplay({ overpass: () => new Response("parse error", { status: 400 }) });
    const err = await runOverpass("bad", { store: new MemoryStore(), fetchImpl, env: {} }).catch((e) => e);
    expect(err.code).toBe("bad_output");
    expect(calls).toHaveLength(1);
  });

  it("OVERPASS_URLS keeps only plain https URLs", () => {
    expect(overpassEndpoints({})).toEqual(OVERPASS_DEFAULT_URLS);
    expect(overpassEndpoints({ OVERPASS_URLS: "http://evil.test/api, https://u:p@x.test/api ,https://a.test/api" })).toEqual([
      "https://a.test/api",
    ]);
    expect(overpassEndpoints({ OVERPASS_URLS: "nonsense" })).toEqual(OVERPASS_DEFAULT_URLS);
  });
});
