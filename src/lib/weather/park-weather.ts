/**
 * The pass page weather card's data: a real Open-Meteo forecast for the park, plus official US alerts (api.weather.gov)
 * when the park is in the US. Never throws and never invents: any failure becomes an honest "No weather data available"
 * reason, and alerts that fail are just left out (logged). See src/lib/sources/open-meteo.ts and nws-alerts.ts.
 *
 * Time budget: the card streams in under <Suspense> (src/app/pass/[id]/page.tsx), so the pass itself never waits. Each
 * lookup may take up to WEATHER_BUDGET_MS (8 s): a cold server's first request (DNS, TLS, a busy event loop) measured
 * over 4 s in e2e. A fast failure (network error, 5xx) is tried once more inside the same budget.
 *
 * Cached in process per park position (rounded to ~1 km): 30 minutes after a good answer, 1 minute after a failure,
 * at most 500 positions, and parallel page views share one request. If a refresh fails, the last good forecast for that
 * position (at most 3 hours old) is shown with its own "forecast updated" time rather than nothing. A daily cap
 * (WEATHER_DAILY_CALLS, default 5,000) keeps us well under Open-Meteo's free 10,000 calls a day.
 */
import "server-only";
import { log, logOnce } from "@/lib/log";
import { SourceError, type FetchLike, type SourceErrorCode } from "@/lib/sources/common";
import { fetchForecast, roundCoord, validPoint } from "@/lib/sources/open-meteo";
import { fetchAlerts, inNwsArea } from "@/lib/sources/nws-alerts";
import type { Forecast, WeatherAlert } from "./types";
import { buildWeatherView, type WeatherView } from "./view";

export const WEATHER_TTL_MS = 30 * 60_000;
export const WEATHER_FAIL_TTL_MS = 60_000;
/** The most a lookup (both services, a retry included) may take. */
export const WEATHER_BUDGET_MS = 8_000;
/** A failed refresh may fall back to a good forecast at most this old (its own time is shown). */
export const WEATHER_STALE_MAX_MS = 3 * 3600_000;
export const WEATHER_MAX_ENTRIES = 500;
export const WEATHER_DAILY_CALLS_DEFAULT = 5_000;

type Env = Record<string, string | undefined>;

/** What one lookup found (cached). */
export type WeatherFetch = {
  /** When the forecast (or the failed try) was fetched. */
  fetchedAt: number;
  forecast: Forecast | null;
  /** Why there is no forecast. */
  forecastError: SourceErrorCode | "budget" | "bad_point" | null;
  /** null: not asked (outside the US) or the request failed. */
  alerts: WeatherAlert[] | null;
  alertsStatus: "ok" | "not_us" | "failed";
};

type Entry = { at: number; ttl: number; value: Promise<WeatherFetch> };
type State = { entries: Map<string, Entry>; good: Map<string, WeatherFetch>; day: string; calls: number };
const KEY = Symbol.for("grass-pass.weather");

function state(): State {
  const g = globalThis as unknown as Record<symbol, State | undefined>;
  return (g[KEY] ??= { entries: new Map(), good: new Map(), day: "", calls: 0 });
}

/** Tests: forget the cache and the daily count. */
export function resetWeather(): void {
  const s = state();
  s.entries.clear();
  s.good.clear();
  s.day = "";
  s.calls = 0;
}

function dailyCap(env: Env): number {
  const n = Number(env.WEATHER_DAILY_CALLS?.trim());
  return Number.isFinite(n) && n >= 0 && env.WEATHER_DAILY_CALLS?.trim() ? Math.floor(n) : WEATHER_DAILY_CALLS_DEFAULT;
}

/** Count one Open-Meteo call against today's cap (UTC day: Open-Meteo's own counter). False when the cap is used up. */
function takeCall(nowMs: number, env: Env): boolean {
  const s = state();
  const day = new Date(nowMs).toISOString().slice(0, 10);
  if (s.day !== day) {
    s.day = day;
    s.calls = 0;
  }
  if (s.calls >= dailyCap(env)) return false;
  s.calls++;
  return true;
}

export type WeatherDeps = { fetchImpl?: FetchLike; env?: Env; /** Tests: a shorter budget than the 8 s default. */ timeoutMs?: number };

/** Run `call` within `budgetMs`; a fast failure (network, busy) is tried once more with the time left (at least 1 s). */
async function withRetry<T>(budgetMs: number, call: (timeoutMs: number) => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await call(budgetMs);
  } catch (err) {
    const left = budgetMs - (Date.now() - start);
    const retryable = err instanceof SourceError && (err.code === "network" || err.code === "busy");
    if (!retryable || left < 1_000) throw err;
    return call(left);
  }
}

