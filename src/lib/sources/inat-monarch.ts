/**
 * October monarch box data (SPEC F10, ADR 0002 D3): real iNaturalist counts, never estimated.
 *
 * - Monarchs (taxon 48662) reported within 25 km of the park in the last 14 days (the same window as
 *   Wild Finds: Oct 5 -> since Sep 21), and in the same calendar days last year. ONE histogram call
 *   (`observations/histogram`, interval=day, from last year's first day to today) gives both sums.
 *   Live 2026-10-05 near Connemara: 9 since Sep 21 vs 63 in 2025 (the ADR's numbers).
 * - Milkweed (genus 47906) reported within 1.5 km of the park, all years: one `per_page=0` count.
 *
 * Every request goes through the S3 iNat client's polite fetch (`getJson`): daily budget, circuit
 * breaker, 1 req/s per process + a shared per-second slot, 12 s timeout.
 * Cached per park: monarch counts 6 h (keyed by today's Chicago day, so the window never goes stale
 * across midnight), milkweed 7 days; failures go to a separate 10-minute negative cache.
 * Nothing here throws a SourceError to the caller: a failure becomes a code-written "No data available" reason.
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import { createCachePair } from "@/lib/cache";
import { log } from "@/lib/log";
import { localDay } from "@/lib/time";
import type { LatLng } from "@/lib/geo";
import {
  MILKWEED_RADIUS_KM,
  MILKWEED_TAXON_ID,
  MONARCH_RADIUS_KM,
  MONARCH_TAXON_ID,
  OCTOBER_REASONS,
  type Milkweed,
  type OctoberBoxData,
  type WindowCount,
} from "@/lib/october";
import { SourceError } from "./common";
import { getJson, INAT_API, windowStart, type InatDeps } from "./inat";

export const MONARCH_CACHE_SEC = 6 * 3600;
export const MILKWEED_CACHE_SEC = 7 * 24 * 3600;
export const OCTOBER_NEGATIVE_SEC = 10 * 60;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Same calendar day one year earlier ("2026-09-21" -> "2025-09-21"; Feb 29 -> Feb 28). */
export function sameDayLastYear(day: string): string {
  if (!DAY_RE.test(day)) throw new RangeError("bad date");
  const [y, m, d] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate(); // days in that month last year
  const dd = Math.min(d, last);
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export type MonarchWindows = { thisYear: { d1: string; d2: string }; lastYear: { d1: string; d2: string } };

/** Oct 5, 2026 (Chicago) -> this year Sep 21..Oct 5 2026, last year Sep 21..Oct 5 2025. */
export function monarchWindows(nowMs: number): MonarchWindows {
  const d1 = windowStart(nowMs);
  const d2 = localDay(nowMs);
  return { thisYear: { d1, d2 }, lastYear: { d1: sameDayLastYear(d1), d2: sameDayLastYear(d2) } };
}

function point(u: URL, center: LatLng, radiusKm: number) {
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng) || Math.abs(center.lat) > 90 || Math.abs(center.lng) > 180) {
    throw new RangeError("bad point");
  }
  u.searchParams.set("lat", center.lat.toFixed(5));
  u.searchParams.set("lng", center.lng.toFixed(5));
  u.searchParams.set("radius", String(radiusKm));
}

/** Daily monarch counts (verifiable = research grade + needs ID) from `d1` to `d2`, inclusive. */
export function monarchHistogramUrl(center: LatLng, d1: string, d2: string): string {
  if (!DAY_RE.test(d1) || !DAY_RE.test(d2) || d1 > d2) throw new RangeError("bad dates");
  const u = new URL(`${INAT_API}/observations/histogram`);
  u.searchParams.set("taxon_id", String(MONARCH_TAXON_ID));
  point(u, center, MONARCH_RADIUS_KM);
  u.searchParams.set("verifiable", "true");
  u.searchParams.set("date_field", "observed");
  u.searchParams.set("interval", "day");
  u.searchParams.set("d1", d1);
  u.searchParams.set("d2", d2);
  return u.toString();
}

/** How many verifiable milkweed observations exist within 1.5 km (no records returned, just the total). */
export function milkweedCountUrl(center: LatLng): string {
  const u = new URL(`${INAT_API}/observations`);
  u.searchParams.set("taxon_id", String(MILKWEED_TAXON_ID));
  point(u, center, MILKWEED_RADIUS_KM);
  u.searchParams.set("verifiable", "true");
  u.searchParams.set("per_page", "0");
  return u.toString();
}

const HistogramBody = z.object({
  results: z.object({ day: z.record(z.string().regex(DAY_RE), z.number().int().min(0)) }),
});

/**
 * Sum the days of each window. The answer must cover both ends of the asked range (iNat zero-fills
 * every day), otherwise it isn't the answer we asked for and we say so instead of guessing.
 */
export function parseMonarchHistogram(json: unknown, w: MonarchWindows): { thisYear: WindowCount; lastYear: WindowCount } {
  const days = HistogramBody.parse(json).results.day;
  if (!(w.lastYear.d1 in days) || !(w.thisYear.d2 in days)) throw new RangeError("histogram does not cover the asked range");
  const sum = (d1: string, d2: string) => {
    let n = 0;
    for (const [day, c] of Object.entries(days)) if (day >= d1 && day <= d2) n += c;
    return n;
  };
  return {
    thisYear: { ...w.thisYear, count: sum(w.thisYear.d1, w.thisYear.d2) },
    lastYear: { ...w.lastYear, count: sum(w.lastYear.d1, w.lastYear.d2) },
  };
}

