/**
 * Nominatim (OpenStreetMap place search): turn typed text ("Allen TX", "75013",
 * "Connemara Meadow Preserve") into one point. ADR 0002 D1.
 *
 * Usage policy (https://operations.osmfoundation.org/policies/nominatim/), all enforced here:
 * - at most 1 request per second for the whole app: one serial queue per process, plus a
 *   per-second slot on the shared store so several serverless instances together stay at 1/s;
 * - search on submit only (no autocomplete; the form has no as-you-type calls);
 * - results cached (30 days, in src/lib/parks/search.ts);
 * - an identifying User-Agent naming the app and its public repo (no personal email).
 * A 429/403 opens a circuit breaker so we stop calling until the wait is over.
 * R1-B1: when Overpass doesn't answer a park search, one bounded "park" search here is the fallback
 * (nominatimParks), through the same queue and limits.
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import type { Store } from "@/lib/cache/store";
import { breakerRetryAfter, createSpacedQueue, QueueAbortedError, takeSecondSlot, tripBreaker } from "@/lib/limits";
import { log } from "@/lib/log";
import { distanceM, isValidLatLng, type LatLng } from "@/lib/geo";
import { PARK_RADIUS_M, type Park } from "@/lib/parks/schema";
import { parseParks } from "./overpass-parks";
import { fetchText, parseRetryAfter, SourceError, userAgent, type FetchLike } from "./common";

export const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
export const NOMINATIM_SOURCE = "nominatim";
/** Measured 2026-10-05: 150-400 ms. 10 s leaves room for a slow moment without hanging the page. */
export const NOMINATIM_TIMEOUT_MS = 10_000;
export const NOMINATIM_MIN_INTERVAL_MS = 1_000;
/** Longest we wait for our turn in the 1 req/s queue before saying "busy". */
export const NOMINATIM_QUEUE_MAX_WAIT_MS = 8_000;
/** Breaker opening after a 429/403 with no Retry-After (Nominatim blocks are usually minutes). */
export const NOMINATIM_BLOCKED_OPEN_SEC = 300;
/** Breaker opening after a 5xx / timeout / network error. */
export const NOMINATIM_ERROR_OPEN_SEC = 30;

export const PLACE_QUERY_MIN = 2;
export const PLACE_QUERY_MAX = 100;

export const PlaceSchema = z.object({
  /** Short name, e.g. "Allen". */
  name: z.string().min(1).max(200),
  /** Full label, e.g. "Allen, Collin County, Texas, United States". */
  displayName: z.string().min(1).max(400),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** e.g. "way/306191453"; null when Nominatim returned no OSM object (rare). */
  osmRef: z.string().max(40).nullable(),
  /**
   * T2 (audit R4): the match is itself a park (OSM leisure=park | nature_reserve), so a search by a park's own
   * name can list that park first even when the nearby-parks list left it out. Absent on places cached before.
   */
  parkKind: z.enum(["park", "nature_reserve"]).nullable().optional(),
});
export type Place = z.infer<typeof PlaceSchema>;

const NominatimHit = z.object({
  osm_type: z.enum(["node", "way", "relation"]).optional(),
  osm_id: z.number().int().positive().optional(),
  lat: z.string().regex(/^-?\d+(\.\d+)?$/),
  lon: z.string().regex(/^-?\d+(\.\d+)?$/),
  name: z.string().optional(),
  display_name: z.string().min(1),
  category: z.string().optional(),
  type: z.string().optional(),
});
const NominatimBody = z.array(z.unknown());

/**
 * Judge R7: "Forest Park Portland OR" matched the Forest Park NEIGHBOURHOOD (Nominatim's first hit), so Portland's
 * 5,000-acre park was not in the list. A query that names a park asks for a few hits and takes the first one that is
 * itself a park (leisure=park | nature_reserve), else the first hit as before. Still one request.
 */
export const PARK_QUERY_RE = /\b(?:park|parks|preserve|reserve|nature|arboretum|greenbelt|greenway|commons?)\b/i;
/** Hits asked for (the first is used unless a park-named query finds a park among them). */
export const NOMINATIM_GEOCODE_LIMIT = 5;

/** Parse a `format=jsonv2` answer. Returns the first usable hit (the first park hit with `preferPark`), null for "no match". Throws on a bad shape. */
export function parseNominatim(json: unknown, opts: { preferPark?: boolean } = {}): Place | null {
  const list = NominatimBody.parse(json);
  const places = parseHits(list);
  return (opts.preferPark ? places.find((p) => p.parkKind) : undefined) ?? places[0] ?? null;
}

function parseHits(list: unknown[]): Place[] {
  const out: Place[] = [];
  for (const item of list) {
    const hit = NominatimHit.safeParse(item);
    if (!hit.success) continue;
    const lat = Number(hit.data.lat);
    const lng = Number(hit.data.lon);
    if (!isValidLatLng({ lat, lng })) continue;
    const displayName = hit.data.display_name.trim().slice(0, 400);
    const name = (hit.data.name?.trim() || displayName.split(",")[0].trim()).slice(0, 200);
    if (!name || !displayName) continue;
    const osmRef = hit.data.osm_type && hit.data.osm_id ? `${hit.data.osm_type}/${hit.data.osm_id}` : null;
    const t = hit.data.type;
    const parkKind = hit.data.category === "leisure" && (t === "park" || t === "nature_reserve") ? t : null;
    out.push({ name, displayName, lat, lng, osmRef, parkKind });
  }
  return out;
}

