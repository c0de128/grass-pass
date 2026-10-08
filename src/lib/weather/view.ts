/**
 * A weather lookup -> exactly what the pass page card shows (plain, serialisable data; the card only renders it).
 * Pure: the time is passed in.
 */
import { weatherGovPageUrl } from "@/lib/sources/nws-alerts";
import { codeInfo, type Sky } from "./codes";
import { alertLine, clockLabel, localNowString, outingStats, pickDay, weatherSummary, THRESHOLDS, type Which } from "./summary";
import type { AlertSeverity, Mood, WeatherAlert } from "./types";
import type { WeatherFetch } from "./park-weather";

/** The card's picture and colours. */
export type WeatherLook = "sunny" | "partly" | "cloudy" | "fog" | "rain" | "snow" | "storm" | "hot" | "cold" | "alert";

export type WeatherAlertView = { line: string; sender: string; severity: AlertSeverity; fromNws: boolean };

type Common = {
  parkName: string;
  /** At most 2, most severe first. */
  alerts: WeatherAlertView[];
  /** weather.gov page for the point (US parks only). */
  alertsLink: string | null;
  /** One honest line about the alerts check (none found, could not check), or null outside the US. */
  alertsNote: string | null;
};

export type WeatherView =
  | (Common & {
      kind: "forecast";
      which: Which;
      /** "Thu, Oct 8" */
      dateLabel: string;
      look: WeatherLook;
      mood: Mood;
      headline: string;
      details: string[];
      tips: string[];
      highF: number;
      lowF: number;
      rainPct: number | null;
      /** "8 mph, gusts 12 mph" */
      wind: string | null;
      /** "7:01 PM" */
      sunset: string | null;
      /** "8:40 AM CDT" (park local time) */
      updated: string;
    })
  | (Common & { kind: "none"; reason: string; reasonCode: string });

export const MAX_ALERTS_SHOWN = 2;

/** Why there is no forecast, in plain words (after "No weather data available: "). */
export const NO_WEATHER_REASONS: Record<string, string> = {
  timeout: "the weather service didn't answer in time.",
  network: "we couldn't reach the weather service.",
  rate_limited: "the weather service is getting too many requests right now. Try again in a few minutes.",
  busy: "the weather service is having trouble right now. Try again in a few minutes.",
  bad_output: "the weather service sent an answer we couldn't read.",
  aborted: "the weather lookup was stopped.",
  budget: "we've used today's free weather lookups. It resets tomorrow.",
  bad_point: "this park has no usable map position.",
  no_day: "the forecast we got doesn't cover this day yet.",
};

export const NO_WEATHER_PREFIX = "No weather data available: ";

export function noWeatherLine(code: string): string {
  return `${NO_WEATHER_PREFIX}${NO_WEATHER_REASONS[code] ?? "the weather service didn't give us a forecast."}`;
}

const DAY_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

/** "2026-10-08" -> "Thu, Oct 8". */
export function dateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return DAY_FMT.format(new Date(Date.UTC(y, m - 1, d)));
}

/** "8:40 AM CDT" in the park's time zone (falls back to UTC if the zone is unknown to this server). */
export function updatedLabel(ms: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(ms));
  } catch {
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(ms));
  }
}

/** Offset of an ISO time ("...-05:00") in seconds; 0 for Z or none. */
function isoOffsetSec(iso: string): number {
  const m = /([+-])(\d{2}):(\d{2})$/.exec(iso);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 3600 + Number(m[3]) * 60) : 0;
}

function stillOn(a: WeatherAlert, nowMs: number): boolean {
  if (a.ends) return Date.parse(a.ends) > nowMs;
  if (a.expires) return Date.parse(a.expires) > nowMs;
  return true;
}

function alertViews(alerts: readonly WeatherAlert[], localNow: (a: WeatherAlert) => string): WeatherAlertView[] {
  return alerts.slice(0, MAX_ALERTS_SHOWN).map((a) => ({
    line: alertLine(a, localNow(a)),
    sender: a.senderName ?? "sender not named",
    severity: a.severity,
    fromNws: a.fromNws,
  }));
}

function alertsNote(w: WeatherFetch, shown: number): string | null {
  if (w.alertsStatus === "not_us") return null;
  if (w.alertsStatus === "failed") return "Official alerts: we couldn't check weather.gov just now.";
  return shown === 0 ? "No official weather alerts here right now (weather.gov)." : null;
}

export function buildWeatherView(park: { name: string; lat: number; lng: number }, w: WeatherFetch, nowMs: number): WeatherView {
  const active = (w.alerts ?? []).filter((a) => stillOn(a, nowMs));
  const alertsLink = w.alertsStatus === "not_us" ? null : weatherGovPageUrl(park.lat, park.lng);
  const parkName = park.name;
  const pick = w.forecast ? pickDay(w.forecast, nowMs) : null;
  if (!w.forecast || !pick) {
    const code = w.forecast ? "no_day" : (w.forecastError ?? "bad_output");
    const alerts = alertViews(active, (a) => localNowString(nowMs, isoOffsetSec(a.ends ?? a.expires ?? a.onset ?? "")));
    return { kind: "none", parkName, reason: noWeatherLine(code), reasonCode: code, alerts, alertsLink, alertsNote: alertsNote(w, alerts.length) };
  }
  const summary = weatherSummary(pick, active);
  const stats = outingStats(pick);
  const day = pick.day;
  const alerts = alertViews(active, () => pick.localNow);
  const severeAlert = active[0] && (active[0].severity === "Extreme" || active[0].severity === "Severe");
  const sky: Sky = codeInfo(day.code).sky;
  // The picture: the weather itself when it is the story (storm, rain, snow, heat, cold); a warning sign when a severe
  // official alert is the story on an otherwise ordinary day (a hurricane warning under grey skies).
  const look: WeatherLook =
    stats.firstStorm !== null
      ? "storm"
      : stats.rainPct !== null && stats.rainPct >= THRESHOLDS.rainWarnPct
        ? "rain"
        : stats.winter
          ? "snow"
          : day.highF >= THRESHOLDS.heatWarnF
            ? "hot"
            : day.highF < THRESHOLDS.coldWarnBelowF
              ? "cold"
              : severeAlert
                ? "alert"
                : stats.fog
                  ? "fog"
                  : sky === "clear"
                    ? "sunny"
                    : sky === "partly"
                      ? "partly"
                      : stats.rainPct !== null && stats.rainPct >= THRESHOLDS.rainCautionPct && (sky === "rain" || sky === "drizzle")
                        ? "rain"
                        : "cloudy";
  const wind =
    day.windMph === null
      ? null
      : day.gustMph !== null && Math.round(day.gustMph) > Math.round(day.windMph)
        ? `${Math.round(day.windMph)} mph, gusts ${Math.round(day.gustMph)}`
        : `${Math.round(day.windMph)} mph`;
  return {
    kind: "forecast",
    parkName,
    which: pick.which,
    dateLabel: dateLabel(day.date),
    look,
    mood: summary.mood,
    headline: summary.headline,
    details: summary.details,
    tips: summary.tips,
    highF: Math.round(day.highF),
    lowF: Math.round(day.lowF),
    rainPct: stats.rainPct,
    wind,
    sunset: day.sunset ? clockLabel(day.sunset) : null,
    updated: updatedLabel(w.fetchedAt, w.forecast.timezone),
    alerts,
    alertsLink,
    alertsNote: alertsNote(w, alerts.length),
  };
}
