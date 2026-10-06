/**
 * Find This Spot, server side (SPEC F9): fetch (or reuse) the park's OSM geometry, pick the target
 * by code, and assemble what the pass stores. Used by src/lib/ai/build-pass.ts.
 *
 * The geometry query starts only AFTER the park-features query confirmed a named park (SEC-1-01),
 * runs at low priority (it never holds an Overpass slot a park search or features query needs,
 * Q-1-06) and is stopped by the pass deadline (R1-M1). It is optional: if OpenStreetMap is busy or
 * slow, the pass is still made and says "No Find This Spot today: ..." with the reason. It never
 * blocks or fails a pass. The example parks have a saved real answer (src/data/osm, R1-B1), and
 * R2-M3: so does every park in the DFW index (src/data/osm/parks). A saved outline is used at once
 * (with its real fetch time on the pass) and refreshed live in the background: a park outline rarely
 * changes, and waiting up to 25 s for a busy Overpass was the main cause of 60 s passes (R2-M2).
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import { createCachePair, createJsonCache, type Store } from "@/lib/cache";
import { log } from "@/lib/log";
import type { FetchLike } from "@/lib/sources/common";
import { SourceError } from "@/lib/sources/common";
import { everyMirrorTimedOut, overpassEndpoints } from "@/lib/sources/overpass";
import { savedDfwGeometry, savedGeometry } from "@/lib/sources/osm-snapshot";
import { REFRESH_AFTER_SEC, REFRESH_BUDGET_MS, refreshLater } from "@/lib/sources/osm-refresh";
import type { ParkFeatures, ParkRef } from "@/lib/sources/overpass-features";
import { parkIdOf } from "@/lib/sources/overpass-features";
import { buildMap, parkGeometry, ParkGeometrySchema, type ParkGeometry } from "./geometry";
import { pickTarget, type SpotTarget } from "./pick-target";
import { SPOT_COPY, type Spot } from "./types";

/** OSM changes slowly (ADR 0002): park geometry is cached 7 days, like park features. */
export const GEOMETRY_TTL_SEC = 7 * 24 * 3600;
/** Parks with a saved answer (the examples) keep their live answers longer. */
export const SAVED_GEOMETRY_TTL_SEC = 30 * 24 * 3600;
/** A park whose map query Overpass called too heavy is not asked again for this long (SEC-1-01). */
export const GEOMETRY_HEAVY_TTL_SEC = 15 * 60;
/**
 * After the pools are ready, wait at most this long for the map before writing clues without it.
 * Measured 2026-10-06: the geometry query took 4-19.5 s on overpass-api.de (a 12 s cap missed a 19.5 s
 * answer). Still bounded by the pass deadline (build-pass.ts leaves the model its time).
 */
export const SPOT_WAIT_MS = 25_000;
/**
 * R2-M2: the map wait also ends this long after the pass started. A pass whose features step was slow
 * (Overpass failover) goes on without the map instead of making the visitor wait another 25 s; the
 * geometry keeps loading and is cached for the next pass.
 */
export const SPOT_STAGE_END_MS = 40_000;
/**
 * Audit Q-3-02: the model no longer waits for a map that is still loading. Before the first model call
 * the pass waits at most this long (a cached or saved outline answers in milliseconds); if the map is
 * not ready, the model writes the clues without it and the map keeps loading alongside the model call.
 */
export const SPOT_EARLY_WAIT_MS = 2_000;
/** After the model answered, a late map gets at most this much more time before the pass goes out without it. */
export const SPOT_LATE_GRACE_MS = 3_000;
/** Time we keep after the map wait for the model and its checks (build-pass's MODEL_MIN_LEFT_MS + 5 s). */
const SPOT_KEEP_FOR_MODEL_MS = 20_000;

/**
 * How long to wait for the optional map now: at most SPOT_WAIT_MS, never past SPOT_STAGE_END_MS into
 * the pass, and never into the model's time. 0 = don't wait (the map is used only if it is ready).
 */
