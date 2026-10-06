/**
 * Park features for a pass (SPEC F3), with the R1 resilience rules:
 *   1. the shared cache (7 days; 30 days for the example parks), refreshed in the background once it
 *      is older than 3 days;
 *   2. the negative caches: "not a park" and "too heavy for Overpass" (15 min, SEC-1-01), so the same
 *      bad id can't be sent again at once;
 *   3. the saved answer (src/data/osm, a real recorded Overpass answer with its fetch time) for the
 *      example parks, so examples never need live Overpass (R1-B1);
 *   4. one live Overpass query, stopped by the pass deadline (R1-M1);
 *   5. R2-M3: when that live query fails for ANY reason (Overpass down or busy, our queue full, too
 *      heavy, the deadline), the saved answer recorded for every park in the DFW index
 *      (src/data/osm/parks, real Overpass answers with their fetch time) is used instead, so a pass for
 *      any Dallas-area park survives an Overpass outage. Outside DFW the honest error stays.
 * Every failure maps to its own honest code: our queue busy (BUSY_HERE), Overpass down
 * (OSM_UNAVAILABLE), park too heavy (PARK_TOO_BIG), deadline (DATA_TOO_SLOW).
 *
 * SEC-3-02: `peekFeatures` reads steps 1, 2 and the "slow" cache plus every Overpass breaker in ONE
 * store command (Upstash MGET) BEFORE makePass reserves the per-IP daily share, so a cached failure
 * (not a park, too heavy, too slow, every Overpass mirror resting) costs 1 command and no reserve or
 * release. `loadFeatures` then reuses what the peek saw instead of reading the same keys again.
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import { createCachePair, createJsonCache, readMany, type CacheHit, type Store } from "@/lib/cache";
import { breakerKey, breakerWaitFrom } from "@/lib/limits/breaker";
import { log } from "@/lib/log";
import { PARKS_COPY } from "@/lib/parks/schema";
import { SourceError, type FetchLike } from "@/lib/sources/common";
import { savedDfwFeatures, savedFeatures, type SavedAnswer } from "@/lib/sources/osm-snapshot";
import { REFRESH_AFTER_SEC, REFRESH_BUDGET_MS, refreshLater } from "@/lib/sources/osm-refresh";
import { breakerName, overpassEndpoints } from "@/lib/sources/overpass";
import { parkFeatures, ParkFeaturesSchema, parkIdOf, type ParkFeatures, type ParkRef } from "@/lib/sources/overpass-features";
import { PASS_COPY } from "./schema";

const HOUR = 3600;
const DAY = 24 * HOUR;
/** ADR 0002: park features 7 days. */
export const FEATURES_TTL_SEC = 7 * DAY;
/** Parks with a saved answer (the examples) keep their live answers longer. */
export const SAVED_PARK_TTL_SEC = 30 * DAY;
/** An id whose query Overpass called too heavy is not sent again for this long (SEC-1-01). */
export const HEAVY_TTL_SEC = 15 * 60;

/** Copy for a data stage stopped by the pass deadline (SPEC §5.4, existing DATA_TOO_SLOW wording). */
export const DATA_TOO_SLOW_COPY = "The park data took too long to load, so there was no time left to write clues. Try again in a minute.";

const featuresCache = createCachePair({
  name: "park-features",
  schema: ParkFeaturesSchema,
  negativeSchema: z.object({ none: z.literal(true) }),
  ttlSec: FEATURES_TTL_SEC,
  maxEntries: 2_000,
});
const heavyCache = createJsonCache({ name: "park-heavy", schema: z.literal(true), ttlSec: HEAVY_TTL_SEC, maxEntries: 500 });
/**
 * R2-m2 (SEC-2-03): a park whose features query ran into our client timeout is not sent again for
 * SLOW_TTL_SEC (a huge park would otherwise keep tripping the shared per-mirror breakers). Only the
 * live query is skipped: a saved DFW answer is still used.
 */
export const SLOW_TTL_SEC = 15 * 60;
const slowCache = createJsonCache({ name: "park-slow", schema: z.literal(true), ttlSec: SLOW_TTL_SEC, maxEntries: 500 });

export type ParkDataDeps = {
  store: Store;
  env: Record<string, string | undefined>;
  now: () => number;
  fetchImpl?: FetchLike;
  /** In-flight + deadline signal. */
  signal?: AbortSignal;
  /** Called right before the first upstream request (charges the per-IP daily share). */
  onUpstream?: () => void;
  /** Tests: Overpass per-attempt timeout for the live features query (default OVERPASS_CLIENT_TIMEOUT_MS). */
  timeoutMs?: number;
};

