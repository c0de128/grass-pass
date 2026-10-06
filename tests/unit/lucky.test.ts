/**
 * S6 Lucky Finds (SPEC F8): the SerpApi client, park -> place matching, mention counting, caps, the
 * 30-day cache, the honest off/empty states, and that review text never reaches the prompt.
 * Every SerpApi answer here is a LIVE recording (tests/fixtures/serpapi, 2026-10-06). Shapes that can't
 * be recorded on demand (a 429, a 5xx, a network error, a hang) are built inside the test that needs
 * them and say so; pages "derived" from a recording are cut from it and say how.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getStore, resetStores, type Store } from "@/lib/cache/store";
import { limitsConfig, quotaUsage } from "@/lib/limits";
import { SERPAPI_DAY_QUOTA, SERPAPI_MONTH_QUOTA, serpapiCaps } from "@/lib/limits/serpapi";
import { setLogSink } from "@/lib/log";
import { localCycle, localDay } from "@/lib/time";
import { dailyPace, noteDailyCommands, noteMonthlyCommands, resetBudget } from "@/lib/limits/budget";
import { buildMessages, computeMix, planRequest } from "@/lib/ai/prompt";
import { validateDraft } from "@/lib/ai/validate";
import {
  keywordsFor,
  loadLucky,
  LUCKY_COPY,
  LUCKY_EVIDENCE_RE,
  LUCKY_KEYWORDS,
  luckyEvidence,
  luckyItem,
  MIN_MENTIONS,
} from "@/lib/pool/lucky";
import {
  countMentions,
  mapsParams,
  matchPlace,
  parsePlaces,
  reviewsParams,
  SERPAPI_ENDPOINT,
  SerpapiError,
  serpapiGet,
  serpapiKey,
  windowStartMs,
} from "@/lib/sources/serpapi";
import { serpBody, serpFixture, serpReplay, type SerpCall } from "./support/serpapi-replay";

/** Shaped like a SerpApi key (64 hex), NOT a real key. */
const KEY = "0123456789abcdef".repeat(4);
const ENV = { SERPAPI_API_KEY: KEY };

/** Our OpenStreetMap parks (ids and centres from src/data/osm/dfw-parks.json). */
const ARBOR = { id: "way/38113837", name: "Arbor Hills Nature Preserve", lat: 33.04894, lng: -96.85205 };
const CELEBRATION = { id: "way/188145317", name: "Celebration Park", lat: 33.10824, lng: -96.62468 };
const CONNEMARA = { id: "way/306191453", name: "Connemara Meadow Preserve", lat: 33.08485, lng: -96.70155 };
/** The made-up name sent for the "no such park" recording (a West Texas point). */
const NONSENSE = { id: "way/1", name: "Zqxwv Plimbort Meadow Preserve", lat: 31.8, lng: -103.2 };

const body = (name: string) => serpBody(serpFixture(name));
const REV = {
  arborDog: "google-maps-reviews-arbor-hills-dog",
  arborBike: "google-maps-reviews-arbor-hills-bike",
  arborSkate: "google-maps-reviews-arbor-hills-skateboard",
  celDog: "google-maps-reviews-celebration-park-dog",
  celBike: "google-maps-reviews-celebration-park-bike",
  celDucks: "google-maps-reviews-celebration-park-ducks",
};
/** When the reviews were recorded: counts at that moment. */
const REC_AT = Date.parse(serpFixture(REV.arborDog)._recording.fetchedAt);
const DAY = 24 * 3600 * 1000;

/** Every review snippet in the recordings (to prove none of them ever leaves the counting code). */
const SNIPPETS = Object.values(REV).flatMap((n) =>
  ((body(n).reviews as { snippet?: string }[] | undefined) ?? []).map((r) => r.snippet ?? "").filter((s) => s.length >= 15),
);

let lines: string[];
let restore: () => void;
let store: Store;
beforeEach(() => {
  resetStores();
  lines = [];
  restore = setLogSink((_l, line) => lines.push(line));
  store = getStore("limits");
});
afterEach(() => restore());

const json = (b: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });
const usage = async (now: number) => ({
  day: (await quotaUsage(store, { name: SERPAPI_DAY_QUOTA, period: { kind: "day" }, now })).global,
  month: (await quotaUsage(store, { name: SERPAPI_MONTH_QUOTA, period: { kind: "cycle", startDay: 1 }, now })).global,
});

