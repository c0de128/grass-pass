/**
 * A clearer Find This Spot map for passes made before the current map code (map-clear 2026-10-07, map-v2 2026-10-08).
 *
 * An older pass stores either a whole-park map (too coarse to zoom on the walk) or a framed map without the named
 * reference points (landmarks, map-v2). When the app holds a saved OpenStreetMap answer for the park
 * (src/data/osm: the example parks and the DFW park index), the map is redrawn from it with today's code, for the
 * SAME X and the SAME START: the same OSM ids, and the code-measured walk (distance and direction) must come out the same.
 *   1. The exact answer the pass was drawn from (same fetch time as the pass's "map data checked"): redrawn as is.
 *   2. Otherwise another saved answer for that park in which the X and START are the same objects at the same walk:
 *      redrawn from it, and the shown pass then says THAT answer's fetch time ("map data checked"), because that is
 *      the data the map now shows.
 * Otherwise the pass keeps its stored map (render-map.ts re-frames and cleans that from its own shapes). The stored pass
 * is never changed: this only decides what is drawn.
 */
import "server-only";
import type { Pass } from "@/lib/pass/schema";
import { savedDfwGeometry, savedGeometry, type SavedAnswer } from "@/lib/sources/osm-snapshot";
import { buildMap, centerOf, distanceM, compass, type LatLng, type ParkGeometry } from "./geometry";
import { roundWalk } from "./pick-target";
import type { SpotMap, SpotOk } from "./types";

/** The map drawn for this spot from one saved answer, or null when its X, START or walk differ from the pass's. */
function mapFrom(g: ParkGeometry, spot: SpotOk): SpotMap | null {
  const target = g.elements.find((e) => e.osmId === spot.target.osmId);
  if (!target) return null;
  const center = centerOf(target.lines);
  let start: LatLng | null = null;
  if (spot.start) {
    const el = g.elements.find((e) => e.osmId === spot.start!.osmId);
    if (!el) return null;
    start = centerOf(el.lines);
    // The same walk the pass printed, or this is not the same START and X: keep the stored map.
    if (!spot.walk || roundWalk(distanceM(start, center)) !== spot.walk.meters || compass(start, center) !== spot.walk.direction) return null;
  }
  return buildMap(g, center, start, { targetId: spot.target.osmId, startId: spot.start?.osmId ?? null });
}

/** The redrawn map and the fetch time of the answer it was drawn from, or null (keep the stored map). */
export function redrawnSpot(parkId: string, spot: SpotOk): { map: SpotMap; checkedAt: string } | null {
  // Already drawn by today's code (framed, with its landmarks list, even an empty one).
  if (spot.map.frame === "spot" && spot.map.landmarks) return null;
  const at = Date.parse(spot.checkedAt);
  const saved = [savedGeometry(parkId), savedDfwGeometry(parkId)].filter((s): s is SavedAnswer<ParkGeometry> => s !== null);
  // 1. The very answer the pass was made from; 2. another saved answer with the same X, START and walk.
  const ordered = [...saved.filter((s) => s.fetchedAt === at), ...saved.filter((s) => s.fetchedAt !== at)];
  for (const s of ordered) {
    const map = mapFrom(s.value, spot);
    if (map) return { map, checkedAt: s.fetchedAt === at ? spot.checkedAt : new Date(s.fetchedAt).toISOString() };
  }
  return null;
}

/** The framed map for an older spot, or null when it can't be redrawn from the same X and START. */
export function redrawnMap(parkId: string, spot: SpotOk): SpotMap | null {
  return redrawnSpot(parkId, spot)?.map ?? null;
}

/** The pass to SHOW: the same pass with its older map redrawn when that is possible (see above). */
export function withClearMap(pass: Pass): Pass {
  const spot = pass.spot;
  if (!spot || spot.status !== "ok") return pass;
  const r = redrawnSpot(pass.park.id, spot);
  return r ? { ...pass, spot: { ...spot, map: r.map, checkedAt: r.checkedAt } } : pass;
}
