/**
 * Weather card (Kevin, Oct 8): Open-Meteo forecast + weather.gov alerts -> code-written words.
 * Every forecast and alert here is a real recording (tests/fixtures/weather, see the README there). Where a test needs a
 * case the recordings don't hold (a 40° day, a Cancel message, a non-NWS sender, a hung server), it takes a REAL
 * recorded day or alert and changes the one field it is about, and says so.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLogSink } from "@/lib/log";
import { forecastUrl, fetchForecast, parseForecast, DAILY_VARS, HOURLY_VARS } from "@/lib/sources/open-meteo";
import { alertsUrl, fetchAlerts, inNwsArea, parseAlerts, weatherGovPageUrl } from "@/lib/sources/nws-alerts";
import { SourceError, type FetchLike } from "@/lib/sources/common";
import { clockLabel, alertTimeLabel, outingStats, pickDay, weatherSummary, THRESHOLDS, type DayPick } from "@/lib/weather/summary";
import {
  cachedWeather,
  getParkWeather,
  lookupWeather,
  resetWeather,
  WEATHER_BUDGET_MS,
  WEATHER_FAIL_TTL_MS,
  WEATHER_STALE_MAX_MS,
  WEATHER_TTL_MS,
} from "@/lib/weather/park-weather";
import { buildWeatherView, NO_WEATHER_PREFIX, noWeatherLine } from "@/lib/weather/view";
import type { Forecast, WeatherAlert, WeatherDay } from "@/lib/weather/types";

const DIR = new URL("../fixtures/weather/", import.meta.url);
type Rec = { _recording: { park: { name: string; lat: number; lng: number }; fetchedAt: string; url: string }; body: unknown };
const rec = (f: string): Rec => JSON.parse(readFileSync(new URL(f, DIR), "utf8"));
const om = (slug: string) => rec(`open-meteo-${slug}.json`);
const nws = (slug: string) => rec(`nws-alerts-${slug}.json`);
const at = (r: Rec) => Date.parse(r._recording.fetchedAt);
const forecast = (slug: string): Forecast => parseForecast(om(slug).body);

const US = [
  "forest-park-st-louis-mo",
  "celebration-park-allen-tx",
  "bayfront-park-miami-fl",
  "papago-park-phoenix-az",
  "frank-brown-park-panama-city-beach-fl",
  "central-park-santa-clarita-ca",
];
const ABROAD = ["rizal-park-manila", "parque-del-centenario-merida-mx", "bosque-los-colomos-guadalajara-mx"];
const SLUGS = [...US, ...ABROAD];

/** The view the card renders for a recording, seen at the recording time (or `now`). */
function viewFor(slug: string, now?: number) {
  const f = om(slug);
  const t = now ?? at(f);
  const alerts = US.includes(slug) ? parseAlerts(nws(slug).body, t) : null;
  return buildWeatherView(f._recording.park, { fetchedAt: at(f), forecast: parseForecast(f.body), forecastError: null, alerts, alertsStatus: alerts ? "ok" : "not_us" }, t);
}

/** A recorded day picked at the recording time. */
function pickAt(slug: string, now?: number): DayPick {
  const p = pickDay(forecast(slug), now ?? at(om(slug)));
  if (!p) throw new Error("no day");
  return p;
}

/** A real recorded day with some fields changed (only those named in the test). */
function changed(slug: string, patch: Partial<WeatherDay>, now?: number): DayPick {
  const p = pickAt(slug, now);
  return { ...p, day: { ...p.day, ...patch } };
}

/** Same, with every outing hour's field set (e.g. code 95 from 3 PM). */
function withHours(p: DayPick, fn: (h: WeatherDay["hours"][number]) => Partial<WeatherDay["hours"][number]>): DayPick {
  return { ...p, day: { ...p.day, hours: p.day.hours.map((h) => ({ ...h, ...fn(h) })) } };
}

const hour = (t: string) => Number(t.slice(11, 13));

let restoreLog: () => void;
let lines: string[];
beforeEach(() => {
  lines = [];
  restoreLog = setLogSink((_l, line) => lines.push(line));
  resetWeather();
});
afterEach(() => restoreLog());

