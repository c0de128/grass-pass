import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OctoberBox, octoberStubText } from "@/components/pass/OctoberBox";
import { MemoryStore, resetStores } from "@/lib/cache/store";
import { tripBreaker } from "@/lib/limits";
import { setLogSink } from "@/lib/log";
import {
  isOctoberBoxDay,
  isOctoberDay,
  milkweedLine,
  OCTOBER_REASONS,
  OCTOBER_TIP,
  OCTOBER_WINDOW_LABEL,
  octoberCompare,
  octoberDetail,
  octoberHeadline,
  OctoberBoxSchema,
  type OctoberBoxData,
} from "@/lib/october";
import { formatTime } from "@/lib/pass/format";
import { makePass, resetPassMaking } from "@/lib/pass/make";
import { PassSchema } from "@/lib/pass/schema";
import {
  milkweedCountUrl,
  MONARCH_CACHE_SEC,
  monarchHistogramUrl,
  monarchWindows,
  OCTOBER_NEGATIVE_SEC,
  octoberBox,
  parseMonarchHistogram,
  parseTotal,
  sameDayLastYear,
} from "@/lib/sources/inat-monarch";
import { PARKS, passReplay, rec } from "./support/pass-replay";

// Live recordings made 2026-10-05 ~23:39 UTC (6:39 PM CDT) by octoberBox() itself (see tests/fixtures/README.md).
const hist = (slug: string) => rec(`inat-monarch-histogram-${slug}`);
const milk = (slug: string) => rec(`inat-milkweed-count-${slug}`);
const AT = hist(PARKS.connemara.slug)._recording.recordedAtMs as number;
const CENTER = {
  connemara: { id: PARKS.connemara.id, lat: 33.08485, lng: -96.70155 },
  celebration: { id: PARKS.celebration.id, lat: 33.10824, lng: -96.62468 },
};
/** A queue that runs at once (the real one spaces iNat calls 1 s apart). */
const noWait = { run: <T,>(fn: () => Promise<T>) => fn() };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

let logs: string[];
let restore: () => void;
beforeEach(() => {
  resetStores();
  resetPassMaking();
  logs = [];
  restore = setLogSink((_l, line) => logs.push(line));
});
afterEach(() => {
  restore();
  vi.useRealTimers();
});
/** Cache TTLs run on the cache store clock (Date.now), so TTL tests set the system date (timers stay real). */
function clockAt(ms: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(ms);
}
/**
 * The app clock for octoberBox(): every reading moves 1 s on, so each iNat request gets its own
 * shared per-second slot at once (a frozen clock would wait for the slot store to expire).
 */
function stepping(start: number): () => number {
  let t = start - 1001;
  return () => (t += 1001);
}
/** A clock that starts at `start` and moves with real time (makePass: many readings, real deadline). */
function ticking(start: number): () => number {
  const t0 = performance.now();
  return () => start + Math.round(performance.now() - t0);
}
const within = (iso: string, from: number, ms = 60_000) => Date.parse(iso) >= from && Date.parse(iso) < from + ms;

