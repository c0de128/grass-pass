/**
 * The words on the pass page weather card, written by code (never by the model), from a real forecast only.
 * Pure functions: every caller passes the time, so tests are exact.
 *
 * Which day: TODAY in the park's local time; from 6 PM local (or after sunset) the family would go TOMORROW, so the
 * card shows tomorrow and says so. Rain and storm timing use the hours you'd be out: from now (today) or 7 AM
 * (tomorrow) until the hour of sunset, at most 9 PM.
 *
 * Moods, worst first (the headline comes from the worst; the rest become detail lines):
 * - danger:  thunderstorm codes (95/96/99) in those hours, or an official Extreme/Severe alert.
 * - warning: rain chance >= 60%; snow or ice; high >= 95°F; high < 40°F; gusts >= 30 mph; a Moderate alert.
 * - caution: rain 30-59%; high 88-94°F; high 40-50°F; gusts 25-29 mph; fog; storms later that evening.
 * - great:   none of the above, clear to partly cloudy, high 60-86°F, rain < 20%.
 * - good:    everything else (cloudy, a cool 51-59°F, an 87°F high, rain 20-29%).
 * UV 8+ adds a sunscreen tip, and a Minor or Unknown alert (an air quality alert, a coastal flood statement) is listed in
 * the card's alerts box; neither changes the mood.
 */
import { codeInfo, isFairCode, isFogCode, isStormCode, isWinterCode } from "./codes";
import type { Forecast, Mood, WeatherAlert, WeatherDay, WeatherHour, WeatherSummary } from "./types";

/** From this local hour the card shows tomorrow. */
export const EVENING_HOUR = 18;
/** The hunt starts no earlier than this local hour. */
export const FIRST_OUTING_HOUR = 7;
/** ...and ends by this one even on long summer evenings. */
export const LAST_OUTING_HOUR = 21;

export const THRESHOLDS = {
  rainWarnPct: 60,
  rainCautionPct: 30,
  rainGreatBelowPct: 20,
  /** An hour at or above this chance is when "rain likely" starts. */
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
} as const;

export type Which = "today" | "tomorrow";
export type DayPick = { day: WeatherDay; which: Which; /** "YYYY-MM-DDTHH:MM", park local time. */ localNow: string };

const pad = (n: number) => String(n).padStart(2, "0");

/** The park's local wall-clock time at `nowMs`, as "YYYY-MM-DDTHH:MM" (the offset Open-Meteo answered with). */
export function localNowString(nowMs: number, utcOffsetSec: number): string {
  return new Date(nowMs + utcOffsetSec * 1000).toISOString().slice(0, 16);
}

const hourOf = (localTime: string): number => Number(localTime.slice(11, 13));

function nextDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * Today (park local time), or tomorrow from 6 PM / after sunset. Null when the forecast doesn't hold that day
 * (e.g. an answer from before local midnight): the caller then fetches again rather than show the wrong day.
 */
export function pickDay(forecast: Forecast, nowMs: number): DayPick | null {
  const localNow = localNowString(nowMs, forecast.utcOffsetSec);
  const date = localNow.slice(0, 10);
  const today = forecast.days.find((d) => d.date === date);
  if (!today) return null;
  const evening = hourOf(localNow) >= EVENING_HOUR || (today.sunset !== null && localNow >= today.sunset);
  if (!evening) return { day: today, which: "today", localNow };
  const tomorrow = forecast.days.find((d) => d.date === nextDate(date));
  return tomorrow ? { day: tomorrow, which: "tomorrow", localNow } : null;
}

/** The hours the family would be out (see the file comment). */
export function outingHours(pick: DayPick): WeatherHour[] {
  const start = pick.which === "today" ? Math.max(FIRST_OUTING_HOUR, hourOf(pick.localNow)) : FIRST_OUTING_HOUR;
  const sunsetHour = pick.day.sunset ? hourOf(pick.day.sunset) : 19;
  const end = Math.max(start, Math.min(LAST_OUTING_HOUR, sunsetHour));
  return pick.day.hours.filter((h) => {
    const hr = hourOf(h.time);
    return hr >= start && hr <= end;
  });
}

export type OutingStats = {
  /** Highest hourly rain chance while you'd be out (the day's when there is no hourly data). */
  rainPct: number | null;
  firstRainLikely: string | null;
  firstRainPossible: string | null;
  firstStorm: string | null;
  /** A storm later the same day, after the outing hours. */
  stormLater: string | null;
  winter: boolean;
  fog: boolean;
  /** First outing hour ("YYYY-MM-DDTHH:MM"), or null without hourly data. */
  start: string | null;
};