describe("Open-Meteo request and parse", () => {
  it("asks for exactly the documented variables, in °F / mph / inch, local time zone, 2 days, at a ~1 km position", () => {
    const u = new URL(forecastUrl(33.10824, -96.62468));
    expect(u.origin + u.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(u.searchParams.get("latitude")).toBe("33.11");
    expect(u.searchParams.get("longitude")).toBe("-96.62");
    expect(u.searchParams.get("daily")?.split(",")).toEqual([...DAILY_VARS]);
    expect(u.searchParams.get("hourly")?.split(",")).toEqual([...HOURLY_VARS]);
    expect(Object.fromEntries([...u.searchParams].filter(([k]) => !["latitude", "longitude", "daily", "hourly"].includes(k)))).toEqual({
      timezone: "auto",
      temperature_unit: "fahrenheit",
      wind_speed_unit: "mph",
      precipitation_unit: "inch",
      forecast_days: "2",
    });
    // The recordings were made with this exact URL builder.
    expect(om("celebration-park-allen-tx")._recording.url).toBe(forecastUrl(33.10824, -96.62468));
    expect(() => forecastUrl(91, 0)).toThrow(RangeError);
    expect(() => forecastUrl(Number.NaN, 0)).toThrow(RangeError);
  });

  it.each(SLUGS)("parses the real recording for %s: 2 local days with 24 hours each", (slug) => {
    const f = forecast(slug);
    expect(f.days).toHaveLength(2);
    for (const d of f.days) {
      expect(d.hours).toHaveLength(24);
      expect(d.hours.every((h) => h.time.startsWith(d.date))).toBe(true);
      expect(d.highF).toBeGreaterThanOrEqual(d.lowF);
    }
  });

  it("keeps the recorded values exactly (Celebration Park, Oct 8)", () => {
    const f = forecast("celebration-park-allen-tx");
    expect(f.timezone).toBe("America/Chicago");
    expect(f.utcOffsetSec).toBe(-18000);
    expect(f.days[0]).toMatchObject({ date: "2026-10-08", code: 0, highF: 87.8, rainPct: 0, sunset: "2026-10-08T19:01" });
  });

  it("refuses arrays that don't line up, and a forecast with no usable day (never fills a gap)", () => {
    const body = structuredClone(om("celebration-park-allen-tx").body) as { daily: Record<string, unknown[]>; hourly: Record<string, unknown[]> };
    const short = structuredClone(body);
    short.daily.temperature_2m_max = short.daily.temperature_2m_max.slice(0, 1);
    expect(() => parseForecast(short)).toThrow(/temperature_2m_max/);
    const hourly = structuredClone(body);
    hourly.hourly.precipitation_probability = hourly.hourly.precipitation_probability.slice(1);
    expect(() => parseForecast(hourly)).toThrow(/precipitation_probability/);
    // A day without its weather code is left out, not guessed; no usable day at all -> error.
    const oneNull = structuredClone(body);
    oneNull.daily.weather_code[0] = null;
    expect(parseForecast(oneNull).days.map((d) => d.date)).toEqual(["2026-10-09"]);
    const allNull = structuredClone(body);
    allNull.daily.weather_code = [null, null];
    expect(() => parseForecast(allNull)).toThrow(/no day/);
    expect(() => parseForecast({ error: true, reason: "Latitude must be in range of -90 to 90°." })).toThrow();
  });

  it("fetches with our User-Agent, no redirects, and maps HTTP failures to error codes", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const ok: FetchLike = async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(om("bayfront-park-miami-fl").body), { status: 200 });
    };
    const r = await fetchForecast(25.7753796, -80.1861658, { fetchImpl: ok });
    expect(r.forecast.days[0].highF).toBe(85.8);
    expect(new Headers(seen[0].init?.headers).get("User-Agent")).toMatch(/^GrassPass\/0\.1 \(\+https:\/\//);
    expect(seen[0].init?.redirect).toBe("error");
    const code = async (status: number, body = "{}") =>
      fetchForecast(1, 1, { fetchImpl: async () => new Response(body, { status }) }).then(
        () => "ok",
        (e: SourceError) => e.code,
      );
    expect(await code(429)).toBe("rate_limited");
    expect(await code(503)).toBe("busy");
    expect(await code(400, '{"error":true,"reason":"bad"}')).toBe("bad_output");
    expect(await code(200, "not json")).toBe("bad_output");
  });
});

