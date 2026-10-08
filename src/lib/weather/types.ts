/**
 * Weather shapes shared by the sources (src/lib/sources/open-meteo.ts, nws-alerts.ts), the wording
 * (summary.ts) and the pass page card (src/components/pass/WeatherCard.tsx). Times without an offset
 * ("2026-10-08T15:00") are the PARK's local wall-clock time, as Open-Meteo answers with timezone=auto.
 */

/** One forecast hour, park local time. */
export type WeatherHour = {
  /** "YYYY-MM-DDTHH:MM", park local time. */
  time: string;
  tempF: number | null;
  /** Chance of rain (any precipitation) in this hour, 0-100. */
  rainPct: number | null;
  code: number | null;
};

/** One forecast day, park local time. */
export type WeatherDay = {
  /** "YYYY-MM-DD", park local date. */
  date: string;
  code: number;
  highF: number;
  lowF: number;
  rainPct: number | null;
  rainIn: number | null;
  windMph: number | null;
  gustMph: number | null;
  uv: number | null;
  /** "YYYY-MM-DDTHH:MM", park local time (null in polar day/night). */
  sunrise: string | null;
  sunset: string | null;
  hours: WeatherHour[];
};

export type Forecast = {
  /** IANA time zone of the park, e.g. "America/Chicago". */
  timezone: string;
  /** The zone's offset from UTC when the forecast was made. */
  utcOffsetSec: number;
  days: WeatherDay[];
};

export type AlertSeverity = "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";

/** One official alert for the park's point (api.weather.gov, status Actual only). */
export type WeatherAlert = {
  event: string;
  severity: AlertSeverity;
  /** Who sent it, as the feed names it (an NWS office, or another agency relayed through IPAWS). */
  senderName: string | null;
  /** True when the sender is the National Weather Service. */
  fromNws: boolean;
  onset: string | null;
  /** The hazard's end ("ends", then parameters.eventEndingTime), with its UTC offset. */
  ends: string | null;
  /** When the MESSAGE expires: not the end of the hazard (memory: pitfall-nws-cap-expires). */
  expires: string | null;
};

export type Mood = "great" | "good" | "caution" | "warning" | "danger";

export type WeatherSummary = {
  mood: Mood;
  headline: string;
  details: string[];
  tips: string[];
};
