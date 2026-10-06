/**
 * Find This Spot, server side (SPEC F9): fetch (or reuse) the park's OSM geometry, pick the target
 * by code, and assemble what the pass stores. Used by src/lib/ai/build-pass.ts.
 *
 * The geometry query starts at the same time as the S3 park-features query, so it normally costs no
 * extra wait. It is optional: if OpenStreetMap is busy or slow, the pass is still made and says
 * "No Find This Spot today: ..." with the reason. It never blocks or fails a pass.
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import { createCachePair, type Store } from "@/lib/cache";
import { log } from "@/lib/log";
import type { FetchLike } from "@/lib/sources/common";
import { SourceError } from "@/lib/sources/common";
import type { ParkFeatures, ParkRef } from "@/lib/sources/overpass-features";
import { parkIdOf } from "@/lib/sources/overpass-features";
import { buildMap, parkGeometry, ParkGeometrySchema, type ParkGeometry } from "./geometry";
import { pickTarget, type SpotTarget } from "./pick-target";
import { SPOT_COPY, type Spot } from "./types";

/** OSM changes slowly (ADR 0002): park geometry is cached 7 days, like park features. */
export const GEOMETRY_TTL_SEC = 7 * 24 * 3600;
/**
 * After the pools are ready, wait at most this long for the map before writing clues without it.
 * Measured 2026-10-06: the geometry query took 4-19.5 s on overpass-api.de (a 12 s cap missed a 19.5 s
 * answer). Still bounded by the pass deadline (build-pass.ts leaves the model its time).
 */
export const SPOT_WAIT_MS = 25_000;

const geometryCache = createCachePair({
  name: "park-geometry",
  schema: ParkGeometrySchema,
  negativeSchema: z.object({ none: z.literal(true) }),
  ttlSec: GEOMETRY_TTL_SEC,
  maxEntries: 500,
});

export type GeometryResult =
  | { status: "ok"; geometry: ParkGeometry; checkedAt: number }
  | { status: "none"; message: string };

export type GeometryDeps = {
  store: Store;
  env: Record<string, string | undefined>;
  now: () => number;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  onUpstream?: () => void;
};

/** The park's geometry, from the cache or one Overpass query. Never throws. */
export async function loadGeometry(ref: ParkRef, deps: GeometryDeps): Promise<GeometryResult> {
  if (ref.type === "node") return { status: "none", message: SPOT_COPY.noOutline };
  const key = parkIdOf(ref);
  try {
    const hit = await geometryCache.positive.get(key, deps.now());
    if (hit) return { status: "ok", geometry: hit.value, checkedAt: hit.storedAt };
    if (await geometryCache.negative.get(key, deps.now())) return { status: "none", message: SPOT_COPY.noOutline };
    const g = await parkGeometry(ref, {
      store: deps.store,
      env: deps.env,
      now: deps.now,
      fetchImpl: deps.fetchImpl,
      signal: deps.signal,
      onStart: deps.onUpstream,
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
    log("spot_geometry_failed", { park: key, code }, err instanceof SourceError ? "warn" : "error");
    return { status: "none", message: SPOT_COPY.busy };
  }
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