describe("weather.gov alerts", () => {
  it("only asks for points NWS covers", () => {
    for (const slug of US) {
      const p = om(slug)._recording.park;
      expect(inNwsArea(p.lat, p.lng), slug).toBe(true);
    }
    for (const slug of ABROAD) {
      const p = om(slug)._recording.park;
      expect(inNwsArea(p.lat, p.lng), slug).toBe(false);
    }
    expect(inNwsArea(21.27, -157.82)).toBe(true); // Honolulu
    expect(inNwsArea(61.2, -149.9)).toBe(true); // Anchorage
    expect(inNwsArea(51.5, -0.12)).toBe(false); // London
    expect(alertsUrl(33.10824, -96.62468)).toBe("https://api.weather.gov/alerts/active?point=33.11,-96.62");
    expect(nws("celebration-park-allen-tx")._recording.url).toBe(alertsUrl(33.10824, -96.62468));
    expect(weatherGovPageUrl(33.10824, -96.62468)).toBe("https://forecast.weather.gov/MapClick.php?lat=33.11&lon=-96.62");
  });

  it("drops status Test, keeps Actual alerts whose instruction is null, and never carries an instruction", () => {
    const r = rec("nws-alerts-active-us-sample.json");
    const raw = (r.body as { features: { properties: { status: string; instruction: string | null } }[] }).features;
    expect(raw.some((f) => f.properties.status === "Test")).toBe(true);
    expect(raw.filter((f) => f.properties.status === "Actual" && f.properties.instruction === null).length).toBe(3);
    const alerts = parseAlerts(r.body, at(r));
    expect(alerts.map((a) => a.event)).not.toContain("Test Message");
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    for (const a of alerts) expect(Object.keys(a)).not.toContain("instruction");
  });

  it("names a non-NWS sender as sent (a relayed IPAWS alert) and never calls it NWS", () => {
    // None was in the live feed (see the fixtures README): a REAL Celebration Park alert with only its sender changed.
    const body = structuredClone(nws("celebration-park-allen-tx").body) as { features: { properties: Record<string, unknown> }[] };
    body.features[0].properties.sender = "ipaws-relay@example.org";
    body.features[0].properties.senderName = "Collin County Office of Emergency Management";
    const [a] = parseAlerts(body, at(nws("celebration-park-allen-tx")));
    expect(a).toMatchObject({ senderName: "Collin County Office of Emergency Management", fromNws: false });
    const [b] = parseAlerts(nws("celebration-park-allen-tx").body, at(nws("celebration-park-allen-tx")));
    expect(b).toMatchObject({ event: "Air Quality Alert", severity: "Unknown", senderName: "NWS Fort Worth TX", fromNws: true, ends: null });
  });

  it("uses ends, then eventEndingTime, never 'expires', as the end; drops ended and cancelled alerts", () => {
    const sc = rec("nws-alerts-active-us-sample.json");
    const now = at(sc);
    const small = (sc.body as { features: { properties: Record<string, unknown> }[] }).features.find((f) => f.properties.event === "Small Craft Advisory")!;
    const one = (patch: Record<string, unknown>) => ({ features: [{ ...small, properties: { ...small.properties, ...patch } }] });
    expect(parseAlerts(one({}), now)[0].ends).toBe("2026-10-09T17:00:00-08:00");
    // A real advisory with `ends` removed: the end comes from parameters.eventEndingTime.
    expect(parseAlerts(one({ ends: null }), now)[0].ends).toBe("2026-10-09T17:00:00-08:00");
    // ...and with neither, there is no end (the card says "no end time given yet"), not the message's expiry.
    expect(parseAlerts(one({ ends: null, parameters: {} }), now)[0].ends).toBeNull();
    expect(parseAlerts(one({}), Date.parse("2026-10-09T17:00:01-08:00"))).toEqual([]);
    expect(parseAlerts(one({ messageType: "Cancel" }), now)).toEqual([]);
    expect(parseAlerts(one({ status: "Exercise" }), now)).toEqual([]);
  });

  it("puts the most severe first and shows each event once (the real Panama City Beach hurricane feed)", () => {
    const r = nws("frank-brown-park-panama-city-beach-fl");
    const alerts = parseAlerts(r.body, at(r));
    expect(alerts.map((a) => `${a.severity} ${a.event}`)).toEqual([
      "Extreme Hurricane Warning",
      "Extreme Storm Surge Warning",
      "Severe Flood Watch",
      "Moderate Rip Current Statement",
      "Moderate Tropical Cyclone Local Statement",
    ]);
  });

  it("calls api.weather.gov with a User-Agent (it answers 403 without one) and treats 403 as a refusal", async () => {
    let ua: string | null = null;
    const r = await fetchAlerts(30.23, -85.88, at(nws("frank-brown-park-panama-city-beach-fl")), {
      fetchImpl: async (_u, init) => {
        ua = new Headers(init?.headers).get("User-Agent");
        return new Response(JSON.stringify(nws("frank-brown-park-panama-city-beach-fl").body), { status: 200 });
      },
    });
    expect(ua).toMatch(/GrassPass/);
    expect(r.alerts[0].event).toBe("Hurricane Warning");
    await expect(fetchAlerts(30.23, -85.88, 0, { fetchImpl: async () => new Response("", { status: 403 }) })).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("which day: today, or tomorrow from 6 PM / after sunset (park local time)", () => {
  const f = () => forecast("celebration-park-allen-tx");
  it("9:20 AM CDT (the recording) -> today; 5:59 PM -> today; 6:00 PM -> tomorrow", () => {
    expect(pickDay(f(), at(om("celebration-park-allen-tx")))).toMatchObject({ which: "today", day: { date: "2026-10-08" } });
    expect(pickDay(f(), Date.parse("2026-10-08T22:59:00Z"))).toMatchObject({ which: "today" });
    expect(pickDay(f(), Date.parse("2026-10-08T23:00:00Z"))).toMatchObject({ which: "tomorrow", day: { date: "2026-10-09" } });
  });
  it("after sunset even before 6 PM (Manila, sunset 5:40 PM): 5:30 PM -> today, 5:41 PM -> tomorrow", () => {
    const m = forecast("rizal-park-manila");
    expect(pickDay(m, Date.parse("2026-10-08T09:30:00Z"))).toMatchObject({ which: "today" });
    expect(pickDay(m, Date.parse("2026-10-08T09:41:00Z"))).toMatchObject({ which: "tomorrow" });
    // The recording itself was made at 10:20 PM in Manila: the card shows tomorrow and says so.
    expect(viewFor("rizal-park-manila")).toMatchObject({ kind: "forecast", which: "tomorrow", dateLabel: "Fri, Oct 9" });
  });
  it("no day to show (an answer from before the park's midnight) -> null, never the wrong day", () => {
    expect(pickDay(f(), Date.parse("2026-10-10T15:00:00Z"))).toBeNull();
    expect(pickDay(f(), Date.parse("2026-10-09T23:30:00Z"))).toBeNull(); // evening of the last day: no tomorrow
  });
});

describe("the words (thresholds and wording, from the real recordings)", () => {
  it.each([
    ["forest-park-st-louis-mo", "great", "The weather will be perfect today: clear skies, a high of 84° and no rain in sight."],
    ["bayfront-park-miami-fl", "good", "Good hunting weather today: cloudy skies, a high of 86° and a 19% chance of rain."],
    ["celebration-park-allen-tx", "caution", "A warm one today: a high of 88°. Bring water and take shade breaks."],
    ["papago-park-phoenix-az", "warning", "Hot one today: a high of 102°. Go early, bring water and take shade breaks."],
    ["central-park-santa-clarita-ca", "danger", "Extreme Heat Warning for this area: save the hunt for another day and follow the official alert."],
    ["frank-brown-park-panama-city-beach-fl", "danger", "Hurricane Warning for this area: save the hunt for another day and follow the official alert."],
    ["parque-del-centenario-merida-mx", "danger", "Storms today from about 1 PM: save the hunt for another day."],
    ["bosque-los-colomos-guadalajara-mx", "warning", "Rain likely from about 4 PM (75%): go this morning."],
    ["rizal-park-manila", "caution", "Some rain is possible from about 1 PM (58%): bring a raincoat."],
  ])("%s -> %s", (slug, mood, headline) => {
    const v = viewFor(slug);
    expect(v.kind).toBe("forecast");
    if (v.kind !== "forecast") return;
    expect(v.mood).toBe(mood);
    expect(v.headline).toBe(headline);
  });

  it("storms give when, a go-early tip and the thunder rule; the rain is not repeated", () => {
    const s = weatherSummary(pickAt("parque-del-centenario-merida-mx"));
    expect(s.tips).toEqual(["If you do go, go early and be home before 1 PM.", "When thunder roars, go indoors."]);
    expect(s.details.join(" ")).not.toMatch(/rain/i);
    expect(s.details).toContain("Very windy: gusts up to 32 mph.");
  });

  it("Kevin's example, from a real clear day (Forest Park, St. Louis), today and tomorrow", () => {
    expect(weatherSummary(pickAt("forest-park-st-louis-mo"))).toEqual({
      mood: "great",
      headline: "The weather will be perfect today: clear skies, a high of 84° and no rain in sight.",
      details: [],
      tips: [],
    });
    // Tomorrow at Celebration Park (Oct 9, recorded as cloudy and 88°) with two changes: clear and 85.
    const t = weatherSummary(changed("celebration-park-allen-tx", { highF: 85, code: 0 }, Date.parse("2026-10-08T23:30:00Z")));
    expect(t.headline).toBe("The weather will be perfect tomorrow: clear skies, a high of 85° and no rain in sight.");
  });

  // The real Celebration Park day (clear, 0% rain, gusts 11 mph) with one field changed per row.
  it.each([
    [{ highF: 95 }, "warning", /^Hot one today: a high of 95°/],
    [{ highF: 94.4 }, "caution", /^A warm one today: a high of 94°/],
    [{ highF: 88 }, "caution", /^A warm one today/],
    [{ highF: 87 }, "good", /^Good hunting weather today: clear skies, a high of 87° and no rain in sight\.$/],
    [{ highF: 86 }, "great", /^The weather will be perfect today/],
    [{ highF: 60 }, "great", /perfect/],
    [{ highF: 59 }, "good", /^Good hunting weather/],
    [{ highF: 50 }, "caution", /^A chilly one today: a high of 50°\. Bring jackets\.$/],
    [{ highF: 40 }, "caution", /^A chilly one/],
    [{ highF: 39 }, "warning", /^Cold one today: a high of only 39°/],
    [{ gustMph: 30 }, "warning", /^Very windy today: gusts up to 30 mph/],
    [{ gustMph: 25, highF: 80 }, "caution", /^Breezy today: gusts up to 25 mph\.$/],
    [{ gustMph: 24 }, "caution", /^A warm one/], // 24 mph adds nothing; the 88° high is the caution
    [{ code: 3, highF: 75 }, "good", /^Good hunting weather today: cloudy skies, a high of 75° and no rain in sight\.$/],
  ] as const)("%o -> %s", (patch, mood, re) => {
    const s = weatherSummary(changed("celebration-park-allen-tx", patch));
    expect(s.mood).toBe(mood);
    expect(s.headline).toMatch(re);
  });

  it("rain chance thresholds use the hours you'd be out (60 warning, 30 caution, 20 not perfect)", () => {
    const base = changed("celebration-park-allen-tx", { highF: 80 });
    const rain = (pct: number) => weatherSummary(withHours(base, () => ({ rainPct: pct })));
    expect(rain(60).mood).toBe("warning");
    expect(rain(60).headline).toBe("Rain likely today (60% chance): pack raincoats or pick a drier day.");
    expect(rain(59).mood).toBe("caution");
    expect(rain(30).headline).toBe("Some rain is possible today (30%): bring a raincoat.");
    expect(rain(29).mood).toBe("good");
    expect(rain(29).headline).toBe("Good hunting weather today: clear skies, a high of 80° and a 29% chance of rain.");
    expect(rain(19).mood).toBe("great");
    expect(rain(19).headline).toMatch(/only a 19% chance of rain\.$/);
    // Rain only before the outing (3 AM) does not count.
    expect(weatherSummary(withHours(base, (h) => ({ rainPct: hour(h.time) === 3 ? 90 : 0 }))).mood).toBe("great");
  });

  it("storms: in the outing hours -> danger; only after dark -> caution 'be home before'", () => {
    const base = changed("celebration-park-allen-tx", { highF: 80 });
    const later = weatherSummary(withHours(base, (h) => ({ code: hour(h.time) >= 15 ? 95 : 0 })));
    expect(later.mood).toBe("danger");
    expect(later.headline).toBe("Storms today from about 3 PM: save the hunt for another day.");
    expect(later.tips[0]).toBe("If you do go, go early and be home before 3 PM.");
    const night = weatherSummary(withHours(base, (h) => ({ code: hour(h.time) >= 22 ? 95 : 0 })));
    expect(night.mood).toBe("caution");
    expect(night.headline).toBe("Storms are possible after 10 PM today: be home before then.");
  });

  it("snow/ice -> warning, fog -> caution, UV 8+ -> a sunscreen tip only", () => {
    const base = changed("celebration-park-allen-tx", { highF: 80 });
    expect(weatherSummary(withHours({ ...base, day: { ...base.day, code: 71 } }, () => ({ code: 71 }))).headline).toBe(
      "Light snow today: dress warm and watch for slippery paths.",
    );
    expect(weatherSummary(withHours(base, (h) => ({ code: hour(h.time) === 10 ? 45 : 0 }))).mood).toBe("caution");
    const uv = weatherSummary({ ...base, day: { ...base.day, uv: 8.2 } });
    expect(uv.mood).toBe("great");
    expect(uv.tips).toEqual(["Strong sun (UV 8): sunscreen and hats."]);
    expect(weatherSummary({ ...base, day: { ...base.day, uv: 7.9 } }).tips).toEqual([]);
  });

  it("official alerts: Extreme/Severe -> danger, Moderate -> warning, Minor/Unknown -> listed only (mood unchanged)", () => {
    const base = changed("celebration-park-allen-tx", { highF: 80 });
    const real = parseAlerts(nws("frank-brown-park-panama-city-beach-fl").body, at(nws("frank-brown-park-panama-city-beach-fl")));
    const withSeverity = (sev: WeatherAlert["severity"]): WeatherAlert => ({ ...real[0], severity: sev });
    expect(weatherSummary(base, [withSeverity("Extreme")]).mood).toBe("danger");
    expect(weatherSummary(base, [withSeverity("Severe")]).mood).toBe("danger");
    expect(weatherSummary(base, [withSeverity("Moderate")])).toMatchObject({ mood: "warning", headline: "Hurricane Warning for this area: read the official alert before you go." });
    expect(weatherSummary(base, [withSeverity("Minor")]).mood).toBe("great");
    const air = parseAlerts(nws("celebration-park-allen-tx").body, at(nws("celebration-park-allen-tx")));
    expect(weatherSummary(pickAt("celebration-park-allen-tx"), air).mood).toBe("caution"); // the 88° high, not the alert
  });

  it("thresholds are the documented ones (summary.ts file comment, README)", () => {
    expect(THRESHOLDS).toEqual({
      rainWarnPct: 60,
      rainCautionPct: 30,
      rainGreatBelowPct: 20,
      rainLikelyHourPct: 50,
      heatWarnF: 95,
      warmCautionF: 88,
      greatMaxF: 86,
      greatMinF: 60,
      chillyCautionMaxF: 50,
      coldWarnBelowF: 40,
      gustWarnMph: 30,
      gustCautionMph: 25,
      uvTip: 8,
    });
  });

  it("is deterministic, short and calm (at most one '!')", () => {
    for (const slug of SLUGS) {
      const a = viewFor(slug);
      expect(viewFor(slug)).toEqual(a);
      if (a.kind !== "forecast") continue;
      const all = [a.headline, ...a.details, ...a.tips].join(" ");
      expect((all.match(/!/g) ?? []).length, slug).toBeLessThanOrEqual(1);
      expect(a.headline.length, slug).toBeLessThan(110);
    }
  });

  it("formats local times and alert ends in the park's own clock", () => {
    expect(clockLabel("2026-10-08T15:00")).toBe("3 PM");
    expect(clockLabel("2026-10-08T19:01")).toBe("7:01 PM");
    expect(clockLabel("2026-10-08T00:30")).toBe("12:30 AM");
    expect(clockLabel("2026-10-08T12:00")).toBe("12 PM");
    expect(alertTimeLabel("2026-10-08T20:00:00-07:00", "2026-10-08T06:39")).toBe("8 PM today");
    expect(alertTimeLabel("2026-10-09T22:00:00-04:00", "2026-10-08T09:39")).toBe("10 PM tomorrow");
    expect(alertTimeLabel("2026-10-12T04:00:00-04:00", "2026-10-08T09:39")).toBe("4 AM Mon");
    expect(outingStats(pickAt("bosque-los-colomos-guadalajara-mx")).firstRainLikely).toBe("2026-10-08T16:00");
  });
});

describe("the card's data (view) and the live lookup", () => {
  it("shows the numbers, the sunset, the update time in the park's zone and at most 2 alerts", () => {
    const v = viewFor("frank-brown-park-panama-city-beach-fl");
    if (v.kind !== "forecast") throw new Error(v.kind);
    expect(v).toMatchObject({ highF: 80, lowF: 71, rainPct: 13, wind: "12 mph, gusts 25", sunset: "6:20 PM", updated: "9:20 AM CDT", look: "alert" });
    expect(v.alerts).toEqual([
      { line: "Hurricane Warning: no end time given yet", sender: "NWS Tallahassee FL", severity: "Extreme", fromNws: true },
      { line: "Storm Surge Warning: no end time given yet", sender: "NWS Tallahassee FL", severity: "Extreme", fromNws: true },
    ]);
    expect(v.alertsLink).toBe("https://forecast.weather.gov/MapClick.php?lat=30.23&lon=-85.88");
    const heat = viewFor("central-park-santa-clarita-ca");
    expect(heat).toMatchObject({ look: "hot", alerts: [{ line: "Extreme Heat Warning until 8 PM today", sender: "NWS Los Angeles/Oxnard CA" }] });
    expect(viewFor("papago-park-phoenix-az")).toMatchObject({ alerts: [], alertsNote: "No official weather alerts here right now (weather.gov)." });
    expect(viewFor("rizal-park-manila")).toMatchObject({ alerts: [], alertsNote: null, alertsLink: null, updated: "10:20 PM GMT+8" });
    // An alert that ended since the lookup is no longer shown (the heat warning ends 8 PM PDT).
    expect(viewFor("central-park-santa-clarita-ca", Date.parse("2026-10-09T03:30:00Z"))).toMatchObject({ alerts: [] });
  });

  /** Replays the recordings by URL; anything else is a test failure. */
  function replay(slug: string, calls: string[]): FetchLike {
    return async (url) => {
      calls.push(url);
      if (url.startsWith("https://api.open-meteo.com/")) return new Response(JSON.stringify(om(slug).body), { status: 200 });
      if (url.startsWith("https://api.weather.gov/")) return new Response(JSON.stringify(nws(slug).body), { status: 200 });
      throw new Error(`unexpected ${url}`);
    };
  }

  it("asks Open-Meteo and weather.gov in parallel for a US park, only Open-Meteo elsewhere", async () => {
    const calls: string[] = [];
    const p = om("papago-park-phoenix-az")._recording.park;
    const v = await getParkWeather(p, at(om("papago-park-phoenix-az")), { fetchImpl: replay("papago-park-phoenix-az", calls) });
    expect(v).toMatchObject({ kind: "forecast", mood: "warning" });
    expect(calls).toEqual([forecastUrl(p.lat, p.lng), alertsUrl(p.lat, p.lng)]);
    const m: string[] = [];
    const mx = om("parque-del-centenario-merida-mx")._recording.park;
    await getParkWeather(mx, at(om("parque-del-centenario-merida-mx")), { fetchImpl: replay("parque-del-centenario-merida-mx", m) });
    expect(m).toEqual([forecastUrl(mx.lat, mx.lng)]);
    expect(lines.some((l) => l.includes('"event":"weather_forecast"') && l.includes('"ok":true'))).toBe(true);
  });

  it("caches a park position for 30 minutes (a failure for 1), and parallel views share one request", async () => {
    const calls: string[] = [];
    const p = om("bayfront-park-miami-fl")._recording.park;
    const t0 = at(om("bayfront-park-miami-fl"));
    const f = replay("bayfront-park-miami-fl", calls);
    await Promise.all([cachedWeather(p.lat, p.lng, t0, { fetchImpl: f }), cachedWeather(p.lat + 0.001, p.lng, t0, { fetchImpl: f })]);
    expect(calls).toHaveLength(2); // one forecast + one alerts call for both
    await cachedWeather(p.lat, p.lng, t0 + WEATHER_TTL_MS - 1, { fetchImpl: f });
    expect(calls).toHaveLength(2);
    await cachedWeather(p.lat, p.lng, t0 + WEATHER_TTL_MS, { fetchImpl: f });
    expect(calls).toHaveLength(4);
    resetWeather();
    let n = 0;
    const down: FetchLike = async () => {
      n++;
      return new Response("", { status: 400 });
    };
    await cachedWeather(10, 10, t0, { fetchImpl: down });
    await cachedWeather(10, 10, t0 + WEATHER_FAIL_TTL_MS - 1, { fetchImpl: down });
    expect(n).toBe(1);
    await cachedWeather(10, 10, t0 + WEATHER_FAIL_TTL_MS, { fetchImpl: down });
    expect(n).toBe(2);
  });

  it.each([
    ["timeout", "No weather data available: the weather service didn't answer in time."],
    ["network", "No weather data available: we couldn't reach the weather service."],
    ["busy", "No weather data available: the weather service is having trouble right now. Try again in a few minutes."],
    ["rate_limited", "No weather data available: the weather service is getting too many requests right now. Try again in a few minutes."],
    ["bad_output", "No weather data available: the weather service sent an answer we couldn't read."],
  ])("a forecast failure (%s) -> the honest line, never a made-up forecast", async (code, line) => {
    const failing: Record<string, FetchLike> = {
      timeout: (_u, init) =>
        new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))),
      network: async () => {
        throw new TypeError("fetch failed");
      },
      busy: async () => new Response("", { status: 503 }),
      rate_limited: async () => new Response("", { status: 429 }),
      bad_output: async () => new Response("<html>", { status: 200 }),
    };
    const v = await getParkWeather({ name: "Rizal Park", lat: 14.583, lng: 120.979 }, Date.now(), { fetchImpl: failing[code], timeoutMs: 50 });
    expect(v).toMatchObject({ kind: "none", reasonCode: code, reason: line });
    expect(noWeatherLine(code)).toBe(line);
    expect(line.startsWith(NO_WEATHER_PREFIX)).toBe(true);
    expect(JSON.stringify(v)).not.toMatch(/°/);
    expect(lines.some((l) => l.includes('"event":"weather_forecast"') && l.includes(`"code":"${code}"`))).toBe(true);
  });

  it("cold start: an 8 s budget per lookup (a slow first answer still arrives), and a fast failure is tried once more", async () => {
    expect(WEATHER_BUDGET_MS).toBe(8_000);
    // A real recording answered after 5.5 s (the e2e cold server took over 4 s): shown, not "didn't answer in time".
    const slug = "parque-del-centenario-merida-mx";
    const slow: FetchLike = (_u, init) =>
      new Promise((res, rej) => {
        const t = setTimeout(() => res(new Response(JSON.stringify(om(slug).body), { status: 200 })), 5_500);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          rej(new DOMException("aborted", "AbortError"));
        });
      });
    const v = await getParkWeather(om(slug)._recording.park, at(om(slug)), { fetchImpl: slow });
    expect(v).toMatchObject({ kind: "forecast", mood: "danger" });
    // A dropped connection, then the real answer: one retry inside the budget.
    resetWeather();
    let n = 0;
    const flaky: FetchLike = async () => {
      n++;
      if (n === 1) throw new TypeError("fetch failed");
      return new Response(JSON.stringify(om(slug).body), { status: 200 });
    };
    expect(await getParkWeather(om(slug)._recording.park, at(om(slug)), { fetchImpl: flaky })).toMatchObject({ kind: "forecast" });
    expect(n).toBe(2);
    // A bad answer (not a dropped line) is not retried.
    resetWeather();
    let m = 0;
    await lookupWeather(14.583, 120.979, Date.now(), {
      fetchImpl: async () => {
        m++;
        return new Response("<html>", { status: 200 });
      },
    });
    expect(m).toBe(1);
  }, 15_000);

  it("a failed refresh keeps the last good forecast (at most 3 h old) with its own time; older than that -> the honest line", async () => {
    const slug = "forest-park-st-louis-mo";
    const p = om(slug)._recording.park;
    const t0 = at(om(slug));
    await cachedWeather(p.lat, p.lng, t0, { fetchImpl: replay(slug, []) });
    const down: FetchLike = async () => new Response("", { status: 400 });
    const later = await getParkWeather(p, t0 + WEATHER_TTL_MS + 60_000, { fetchImpl: down });
    expect(later).toMatchObject({ kind: "forecast", mood: "great", updated: "9:21 AM CDT" });
    expect(lines.some((l) => l.includes('"event":"weather_forecast_stale"'))).toBe(true);
    const tooOld = await getParkWeather(p, t0 + WEATHER_STALE_MAX_MS + 60_000, { fetchImpl: down });
    expect(tooOld).toMatchObject({ kind: "none", reasonCode: "bad_output" });
  });

  it("weather.gov failing still shows the forecast, and says the alerts couldn't be checked", async () => {
    const slug = "celebration-park-allen-tx";
    const v = await getParkWeather(om(slug)._recording.park, at(om(slug)), {
      fetchImpl: async (url) => (url.includes("open-meteo") ? new Response(JSON.stringify(om(slug).body), { status: 200 }) : new Response("", { status: 403 })),
    });
    expect(v).toMatchObject({ kind: "forecast", alerts: [], alertsNote: "Official alerts: we couldn't check weather.gov just now." });
    expect(lines.some((l) => l.includes('"event":"weather_alerts"') && l.includes('"ok":false'))).toBe(true);
  });

  it("the daily cap stops calls before they are made (WEATHER_DAILY_CALLS=0)", async () => {
    let n = 0;
    const v = await lookupWeather(14.583, 120.979, Date.now(), {
      env: { WEATHER_DAILY_CALLS: "0" },
      fetchImpl: async () => {
        n++;
        return new Response("{}");
      },
    });
    expect(n).toBe(0);
    expect(buildWeatherView({ name: "Rizal Park", lat: 14.583, lng: 120.979 }, v, Date.now())).toMatchObject({
      kind: "none",
      reason: "No weather data available: we've used today's free weather lookups. It resets tomorrow.",
    });
  });

  it("a cached answer that no longer covers the day is fetched again (after the park's midnight)", async () => {
    const slug = "bayfront-park-miami-fl";
    const calls: string[] = [];
    const p = om(slug)._recording.park;
    // Cached at 5:50 PM EDT on Oct 9 (the recording's last day): still "today". 15 minutes later it is 6:05 PM, the card
    // needs Oct 10, which the cached answer doesn't hold: it is fetched again at once (inside the 30-minute cache time).
    const t1 = Date.parse("2026-10-09T21:50:00Z");
    expect(pickDay(forecast(slug), t1)).toMatchObject({ which: "today", day: { date: "2026-10-09" } });
    await cachedWeather(p.lat, p.lng, t1, { fetchImpl: replay(slug, calls) });
    expect(calls).toHaveLength(2);
    const v = await getParkWeather(p, t1 + 15 * 60_000, { fetchImpl: replay(slug, calls) });
    expect(calls).toHaveLength(4);
    // The replay is still the Oct 8-9 recording, so the honest answer is "no data", never Oct 9 labelled as tomorrow.
    expect(v).toMatchObject({ kind: "none", reasonCode: "no_day", reason: "No weather data available: the forecast we got doesn't cover this day yet." });
  });
});