export function outingStats(pick: DayPick): OutingStats {
  const hours = outingHours(pick);
  const t = THRESHOLDS;
  const pcts = hours.map((h) => h.rainPct).filter((p): p is number => p !== null);
  const rainPct = pcts.length > 0 ? Math.max(...pcts) : pick.day.rainPct;
  const first = (ok: (h: WeatherHour) => boolean) => hours.find(ok)?.time ?? null;
  const last = hours.at(-1)?.time ?? null;
  const noHours = hours.length === 0;
  return {
    rainPct: rainPct === null ? null : Math.round(rainPct),
    firstRainLikely: first((h) => (h.rainPct ?? -1) >= t.rainLikelyHourPct),
    firstRainPossible: first((h) => (h.rainPct ?? -1) >= t.rainCautionPct),
    firstStorm: noHours ? (isStormCode(pick.day.code) ? "" : null) : first((h) => isStormCode(h.code)),
    stormLater: last ? (pick.day.hours.find((h) => h.time > last && isStormCode(h.code))?.time ?? null) : null,
    winter: noHours ? isWinterCode(pick.day.code) : hours.some((h) => isWinterCode(h.code)),
    fog: noHours ? isFogCode(pick.day.code) : hours.some((h) => isFogCode(h.code)),
    start: hours[0]?.time ?? null,
  };
}

