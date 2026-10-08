/**
 * Official US weather alerts for the park's point: api.weather.gov `alerts/active?point=lat,lng` (public domain, no key).
 *
 * Rules learned the hard way (factory memory):
 * - api.weather.gov answers 403 without a User-Agent, so this runs on the server only, with our descriptive UA.
 * - The feed carries `status: "Test"` (and Exercise/System/Draft) messages: only `Actual` is shown.
 * - It also relays non-NWS IPAWS alerts (a county, a village): the card names the real sender, never "NWS".
 * - Most alerts have `instruction: null` (live 2026-10-08: 290 of 459): we never write actions for an alert.
 * - `expires` is when the MESSAGE expires, not when the hazard ends: "until" uses `ends`, then
 *   `parameters.eventEndingTime`; with neither, the card says no end time was given.
 * Only points inside the US areas NWS covers are asked (elsewhere there is nothing to ask). Any failure is logged by the
 * caller and the card shows the forecast without alerts.
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import { fetchText, SourceError, userAgent, type FetchLike } from "./common";
import { roundCoord, validPoint } from "./open-meteo";
import type { AlertSeverity, WeatherAlert } from "@/lib/weather/types";

export const NWS_API = "https://api.weather.gov";
export const NWS_SOURCE = "nws-alerts";
export const NWS_TIMEOUT_MS = 4_000;
/** A busy point (a hurricane coast) can carry a dozen long alerts; 1 MB is far above any real answer. */
const MAX_BYTES = 1_000_000;

/** Rough boxes around the US states and territories NWS forecasts for (a point outside is never asked). */
const NWS_BOXES: readonly [minLat: number, maxLat: number, minLng: number, maxLng: number][] = [
  [24.3, 49.5, -125.0, -66.8], // lower 48
  [51.0, 71.6, -180.0, -129.9], // Alaska
  [51.0, 53.0, 172.0, 180.0], // western Aleutians
  [18.8, 22.4, -160.4, -154.7], // Hawaii
  [17.6, 18.6, -67.4, -64.5], // Puerto Rico and the US Virgin Islands
  [13.2, 20.6, 144.6, 146.1], // Guam and the Northern Mariana Islands
  [-14.6, -11.0, -171.2, -168.1], // American Samoa
];

export function inNwsArea(lat: number, lng: number): boolean {
  if (!validPoint(lat, lng)) return false;
  return NWS_BOXES.some(([a, b, c, d]) => lat >= a && lat <= b && lng >= c && lng <= d);
}

export function alertsUrl(lat: number, lng: number): string {
  if (!validPoint(lat, lng)) throw new RangeError("bad point");
  return `${NWS_API}/alerts/active?point=${roundCoord(lat).toFixed(2)},${roundCoord(lng).toFixed(2)}`;
}

/** A forecast page for the point on weather.gov: it lists every hazard in effect there, in plain words. */
export function weatherGovPageUrl(lat: number, lng: number): string {
  return `https://forecast.weather.gov/MapClick.php?lat=${roundCoord(lat).toFixed(2)}&lon=${roundCoord(lng).toFixed(2)}`;
}

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/;
const when = z.string().regex(ISO_WITH_OFFSET).nullish();
const SEVERITIES = ["Extreme", "Severe", "Moderate", "Minor", "Unknown"] as const;

const Feature = z.object({
  properties: z.object({
    status: z.string().max(20),
    messageType: z.string().max(20).nullish(),
    event: z.string().min(1).max(120),
    severity: z.string().max(20).nullish(),
    sender: z.string().max(200).nullish(),
    senderName: z.string().max(200).nullish(),
    onset: when,
    ends: when,
    expires: when,
    instruction: z.string().nullish(),
    parameters: z.object({ eventEndingTime: z.array(z.string()).nullish() }).partial().passthrough().nullish(),
  }),
});
const Body = z.object({ features: z.array(z.unknown()).max(500) });

export const SEVERITY_RANK: Record<AlertSeverity, number> = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };

