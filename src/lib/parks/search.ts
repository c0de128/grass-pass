/**
 * Park search behind `GET /api/parks` (SPEC F1, §7). Order of work:
 *   1. input validation (field errors, 400);
 *   2. per-IP rate limit, 10 searches/min (429 + Retry-After);
 *   3. caches: place 30 days, parks near a point 7 days, each with a separate 15-min negative cache;
 *   4. only on a cache miss: per-IP daily share + global daily cap for uncached searches,
 *      checked BEFORE any upstream call; the slot is spent the moment a request is sent
 *      (even if it then fails) and given back only when nothing was sent;
 *   5. upstreams with their own politeness rules (Nominatim 1 req/s queue, Overpass failover +
 *      breakers), collapsed so identical concurrent searches make one set of calls;
 *   6. R1-B1: live Overpass gets SEARCH_OVERPASS_BUDGET_MS (10 s, our slot wait included). If it doesn't
 *      answer, the list comes from (a) our saved Dallas-area park list (a real recorded Overpass answer,
 *      shown with its fetch date) when it covers the point, else (b) one Nominatim "park" search; each
 *      is labelled. If nothing answers, the error carries a link to a ready example pass.
 * A client that leaves does not cancel a started upstream call: it finishes and is cached.
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import { createCachePair, createInflight, createJsonCache, getStore, normalizeKey, StoreError, type Store } from "@/lib/cache";
import { hitRateLimit, limitsConfig, reserveQuota, type QuotaTicket } from "@/lib/limits";
import { waitText, type ApiError } from "@/lib/http/respond";
import { log } from "@/lib/log";
import { isValidLatLng, roundCoord, type LatLng } from "@/lib/geo";
import { cleanPlaceQuery, geocode, nominatimParks, PlaceSchema, type Place } from "@/lib/sources/nominatim";
import { savedParksNear } from "@/lib/sources/osm-snapshot";
import { readyExample } from "@/lib/prewarm";
import { parksNear } from "@/lib/sources/overpass-parks";
import { SourceError, type FetchLike } from "@/lib/sources/common";
import {
  LOCATION_DECIMALS,
  MAX_PARKS,
  PARK_RADIUS_M,
  PARKS_COPY,
  ParkSchema,
  PlaceQueryLimits,
  type ExampleLink,
  type ParksResult,
} from "./schema";

const DAY = 24 * 3600;
export const PLACE_TTL_SEC = 30 * DAY;
export const PARKS_TTL_SEC = 7 * DAY;
/** R1-B1: how long a park search waits for live Overpass (slot wait included) before the fallbacks. */
export const SEARCH_OVERPASS_BUDGET_MS = 10_000;
/** Nominatim fallback lists are kept briefly (live Overpass is tried again after this). */
export const NOMINATIM_PARKS_TTL_SEC = 3600;

export type SearchInput = { kind: "text"; q: string } | { kind: "location"; lat: number; lng: number };

export type FieldError = { field: "q" | "location"; code: string; message: string };

export const FIELD_COPY = {
  qEmpty: "Type a town, ZIP or park name.",
  qShort: "Type at least 2 letters or numbers: a town, ZIP or park name.",
  qLong: `That's too long. Type a town, ZIP or park name (up to ${PlaceQueryLimits.max} characters).`,
  badLocation: "That location doesn't look right. Try 'Use my location' again, or type a town or ZIP.",
  bothOrNeither: "Search with a place name, or with your location, but not both.",
} as const;

