/**
 * Weather on the pass page: the Open-Meteo forecast API (https://open-meteo.com/en/docs, free, no key, data CC BY 4.0,
 * "Weather data by Open-Meteo.com"; the free API is for non-commercial use, under 10,000 calls a day).
 *
 * One GET per park position (rounded to 2 decimals, about 1 km), 2 days (today and tomorrow, park local time):
 * daily weather code, high/low, rain chance and amount, wind and gusts, UV, sunrise/sunset, plus the hourly rain
 * chance, weather code and temperature so the card can say WHEN rain or storms start. Fahrenheit, mph, inches;
 * timezone=auto (times come back in the park's own local time, with its UTC offset).
 * Server only, short timeout; every failure is a SourceError and becomes the card's honest
 * "No weather data available" line (src/lib/weather/park-weather.ts).
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import { fetchText, SourceError, userAgent, type FetchLike } from "./common";
import type { Forecast, WeatherDay, WeatherHour } from "@/lib/weather/types";

export const OPEN_METEO_API = "https://api.open-meteo.com/v1/forecast";
export const OPEN_METEO_SOURCE = "open-meteo";
/** One attempt's limit (the card's whole lookup has a longer budget: src/lib/weather/park-weather.ts). */
export const WEATHER_TIMEOUT_MS = 4_000;
/** A 2-day answer with hourly data is ~5 KB; anything near this is not what we asked for. */
const MAX_BYTES = 200_000;

export const DAILY_VARS = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_probability_max",
  "precipitation_sum",
  "wind_speed_10m_max",
  "wind_gusts_10m_max",
  "uv_index_max",
  "sunrise",
  "sunset",
] as const;
export const HOURLY_VARS = ["temperature_2m", "precipitation_probability", "weather_code"] as const;

/** Round to ~1 km: better caching, and the weather service never gets a more exact point than it needs. */
export const roundCoord = (v: number): number => Math.round(v * 100) / 100;