describe("monarch windows and URLs", () => {
  it("Oct 5 (Chicago) -> the Wild Finds 14-day window, and the same days last year", () => {
    expect(monarchWindows(AT)).toEqual({
      thisYear: { d1: "2026-09-21", d2: "2026-10-05" },
      lastYear: { d1: "2025-09-21", d2: "2025-10-05" },
    });
    // 11:30 PM CDT on Oct 5 is 04:30 UTC Oct 6: still Oct 5 in Chicago.
    expect(monarchWindows(Date.UTC(2026, 9, 6, 4, 30)).thisYear.d2).toBe("2026-10-05");
    expect(monarchWindows(Date.UTC(2026, 9, 6, 5, 30)).thisYear).toEqual({ d1: "2026-09-22", d2: "2026-10-06" });
  });

  it("same day last year clamps Feb 29 and rejects junk", () => {
    expect(sameDayLastYear("2028-02-29")).toBe("2027-02-28");
    expect(sameDayLastYear("2026-10-31")).toBe("2025-10-31");
    expect(() => sameDayLastYear("10/05/2026")).toThrow(RangeError);
  });

  it("the URLs are exactly the ones recorded live (taxon 48662 within 25 km; 47906 within 1.5 km)", () => {
    const w = monarchWindows(AT);
    for (const p of ["connemara", "celebration"] as const) {
      const slug = PARKS[p].slug;
      expect(monarchHistogramUrl(CENTER[p], w.lastYear.d1, w.thisYear.d2)).toBe(hist(slug)._recording.url);
      expect(milkweedCountUrl(CENTER[p])).toBe(milk(slug)._recording.url);
    }
    const u = new URL(monarchHistogramUrl(CENTER.connemara, "2025-09-21", "2026-10-05"));
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ taxon_id: "48662", radius: "25", verifiable: "true", interval: "day", date_field: "observed" });
    expect(new URL(milkweedCountUrl(CENTER.connemara)).searchParams.get("taxon_id")).toBe("47906");
    expect(() => monarchHistogramUrl(CENTER.connemara, "2026-10-05", "2025-09-21")).toThrow(RangeError);
    expect(() => monarchHistogramUrl({ lat: Number.NaN, lng: 0 }, "2025-09-21", "2026-10-05")).toThrow(RangeError);
  });
});

describe("parsing the live recordings", () => {
  it("Connemara: 9 monarchs since Sep 21 vs 63 in 2025 (the ADR 0002 numbers); Celebration: 9 vs 56", () => {
    const w = monarchWindows(AT);
    expect(parseMonarchHistogram(hist(PARKS.connemara.slug).body, w)).toEqual({
      thisYear: { d1: "2026-09-21", d2: "2026-10-05", count: 9 },
      lastYear: { d1: "2025-09-21", d2: "2025-10-05", count: 63 },
    });
    const c = parseMonarchHistogram(hist(PARKS.celebration.slug).body, w);
    expect([c.thisYear.count, c.lastYear.count]).toEqual([9, 56]);
  });

  it("milkweed totals: Connemara 199, Celebration 7", () => {
    expect(parseTotal(milk(PARKS.connemara.slug).body)).toBe(199);
    expect(parseTotal(milk(PARKS.celebration.slug).body)).toBe(7);
  });

  it("an answer that doesn't cover the asked days, or has the wrong shape, is refused (never guessed)", () => {
    const w = monarchWindows(AT);
    const body = hist(PARKS.connemara.slug).body as { results: { day: Record<string, number> } };
    const cut = { ...body, results: { day: Object.fromEntries(Object.entries(body.results.day).filter(([d]) => d !== "2026-10-05")) } };
    expect(() => parseMonarchHistogram(cut, w)).toThrow(/cover/);
    expect(() => parseMonarchHistogram({ results: { month: {} } }, w)).toThrow();
    expect(() => parseMonarchHistogram({ results: { day: { "2026-10-05": -1 } } }, w)).toThrow();
    expect(() => parseTotal({})).toThrow();
  });
});