/** Read `?q=` or `?lat=&lng=`. Location is rounded to 2 decimals here too (~1 km), whatever the client sent. */
export function parseSearchParams(params: URLSearchParams): { ok: true; input: SearchInput } | { ok: false; error: FieldError } {
  const q = params.get("q");
  const lat = params.get("lat");
  const lng = params.get("lng");
  const hasLoc = lat !== null || lng !== null;
  if ((q !== null) === hasLoc) {
    return { ok: false, error: { field: "q", code: "BAD_INPUT", message: FIELD_COPY.bothOrNeither } };
  }
  if (q !== null) {
    if (q.length > PlaceQueryLimits.max * 4) {
      return { ok: false, error: { field: "q", code: "QUERY_TOO_LONG", message: FIELD_COPY.qLong } };
    }
    const clean = cleanPlaceQuery(q);
    if (clean.length === 0) return { ok: false, error: { field: "q", code: "QUERY_EMPTY", message: FIELD_COPY.qEmpty } };
    if (clean.length < PlaceQueryLimits.min) return { ok: false, error: { field: "q", code: "QUERY_TOO_SHORT", message: FIELD_COPY.qShort } };
    if (clean.length > PlaceQueryLimits.max) return { ok: false, error: { field: "q", code: "QUERY_TOO_LONG", message: FIELD_COPY.qLong } };
    if (!/[\p{L}\p{N}]/u.test(clean)) return { ok: false, error: { field: "q", code: "QUERY_EMPTY", message: FIELD_COPY.qEmpty } };
    return { ok: true, input: { kind: "text", q: clean } };
  }
  const num = /^-?\d{1,3}(\.\d{1,8})?$/;
  if (!lat || !lng || !num.test(lat) || !num.test(lng)) {
    return { ok: false, error: { field: "location", code: "BAD_LOCATION", message: FIELD_COPY.badLocation } };
  }
  const p = { lat: roundCoord(Number(lat), LOCATION_DECIMALS), lng: roundCoord(Number(lng), LOCATION_DECIMALS) };
  if (!isValidLatLng(p)) {
    return { ok: false, error: { field: "location", code: "BAD_LOCATION", message: FIELD_COPY.badLocation } };
  }
  return { ok: true, input: { kind: "location", ...p } };
}

// ---------- caches (positive + separate negative, ADR 0002) ----------

const NoneSchema = z.object({ none: z.literal(true) });
const ParksNearSchema = z.object({ parks: z.array(ParkSchema).max(MAX_PARKS), totalFound: z.number().int().min(0) });

const placeCache = createCachePair({
  name: "geocode",
  schema: PlaceSchema,
  negativeSchema: NoneSchema,
  ttlSec: PLACE_TTL_SEC,
  maxEntries: 5_000,
});
const parksCache = createCachePair({
  name: "parks-near",
  schema: ParksNearSchema,
  negativeSchema: NoneSchema,
  ttlSec: PARKS_TTL_SEC,
  maxEntries: 2_000,
});
const nominatimParksCache = createJsonCache({ name: "parks-nominatim", schema: ParksNearSchema, ttlSec: NOMINATIM_PARKS_TTL_SEC, maxEntries: 500 });

/** Cache key for a point: 4 decimals (~11 m). Text searches use the geocoded point; locations are already 2 decimals. */
export function pointKey(p: LatLng): string {
  return `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
}

// ---------- the search ----------

export type SearchDeps = {
  ip: string;
  signal?: AbortSignal;
  store?: Store;
  fetchImpl?: FetchLike;
  env?: Record<string, string | undefined>;
  now?: () => number;
  /** Tests: the live Overpass budget (default SEARCH_OVERPASS_BUDGET_MS). */
  overpassBudgetMs?: number;
};

export type SearchOutcome =
  | { ok: true; result: ParksResult }
  | { ok: false; status: number; error: ApiError & { field?: "q" | "location"; example?: ExampleLink } };

class LimitRefusal extends Error {
  constructor(readonly status: number, readonly error: ApiError) {
    super(error.code);
  }
}

type Holder = { inflight: ReturnType<typeof createInflight<SearchOutcome>> };
const INFLIGHT_KEY = Symbol.for("grass-pass.parks-inflight");
function inflight() {
  const g = globalThis as unknown as Record<symbol, Holder | undefined>;
  return (g[INFLIGHT_KEY] ??= { inflight: createInflight<SearchOutcome>() }).inflight;
}

/** Tests: drop in-flight searches. (Caches and limits live in the stores; reset those with resetStores().) */
export function resetParksSearch(): void {
  inflight().clear();
}

const iso = (ms: number) => new Date(ms).toISOString();

/** A ready example pass for an error answer (never throws; none ready -> no link). */
async function exampleLink(now: () => number): Promise<{ example?: ExampleLink }> {
  try {
    const ex = await readyExample({ now });
    return ex ? { example: ex } : {};
  } catch {
    return {};
  }
}

async function sourceFailure(err: SourceError, now: () => number): Promise<SearchOutcome> {
  const example = await exampleLink(now);
  if (err.source === "nominatim") {
    return {
      ok: false,
      status: 503,
      error: { code: "GEOCODER_UNAVAILABLE", message: PARKS_COPY.geocoderDown, retryAfter: err.retryAfter ?? 30, ...example },
    };
  }
  if (err.code === "queue_full") {
    return { ok: false, status: 503, error: { code: "BUSY_HERE", message: PARKS_COPY.busyHere, retryAfter: 5, ...example } };
  }
  return {
    ok: false,
    status: 503,
    error: { code: "OSM_UNAVAILABLE", message: PARKS_COPY.overpassDown, retryAfter: err.retryAfter ?? 60, ...example },
  };
}

export async function searchParks(input: SearchInput, deps: SearchDeps): Promise<SearchOutcome> {
  const now = deps.now ?? (() => Date.now());
  const env = deps.env ?? process.env;
  const store = deps.store ?? getStore("limits");
  const cfg = limitsConfig(env);

  try {
    const rl = await hitRateLimit(store, { name: "parks", key: deps.ip, limit: cfg.parksPerIpPerMin, windowSec: 60, now: now() });
    if (!rl.ok) {
      return {
        ok: false,
        status: 429,
        error: {
          code: "RATE_LIMITED",
          message: `That's a lot of park searches in a minute. Please wait ${waitText(rl.retryAfter)} and try again.`,
          retryAfter: rl.retryAfter,
        },
      };
    }
  } catch (err) {
    if (err instanceof StoreError) return storeDown();
    throw err;
  }

  const key = input.kind === "text" ? `t:${normalizeKey(input.q)}` : `l:${pointKey(input)}`;
  try {
    return await inflight().run(key, (signal, _emit, pin) => runSearch(input, { ...deps, store, env, now, signal, pin, cfg }), deps.signal);
  } catch (err) {
    if (err instanceof StoreError) return storeDown();
    throw err;
  }
}