describe("SerpApi key and requests", () => {
  it("reads a key-shaped SERPAPI_API_KEY only; placeholders and URLs are 'not connected'", () => {
    expect(serpapiKey({ SERPAPI_API_KEY: KEY })).toBe(KEY);
    expect(serpapiKey({ SERPAPI_API_KEY: ` ${KEY} ` })).toBe(KEY);
    for (const bad of [undefined, "", "your-key-here", "changeme", `https://serpapi.com/?api_key=${KEY}`, "abc"]) {
      expect(serpapiKey({ SERPAPI_API_KEY: bad })).toBeNull();
    }
  });

  it("builds exactly the requests that were recorded live (so the recordings answer the app's own requests)", () => {
    const strip = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== "google_domain").map(([k, v]) => [k, String(v)]));
    expect(mapsParams(ARBOR)).toEqual(strip(serpFixture("google-maps-arbor-hills-nature-preserve").search_parameters!));
    expect(mapsParams(CELEBRATION)).toEqual(strip(serpFixture("google-maps-celebration-park").search_parameters!));
    expect(reviewsParams("0x864c10f458a11fdb:0xf0f51397eb1115b6", "dog")).toEqual(strip(serpFixture(REV.celDog).search_parameters!));
    expect(() => reviewsParams("ChIJCeGMib4kTIYRI0lqACKD0cM", "dog")).toThrow(RangeError);
    expect(() => reviewsParams("0x1:0x2", "dog&api_key=x")).toThrow(RangeError);
  });
});

describe("park -> Google place (real google_maps answers)", () => {
  it("Arbor Hills: one place_results (type is an array there) is the park, ~380 m from our centre", () => {
    const places = parsePlaces(body("google-maps-arbor-hills-nature-preserve"));
    expect(places).toHaveLength(1);
    const m = matchPlace(ARBOR, places);
    expect(m).toMatchObject({ ok: true, place: { dataId: "0x864c24be898ce109:0xc3d18322006a4923", title: "Arbor Hills Nature Preserve", similarity: 1 } });
    if (m.ok) expect(m.place.distanceM).toBeLessThan(1000);
  });

  it("Celebration Park: picks the park, not its own tennis courts or fields, nor the same-name park in Lucas 13 km away", () => {
    const places = parsePlaces(body("google-maps-celebration-park"));
    expect(places.length).toBeGreaterThanOrEqual(9);
    expect(places.some((p) => p.title === "Celebration Park, Lucas, Tx")).toBe(true);
    const m = matchPlace(CELEBRATION, places);
    expect(m).toMatchObject({ ok: true, place: { dataId: "0x864c10f458a11fdb:0xf0f51397eb1115b6", title: "Celebration Park" } });
  });

  it("Connemara: 'Connemara Meadow Nature Preserve' (82 reviews) beats the 8-review 'Connemara Meadow' hiking area", () => {
    const m = matchPlace(CONNEMARA, parsePlaces(body("google-maps-connemara-meadow-preserve")));
    expect(m).toMatchObject({ ok: true, place: { title: "Connemara Meadow Nature Preserve", dataId: "0x864c17dd1dbafe01:0xa970c7c0ca7f7f50" } });
    if (m.ok) expect(m.place.distanceM).toBeLessThan(1000);
  });

  it("a made-up name still came back with ONE place (a preserve in Illinois): rejected, no match", () => {
    const places = parsePlaces(body("google-maps-nonsense-name-west-texas"));
    expect(places).toHaveLength(1);
    expect(places[0].title).toBe("Plum Creek Meadow");
    expect(matchPlace(NONSENSE, places)).toEqual({ ok: false, why: "name" });
  });

  it("the right name but far away is rejected (derived: Arbor Hills' real answer, our park point moved to Celebration Park, 21 km)", () => {
    const places = parsePlaces(body("google-maps-arbor-hills-nature-preserve"));
    expect(matchPlace({ ...ARBOR, lat: CELEBRATION.lat, lng: CELEBRATION.lng }, places)).toEqual({ ok: false, why: "distance" });
  });

  it("a place that is only a court is never the park (derived: Celebration's real list, park named like its tennis courts)", () => {
    const places = parsePlaces(body("google-maps-celebration-park"));
    expect(matchPlace({ ...CELEBRATION, name: "Celebration Park Tennis Courts" }, places)).toEqual({ ok: false, why: "type" });
  });

  it("no results (SerpApi's 200 'no results' -> null) is no match", () => {
    expect(parsePlaces(null)).toEqual([]);
    expect(matchPlace(ARBOR, [])).toEqual({ ok: false, why: "no_results" });
  });
});