/** NWS offices send as "w-nws.webmaster@noaa.gov" and name themselves "NWS <office>". */
function isNwsSender(sender: string | null | undefined, senderName: string | null | undefined): boolean {
  return /@noaa\.gov$/i.test(sender ?? "") || /^NWS\b/.test(senderName ?? "");
}

/**
 * The feed -> alerts worth showing: `Actual` only, no cancellations, not already over at `nowMs`, most severe first
 * (then the soonest end). A feature that doesn't parse is skipped, not guessed. Throws only when the body itself is wrong.
 */
export function parseAlerts(json: unknown, nowMs: number): WeatherAlert[] {
  const out: WeatherAlert[] = [];
  for (const raw of Body.parse(json).features) {
    const f = Feature.safeParse(raw);
    if (!f.success) continue;
    const p = f.data.properties;
    if (p.status !== "Actual") continue;
    if (p.messageType === "Cancel") continue;
    const endingParam = p.parameters?.eventEndingTime?.find((t) => ISO_WITH_OFFSET.test(t)) ?? null;
    const ends = p.ends ?? endingParam;
    if (ends && Date.parse(ends) <= nowMs) continue;
    if (!ends && p.expires && Date.parse(p.expires) <= nowMs) continue;
    const severity: AlertSeverity = (SEVERITIES as readonly string[]).includes(p.severity ?? "") ? (p.severity as AlertSeverity) : "Unknown";
    out.push({
      event: p.event.trim(),
      severity,
      senderName: p.senderName?.trim() || null,
      fromNws: isNwsSender(p.sender, p.senderName),
      onset: p.onset ?? null,
      ends: ends ?? null,
      expires: p.expires ?? null,
    });
  }
  // The same event from the same sender (a warning re-issued per zone) is shown once, with the latest end.
  const seen = new Map<string, WeatherAlert>();
  for (const a of out) {
    const k = `${a.event}|${a.senderName ?? ""}`;
    const prev = seen.get(k);
    const later = (a.ends ? Date.parse(a.ends) : 0) > (prev?.ends ? Date.parse(prev.ends) : 0);
    if (!prev || SEVERITY_RANK[a.severity] > SEVERITY_RANK[prev.severity] || (SEVERITY_RANK[a.severity] === SEVERITY_RANK[prev.severity] && later)) seen.set(k, a);
  }
  return [...seen.values()].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || (a.ends ? Date.parse(a.ends) : Infinity) - (b.ends ? Date.parse(b.ends) : Infinity),
  );
}

export type NwsDeps = { fetchImpl?: FetchLike; signal?: AbortSignal; timeoutMs?: number; env?: Record<string, string | undefined> };

/** Active alerts at the point. Throws SourceError on any failure (the caller logs it and shows no alerts). */
export async function fetchAlerts(lat: number, lng: number, nowMs: number, deps: NwsDeps = {}): Promise<{ alerts: WeatherAlert[]; latencyMs: number }> {
  const res = await fetchText(
    NWS_SOURCE,
    alertsUrl(lat, lng),
    { headers: { "User-Agent": userAgent(deps.env), Accept: "application/geo+json" } },
    { timeoutMs: deps.timeoutMs ?? NWS_TIMEOUT_MS, fetchImpl: deps.fetchImpl, signal: deps.signal, maxBytes: MAX_BYTES },
  );
  if (res.status === 429 || res.status === 403) throw new SourceError(NWS_SOURCE, "rate_limited", { status: res.status, started: true });
  if (res.status >= 500) throw new SourceError(NWS_SOURCE, "busy", { status: res.status, started: true });
  if (res.status !== 200) throw new SourceError(NWS_SOURCE, "bad_output", { status: res.status, started: true });
  try {
    return { alerts: parseAlerts(JSON.parse(res.text), nowMs), latencyMs: res.latencyMs };
  } catch (err) {
    throw new SourceError(NWS_SOURCE, "bad_output", { started: true, cause: err, message: `${NWS_SOURCE}: answer not in the expected shape` });
  }
}