function storeDown(): SearchOutcome {
  return {
    ok: false,
    status: 503,
    error: {
      code: "STORE_UNAVAILABLE",
      message: "Grass Pass can't check its usage limits right now, so it paused new searches. Try again in a minute.",
      retryAfter: 60,
    },
  };
}

async function runSearch(
  input: SearchInput,
  ctx: Required<Pick<SearchDeps, "store" | "env" | "now">> &
    Pick<SearchDeps, "ip" | "fetchImpl" | "overpassBudgetMs"> & {
      signal: AbortSignal;
      pin: () => void;
      cfg: ReturnType<typeof limitsConfig>;
    },
): Promise<SearchOutcome> {
  const { store, now, cfg } = ctx;
  let ticket: QuotaTicket | null = null;

  /** Reserve one uncached-search slot (per-IP share + global cap) before the first upstream call. */
  async function ensureTicket(): Promise<void> {
    if (ticket) return;
    const r = await reserveQuota(store, {
      name: "parks-upstream",
      key: ctx.ip,
      perKey: cfg.parksPerIpPerDay,
      global: cfg.parksDailyCap,
      period: { kind: "day" },
      now: now(),
    });
    if (!r.ok) {
      const message =
        r.scope === "global"
          ? `Grass Pass has reached its free limit for new park searches today (for everyone). It resets in ${waitText(r.retryAfter)}. Searches people already made still work.`
          : `You've made a lot of new park searches today. Please wait ${waitText(r.retryAfter)}, or search a place you've already looked up.`;
      throw new LimitRefusal(429, { code: r.scope === "global" ? "DAILY_LIMIT" : "IP_DAILY_LIMIT", message, retryAfter: r.retryAfter });
    }
    ticket = r.ticket;
  }
  const onStart = () => {
    ticket?.commit();
    // The request is on the wire and counted: let it finish and fill the cache even if every client leaves.
    ctx.pin();
  };

  try {
    let center: LatLng;
    let query: ParksResult["query"];
    let placeAt: number | null = null;

    if (input.kind === "text") {
      const pkey = normalizeKey(input.q);
      let place: Place | null = null;
      const hit = await placeCache.positive.get(pkey, now());
      if (hit) {
        place = hit.value;
      } else {
        const miss = await placeCache.negative.get(pkey, now());
        if (miss) return noPlace(input.q, miss.storedAt, true);
        await ensureTicket();
        place = await geocode(input.q, { store, fetchImpl: ctx.fetchImpl, signal: ctx.signal, env: ctx.env, onStart, now });
        placeAt = now();
        if (!place) {
          await placeCache.negative.set(pkey, { none: true }, { now: now() });
          return noPlace(input.q, placeAt, false);
        }
        await placeCache.positive.set(pkey, place, { now: now() });
      }
      center = { lat: place.lat, lng: place.lng };
      query = { kind: "text", text: input.q, matched: place.displayName };
    } else {
      center = { lat: input.lat, lng: input.lng };
      query = { kind: "location" };
    }

    const ckey = pointKey(center);
    const parksHit = await parksCache.positive.get(ckey, now());
    if (parksHit) return found(query, center, parksHit.value, parksHit.storedAt, true);
    const parksMiss = await parksCache.negative.get(ckey, now());
    if (parksMiss) return found(query, center, { parks: [], totalFound: 0 }, parksMiss.storedAt, true);

    await ensureTicket();
    let near: { parks: ParksResult["parks"]; totalFound: number };
    try {
      near = await parksNear(center, {
        store,
        fetchImpl: ctx.fetchImpl,
        signal: ctx.signal,
        env: ctx.env,
        onStart,
        now,
        totalBudgetMs: ctx.overpassBudgetMs ?? SEARCH_OVERPASS_BUDGET_MS,
        timeoutMs: ctx.overpassBudgetMs ?? SEARCH_OVERPASS_BUDGET_MS,
      });
    } catch (err) {
      if (!(err instanceof SourceError) || err.code === "aborted") throw err;
      log("parks_search_failed", { source: err.source, code: err.code, started: err.started, upstreamStatus: err.status, next: "fallback" }, "warn");
      return await fallbackParks(query, center, err, { ...ctx, onStart });
    }
    const at = now();
    if (near.parks.length === 0) await parksCache.negative.set(ckey, { none: true }, { now: at });
    else await parksCache.positive.set(ckey, near, { now: at });
    return found(query, center, near, at, false);
  } catch (err) {
    if (err instanceof LimitRefusal) return { ok: false, status: err.status, error: err.error };
    if (err instanceof SourceError) {
      log("parks_search_failed", { source: err.source, code: err.code, started: err.started, upstreamStatus: err.status }, "warn");
      return await sourceFailure(err, now);
    }
    throw err;
  } finally {
    const t = ticket as QuotaTicket | null;
    if (t && !t.committed) await t.release();
  }
}