export function spotWaitMs(elapsedMs: number, leftMs: number): number {
  return Math.max(0, Math.min(SPOT_WAIT_MS, SPOT_STAGE_END_MS - elapsedMs, leftMs - SPOT_KEEP_FOR_MODEL_MS));
}

/** Saved answer for this park: the example file first, then the per-park DFW files. */
const savedAny = (key: string) => savedGeometry(key) ?? savedDfwGeometry(key);

/** Our own Overpass slots were busy (Q-1-06): not OpenStreetMap's fault. */
export const SPOT_BUSY_HERE =
  "No Find This Spot today: Grass Pass was busy with other map lookups, so we couldn't draw the map. Make a different pass to try again.";

/** Spot messages that mean "a source was down or slow" (the pass is degraded and is re-made sooner, R1-m2). */
export const SPOT_DEGRADED_MESSAGES: readonly string[] = [SPOT_COPY.busy, SPOT_COPY.slow, SPOT_BUSY_HERE];

const geometryCache = createCachePair({
  name: "park-geometry",
  schema: ParkGeometrySchema,
  negativeSchema: z.object({ none: z.literal(true) }),
  ttlSec: GEOMETRY_TTL_SEC,
  maxEntries: 500,
});
const heavyCache = createJsonCache({ name: "park-geometry-heavy", schema: z.literal(true), ttlSec: GEOMETRY_HEAVY_TTL_SEC, maxEntries: 500 });

export type GeometryResult =
  | { status: "ok"; geometry: ParkGeometry; checkedAt: number }
  | { status: "none"; message: string };

export type GeometryDeps = {
  store: Store;
  env: Record<string, string | undefined>;
  now: () => number;
  fetchImpl?: FetchLike;
  /** In-flight + pass deadline signal. */
  signal?: AbortSignal;
  onUpstream?: () => void;
};

function scheduleRefresh(ref: ParkRef, key: string, deps: GeometryDeps): void {
  refreshLater(
    { kind: "geometry", parkId: key },
    async () => {
      const g = await parkGeometry(ref, { store: deps.store, env: deps.env, now: deps.now, fetchImpl: deps.fetchImpl, priority: "low", totalBudgetMs: REFRESH_BUDGET_MS });
      if (g) await geometryCache.positive.set(key, g, { now: deps.now(), ttlSec: savedAny(key) ? SAVED_GEOMETRY_TTL_SEC : GEOMETRY_TTL_SEC });
    },
    deps,
  );
}

/** The park's geometry, from the cache, the saved answer or one low-priority Overpass query. Never throws. */
export async function loadGeometry(ref: ParkRef, deps: GeometryDeps): Promise<GeometryResult> {
  if (ref.type === "node") return { status: "none", message: SPOT_COPY.noOutline };
  const key = parkIdOf(ref);
  try {
    const hit = await geometryCache.positive.get(key, deps.now());
    if (hit) {
      if (hit.ageSec > REFRESH_AFTER_SEC) scheduleRefresh(ref, key, deps);
      return { status: "ok", geometry: hit.value, checkedAt: hit.storedAt };
    }
    if (await geometryCache.negative.get(key, deps.now())) return { status: "none", message: SPOT_COPY.noOutline };
    const saved = savedAny(key);
    if (saved) {
      await geometryCache.positive.set(key, saved.value, { now: saved.fetchedAt, ttlSec: SAVED_GEOMETRY_TTL_SEC });
      scheduleRefresh(ref, key, deps);
      return { status: "ok", geometry: saved.value, checkedAt: saved.fetchedAt };
    }
    if (await heavyCache.get(key, deps.now())) return { status: "none", message: SPOT_COPY.busy };
    const g = await parkGeometry(ref, {
      store: deps.store,
      env: deps.env,
      now: deps.now,
      fetchImpl: deps.fetchImpl,
      signal: deps.signal,
      onStart: deps.onUpstream,
      priority: "low",
    });
    const at = deps.now();
    if (!g) {
      await geometryCache.negative.set(key, { none: true }, { now: at });
      return { status: "none", message: SPOT_COPY.noOutline };
    }
    await geometryCache.positive.set(key, g, { now: at });
    return { status: "ok", geometry: g, checkedAt: at };
  } catch (err) {
    // Optional section: any failure (busy server, bad answer, store hiccup) means "no map today", never a failed pass.
    const code = err instanceof SourceError ? err.code : err instanceof Error ? err.name : "unknown";
    // R2-m2: a client timeout on this park's map query is negative-cached like "too heavy" (15 min).
    // Audit Q-3-01 option 3: only when every mirror tried timed out (one dead mirror is not the park's fault).
    if (err instanceof SourceError && (err.code === "too_heavy" || everyMirrorTimedOut(err, overpassEndpoints(deps.env).length))) {
      await heavyCache.set(key, true, { now: deps.now() });
    }
    log("spot_geometry_failed", { park: key, code }, err instanceof SourceError ? "warn" : "error");
    const message =
      err instanceof SourceError && err.code === "aborted"
        ? SPOT_COPY.slow
        : err instanceof SourceError && err.code === "queue_full"
          ? SPOT_BUSY_HERE
          : SPOT_COPY.busy;
    return { status: "none", message };
  }
}