describe("committed review fixtures keep no full review text (R3 privacy, public repo)", () => {
  it("every kept word is within 3 words of a keyword the counting code matches; reviews without one keep an empty snippet", () => {
    const res = Object.values(LUCKY_KEYWORDS).map((k) => k.mentions);
    const hits = (w: string, next = "") => res.some((re) => re.test(w)) || LUCKY_KEYWORDS.skateboard.mentions.test(`${w} ${next}`);
    let checked = 0;
    for (const n of [...Object.values(REV), "google-maps-reviews-arbor-hills-newest-topics"]) {
      for (const r of (body(n).reviews as { snippet?: string; iso_date?: string }[] | undefined) ?? []) {
        expect(r.iso_date).toMatch(/^\d{4}-\d{2}-\d{2}T/); // the date stays: the window test needs it
        for (const seg of (r.snippet ?? "").split(" … ").filter(Boolean)) {
          const words = seg.split(/\s+/);
          const at = words.flatMap((w, i) => (hits(w, words[i + 1]) ? [i] : []));
          expect(at.length, `${n}: "${seg}"`).toBeGreaterThan(0);
          for (let i = 0; i < words.length; i++) expect(at.some((j) => Math.abs(i - j) <= 4), `${n}: "${seg}"`).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(60);
  });
});

describe("counting mentions (real google_maps_reviews pages)", () => {
  const dog = LUCKY_KEYWORDS.dog.mentions;

  it("Arbor Hills dogs: all 20 on the page are recent and a next page exists -> 'at least 20', newest Sep 24 2026", () => {
    expect(countMentions(body(REV.arborDog), dog, REC_AT)).toEqual({ count: 20, atLeast: true, newestMs: Date.parse("2026-09-24T02:31:48Z") });
  });

  it("the 24-month window: a year later only 12 of the same 20 count (and the count is exact: the page reaches past the window)", () => {
    expect(countMentions(body(REV.arborDog), dog, REC_AT + 365 * DAY)).toMatchObject({ count: 12, atLeast: false });
  });

  it("a review counts by its LAST EDIT date (posted 2017 / Jul 2025, edited Nov 2025 / Jul 2026: inside the window a year later)", () => {
    const b = body(REV.arborDog) as { reviews: { iso_date: string; iso_date_of_last_edit?: string }[] };
    expect(b.reviews.find((r) => r.iso_date.startsWith("2017-10-25"))?.iso_date_of_last_edit).toBe("2025-11-20T00:47:03Z");
    expect(b.reviews.find((r) => r.iso_date.startsWith("2025-07-23"))?.iso_date_of_last_edit).toBe("2026-07-06T14:55:27Z");
    // Derived: the same page with every edit date removed (first-posted dates only) counts those two fewer.
    const posted = { ...b, reviews: b.reviews.map(({ iso_date_of_last_edit: _e, ...r }) => (void _e, r)) };
    expect(countMentions(posted, dog, REC_AT + 365 * DAY).count).toBe(10);
  });

  it("Celebration Park: dogs 4 (exact, newest Mar 2026); bikes 0 (newest Sep 28 2024, just outside); ducks 2 (below 3)", () => {
    expect(countMentions(body(REV.celDog), dog, REC_AT)).toEqual({ count: 4, atLeast: false, newestMs: Date.parse("2026-03-14T21:48:43Z") });
    expect(countMentions(body(REV.celBike), LUCKY_KEYWORDS.bike.mentions, REC_AT)).toEqual({ count: 0, atLeast: false, newestMs: null });
    const ducks = countMentions(body(REV.celDucks), LUCKY_KEYWORDS.duck.mentions, REC_AT);
    expect(ducks).toMatchObject({ count: 2, atLeast: false });
    expect(ducks.count).toBeLessThan(MIN_MENTIONS);
  });

  it("Arbor Hills skateboards: Google matched 1 review, from 2018 -> 0", () => {
    expect(countMentions(body(REV.arborSkate), LUCKY_KEYWORDS.skateboard.mentions, REC_AT).count).toBe(0);
  });

  it("only a review's OWN text counts (Google's filter alone is not trusted): the bike page has 3 reviews that mention dogs", () => {
    expect(countMentions(body(REV.arborBike), dog, REC_AT).count).toBe(3);
    expect(countMentions(body(REV.arborDog), LUCKY_KEYWORDS.duck.mentions, REC_AT).count).toBe(0);
  });

  it("the threshold: 2 recent mentions are not enough (derived: Arbor dogs cut to its first 2 reviews, no next page)", () => {
    const b = body(REV.arborDog) as { reviews: unknown[] };
    const two = { reviews: b.reviews.slice(0, 2) };
    expect(countMentions(two, dog, REC_AT)).toMatchObject({ count: 2, atLeast: false });
    expect(countMentions({ reviews: b.reviews.slice(0, 3) }, dog, REC_AT).count).toBe(MIN_MENTIONS);
  });

  it("a review dated after 'now' (+1 day) is not counted (clock skew guard)", () => {
    // Now = Sep 20 2026: the Sep 24 review is in the future; the window starts Sep 20 2024, so the other 19 count.
    expect(countMentions(body(REV.arborDog), dog, Date.parse("2026-09-20T12:00:00Z")).count).toBe(19);
  });

  it("no results is an honest zero", () => {
    expect(countMentions(null, dog, REC_AT)).toEqual({ count: 0, atLeast: false, newestMs: null });
  });

  it("the window is 24 calendar months", () => {
    expect(new Date(windowStartMs(Date.parse("2026-10-06T04:00:00Z"))).toISOString()).toBe("2024-10-06T04:00:00.000Z");
    expect(new Date(windowStartMs(Date.parse("2026-02-28T12:00:00Z"))).toISOString()).toBe("2024-02-28T12:00:00.000Z");
  });
});

describe("evidence and pool items (code-written)", () => {
  it("the evidence line says the real count, the window and the newest month", () => {
    const cel = luckyEvidence({ keyword: "dog", ...countMentions(body(REV.celDog), LUCKY_KEYWORDS.dog.mentions, REC_AT) }, REC_AT);
    expect(cel).toBe("4 visitor reviews since Oct 2024 mention dogs, newest Mar 2026 · Google reviews via SerpApi");
    const arbor = luckyEvidence({ keyword: "dog", ...countMentions(body(REV.arborDog), LUCKY_KEYWORDS.dog.mentions, REC_AT) }, REC_AT);
    expect(arbor).toBe("at least 20 visitor reviews since Oct 2024 mention dogs, newest Sep 2026 · Google reviews via SerpApi");
    expect(LUCKY_EVIDENCE_RE.test(cel) && LUCKY_EVIDENCE_RE.test(arbor)).toBe(true);
  });

  it("the pool item's source text is fixed copy: no count, no review text, and its name words are forbidden in clues", () => {
    const item = luckyItem({ keyword: "dog", count: 4, atLeast: false, newestMs: Date.parse("2026-03-14T21:48:43Z") }, REC_AT);
    expect(item).toMatchObject({ id: "lucky-dog", section: "lucky", source: "Google reviews via SerpApi", stationary: false });
    expect(item.sourceText).not.toMatch(/\d/);
    for (const s of SNIPPETS) expect(item.sourceText).not.toContain(s.slice(0, 25));
    expect(item.nameWords).toEqual(expect.arrayContaining(["dog", "dogs", "puppy"]));
    expect(item.safety ?? "").not.toMatch(/dog|pupp/i); // printed on the kid's row: it must not give the answer away
    expect(item.evidence.length).toBeLessThanOrEqual(160);
  });

  it("keywords: dogs, bikes, then ducks for a park with a pond or lake, else skateboards", () => {
    expect(keywordsFor({ features: { water: { count: 2, names: [] } } }).map((k) => k.id)).toEqual(["dog", "bike", "duck"]);
    expect(keywordsFor({ features: {} }).map((k) => k.id)).toEqual(["dog", "bike", "skateboard"]);
    expect(keywordsFor(null)).toHaveLength(3);
  });
});

describe("serpapiGet: key, host, redirects, caps and failures", () => {
  const params = () => mapsParams(ARBOR);

  it("sends the key only to https://serpapi.com/search.json, refuses redirects, and counts the search on both caps", async () => {
    const r = serpReplay();
    const out = await serpapiGet(params(), "maps", { store, env: ENV, fetchImpl: r.fetchImpl });
    expect(out).toMatchObject({ place_results: { title: "Arbor Hills Nature Preserve" } });
    const u = new URL(r.calls[0].url);
    expect(`${u.origin}${u.pathname}`).toBe(SERPAPI_ENDPOINT);
    expect(u.searchParams.get("api_key")).toBe(KEY);
    expect(r.calls[0].init?.redirect).toBe("error");
    expect(await usage(Date.now())).toEqual({ day: 1, month: 1 });
    expect(lines.join("\n")).not.toContain(KEY);
    expect(lines.join("\n")).not.toContain("serpapi.com/search");
  });

  it("the daily cap stops the next search BEFORE anything is sent (and gives the month slot back)", async () => {
    const r = serpReplay();
    const env = { ...ENV, SERPAPI_DAILY_CAP: "2" };
    await serpapiGet(params(), "maps", { store, env, fetchImpl: r.fetchImpl });
    await serpapiGet(params(), "maps", { store, env, fetchImpl: r.fetchImpl });
    await expect(serpapiGet(params(), "maps", { store, env, fetchImpl: r.fetchImpl })).rejects.toMatchObject({ kind: "daily_cap", started: false });
    expect(r.calls).toHaveLength(2);
    expect(await usage(Date.now())).toEqual({ day: 2, month: 2 });
  });

  it("the monthly cap stops searches too, and is hard-clamped to the free 250", async () => {
    const r = serpReplay();
    const env = { ...ENV, SERPAPI_MONTHLY_CAP: "1" };
    await serpapiGet(params(), "maps", { store, env, fetchImpl: r.fetchImpl });
    await expect(serpapiGet(params(), "maps", { store, env, fetchImpl: r.fetchImpl })).rejects.toMatchObject({ kind: "monthly_cap" });
    expect(r.calls).toHaveLength(1);
    expect(serpapiCaps({ SERPAPI_MONTHLY_CAP: "999" }).monthly).toBe(250);
    expect(limitsConfig({ SERPAPI_MONTHLY_CAP: "250000" }).serpapiMonthlyCap).toBe(250);
    expect(serpapiCaps({})).toEqual({ daily: 12, monthly: 200, renewsDay: 1 });
    expect(serpapiCaps({ SERPAPI_RENEWS_DAY: "16" }).renewsDay).toBe(16);
    expect(serpapiCaps({ SERPAPI_RENEWS_DAY: "31" }).renewsDay).toBe(28);
  });

  it("a real 401 (bad key): 'auth', charged, breaker open (the next search is refused unsent), key never in logs or the error", async () => {
    const rec = serpFixture("error-401-invalid-key");
    const r = serpReplay({ answer: () => json(serpBody(rec), rec._recording.httpStatus) });
    const err = await serpapiGet(params(), "maps", { store, env: ENV, fetchImpl: r.fetchImpl }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SerpapiError);
    expect(err).toMatchObject({ kind: "auth", started: true, status: 401 });
    expect(String((err as Error).message)).not.toContain(KEY);
    expect(await usage(Date.now())).toEqual({ day: 1, month: 1 });
    await expect(serpapiGet(params(), "maps", { store, env: ENV, fetchImpl: r.fetchImpl })).rejects.toMatchObject({ kind: "breaker", started: false });
    expect(r.calls).toHaveLength(1);
    expect(lines.join("\n")).not.toContain(KEY);
  });

  it("429 (built: SerpApi's documented 'run out of searches' answer) -> 'quota', breaker for Retry-After", async () => {
    const r = serpReplay({ answer: () => json({ error: "Your account has run out of searches." }, 429, { "retry-after": "120" }) });
    await expect(serpapiGet(params(), "maps", { store, env: ENV, fetchImpl: r.fetchImpl })).rejects.toMatchObject({ kind: "quota", started: true });
    await expect(serpapiGet(params(), "maps", { store, env: ENV, fetchImpl: r.fetchImpl, now: () => Date.now() + 100_000 })).rejects.toMatchObject({ kind: "breaker" });
    // After Retry-After it may try again.
    await expect(serpapiGet(params(), "maps", { store, env: ENV, fetchImpl: serpReplay().fetchImpl, now: () => Date.now() + 130_000 })).resolves.toBeTruthy();
  });

  it("5xx (built) -> 'down', still charged", async () => {
    const r = serpReplay({ answer: () => new Response("upstream error", { status: 502 }) });
    await expect(serpapiGet(params(), "maps", { store, env: ENV, fetchImpl: r.fetchImpl })).rejects.toMatchObject({ kind: "down", started: true });
    expect(await usage(Date.now())).toEqual({ day: 1, month: 1 });
  });

  it("a network error that quotes the URL (built) never leaks the key into the error or the logs", async () => {
    const fetchImpl = async (url: string): Promise<Response> => {
      throw new TypeError(`fetch failed for ${url}`);
    };
    const err = await serpapiGet(params(), "maps", { store, env: ENV, fetchImpl }).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "down", started: true });
    expect(JSON.stringify(err)).not.toContain(KEY);
    expect(String((err as Error).message)).not.toContain(KEY);
    expect((err as Error).cause).toBeUndefined();
    expect(lines.join("\n")).not.toContain(KEY);
  });

  it("our deadline stopping a sent search (built: a hang): 'aborted' and charged; a deadline that already passed sends nothing", async () => {
    const ac = new AbortController();
    const hang = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal!.reason)));
    const p = serpapiGet(params(), "maps", { store, env: ENV, fetchImpl: hang, signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toMatchObject({ kind: "aborted", started: true });
    expect(await usage(Date.now())).toEqual({ day: 1, month: 1 });

    const r = serpReplay();
    const done = new AbortController();
    done.abort();
    await expect(serpapiGet(params(), "maps", { store, env: ENV, fetchImpl: r.fetchImpl, signal: done.signal })).rejects.toMatchObject({ kind: "aborted", started: false });
    expect(r.calls).toHaveLength(0);
    expect(await usage(Date.now())).toEqual({ day: 1, month: 1 });
  });

  it("SerpApi's 200 'no results' answer is an honest null, not an error", async () => {
    const r = serpReplay({ answer: () => json({ search_metadata: { status: "Success" }, error: "Google hasn't returned any results for this query." }) });
    await expect(serpapiGet(params(), "maps", { store, env: ENV, fetchImpl: r.fetchImpl })).resolves.toBeNull();
  });
});

