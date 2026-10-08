/**
 * Round 10 (SEC-10-03): the weather daily cap is shared by every server instance through the store (Upstash in
 * production), weather.gov calls are counted too, and a 429 keeps the failed lookup for 10 minutes.
 *
 * The forecast body is a real Open-Meteo recording (tests/fixtures/weather). The "shared" store is the in-memory store
 * presented as the Upstash kind (built in the test: no recording can hold a second server instance), and the 429 and
 * the store failure are built too.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore, type Store } from "@/lib/cache/store";
import { cachedWeather, lookupWeather, resetWeather, takeWeatherCall, weatherCallsKey, WEATHER_RATE_LIMITED_TTL_MS } from "@/lib/weather/park-weather";

const OM = JSON.parse(readFileSync(new URL("../fixtures/weather/open-meteo-celebration-park-allen-tx.json", import.meta.url), "utf8")) as {
  _recording: { park: { lat: number; lng: number }; fetchedAt: string };
  body: unknown;
};
const P = OM._recording.park;
const T = Date.parse(OM._recording.fetchedAt);

/** The in-memory store, presented as the shared (Upstash) kind. */
function sharedStore(): Store & { incrs: number } {
  const m = new MemoryStore();
  const s = {
    kind: "upstash" as const,
    incrs: 0,
    get: (k: string) => m.get(k),
    set: (k: string, v: string, t: number) => m.set(k, v, t),
    del: (k: string) => m.del(k),
    incr: async (k: string, by: number, t: number) => {
      s.incrs++;
      return m.incr(k, by, t);
    },
  };
  return s;
}

beforeEach(() => resetWeather());

describe("SEC-10-03: one daily weather cap for all server instances", () => {
  it("a second instance (fresh process counters, same store) sees the calls of the first", async () => {
    const store = sharedStore();
    const env = { WEATHER_DAILY_CALLS: "2" };
    expect(await takeWeatherCall("open-meteo", T, env, store)).toBe(true);
    expect(await takeWeatherCall("open-meteo", T, env, store)).toBe(true);
    resetWeather(); // "another instance": its own counters start at 0
    expect(await takeWeatherCall("open-meteo", T, env, store)).toBe(false);
    expect(Number(await store.get(weatherCallsKey("open-meteo", OM._recording.fetchedAt.slice(0, 10))))).toBe(3);
    // weather.gov has its own counter.
    expect(await takeWeatherCall("nws", T, env, store)).toBe(true);
  });

  it("weather.gov calls are counted: over the cap neither service is called", async () => {
    let calls = 0;
    const fetchImpl = async (url: string) => {
      calls++;
      return url.includes("open-meteo") ? new Response(JSON.stringify(OM.body), { status: 200 }) : new Response(JSON.stringify({ features: [] }), { status: 200 });
    };
    const env = { WEATHER_DAILY_CALLS: "1" };
    await lookupWeather(P.lat, P.lng, T, { env, fetchImpl });
    expect(calls).toBe(2);
    const again = await lookupWeather(P.lat, P.lng, T, { env, fetchImpl });
    expect(calls).toBe(2);
    expect(again).toMatchObject({ forecast: null, forecastError: "budget", alertsStatus: "failed" });
  });

  it("if the shared store fails, this process's own count still caps the calls", async () => {
    const broken: Store = { ...sharedStore(), incr: async () => Promise.reject(new Error("store down")) };
    const env = { WEATHER_DAILY_CALLS: "1" };
    expect(await takeWeatherCall("open-meteo", T, env, broken)).toBe(true);
    expect(await takeWeatherCall("open-meteo", T, env, broken)).toBe(false);
  });

  it("a 429 from Open-Meteo is kept for 10 minutes (not asked again every minute)", async () => {
    let calls = 0;
    const fetchImpl = async (url: string) => {
      if (url.includes("open-meteo")) calls++;
      return url.includes("open-meteo") ? new Response("", { status: 429 }) : new Response(JSON.stringify({ features: [] }), { status: 200 });
    };
    const first = await cachedWeather(P.lat, P.lng, T, { fetchImpl });
    expect(first.forecastError).toBe("rate_limited");
    expect(calls).toBe(1);
    await cachedWeather(P.lat, P.lng, T + 5 * 60_000, { fetchImpl });
    expect(calls).toBe(1);
    await cachedWeather(P.lat, P.lng, T + WEATHER_RATE_LIMITED_TTL_MS + 1_000, { fetchImpl });
    expect(calls).toBe(2);
  });
});