describe("octoberBox() (replaying the live recordings)", () => {
  it("an ok box with real counts and real check times; the second look is a cache hit (no new request)", async () => {
    const r = passReplay();
    const store = new MemoryStore();
    // Start 6 h before the recording (12:39 PM CDT, same Chicago day, so the same window and URL).
    const first = AT - MONARCH_CACHE_SEC * 1000;
    clockAt(first);
    let now = stepping(first);
    const deps = { store, fetchImpl: r.fetchImpl, queue: noWait, now: () => now() };
    const box = await octoberBox(CENTER.connemara, deps);
    expect(OctoberBoxSchema.parse(box)).toEqual(box);
    expect(box).toMatchObject({
      status: "ok",
      radiusKm: 25,
      thisYear: { d1: "2026-09-21", d2: "2026-10-05", count: 9 },
      lastYear: { d1: "2025-09-21", d2: "2025-10-05", count: 63 },
      milkweed: { status: "ok", count: 199, radiusKm: 1.5 },
    });
    if (box.status !== "ok") throw new Error("expected ok");
    expect(within(box.checkedAt, first)).toBe(true);
    expect(r.calls.map((c) => new URL(c.url).pathname)).toEqual(["/v1/observations/histogram", "/v1/observations"]);
    expect(new Headers(r.calls[0].init?.headers).get("user-agent")).toMatch(/^GrassPass\//);

    vi.setSystemTime(first + 60_000);
    now = stepping(first + 60_000);
    const again = await octoberBox(CENTER.connemara, deps);
    expect(again).toEqual(box); // same numbers, same original check time
    expect(r.calls).toHaveLength(2);

    // After 6 h the monarch counts are checked again (milkweed is kept 7 days) with the new time.
    vi.setSystemTime(AT + 1);
    now = stepping(AT + 1);
    const later = await octoberBox(CENTER.connemara, deps);
    expect(r.calls.map((c) => new URL(c.url).pathname)).toEqual(["/v1/observations/histogram", "/v1/observations", "/v1/observations/histogram"]);
    if (later.status !== "ok") throw new Error("expected ok");
    expect(within(later.checkedAt, AT + 1)).toBe(true);
    expect(later.milkweed).toEqual(box.milkweed); // milkweed is still the cached first answer (7 days)
  });

  it("iNaturalist down (built 503: can't be recorded on demand) -> No data available + why; cached 10 min, no milkweed call", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return new Response("Service Unavailable", { status: 503 });
    };
    clockAt(AT);
    const now = stepping(AT);
    const store = new MemoryStore();
    const box = await octoberBox(CENTER.connemara, { store, fetchImpl, queue: noWait, now });
    expect(box).toEqual({ status: "unavailable", reason: OCTOBER_REASONS.down });
    expect(calls).toHaveLength(1);
    expect(logs.some((l) => l.includes('"event":"october_source_failed"') && l.includes('"code":"busy"'))).toBe(true);

    // A fresh store (breaker closed) still hits the 10-minute negative cache, not iNaturalist.
    vi.setSystemTime(AT + 5 * 60_000);
    expect(await octoberBox(CENTER.connemara, { store: new MemoryStore(), fetchImpl, queue: noWait, now })).toEqual(box);
    expect(calls).toHaveLength(1);
    vi.setSystemTime(AT + OCTOBER_NEGATIVE_SEC * 1000 + 1);
    await octoberBox(CENTER.connemara, { store: new MemoryStore(), fetchImpl, queue: noWait, now });
    expect(calls).toHaveLength(2);
  });

  it("429 (built) -> 'polite share' reason; a 200 that isn't a histogram -> 'couldn't read'", async () => {
    const limited = async () => new Response("", { status: 429, headers: { "retry-after": "120" } });
    expect(await octoberBox(CENTER.connemara, { store: new MemoryStore(), fetchImpl: limited, queue: noWait, now: stepping(AT) })).toEqual({
      status: "unavailable",
      reason: OCTOBER_REASONS.rateLimited,
    });
    resetStores();
    const odd = async () => json({ total_results: 0, results: [] });
    expect(await octoberBox(CENTER.celebration, { store: new MemoryStore(), fetchImpl: odd, queue: noWait, now: stepping(AT) })).toEqual({
      status: "unavailable",
      reason: OCTOBER_REASONS.badOutput,
    });
  });

  it("breaker already open -> nothing is sent, the box says iNaturalist didn't answer, and it isn't negative-cached", async () => {
    const store = new MemoryStore();
    await tripBreaker(store, "inaturalist", AT, 60);
    const calls: string[] = [];
    const r = passReplay();
    const fetchImpl = async (u: string, i?: RequestInit) => (calls.push(u), r.fetchImpl(u, i));
    expect(await octoberBox(CENTER.connemara, { store, fetchImpl, queue: noWait, now: stepping(AT) })).toEqual({ status: "unavailable", reason: OCTOBER_REASONS.down });
    expect(calls).toHaveLength(0);
    expect((await octoberBox(CENTER.connemara, { store: new MemoryStore(), fetchImpl, queue: noWait, now: stepping(AT) })).status).toBe("ok");
  });

  it("monarchs ok but milkweed fails (built 503) -> the box still shows counts; milkweed says No data available", async () => {
    const r = passReplay();
    const fetchImpl = async (u: string, i?: RequestInit) =>
      new URL(u).pathname === "/v1/observations" ? new Response("", { status: 503 }) : r.fetchImpl(u, i);
    const box = await octoberBox(CENTER.connemara, { store: new MemoryStore(), fetchImpl, queue: noWait, now: stepping(AT) });
    expect(box).toMatchObject({ status: "ok", thisYear: { count: 9 }, milkweed: { status: "unavailable", reason: OCTOBER_REASONS.milkweedDown } });
  });
});