describe("the SerpApi plan cycle (the monthly cap resets on the plan's renewal day)", () => {
  it("starts on SERPAPI_RENEWS_DAY at Chicago midnight", () => {
    // Oct 6 04:00 UTC = Oct 5, 11 PM CDT: the cycle that renews on the 16th began Sep 16 and resets Oct 16 05:00 UTC.
    expect(localCycle(Date.parse("2026-10-06T04:00:00Z"), 16)).toEqual({ id: "2026-09-16", resetSec: (Date.parse("2026-10-16T05:00:00Z") - Date.parse("2026-10-06T04:00:00Z")) / 1000 });
    expect(localCycle(Date.parse("2026-10-20T12:00:00Z"), 16).id).toBe("2026-10-16");
    expect(localCycle(Date.parse("2026-01-05T12:00:00Z"), 16).id).toBe("2025-12-16");
    expect(localCycle(Date.parse("2026-10-06T12:00:00Z"), 1).id).toBe("2026-10-01");
    // 05:30 UTC on Oct 16 is 00:30 CDT: the new cycle has started.
    expect(localCycle(Date.parse("2026-10-16T05:30:00Z"), 16).id).toBe("2026-10-16");
  });

  it("a search late in one cycle and one early in the next are counted apart; across the 1st they are not", async () => {
    const r = serpReplay();
    const env = { ...ENV, SERPAPI_MONTHLY_CAP: "1", SERPAPI_RENEWS_DAY: "16" };
    await serpapiGet(mapsParams(ARBOR), "maps", { store, env, fetchImpl: r.fetchImpl, now: () => Date.parse("2026-10-30T15:00:00Z") });
    // Nov 2 is still the Oct 16 cycle: refused.
    await expect(serpapiGet(mapsParams(ARBOR), "maps", { store, env, fetchImpl: r.fetchImpl, now: () => Date.parse("2026-11-02T15:00:00Z") })).rejects.toMatchObject({ kind: "monthly_cap" });
    // Nov 16 starts a new cycle.
    await expect(serpapiGet(mapsParams(ARBOR), "maps", { store, env, fetchImpl: r.fetchImpl, now: () => Date.parse("2026-11-16T15:00:00Z") })).resolves.toBeTruthy();
  });
});