/** "2026-10-08T15:00" -> "3 PM"; "2026-10-08T19:01" -> "7:01 PM". */
export function clockLabel(localTime: string): string {
  const h = hourOf(localTime);
  const m = Number(localTime.slice(14, 16));
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${pad(m)}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** An alert time with its own offset ("2026-10-08T20:00:00-05:00") -> "8 PM today" / "8 PM tomorrow" / "8 PM Sat". */
export function alertTimeLabel(iso: string, localNow: string): string {
  const local = iso.slice(0, 16);
  const date = local.slice(0, 10);
  const today = localNow.slice(0, 10);
  const [y, m, d] = date.split("-").map(Number);
  const day = date === today ? "today" : date === nextDate(today) ? "tomorrow" : WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${clockLabel(local)} ${day}`;
}

/** "Hurricane Warning until 8 PM tomorrow" / "... until further notice" (UX-10-04: the NWS gave no end time). */
export function alertLine(a: WeatherAlert, localNow: string): string {
  return a.ends ? `${a.event} until ${alertTimeLabel(a.ends, localNow)}` : `${a.event} until further notice`;
}

type Issue = { mood: Mood; headline: string; line: string };

const MOOD_RANK: Record<Mood, number> = { great: 0, good: 1, caution: 2, warning: 3, danger: 4 };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const deg = (f: number) => `${Math.round(f)}°`;

/** Rain phrase for a fair day: "no rain in sight", "only a 15% chance of rain", or nothing when unknown. */
function rainWords(pct: number | null, great: boolean): string | null {
  if (pct === null) return null;
  if (pct < 10) return "no rain in sight";
  return `${great ? "only " : ""}a ${pct}% chance of rain`;
}

/**
 * The card's words for the picked day. `alerts` are the official alerts at the park (most severe first).
 * Deterministic: the same forecast, alerts and time always give the same words.
 */
export function weatherSummary(pick: DayPick, alerts: readonly WeatherAlert[] = []): WeatherSummary {
  const t = THRESHOLDS;
  const { day, which } = pick;
  const when = which;
  const s = outingStats(pick);
  const high = Math.round(day.highF);
  const gust = day.gustMph === null ? null : Math.round(day.gustMph);
  const issues: Issue[] = [];
  const tips: string[] = [];
  const later = (time: string | null) => time !== null && time !== "" && s.start !== null && hourOf(time) >= hourOf(s.start) + 2;

  // Storms in the hours you'd be out.
  if (s.firstStorm !== null) {
    const at = s.firstStorm ? clockLabel(s.firstStorm) : null;
    issues.push({
      mood: "danger",
      headline: at ? `Storms ${when} from about ${at}: save the hunt for another day.` : `Storms ${when}: save the hunt for another day.`,
      line: at ? `Thunderstorms forecast from about ${at}.` : `Thunderstorms are forecast ${when}.`,
    });
    if (at && later(s.firstStorm)) tips.push(`If you do go, go early and be home before ${at}.`);
    tips.push("When thunder roars, go indoors.");
  } else if (s.stormLater) {
    const at = clockLabel(s.stormLater);
    issues.push({ mood: "caution", headline: `Storms are possible after ${at} ${when}: be home before then.`, line: `Storms are possible after ${at}: be home before then.` });
  }

  // Official alerts (never our own actions: only "follow" or "read" the alert). Minor and Unknown alerts (an air quality
  // alert, a coastal flood statement) don't change the mood: the card lists them in its own alerts box.
  const top = alerts[0];
  if (top) {
    const severe = top.severity === "Extreme" || top.severity === "Severe";
    if (severe) {
      issues.push({
        mood: "danger",
        headline: `${top.event} for this area: save the hunt for another day and follow the official alert.`,
        line: `Official alert: ${top.event}. Follow it.`,
      });
    } else if (top.severity === "Moderate") {
      issues.push({ mood: "warning", headline: `${top.event} for this area: read the official alert before you go.`, line: `Official alert: ${top.event}. Read it before you go.` });
    }
  }

  // Rain (not repeated under a storm headline: the storm line already says when).
  const storming = s.firstStorm !== null;
  if (!storming && s.rainPct !== null && s.rainPct >= t.rainWarnPct) {
    const from = s.firstRainLikely;
    if (later(from) && from) {
      const at = clockLabel(from);
      const go = hourOf(from) >= 12 && s.start !== null && hourOf(s.start) <= 10 ? "go this morning" : "go before then";
      issues.push({ mood: "warning", headline: `Rain likely from about ${at} (${s.rainPct}%): ${go}.`, line: `Rain likely from about ${at} (${s.rainPct}%).` });
    } else {
      issues.push({
        mood: "warning",
        headline: `Rain likely ${when} (${s.rainPct}% chance): pack raincoats or pick a drier day.`,
        line: `Rain likely (${s.rainPct}% chance): pack raincoats.`,
      });
    }
  } else if (!storming && s.rainPct !== null && s.rainPct >= t.rainCautionPct) {
    const from = s.firstRainPossible;
    const at = later(from) && from ? clockLabel(from) : null;
    issues.push({
      mood: "caution",
      headline: at ? `Some rain is possible from about ${at} (${s.rainPct}%): bring a raincoat.` : `Some rain is possible ${when} (${s.rainPct}%): bring a raincoat.`,
      line: at ? `Some rain is possible from about ${at} (${s.rainPct}%).` : `Some rain is possible (${s.rainPct}%).`,
    });
  }

  // Snow and ice.
  if (s.winter) {
    const words = isWinterCode(day.code) ? codeInfo(day.code).words : "snow or ice";
    issues.push({ mood: "warning", headline: `${cap(words)} ${when}: dress warm and watch for slippery paths.`, line: `${cap(words)}: watch for slippery paths.` });
  }

  // Heat and cold.
  if (high >= t.heatWarnF) {
    issues.push({ mood: "warning", headline: `Hot one ${when}: a high of ${deg(high)}. Go early, bring water and take shade breaks.`, line: `Hot: a high of ${deg(high)}. Bring water.` });
  } else if (high >= t.warmCautionF) {
    issues.push({ mood: "caution", headline: `A warm one ${when}: a high of ${deg(high)}. Bring water and take shade breaks.`, line: `Warm: a high of ${deg(high)}. Bring water.` });
  } else if (high < t.coldWarnBelowF) {
    issues.push({ mood: "warning", headline: `Cold one ${when}: a high of only ${deg(high)}. Coats, hats and gloves.`, line: `Cold: a high of only ${deg(high)}. Coats, hats and gloves.` });
  } else if (high <= t.chillyCautionMaxF) {
    issues.push({ mood: "caution", headline: `A chilly one ${when}: a high of ${deg(high)}. Bring jackets.`, line: `Chilly: a high of ${deg(high)}. Bring jackets.` });
  }

  // Wind.
  if (gust !== null && gust >= t.gustWarnMph) {
    issues.push({ mood: "warning", headline: `Very windy ${when}: gusts up to ${gust} mph. Hold on to your pass!`, line: `Very windy: gusts up to ${gust} mph.` });
  } else if (gust !== null && gust >= t.gustCautionMph) {
    issues.push({ mood: "caution", headline: `Breezy ${when}: gusts up to ${gust} mph.`, line: `Breezy: gusts up to ${gust} mph.` });
  }

  if (s.fog) issues.push({ mood: "caution", headline: `Fog ${when}: stay close together where it's hard to see.`, line: "Fog: stay close together." });

  if (day.uv !== null && day.uv >= t.uvTip) tips.push(`Strong sun (UV ${Math.round(day.uv)}): sunscreen and hats.`);

  if (issues.length > 0) {
    // Stable sort: the worst mood first; within a mood, the order above (storms, alerts, rain, snow, heat/cold, wind, fog).
    const sorted = [...issues].sort((a, b) => MOOD_RANK[b.mood] - MOOD_RANK[a.mood]);
    const [head, ...rest] = sorted;
    return { mood: head.mood, headline: head.headline, details: rest.slice(0, 3).map((i) => i.line), tips };
  }

  const sky = codeInfo(day.code).words;
  const great = isFairCode(day.code) && high >= t.greatMinF && high <= t.greatMaxF && s.rainPct !== null && s.rainPct < t.rainGreatBelowPct;
  const rain = rainWords(s.rainPct, great);
  const facts = rain ? `${sky}, a high of ${deg(high)} and ${rain}` : `${sky} and a high of ${deg(high)}`;
  if (great) return { mood: "great", headline: `The weather will be perfect ${when}: ${facts}.`, details: [], tips };
  if (high < t.greatMinF) tips.unshift("A jacket helps.");
  return { mood: "good", headline: `Good hunting weather ${when}: ${facts}.`, details: [], tips };
}
