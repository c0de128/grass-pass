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
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import { createCachePair, createJsonCache, type Store } from "@/lib/cache";
import { log } from "@/lib/log";
import { PARKS_COPY } from "@/lib/parks/schema";
import { SourceError, type FetchLike } from "@/lib/sources/common";
import { savedDfwFeatures, savedFeatures, type SavedAnswer } from "@/lib/sources/osm-snapshot";
import { REFRESH_AFTER_SEC, REFRESH_BUDGET_MS, refreshLater } from "@/lib/sources/osm-refresh";
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

export type ParkDataDeps = {
  store: Store;
  env: Record<string, string | undefined>;
  now: () => number;
  fetchImpl?: FetchLike;
  /** In-flight + deadline signal. */
  signal?: AbortSignal;
  /** Called right before the first upstream request (charges the per-IP daily share). */
  onUpstream?: () => void;
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

export async function loadFeatures(ref: ParkRef, deps: ParkDataDeps): Promise<FeaturesResult> {
  const key = parkIdOf(ref);
  const hit = await featuresCache.positive.get(key, deps.now());
  if (hit) {
    if (hit.ageSec > REFRESH_AFTER_SEC) scheduleRefresh(ref, key, deps);
    return { ok: true, value: hit.value, at: hit.storedAt, from: "cache" };
  }
  if (await featuresCache.negative.get(key, deps.now())) return fail(404, { code: "NOT_A_PARK", message: PASS_COPY.notAPark });
  if (await heavyCache.get(key, deps.now())) {
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