describe("loadLucky (the whole lookup)", () => {
  const deps = (fetchImpl: (u: string, i?: RequestInit) => Promise<Response>, env: Record<string, string> = ENV, now = REC_AT) => ({
    store,
    env,
    now: () => now,
    fetchImpl,
  });
  const withWater = { features: { water: { count: 2, names: [] } } };

  it("no key: Lucky Finds off with 'not connected', nothing sent", async () => {
    const r = serpReplay();
    const out = await loadLucky(CELEBRATION, withWater, deps(r.fetchImpl, {}));
    expect(out).toEqual({ items: [], state: { status: "off", message: LUCKY_COPY.notConnected }, checkedAt: null, searches: 0 });
    expect(r.calls).toHaveLength(0);
  });

  it("Celebration Park (real): 4 searches (place, dogs, bikes, ducks) -> 1 Lucky Find (dogs, 4 reviews); cached: the next pass sends 0", async () => {
    const r = serpReplay();
    const out = await loadLucky(CELEBRATION, withWater, deps(r.fetchImpl));
    expect(r.calls.map((c) => c.params.engine === "google_maps" ? "maps" : c.params.query)).toEqual(["maps", "dog", "bike", "ducks"]);
    expect(out.searches).toBe(4);
    expect(out.state).toEqual({ status: "ok" });
    expect(out.items.map((i) => [i.id, i.evidence])).toEqual([["lucky-dog", "4 visitor reviews since Oct 2024 mention dogs, newest Mar 2026 · Google reviews via SerpApi"]]);
    // Review text never leaves the counting code: not in the result, not in the logs.
    const all = JSON.stringify(out) + lines.join("\n");
    for (const s of SNIPPETS) expect(all).not.toContain(s.slice(0, 25));

    const again = serpReplay();
    const hit = await loadLucky(CELEBRATION, withWater, deps(again.fetchImpl, ENV, REC_AT + DAY));
    expect(again.calls).toHaveLength(0);
    expect(hit).toMatchObject({ searches: 0, state: { status: "ok" } });
    expect(hit.items[0].evidence).toBe(out.items[0].evidence);
    expect(hit.checkedAt).toBe(new Date(REC_AT).toISOString());
  });

  it("Arbor Hills (real, no pond on the map): stops after dogs and bikes both qualify -> 3 searches, 2 Lucky Finds", async () => {
    const r = serpReplay();
    const out = await loadLucky(ARBOR, { features: {} }, deps(r.fetchImpl));
    expect(out.searches).toBe(3);
    expect(out.items.map((i) => i.id)).toEqual(["lucky-dog", "lucky-bike"]);
    expect(out.items[1].evidence).toBe("at least 20 visitor reviews since Oct 2024 mention bikes, newest Jul 2026 · Google reviews via SerpApi");
  });

  it("no matching Google place (real nonsense-name answer): honest 'couldn't match' copy, 1 search, cached", async () => {
    const r = serpReplay();
    const out = await loadLucky(NONSENSE, null, deps(r.fetchImpl));
    expect(out.state).toEqual({ status: "empty", message: LUCKY_COPY.noMatch(NONSENSE.name) });
    expect(out.searches).toBe(1);
    const again = serpReplay();
    await loadLucky(NONSENSE, null, deps(again.fetchImpl));
    expect(again.calls).toHaveLength(0);
  });

  it("nothing qualifies: 'no visitor reviews ... mention dogs, bikes or skateboards' (derived: every review search answered with Arbor's real skateboard page)", async () => {
    const skate = serpBody(serpFixture(REV.arborSkate));
    const r = serpReplay({ answer: (c: SerpCall) => (c.params.engine === "google_maps_reviews" ? json(skate) : undefined) });
    const out = await loadLucky(ARBOR, { features: {} }, deps(r.fetchImpl));
    expect(out.searches).toBe(4);
    expect(out.state).toEqual({ status: "empty", message: LUCKY_COPY.noEvidence(["dogs", "bikes", "skateboards"]) });
    expect(out.state).toMatchObject({ message: "No data available: no visitor reviews from the last 2 years mention dogs, bikes or skateboards at least 3 times (Google reviews via SerpApi)." });
    const again = serpReplay();
    await loadLucky(ARBOR, { features: {} }, deps(again.fetchImpl));
    expect(again.calls).toHaveLength(0); // negative results are cached too
  });

  it("daily cap reached before any review search: 'free search limit reached today'; not cached, so tomorrow searches again", async () => {
    const r = serpReplay();
    const out = await loadLucky(ARBOR, { features: {} }, deps(r.fetchImpl, { ...ENV, SERPAPI_DAILY_CAP: "1" }));
    expect(out.state).toEqual({ status: "off", message: LUCKY_COPY.dailyCap });
    expect(LUCKY_COPY.dailyCap).toContain("free search limit");
    expect(r.calls).toHaveLength(1); // the place search only
    // Next day (new daily count): the place is cached, so only review searches are sent.
    const next = serpReplay();
    const later = await loadLucky(ARBOR, { features: {} }, deps(next.fetchImpl, { ...ENV, SERPAPI_DAILY_CAP: "1" }, REC_AT + DAY));
    expect(next.calls.map((c) => c.params.engine)).toEqual(["google_maps_reviews"]);
    expect(later.items.map((i) => i.id)).toEqual(["lucky-dog"]); // dogs qualified, then the cap stopped bikes
  });

  it("a cap in the middle keeps what qualified (dogs) but is not cached for 30 days", async () => {
    const r = serpReplay();
    const out = await loadLucky(ARBOR, { features: {} }, deps(r.fetchImpl, { ...ENV, SERPAPI_DAILY_CAP: "2" }));
    expect(out.state).toEqual({ status: "ok" });
    expect(out.items.map((i) => i.id)).toEqual(["lucky-dog"]);
    const again = serpReplay();
    await loadLucky(ARBOR, { features: {} }, deps(again.fetchImpl, ENV, REC_AT + DAY));
    expect(again.calls.length).toBeGreaterThan(0);
  });

  it("monthly cap: 'off for this month'", async () => {
    const out = await loadLucky(ARBOR, { features: {} }, deps(serpReplay().fetchImpl, { ...ENV, SERPAPI_MONTHLY_CAP: "1" }));
    // The place search used the 1 monthly search.
    expect(out.state).toEqual({ status: "off", message: LUCKY_COPY.monthlyCap });
  });

  it("SerpApi refuses the key (real 401): 'did not accept this server's key'", async () => {
    const rec = serpFixture("error-401-invalid-key");
    const r = serpReplay({ answer: () => json(serpBody(rec), 401) });
    const out = await loadLucky(ARBOR, { features: {} }, deps(r.fetchImpl));
    expect(out.state).toEqual({ status: "off", message: LUCKY_COPY.auth });
    expect(lines.join("\n")).not.toContain(KEY);
  });

  it("SerpApi down (built 503): 'didn't answer'", async () => {
    const r = serpReplay({ answer: () => new Response("", { status: 503 }) });
    const out = await loadLucky(ARBOR, { features: {} }, deps(r.fetchImpl));
    expect(out.state).toEqual({ status: "unavailable", message: LUCKY_COPY.down });
  });

  it("the daily store pace (SEC-3-03) stops NEW lookups (nothing sent) but cached counts still show", async () => {
    const r = serpReplay();
    await loadLucky(CELEBRATION, withWater, deps(r.fetchImpl)); // cached now
    const sent = r.calls.length;
    const day = localDay(REC_AT);
    noteMonthlyCommands(1, 500_000, new Date(REC_AT).toISOString().slice(0, 7));
    noteDailyCommands(dailyPace(500_000, REC_AT), day);
    try {
      const paced = await loadLucky(ARBOR, { features: {} }, deps(r.fetchImpl));
      expect(paced.state).toEqual({ status: "off", message: LUCKY_COPY.storePace });
      expect(r.calls.length).toBe(sent);
      const cached = await loadLucky(CELEBRATION, withWater, deps(r.fetchImpl));
      expect(cached.state).toEqual({ status: "ok" });
      expect(r.calls.length).toBe(sent);
    } finally {
      resetBudget();
    }
  });

  it("the pass deadline already passed: 'too slow', nothing sent", async () => {
    const r = serpReplay();
    const ac = new AbortController();
    ac.abort();
    const out = await loadLucky(ARBOR, { features: {} }, { ...deps(r.fetchImpl), signal: ac.signal });
    expect(out.state).toEqual({ status: "unavailable", message: LUCKY_COPY.slow });
    expect(r.calls).toHaveLength(0);
  });
});