/** One live lookup (forecast and alerts in parallel). Never throws. */
export async function lookupWeather(lat: number, lng: number, nowMs: number, deps: WeatherDeps = {}): Promise<WeatherFetch> {
  const env = deps.env ?? process.env;
  const budget = deps.timeoutMs ?? WEATHER_BUDGET_MS;
  if (!validPoint(lat, lng)) return { fetchedAt: nowMs, forecast: null, forecastError: "bad_point", alerts: null, alertsStatus: "failed" };
  // WEATHER_DAILY_CALLS=0 switches the weather off: no call to either service.
  if (dailyCap(env) === 0) {
    logOnce("weather-off", "weather_off", { reason: "WEATHER_DAILY_CALLS=0" });
    return { fetchedAt: nowMs, forecast: null, forecastError: "budget", alerts: null, alertsStatus: "failed" };
  }
  const point = { lat: roundCoord(lat), lng: roundCoord(lng) };
  const forecastP = (async (): Promise<Pick<WeatherFetch, "forecast" | "forecastError">> => {
    if (!takeCall(nowMs, env)) {
      log("weather_forecast", { source: "open-meteo", ok: false, code: "budget" }, "warn");
      return { forecast: null, forecastError: "budget" };
    }
    try {
      const r = await withRetry(budget, (timeoutMs) => fetchForecast(lat, lng, { fetchImpl: deps.fetchImpl, env, timeoutMs }));
      log("weather_forecast", { source: "open-meteo", ok: true, latencyMs: r.latencyMs, days: r.forecast.days.length, ...point });
      return { forecast: r.forecast, forecastError: null };
    } catch (err) {
      const code: SourceErrorCode = err instanceof SourceError ? err.code : "bad_output";
      log("weather_forecast", { source: "open-meteo", ok: false, code, status: err instanceof SourceError ? err.status : undefined, ...point }, "warn");
      return { forecast: null, forecastError: code };
    }
  })();
  const alertsP = (async (): Promise<Pick<WeatherFetch, "alerts" | "alertsStatus">> => {
    if (!inNwsArea(lat, lng)) return { alerts: null, alertsStatus: "not_us" };
    try {
      const r = await withRetry(budget, (timeoutMs) => fetchAlerts(lat, lng, nowMs, { fetchImpl: deps.fetchImpl, env, timeoutMs }));
      log("weather_alerts", { source: "nws-alerts", ok: true, latencyMs: r.latencyMs, alerts: r.alerts.length, ...point });
      return { alerts: r.alerts, alertsStatus: "ok" };
    } catch (err) {
      const code: SourceErrorCode = err instanceof SourceError ? err.code : "bad_output";
      log("weather_alerts", { source: "nws-alerts", ok: false, code, status: err instanceof SourceError ? err.status : undefined, ...point }, "warn");
      return { alerts: null, alertsStatus: "failed" };
    }
  })();
  const [f, a] = await Promise.all([forecastP, alertsP]);
  return { fetchedAt: nowMs, ...f, ...a };
}

/** The cached lookup for a park position (see the file comment). */
export function cachedWeather(lat: number, lng: number, nowMs: number, deps: WeatherDeps = {}, opts: { fresh?: boolean } = {}): Promise<WeatherFetch> {
  const s = state();
  const key = `${roundCoord(lat).toFixed(2)},${roundCoord(lng).toFixed(2)}`;
  const hit = s.entries.get(key);
  if (!opts.fresh && hit && nowMs - hit.at < hit.ttl) return hit.value;
  const entry: Entry = { at: nowMs, ttl: WEATHER_FAIL_TTL_MS, value: Promise.resolve(null as unknown as WeatherFetch) };
  entry.value = lookupWeather(lat, lng, nowMs, deps).then((w) => {
    if (w.forecast) {
      entry.ttl = WEATHER_TTL_MS;
      s.good.set(key, w);
      while (s.good.size > WEATHER_MAX_ENTRIES) {
        const oldest = s.good.keys().next().value;
        if (oldest === undefined) break;
        s.good.delete(oldest);
      }
      return w;
    }
    // A failed refresh: keep showing the last good forecast for this spot (with its own time), not nothing.
    const prev = s.good.get(key);
    if (prev?.forecast && nowMs - prev.fetchedAt <= WEATHER_STALE_MAX_MS && w.forecastError !== "budget") {
      log("weather_forecast_stale", { ageMin: Math.round((nowMs - prev.fetchedAt) / 60_000), code: w.forecastError }, "warn");
      return { ...prev, alerts: w.alertsStatus === "ok" ? w.alerts : prev.alerts, alertsStatus: w.alertsStatus === "ok" ? "ok" : prev.alertsStatus };
    }
    return w;
  });
  s.entries.delete(key);
  s.entries.set(key, entry);
  while (s.entries.size > WEATHER_MAX_ENTRIES) {
    const oldest = s.entries.keys().next().value;
    if (oldest === undefined) break;
    s.entries.delete(oldest);
  }
  return entry.value;
}

/**
 * The card for a park: cached lookup -> words. If the cached forecast no longer holds the day to show (it was fetched
 * before the park's local midnight), it is fetched once more rather than showing the wrong day.
 */
export async function getParkWeather(park: { name: string; lat: number; lng: number }, nowMs: number, deps: WeatherDeps = {}): Promise<WeatherView> {
  let w = await cachedWeather(park.lat, park.lng, nowMs, deps);
  let view = buildWeatherView(park, w, nowMs);
  if (view.kind === "none" && view.reasonCode === "no_day" && w.fetchedAt < nowMs) {
    w = await cachedWeather(park.lat, park.lng, nowMs, deps, { fresh: true });
    view = buildWeatherView(park, w, nowMs);
  }
  return view;
}