/**
 * R1-B1: live Overpass didn't answer. (a) The saved Dallas-area park list when it covers the whole
 * 5 km circle (real Overpass answer, its fetch time shown); else (b) Nominatim's park search (cached
 * 1 h); else the original error with a link to a ready example pass. Each list is labelled.
 */
async function fallbackParks(
  query: ParksResult["query"],
  center: LatLng,
  overpassErr: SourceError,
  ctx: { store: Store; now: () => number; env: Record<string, string | undefined>; fetchImpl?: FetchLike; signal: AbortSignal; onStart: () => void },
): Promise<SearchOutcome> {
  const { now } = ctx;
  const saved = savedParksNear(center);
  if (saved) {
    log("parks_search_fallback", { kind: "saved_index", parks: saved.totalFound });
    return found(query, center, saved, saved.fetchedAt, true, { kind: "saved_index", message: PARKS_COPY.savedIndex });
  }
  const key = pointKey(center);
  const hit = await nominatimParksCache.get(key, now());
  if (hit) return found(query, center, hit.value, hit.storedAt, true, { kind: "nominatim", message: PARKS_COPY.nominatimParks });
  try {
    const near = await nominatimParks(center, { store: ctx.store, fetchImpl: ctx.fetchImpl, signal: ctx.signal, env: ctx.env, onStart: ctx.onStart, now });
    const at = now();
    await nominatimParksCache.set(key, near, { now: at });
    log("parks_search_fallback", { kind: "nominatim", parks: near.totalFound });
    return found(query, center, near, at, false, { kind: "nominatim", message: PARKS_COPY.nominatimParks });
  } catch (err) {
    if (!(err instanceof SourceError) || err.code === "aborted") throw err;
    log("parks_search_failed", { source: err.source, code: err.code, started: err.started, upstreamStatus: err.status, next: "none" }, "warn");
    // The answer names what really failed first: the park server (or our own queue), not the fallback.
    return await sourceFailure(overpassErr, now);
  }
}

function noPlace(text: string, at: number, cached: boolean): SearchOutcome {
  return {
    ok: true,
    result: {
      query: { kind: "text", text, matched: null },
      center: null,
      radiusM: PARK_RADIUS_M,
      parks: [],
      totalFound: 0,
      empty: { reason: "no_place", message: PARKS_COPY.noPlace },
      checkedAt: iso(at),
      cached,
    },
  };
}

function found(
  query: ParksResult["query"],
  center: LatLng,
  near: { parks: ParksResult["parks"]; totalFound: number },
  at: number,
  cached: boolean,
  fallback: ParksResult["fallback"] = null,
): SearchOutcome {
  return {
    ok: true,
    result: {
      query,
      center,
      radiusM: PARK_RADIUS_M,
      parks: near.parks,
      totalFound: near.totalFound,
      empty: near.parks.length === 0 ? { reason: "no_parks", message: PARKS_COPY.noParks } : null,
      checkedAt: iso(at),
      cached,
      fallback,
    },
  };
}