/** Clean user text for the query: trim, collapse spaces, drop control characters. */
export function cleanPlaceQuery(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function nominatimUrl(q: string): string {
  const u = new URL(NOMINATIM_SEARCH_URL);
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("q", q);
  u.searchParams.set("limit", String(PARK_QUERY_RE.test(q) ? NOMINATIM_GEOCODE_LIMIT : 1));
  u.searchParams.set("addressdetails", "0");
  u.searchParams.set("accept-language", "en");
  return u.toString();
}

type QueueHolder = { queue: ReturnType<typeof createSpacedQueue> };
const QUEUE_KEY = Symbol.for("grass-pass.nominatim-queue");
/** One queue per process, kept on globalThis so route modules and instrumentation share it. */
function processQueue(): QueueHolder["queue"] {
  const g = globalThis as unknown as Record<symbol, QueueHolder | undefined>;
  return (g[QUEUE_KEY] ??= { queue: createSpacedQueue(NOMINATIM_MIN_INTERVAL_MS) }).queue;
}

export type GeocodeDeps = {
  store: Store;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
  /** Called right before the request is sent (charge budgets here). */
  onStart?: () => void;
  /** Tests inject their own queue. */
  queue?: { run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> };
  now?: () => number;
};

/**
 * One polite Nominatim GET (breaker, 1 req/s queue + shared slot, timeout, status handling).
 * Returns the parsed JSON body. Throws SourceError: "not_called" (breaker open / no shared slot),
 * "queue_full" (our queue), "aborted" (caller signal), "rate_limited", "busy", "timeout", "network",
 * "bad_output". `what` names the call in the log.
 */
async function nominatimGet(url: string, what: string, deps: GeocodeDeps): Promise<{ json: unknown; status: number; latencyMs: number }> {
  const now = deps.now ?? (() => Date.now());
  const wait = await breakerRetryAfter(deps.store, NOMINATIM_SOURCE, now());
  if (wait > 0) throw new SourceError(NOMINATIM_SOURCE, "not_called", { started: false, retryAfter: wait });

  const queue = deps.queue ?? processQueue();
  const queueSignal = deps.signal
    ? AbortSignal.any([deps.signal, AbortSignal.timeout(NOMINATIM_QUEUE_MAX_WAIT_MS)])
    : AbortSignal.timeout(NOMINATIM_QUEUE_MAX_WAIT_MS);

  let res;
  try {
    res = await queue.run(async () => {
      // Cross-instance 1 req/s (the per-process queue already spaces this process's calls).
      const slot = await takeSecondSlot(deps.store, {
        name: NOMINATIM_SOURCE,
        perSecond: 1,
        maxWaitMs: 3_000,
        now,
      });
      if (!slot) throw new SourceError(NOMINATIM_SOURCE, "not_called", { started: false, retryAfter: 2 });
      deps.onStart?.();
      return fetchText(
        NOMINATIM_SOURCE,
        url,
        { method: "GET", headers: { "User-Agent": userAgent(deps.env), Accept: "application/json" } },
        { timeoutMs: NOMINATIM_TIMEOUT_MS, fetchImpl: deps.fetchImpl, signal: deps.signal, maxBytes: NOMINATIM_MAX_BYTES },
      );
    }, queueSignal);
  } catch (err) {
    if (err instanceof QueueAbortedError) {
      throw new SourceError(NOMINATIM_SOURCE, deps.signal?.aborted ? "aborted" : "queue_full", { started: false, retryAfter: 2, cause: err });
    }
    if (err instanceof SourceError && (err.code === "timeout" || err.code === "network")) {
      await tripBreaker(deps.store, NOMINATIM_SOURCE, now(), NOMINATIM_ERROR_OPEN_SEC);
      log("upstream_call", { source: NOMINATIM_SOURCE, what, outcome: err.code });
    }
    throw err;
  }

  const base = { source: NOMINATIM_SOURCE, what, status: res.status, latencyMs: res.latencyMs };
  if (res.status === 429 || res.status === 403) {
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"), now()) ?? NOMINATIM_BLOCKED_OPEN_SEC;
    await tripBreaker(deps.store, NOMINATIM_SOURCE, now(), retryAfter);
    log("upstream_call", { ...base, outcome: "rate_limited", retryAfter }, "warn");
    throw new SourceError(NOMINATIM_SOURCE, "rate_limited", { status: res.status, retryAfter, started: true });
  }
  if (res.status >= 500) {
    await tripBreaker(deps.store, NOMINATIM_SOURCE, now(), NOMINATIM_ERROR_OPEN_SEC);
    log("upstream_call", { ...base, outcome: "busy" }, "warn");
    throw new SourceError(NOMINATIM_SOURCE, "busy", { status: res.status, started: true });
  }
  if (res.status !== 200) {
    log("upstream_call", { ...base, outcome: "bad_status" }, "warn");
    throw new SourceError(NOMINATIM_SOURCE, "bad_output", { status: res.status, started: true });
  }
  try {
    return { json: JSON.parse(res.text) as unknown, status: res.status, latencyMs: res.latencyMs };
  } catch (err) {
    log("upstream_call", { ...base, outcome: "bad_output" }, "warn");
    throw new SourceError(NOMINATIM_SOURCE, "bad_output", { status: res.status, started: true, cause: err });
  }
}

/** Biggest Nominatim answer we read (40 results are about 25 KB). */
export const NOMINATIM_MAX_BYTES = 512 * 1024;

/**
 * Look up `q`. Returns the place, or null when Nominatim has no match.
 * Throws SourceError (see nominatimGet).
 */
export async function geocode(q: string, deps: GeocodeDeps): Promise<Place | null> {
  const r = await nominatimGet(nominatimUrl(q), "geocode", deps);
  let place: Place | null;
  try {
    place = parseNominatim(r.json, { preferPark: PARK_QUERY_RE.test(q) });
  } catch (err) {
    log("upstream_call", { source: NOMINATIM_SOURCE, what: "geocode", status: r.status, latencyMs: r.latencyMs, outcome: "bad_output" }, "warn");
    throw new SourceError(NOMINATIM_SOURCE, "bad_output", { status: r.status, started: true, cause: err });
  }
  log("upstream_call", { source: NOMINATIM_SOURCE, what: "geocode", status: r.status, latencyMs: r.latencyMs, outcome: place ? "ok" : "no_match" });
  return place;
}

// ---------- parks fallback (R1-B1) ----------

/** Nominatim answers at most 40 results per search. */
export const NOMINATIM_PARKS_LIMIT = 40;

/**
 * The park fallback search: Nominatim's "park" special phrase (OSM leisure=park) inside a box of
 * `radiusM` around the point, bounded. One request, through the same 1 req/s queue as geocoding.
 * Used only when live Overpass didn't answer a park search.
 */
export function nominatimParksUrl(center: LatLng, radiusM: number = PARK_RADIUS_M): string {
  if (!isValidLatLng(center)) throw new RangeError("bad point");
  const dLat = radiusM / 110_574;
  const dLng = radiusM / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  const f = (n: number) => n.toFixed(5);
  const u = new URL(NOMINATIM_SEARCH_URL);
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("q", "park");
  // viewbox = left,top,right,bottom (lng/lat)
  u.searchParams.set("viewbox", `${f(center.lng - dLng)},${f(center.lat + dLat)},${f(center.lng + dLng)},${f(center.lat - dLat)}`);
  u.searchParams.set("bounded", "1");
  u.searchParams.set("limit", String(NOMINATIM_PARKS_LIMIT));
  u.searchParams.set("addressdetails", "0");
  u.searchParams.set("accept-language", "en");
  return u.toString();
}

const NominatimParkHit = z.object({
  osm_type: z.enum(["node", "way", "relation"]),
  osm_id: z.number().int().positive(),
  lat: z.string().regex(/^-?\d+(\.\d+)?$/),
  lon: z.string().regex(/^-?\d+(\.\d+)?$/),
  category: z.string(),
  type: z.string(),
  name: z.string().optional(),
});

/** Named leisure=park|nature_reserve hits within `radiusM`, merged, nearest first (same rules as the Overpass list). */
export function parseNominatimParks(json: unknown, center: LatLng, radiusM: number = PARK_RADIUS_M): { parks: Park[]; totalFound: number } {
  const list = NominatimBody.parse(json);
  const elements: unknown[] = [];
  for (const item of list) {
    const h = NominatimParkHit.safeParse(item);
    if (!h.success || h.data.category !== "leisure" || (h.data.type !== "park" && h.data.type !== "nature_reserve")) continue;
    const name = h.data.name?.trim();
    const lat = Number(h.data.lat);
    const lng = Number(h.data.lon);
    if (!name || !isValidLatLng({ lat, lng }) || distanceM(center, { lat, lng }) > radiusM) continue;
    elements.push({ type: h.data.osm_type, id: h.data.osm_id, lat, lon: lng, tags: { name, leisure: h.data.type } });
  }
  return parseParks({ elements }, center);
}

/** Parks near a point from Nominatim (the fallback when Overpass is down). Throws SourceError. */
export async function nominatimParks(center: LatLng, deps: GeocodeDeps): Promise<{ parks: Park[]; totalFound: number }> {
  const r = await nominatimGet(nominatimParksUrl(center), "parks", deps);
  try {
    const out = parseNominatimParks(r.json, center);
    log("upstream_call", { source: NOMINATIM_SOURCE, what: "parks", status: r.status, latencyMs: r.latencyMs, outcome: "ok", parks: out.totalFound });
    return out;
  } catch (err) {
    throw new SourceError(NOMINATIM_SOURCE, "bad_output", { status: r.status, started: true, cause: err });
  }
}