/** The geometry when it settles within `ms`, else null (the fetch keeps going and fills the cache). */
export async function settleWithin(p: Promise<GeometryResult>, ms: number): Promise<GeometryResult | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, ms));
  });
  try {
    return await Promise.race([p, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Audit Q-3-02: the plan for a map that arrived while the model was writing. The clues were written
 * without it, so a target that is the same thing as a printed Park Find (the park's only shelter) is
 * swapped for the next candidate when there is one (`keptIds`: the pool ids on the pass).
 */
export function planLateSpot(
  geo: GeometryResult,
  opts: { parkName: string; features: ParkFeatures | null; variant: number; keptIds: ReadonlySet<string> },
): SpotPlan {
  const first = planSpot(geo, opts);
  if (first.status !== "target") return first;
  const clash = (p: SpotPlan) => p.status === "target" && p.target.poolKind !== null && opts.keptIds.has(`osm-${p.target.poolKind.replace(/_/g, "-")}`);
  if (!clash(first)) return first;
  for (let v = opts.variant + 1; v < opts.variant + 3; v++) {
    const next = planSpot(geo, { ...opts, variant: v });
    if (next.status === "target" && !clash(next)) return next;
  }
  return first;
}

/** The geometry, or "too slow" after `ms` (the fetch keeps going and fills the cache for the next pass). */
export async function geometryWithin(p: Promise<GeometryResult>, ms: number): Promise<GeometryResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<GeometryResult>((resolve) => {
    timer = setTimeout(() => resolve({ status: "none", message: SPOT_COPY.slow }), Math.max(0, ms));
  });
  try {
    return await Promise.race([p, slow]);
  } finally {
    clearTimeout(timer);
  }
}

export type SpotPlan =
  | { status: "target"; target: SpotTarget; geometry: ParkGeometry; checkedAt: number }
  | { status: "none"; message: string };

/** Code picks the target (or says why there is none). */
export function planSpot(geo: GeometryResult, opts: { parkName: string; features: ParkFeatures | null; variant: number }): SpotPlan {
  if (geo.status === "none") return geo;
  const target = pickTarget(geo.geometry, opts);
  if (!target) return { status: "none", message: SPOT_COPY.noLandmark };
  return { status: "target", target, geometry: geo.geometry, checkedAt: geo.checkedAt };
}

/** What the pass stores. `riddle` is the model's riddle that passed every check, or null (fixed line). */
export function finishSpot(plan: SpotPlan, riddle: string | null): Spot {
  if (plan.status === "none") return { status: "none", message: plan.message };
  const t = plan.target;
  return {
    status: "ok",
    target: { osmId: t.osmId, label: t.label, name: t.name, answer: t.answer },
    start: t.start ? { osmId: t.start.osmId, label: t.start.label } : null,
    walk: t.walk,
    riddle: riddle ?? SPOT_COPY.codeRiddle(t.start !== null),
    riddleBy: riddle ? "model" : "code",
    map: buildMap(plan.geometry, t.center, t.start?.at ?? null),
    checkedAt: new Date(plan.checkedAt).toISOString(),
  };
}