describe("the prompt and the checks with Lucky Finds", () => {
  const dogItem = () => luckyItem({ keyword: "dog", ...countMentions(body(REV.celDog), LUCKY_KEYWORDS.dog.mentions, REC_AT) }, REC_AT);

  it("one Lucky Find is asked for when the pool has one; never more than 2", () => {
    expect(computeMix({ park: 10, wild: 16, lucky: 2 }, "6-10")).toMatchObject({ n: 8, min: { park: 2, wild: 2, lucky: 1 }, max: { lucky: 2 } });
    expect(computeMix({ park: 10, wild: 0, lucky: 1 }, "6-10")).toMatchObject({ n: 8, min: { park: 7, lucky: 1 }, max: { park: 7, lucky: 1 } });
    expect(computeMix({ park: 10, wild: 16, lucky: 0 }, "6-10")).toMatchObject({ min: { lucky: 0 }, max: { lucky: 0 } });
  });

  it("the prompt carries the keyword's fixed text and the 'maybe' rule, never a review's text", () => {
    const item = dogItem();
    const plan = planRequest([item, luckyItem({ keyword: "bike", count: 5, atLeast: false, newestMs: REC_AT - DAY }, REC_AT)], "6-10");
    expect(plan).toBeNull(); // Lucky Finds alone are never a pass (build-pass.ts also adds them only to a full pool)
    const mix = computeMix({ park: 0, wild: 0, lucky: 1 }, "4-6") ?? { n: 1, min: { park: 0, wild: 0, lucky: 1 }, max: { park: 0, wild: 0, lucky: 1 }, hardMin: 0 };
    const msgs = buildMessages("Celebration Park", [item], "6-10", mix, null, { month: 10 });
    const all = msgs.map((m) => m.content).join("\n");
    expect(all).toContain('<source id="lucky-dog" section="lucky"');
    expect(all).toContain("Google reviews of this park from the last two years mention dogs");
    expect(all).toContain('Lucky Finds (section "lucky") come and go');
    for (const s of SNIPPETS) expect(all).not.toContain(s.slice(0, 25));
    expect(all).not.toMatch(/\b4 visitor reviews\b/);
  });

  it("a Lucky Find clue is checked like any other: grounded quote kept, the name or an unknown quote dropped", () => {
    const item = dogItem();
    const mix = { n: 1, min: { park: 0, wild: 0, lucky: 1 }, max: { park: 0, wild: 0, lucky: 1 }, hardMin: 0 };
    const ask = (clue: string, sourceQuote: string) =>
      validateDraft({ items: [{ itemId: "lucky-dog", clue, lookWhere: "by the path", sourceQuote, difficulty: "easy" }] }, [item], mix, { hasMap: false });
    // Clue texts below are test inputs for the checker (what a model might write), not data shown anywhere.
    expect(ask("You might see a furry pet with a wagging tail on a leash today.", "a wagging tail").items).toHaveLength(1);
    expect(ask("You might see a dog on a leash today.", "a wagging tail").drops).toEqual({ name_leak: 1 });
    expect(ask("You might see a furry pet with a wagging tail today.", "barks at squirrels").drops).toEqual({ not_grounded: 1 });
  });
});