export function validPoint(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function forecastUrl(lat: number, lng: number): string {
  if (!validPoint(lat, lng)) throw new RangeError("bad point");
  const u = new URL(OPEN_METEO_API);
  u.searchParams.set("latitude", roundCoord(lat).toFixed(2));
  u.searchParams.set("longitude", roundCoord(lng).toFixed(2));
  u.searchParams.set("daily", DAILY_VARS.join(","));
  u.searchParams.set("hourly", HOURLY_VARS.join(","));
  u.searchParams.set("timezone", "auto");
  u.searchParams.set("temperature_unit", "fahrenheit");
  u.searchParams.set("wind_speed_unit", "mph");
  u.searchParams.set("precipitation_unit", "inch");
  u.searchParams.set("forecast_days", "2");
  return u.toString();
}

const LOCAL_DAY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const num = z.number().finite();
const temp = num.min(-130).max(150);
const pct = num.min(0).max(100);
const nonNeg = num.min(0).max(1000);

const Body = z.object({
  timezone: z.string().min(1).max(64).regex(/^[A-Za-z0-9_+\-/]+$/),
  utc_offset_seconds: z.number().int().min(-14 * 3600).max(14 * 3600),
  daily: z.object({
    time: z.array(z.string().regex(LOCAL_DAY)).min(1).max(16),
    weather_code: z.array(z.number().int().min(0).max(99).nullable()),
    temperature_2m_max: z.array(temp.nullable()),
    temperature_2m_min: z.array(temp.nullable()),
    precipitation_probability_max: z.array(pct.nullable()),
    precipitation_sum: z.array(nonNeg.nullable()),
    wind_speed_10m_max: z.array(nonNeg.nullable()),
    wind_gusts_10m_max: z.array(nonNeg.nullable()),
    uv_index_max: z.array(num.min(0).max(30).nullable()),
    sunrise: z.array(z.string().regex(LOCAL_TIME).nullable()),
    sunset: z.array(z.string().regex(LOCAL_TIME).nullable()),
  }),
  hourly: z
    .object({
      time: z.array(z.string().regex(LOCAL_TIME)).max(16 * 24),
      temperature_2m: z.array(temp.nullable()),
      precipitation_probability: z.array(pct.nullable()),
      weather_code: z.array(z.number().int().min(0).max(99).nullable()),
    })
    .optional(),
});

/**
 * Open-Meteo's JSON -> our Forecast. Throws (RangeError / ZodError) when the shape is wrong, the arrays don't line up,
 * or no day has a weather code and both temperatures (then there is no forecast to show; never filled in).
 */
export function parseForecast(json: unknown): Forecast {
  const b = Body.parse(json);
  const d = b.daily;
  const n = d.time.length;
  for (const [k, arr] of Object.entries(d)) if (arr.length !== n) throw new RangeError(`daily.${k} has ${arr.length} values, expected ${n}`);
  const hours: WeatherHour[] = [];
  if (b.hourly) {
    const h = b.hourly;
    const m = h.time.length;
    for (const [k, arr] of Object.entries(h)) if (arr.length !== m) throw new RangeError(`hourly.${k} has ${arr.length} values, expected ${m}`);
    for (let i = 0; i < m; i++) hours.push({ time: h.time[i], tempF: h.temperature_2m[i], rainPct: h.precipitation_probability[i], code: h.weather_code[i] });
  }
  const days: WeatherDay[] = [];
  for (let i = 0; i < n; i++) {
    const code = d.weather_code[i];
    const highF = d.temperature_2m_max[i];
    const lowF = d.temperature_2m_min[i];
    // A day without its code or temperatures is left out (never guessed).
    if (code === null || highF === null || lowF === null) continue;
    const date = d.time[i];
    days.push({
      date,
      code,
      highF,
      lowF,
      rainPct: d.precipitation_probability_max[i],
      rainIn: d.precipitation_sum[i],
      windMph: d.wind_speed_10m_max[i],
      gustMph: d.wind_gusts_10m_max[i],
      uv: d.uv_index_max[i],
      sunrise: d.sunrise[i],
      sunset: d.sunset[i],
      hours: hours.filter((x) => x.time.startsWith(`${date}T`)),
    });
  }
  if (days.length === 0) throw new RangeError("no day with a weather code and temperatures");
  return { timezone: b.timezone, utcOffsetSec: b.utc_offset_seconds, days };
}

export type OpenMeteoDeps = { fetchImpl?: FetchLike; signal?: AbortSignal; timeoutMs?: number; env?: Record<string, string | undefined> };

/** Fetch and parse the 2-day forecast. Throws SourceError (timeout, network, rate_limited, busy, bad_output). */
export async function fetchForecast(lat: number, lng: number, deps: OpenMeteoDeps = {}): Promise<{ forecast: Forecast; latencyMs: number }> {
  const url = forecastUrl(lat, lng);
  const res = await fetchText(
    OPEN_METEO_SOURCE,
    url,
    { headers: { "User-Agent": userAgent(deps.env), Accept: "application/json" } },
    { timeoutMs: deps.timeoutMs ?? WEATHER_TIMEOUT_MS, fetchImpl: deps.fetchImpl, signal: deps.signal, maxBytes: MAX_BYTES },
  );
  if (res.status === 429) throw new SourceError(OPEN_METEO_SOURCE, "rate_limited", { status: 429, started: true });
  if (res.status >= 500) throw new SourceError(OPEN_METEO_SOURCE, "busy", { status: res.status, started: true });
  if (res.status !== 200) throw new SourceError(OPEN_METEO_SOURCE, "bad_output", { status: res.status, started: true });
  try {
    return { forecast: parseForecast(JSON.parse(res.text)), latencyMs: res.latencyMs };
  } catch (err) {
    throw new SourceError(OPEN_METEO_SOURCE, "bad_output", { started: true, cause: err, message: `${OPEN_METEO_SOURCE}: answer not in the expected shape` });
  }
}