const okBox = (n: number, m: number): Extract<OctoberBoxData, { status: "ok" }> => ({
  status: "ok",
  radiusKm: 25,
  thisYear: { d1: "2026-09-21", d2: "2026-10-05", count: n },
  lastYear: { d1: "2025-09-21", d2: "2025-10-05", count: m },
  checkedAt: new Date(AT).toISOString(),
  milkweed: { status: "ok", count: 199, radiusKm: 1.5, checkedAt: new Date(AT).toISOString() },
});

describe("October copy (code-written, honest when low)", () => {
  it("headline and detail with the real numbers and check time", () => {
    const b = okBox(9, 63);
    expect(octoberHeadline(b)).toBe("9 monarchs seen since Sep 21 vs 63 in 2025");
    expect(octoberHeadline(okBox(1, 0))).toBe("1 monarch seen since Sep 21 vs 0 in 2025");
    expect(octoberDetail(b, "Oct 5, 6:39 PM CDT")).toBe(
      "Monarch butterflies reported within 25 km in the last 14 days (since Sep 21): 9 (iNaturalist, checked Oct 5, 6:39 PM CDT). Same two weeks last year (Sep 21-Oct 5, 2025): 63.",
    );
    expect(octoberCompare(b)).toBe("That's fewer than last year, so a monarch would be a lucky find.");
    expect(octoberCompare(okBox(70, 63))).toBe("That's more than last year, so keep your eyes open.");
    expect(octoberCompare(okBox(5, 5))).toBe("That's the same as last year, so keep your eyes open.");
  });

  it("zero is printed as zero, with the SPEC 5.4 sentence", () => {
    const b = okBox(0, 63);
    expect(octoberHeadline(b)).toBe("0 monarchs seen since Sep 21 vs 63 in 2025");
    expect(octoberDetail(b, "Oct 5, 6:39 PM CDT")).toBe(
      "No monarch sightings reported within 25 km in the last 14 days (iNaturalist, checked Oct 5, 6:39 PM CDT). Same two weeks last year (Sep 21-Oct 5, 2025): 63.",
    );
    expect(octoberCompare(b)).toBe("None reported nearby yet this year, so a monarch would be a lucky find.");
    expect(octoberCompare(okBox(0, 0))).toBe("None were reported in these two weeks last year either, so a monarch would be a rare find.");
  });

  it("milkweed yes / no / no data", () => {
    expect(milkweedLine({ status: "ok", count: 199, radiusKm: 1.5, checkedAt: "x" })).toBe(
      "Milkweed seen near this park: yes (199 iNaturalist sightings within 1.5 km, all years).",
    );
    expect(milkweedLine({ status: "ok", count: 1, radiusKm: 1.5, checkedAt: "x" })).toContain("(1 iNaturalist sighting within");
    expect(milkweedLine({ status: "ok", count: 0, radiusKm: 1.5, checkedAt: "x" })).toBe("Milkweed seen near this park: no (no iNaturalist sightings within 1.5 km).");
    expect(milkweedLine({ status: "unavailable", reason: OCTOBER_REASONS.milkweedDown })).toBe(
      "Milkweed near this park: No data available (iNaturalist didn't answer).",
    );
  });

  it("shown Sep 15 - Nov 15 inclusive (SPEC F10), in Chicago days, every year", () => {
    for (const d of ["2026-09-15", "2026-09-30", "2026-10-01", "2026-10-05", "2026-10-31", "2026-11-01", "2026-11-15", "2027-09-15", "2025-11-15"]) {
      expect(isOctoberBoxDay(d), d).toBe(true);
    }
    for (const d of ["2026-09-14", "2026-11-16", "2026-12-31", "2026-01-01", "2026-08-31", "2026-06-15", "2027-09-14"]) {
      expect(isOctoberBoxDay(d), d).toBe(false);
    }
    expect(OCTOBER_WINDOW_LABEL).toBe("September 15 to November 15");
  });

  it("rejects anything that is not a YYYY-MM-DD day", () => {
    for (const d of ["", "2026-10", "2026-10-5", "10/05/2026", "2026-13-01", "2026-10-00", "2026-10-32", "x2026-10-05", "2026-10-05T00:00"]) {
      expect(isOctoberBoxDay(d), d).toBe(false);
    }
  });

  it("isOctoberDay (the callers' name) is the same window check", () => {
    expect(isOctoberDay).toBe(isOctoberBoxDay);
    expect(isOctoberDay("2026-09-20")).toBe(true);
    expect(isOctoberDay("2026-11-16")).toBe(false);
  });
});