export type ApiError = { code: string; message: string; retryAfter?: number };
export type FeaturesFailure = { kind: "error"; status: number; error: ApiError };
export type FeaturesResult =
  | { ok: true; value: ParkFeatures; at: number; from: "cache" | "saved" | "live" }
  | { ok: false; outcome: FeaturesFailure };

const fail = (status: number, error: ApiError): FeaturesResult => ({ ok: false, outcome: { kind: "error", status, error } });

/** The failure for a SourceError from a park-data query (shared with geometry logging). */
export function featuresFailure(err: SourceError): FeaturesFailure {
  switch (err.code) {
    case "aborted":
      return { kind: "error", status: 504, error: { code: "DATA_TOO_SLOW", message: DATA_TOO_SLOW_COPY } };
    case "queue_full":
      return { kind: "error", status: 503, error: { code: "BUSY_HERE", message: PARKS_COPY.busyHere, retryAfter: 5 } };
    case "too_heavy":
      return { kind: "error", status: 503, error: { code: "PARK_TOO_BIG", message: PARKS_COPY.parkTooBig, retryAfter: HEAVY_TTL_SEC } };
    default:
      return { kind: "error", status: 503, error: { code: "OSM_UNAVAILABLE", message: PARKS_COPY.overpassDown, retryAfter: err.retryAfter ?? 60 } };
  }
}

async function liveFeatures(ref: ParkRef, deps: ParkDataDeps, priority: "normal" | "low"): Promise<ParkFeatures | null> {
  return parkFeatures(ref, {
    store: deps.store,
    fetchImpl: deps.fetchImpl,
    signal: deps.signal,
    env: deps.env,
    onStart: deps.onUpstream,
    now: deps.now,
    priority,
    ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
    ...(priority === "low" ? { totalBudgetMs: REFRESH_BUDGET_MS } : {}),
  });
}

/** One background live refresh of a saved/old answer (low priority, never charged to a visitor). */
function scheduleRefresh(ref: ParkRef, key: string, deps: ParkDataDeps): void {
  refreshLater(
    { kind: "features", parkId: key },
    async () => {
      const f = await liveFeatures(ref, { store: deps.store, env: deps.env, now: deps.now, fetchImpl: deps.fetchImpl }, "low");
      if (f) await featuresCache.positive.set(key, f, { now: deps.now(), ttlSec: savedFeatures(key) ? SAVED_PARK_TTL_SEC : FEATURES_TTL_SEC });
    },
    deps,
  );
}

/**
 * What the caches already say about a park (SEC-3-02), read in one store command:
 * - `fail`: a cached failure (not a park; too heavy or too slow with no saved DFW answer; every Overpass
 *   mirror's breaker open and nothing saved): answer it without reserving anything;
 * - `known`: the positive hit (or null) and the heavy/slow flags, for loadFeatures to reuse.
 */
export type FeaturesPlan = { kind: "fail"; outcome: FeaturesFailure } | { kind: "known"; hit: CacheHit<ParkFeatures> | null; heavy: boolean; slow: boolean };

const failure = (status: number, error: ApiError): FeaturesFailure => ({ kind: "error", status, error });

/** One batched read of the features caches and the Overpass breakers. Throws StoreError when the store fails. */
export async function peekFeatures(ref: ParkRef, deps: Pick<ParkDataDeps, "store" | "env" | "now">): Promise<FeaturesPlan> {
  const key = parkIdOf(ref);
  const now = deps.now();
  const endpoints = overpassEndpoints(deps.env);
  const raws = await readMany([
    featuresCache.positive.locate(key),
    featuresCache.negative.locate(key),
    heavyCache.locate(key),
    slowCache.locate(key),
    ...endpoints.map((e) => ({ store: deps.store, key: breakerKey(breakerName(e)) })),
  ]);
  const [pos, neg, heavyRaw, slowRaw, ...breakers] = raws;
  const hit = featuresCache.positive.decode(pos, now);
  if (hit) return { kind: "known", hit, heavy: false, slow: false };
  if (featuresCache.negative.decode(neg, now)) return { kind: "fail", outcome: failure(404, { code: "NOT_A_PARK", message: PASS_COPY.notAPark }) };
  const dfw = savedDfwFeatures(key) !== null;
  const heavy = heavyCache.decode(heavyRaw, now) !== null;
  if (heavy) {
    return dfw ? { kind: "known", hit: null, heavy: true, slow: false } : { kind: "fail", outcome: failure(503, { code: "PARK_TOO_BIG", message: PARKS_COPY.parkTooBig, retryAfter: HEAVY_TTL_SEC }) };
  }
  if (savedFeatures(key)) return { kind: "known", hit: null, heavy: false, slow: false };
  const slow = slowCache.decode(slowRaw, now) !== null;
  if (slow) {
    return dfw ? { kind: "known", hit: null, heavy: false, slow: true } : { kind: "fail", outcome: failure(503, { code: "OSM_UNAVAILABLE", message: PARKS_COPY.overpassDown, retryAfter: SLOW_TTL_SEC }) };
  }
  // A live query is next. With every mirror resting and nothing saved, it could only fail.
  const waits = breakers.map((b) => breakerWaitFrom(b, now));
  if (!dfw && waits.length > 0 && waits.every((w) => w > 0)) {
    return { kind: "fail", outcome: failure(503, { code: "OSM_UNAVAILABLE", message: PARKS_COPY.overpassDown, retryAfter: Math.min(...waits) }) };
  }
  return { kind: "known", hit: null, heavy: false, slow: false };
}