const TotalBody = z.object({ total_results: z.number().int().min(0) });

export function parseTotal(json: unknown): number {
  return TotalBody.parse(json).total_results;
}

// ---------- caches ----------

const ReasonSchema = z.enum(["down", "slow", "rateLimited", "badOutput"]);
type Reason = z.infer<typeof ReasonSchema>;

const MonarchCountsSchema = z.object({ thisYear: z.object({ d1: z.string(), d2: z.string(), count: z.number().int().min(0) }), lastYear: z.object({ d1: z.string(), d2: z.string(), count: z.number().int().min(0) }) });

const monarchCache = createCachePair({
  name: "inat-monarch",
  schema: MonarchCountsSchema,
  negativeSchema: ReasonSchema,
  ttlSec: MONARCH_CACHE_SEC,
  negativeTtlSec: OCTOBER_NEGATIVE_SEC,
  maxEntries: 2_000,
});
const milkweedCache = createCachePair({
  name: "inat-milkweed",
  schema: z.number().int().min(0),
  negativeSchema: ReasonSchema,
  ttlSec: MILKWEED_CACHE_SEC,
  negativeTtlSec: OCTOBER_NEGATIVE_SEC,
  maxEntries: 2_000,
});

function reasonOf(err: SourceError): Reason {
  if (err.code === "rate_limited") return "rateLimited";
  if (err.code === "bad_output") return "badOutput";
  if (err.code === "timeout") return "slow";
  return "down";
}

const iso = (ms: number) => new Date(ms).toISOString();

export type OctoberPark = { id: string; lat: number; lng: number };

/** Throws only for non-upstream bugs; every upstream problem comes back as a Reason. */
async function monarchCounts(park: OctoberPark, w: MonarchWindows, deps: InatDeps, now: () => number) {
  const key = `${park.id}|${w.thisYear.d2}`;
  const hit = await monarchCache.positive.get(key, now());
  if (hit) return { ok: true as const, counts: hit.value, checkedAt: hit.storedAt };
  const neg = await monarchCache.negative.get(key, now());
  if (neg) return { ok: false as const, reason: neg.value };
  try {
    const json = await getJson(monarchHistogramUrl(park, w.lastYear.d1, w.thisYear.d2), "monarch_histogram", deps);
    let counts;
    try {
      counts = parseMonarchHistogram(json, w);
    } catch (err) {
      throw new SourceError("inaturalist", "bad_output", { started: true, cause: err });
    }
    const at = now();
    await monarchCache.positive.set(key, counts, { now: at });
    return { ok: true as const, counts, checkedAt: at };
  } catch (err) {
    if (!(err instanceof SourceError)) throw err;
    const reason = reasonOf(err);
    log("october_source_failed", { what: "monarch_histogram", code: err.code, started: err.started, upstreamStatus: err.status }, "warn");
    // "not_called" (breaker open / no polite slot) is not cached: the breaker already remembers it.
    if (err.code !== "not_called") await monarchCache.negative.set(key, reason, { now: now() });
    return { ok: false as const, reason };
  }
}

async function milkweed(park: OctoberPark, deps: InatDeps, now: () => number): Promise<Milkweed> {
  const unavailable: Milkweed = { status: "unavailable", reason: OCTOBER_REASONS.milkweedDown };
  const hit = await milkweedCache.positive.get(park.id, now());
  if (hit) return { status: "ok", count: hit.value, radiusKm: MILKWEED_RADIUS_KM, checkedAt: iso(hit.storedAt) };
  if (await milkweedCache.negative.get(park.id, now())) return unavailable;
  try {
    const json = await getJson(milkweedCountUrl(park), "milkweed_count", deps);
    let count: number;
    try {
      count = parseTotal(json);
    } catch (err) {
      throw new SourceError("inaturalist", "bad_output", { started: true, cause: err });
    }
    const at = now();
    await milkweedCache.positive.set(park.id, count, { now: at });
    return { status: "ok", count, radiusKm: MILKWEED_RADIUS_KM, checkedAt: iso(at) };
  } catch (err) {
    if (!(err instanceof SourceError)) throw err;
    log("october_source_failed", { what: "milkweed_count", code: err.code, started: err.started, upstreamStatus: err.status }, "warn");
    if (err.code !== "not_called") await milkweedCache.negative.set(park.id, reasonOf(err), { now: now() });
    return unavailable;
  }
}

/**
 * The October box for one park (cached). Never throws for upstream trouble: the box then says
 * "No data available" with the reason. The milkweed check is skipped when the monarch check failed
 * (the box has nothing to show anyway, and it saves iNaturalist a request).
 */
export async function octoberBox(park: OctoberPark, deps: InatDeps): Promise<OctoberBoxData> {
  const now = deps.now ?? (() => Date.now());
  const w = monarchWindows(now());
  const m = await monarchCounts(park, w, deps, now);
  if (!m.ok) return { status: "unavailable", reason: OCTOBER_REASONS[m.reason] };
  return {
    status: "ok",
    radiusKm: MONARCH_RADIUS_KM,
    thisYear: m.counts.thisYear,
    lastYear: m.counts.lastYear,
    checkedAt: iso(m.checkedAt),
    milkweed: await milkweed(park, deps, now),
  };
}