describe("<OctoberBox> (screen and print)", () => {
  it("screen: chip heading, real numbers, compare line, check time, milkweed, tip", () => {
    const b = okBox(9, 63);
    const html = renderToStaticMarkup(<OctoberBox pass={{ day: "2026-10-05", october: b }} />);
    const t = text(html);
    expect(html).toMatch(/<section[^>]*aria-labelledby="october-title"/);
    expect(html).toContain('data-variant="screen"');
    expect(html).toMatch(/<h2 id="october-title"/);
    expect(t).toContain("October special: monarch butterflies");
    expect(t).toContain("9 monarchs seen since Sep 21 vs 63 in 2025");
    expect(t).toContain("That's fewer than last year, so a monarch would be a lucky find.");
    expect(t).toContain(`checked ${formatTime(b.checkedAt)}`);
    expect(t).toContain("Milkweed seen near this park: yes (199");
    expect(t).toContain(OCTOBER_TIP);
  });

  it("print: black and white, no chip colours, optional h3", () => {
    const html = renderToStaticMarkup(<OctoberBox pass={{ day: "2026-10-05", october: okBox(0, 63) }} variant="print" headingLevel={3} />);
    expect(html).toContain('data-variant="print"');
    expect(html).toMatch(/<h3 id="october-title-print"/);
    expect(html).not.toContain("bg-chip");
    expect(html).toContain("border-black");
    // Paper (PM decision 2026-10-05): headline + one tip line on the kid's side; the window, check time
    // and milkweed line move to the parent stub (octoberStubText).
    const t = text(html);
    expect(t).toContain("0 monarchs seen since Sep 21 vs 63 in 2025");
    expect(t).toContain(OCTOBER_TIP);
    expect(t).not.toContain("No monarch sightings reported within 25 km in the last 14 days");
    expect(t).not.toContain("Milkweed");
    expect(html.match(/<p[ >]/g)).toHaveLength(2);
  });

  it("stub text: the SPEC F10 sentence with window and check time and milkweed; nothing without counts", () => {
    const box = okBox(0, 63);
    const stub = octoberStubText({ day: "2026-10-05", october: box })!;
    expect(stub).toMatch(/^October box: No monarch sightings reported within 25 km in the last 14 days \(iNaturalist, checked /);
    expect(stub).not.toContain(octoberCompare(box));
    expect(stub).toContain("Milkweed seen near this park:");
    expect(octoberStubText({ day: "2026-10-05", october: { status: "unavailable", reason: OCTOBER_REASONS.down } })).toBeNull();
    expect(octoberStubText({ day: "2026-09-14", october: box })).toBeNull();
  });

  it("outside Sep 15 - Nov 15 -> nothing at all", () => {
    expect(renderToStaticMarkup(<OctoberBox pass={{ day: "2026-09-14", october: okBox(9, 63) }} />)).toBe("");
    expect(renderToStaticMarkup(<OctoberBox pass={{ day: "2026-11-16" }} variant="print" />)).toBe("");
  });

  it("inside the window but outside October (Sep 30, Nov 1) -> the box is shown", () => {
    expect(text(renderToStaticMarkup(<OctoberBox pass={{ day: "2026-09-30", october: okBox(9, 63) }} />))).toContain("9 monarchs");
    expect(renderToStaticMarkup(<OctoberBox pass={{ day: "2026-11-01", october: okBox(9, 63) }} variant="print" />)).not.toBe("");
  });

  it("October but no counts -> the exact 'No data available' line with why", () => {
    const down = text(renderToStaticMarkup(<OctoberBox pass={{ day: "2026-10-05", october: { status: "unavailable", reason: OCTOBER_REASONS.down } }} />));
    expect(down).toContain("No data available: iNaturalist didn't answer when this pass was made, so there are no monarch counts to show.");
    expect(down).not.toMatch(/\d+ monarchs? seen/);
    const missing = text(renderToStaticMarkup(<OctoberBox pass={{ day: "2026-10-12" }} />));
    expect(missing).toContain("No data available: monarch counts weren't checked when this pass was made. Make a different pass to check them.");
  });
});

describe("makePass() adds the box only Sep 15 - Nov 15 (clock set to the recording time, live recordings)", () => {
  const env = { DO_INFERENCE_API_KEY: "test-key-not-real" };

  it("Oct 5: the Connemara pass carries 9 vs 63 and the milkweed count, fetched in parallel with the model", async () => {
    const r = passReplay();
    const out = await makePass({ parkId: PARKS.connemara.id, ageBand: "6-10" }, { ip: "192.0.2.70", fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env, now: ticking(AT) });
    if (out.kind !== "pass") throw new Error(out.kind);
    expect(PassSchema.parse(out.pass).october).toMatchObject({ status: "ok", thisYear: { count: 9 }, lastYear: { count: 63 }, milkweed: { status: "ok", count: 199 } });
    const order = r.calls.map((c) => (c.host === "inference.do-ai.run" ? "model" : new URL(c.url).pathname));
    // The box starts when the pools are ready, i.e. before the model answer arrives.
    expect(order.indexOf("/v1/observations/histogram")).toBeGreaterThan(-1);
    expect(order.indexOf("/v1/observations/histogram")).toBeLessThan(order.length - 1);
  }, 20_000);

  it("Nov 16 (the day after the window): no box, and no monarch or milkweed request", async () => {
    const r = passReplay();
    const nov = Date.UTC(2026, 10, 16, 18, 0); // noon CST, Chicago day 2026-11-16
    const out = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, { ip: "192.0.2.71", fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env, now: ticking(nov) });
    if (out.kind !== "pass") throw new Error(out.kind);
    expect(out.pass.october).toBeUndefined();
    expect(r.calls.some((c) => /^\/v1\/observations(\/histogram)?$/.test(new URL(c.url).pathname))).toBe(false);
  }, 20_000);

  it("iNaturalist counts down (built 503) -> the pass is still made, and its box says No data available", async () => {
    const r = passReplay();
    const fetchImpl = async (u: string, i?: RequestInit) =>
      new URL(u).pathname === "/v1/observations/histogram" ? new Response("", { status: 503 }) : r.fetchImpl(u, i);
    const out = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, { ip: "192.0.2.72", fetchImpl, modelFetch: r.fetchImpl, env, now: ticking(AT) });
    if (out.kind !== "pass") throw new Error(out.kind);
    expect(out.pass.october).toEqual({ status: "unavailable", reason: OCTOBER_REASONS.down });
  }, 20_000);
});