export async function loadFeatures(ref: ParkRef, deps: ParkDataDeps, plan?: FeaturesPlan): Promise<FeaturesResult> {
  if (plan?.kind === "fail") return { ok: false, outcome: plan.outcome };
  const key = parkIdOf(ref);
  const known = plan?.kind === "known" ? plan : null;
  const hit = known ? known.hit : await featuresCache.positive.get(key, deps.now());
  if (hit) {
    if (hit.ageSec > REFRESH_AFTER_SEC) scheduleRefresh(ref, key, deps);
    return { ok: true, value: hit.value, at: hit.storedAt, from: "cache" };
  }
  if (!known && (await featuresCache.negative.get(key, deps.now()))) return fail(404, { code: "NOT_A_PARK", message: PASS_COPY.notAPark });
  if (known ? known.heavy : await heavyCache.get(key, deps.now())) {
    const dfw = savedDfwFeatures(key);
    if (dfw) return fromSavedDfw(ref, key, dfw, deps, "too_heavy");
    return fail(503, { code: "PARK_TOO_BIG", message: PARKS_COPY.parkTooBig, retryAfter: HEAVY_TTL_SEC });
  }

  const saved = savedFeatures(key);
  if (saved) {
    // Real recorded answer with its real fetch time ("map data checked <date>"); live refresh later.
    await featuresCache.positive.set(key, saved.value, { now: saved.fetchedAt, ttlSec: SAVED_PARK_TTL_SEC });
    scheduleRefresh(ref, key, deps);
    return { ok: true, value: saved.value, at: saved.fetchedAt, from: "saved" };
  }

  if (known ? known.slow : await slowCache.get(key, deps.now())) {
    const dfw = savedDfwFeatures(key);
    if (dfw) return fromSavedDfw(ref, key, dfw, deps, "slow_cached");
    return fail(503, { code: "OSM_UNAVAILABLE", message: PARKS_COPY.overpassDown, retryAfter: SLOW_TTL_SEC });
  }

  try {
    const f = await liveFeatures(ref, deps, "normal");
    const at = deps.now();
    if (!f) {
      await featuresCache.negative.set(key, { none: true }, { now: at });
      return fail(404, { code: "NOT_A_PARK", message: PASS_COPY.notAPark });
    }
    await featuresCache.positive.set(key, f, { now: at });
    return { ok: true, value: f, at, from: "live" };
  } catch (err) {
    if (!(err instanceof SourceError)) throw err;
    log("pass_source_failed", { source: err.source, code: err.code, started: err.started, upstreamStatus: err.status }, "warn");
    if (err.code === "too_heavy") await heavyCache.set(key, true, { now: deps.now() });
    if (err.code === "timeout") await slowCache.set(key, true, { now: deps.now() });
    const dfw = savedDfwFeatures(key);
    if (dfw) return fromSavedDfw(ref, key, dfw, deps, err.code);
    return { ok: false, outcome: featuresFailure(err) };
  }
}

/**
 * R2-M3: the saved DFW answer after live Overpass failed. It goes into the features cache with its REAL
 * fetch time (so the pass says "map data checked <that date>" and the next pass for this park doesn't
 * wait for a dead Overpass again), and one low-priority live refresh is queued for later.
 */
async function fromSavedDfw(ref: ParkRef, key: string, saved: SavedAnswer<ParkFeatures>, deps: ParkDataDeps, why: string): Promise<FeaturesResult> {
  log("pass_features_saved_fallback", { park: key, why, fetchedAt: new Date(saved.fetchedAt).toISOString() }, "warn");
  try {
    await featuresCache.positive.set(key, saved.value, { now: saved.fetchedAt, ttlSec: FEATURES_TTL_SEC });
  } catch {
    // The store hiccuped: the saved answer is still good for this pass.
  }
  scheduleRefresh(ref, key, deps);
  return { ok: true, value: saved.value, at: saved.fetchedAt, from: "saved" };
}
