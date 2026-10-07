/**
 * map-clear (2026-10-07): a sharper Find This Spot map for passes made before maps were framed on START and the X.
 *
 * An older pass stores a whole-park map, drawn at whole-park resolution: on a big park (White Rock Lake, ~4 km)
 * one stored unit is ~22 m, far too coarse to zoom in on a 290 m walk. When the app holds the EXACT OpenStreetMap
 * answer that pass was drawn from (a saved snapshot whose fetch time equals the pass's "map data checked" time),
 * the map is redrawn from it with today's framing, for the same X and the same START (same OSM ids, and the
 * code-measured walk must come out the same). Otherwise the pass keeps its stored map (render-map.ts re-frames
 * that from its own shapes). The stored pass is never changed: this only decides what is drawn.
 */
import "server-only";
import type { Pass } from "@/lib/pass/schema";
import { savedDfwGeometry, savedGeometry } from "@/lib/sources/osm-snapshot";
import { buildMap, centerOf, distanceM, compass, type ParkGeometry } from "./geometry";
import { roundWalk } from "./pick-target";
import type { SpotMap, SpotOk } from "./types";

/** The geometry this spot was drawn from, when a saved copy with the very same fetch time exists. */
function sameAnswer(parkId: string, checkedAt: string): ParkGeometry | null {
  const at = Date.parse(checkedAt);
  if (!Number.isFinite(at)) return null;
  for (const saved of [savedGeometry(parkId), savedDfwGeometry(parkId)]) if (saved && saved.fetchedAt === at) return saved.value;
  return null;
}

/** The framed map for an older spot, or null when it can't be redrawn from the same data. */
export function redrawnMap(parkId: string, spot: SpotOk): SpotMap | null {
  if (spot.map.frame === "spot") return null;
  const g = sameAnswer(parkId, spot.checkedAt);
  if (!g) return null;
  const target = g.elements.find((e) => e.osmId === spot.target.osmId);
  if (!target) return null;
  const center = centerOf(target.lines);
  let start = null;
  if (spot.start) {
    const el = g.elements.find((e) => e.osmId === spot.start!.osmId);
    if (!el) return null;
    start = centerOf(el.lines);
    // The same walk the pass printed, or this is not the same START and X: keep the stored map.
    if (!spot.walk || roundWalk(distanceM(start, center)) !== spot.walk.meters || compass(start, center) !== spot.walk.direction) return null;
  }
  return buildMap(g, center, start);
}

/** The pass to SHOW: the same pass with its older map redrawn when that is possible (see above). */
export function withClearMap(pass: Pass): Pass {
  const spot = pass.spot;
  if (!spot || spot.status !== "ok") return pass;
  const map = redrawnMap(pass.park.id, spot);
  return map ? { ...pass, spot: { ...spot, map } } : pass;
}
