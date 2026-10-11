/**
 * Search v2 (2026-10-10): pure helpers for the park results view, with NO zod or map library import, so the wizard
 * can use them on first paint and the unit tests can check them. The circle and bounds feed the results map
 * (src/components/parks/ParkResultsMap.tsx); the summary is the line above the list.
 */
import { MAX_PARKS, METERS_PER_MILE, radiusShort, type RadiusMiles } from "./constants";

export type LngLatPair = [number, number];

const EARTH_R = 6_371_008.8;

/**
 * A closed ring of `steps` points `radiusM` metres from `center` (great-circle destination points), as [lng, lat]
 * pairs, first point repeated at the end (GeoJSON Polygon ring).
 */
export function circleRing(center: { lat: number; lng: number }, radiusM: number, steps = 72): LngLatPair[] {
  const lat1 = (center.lat * Math.PI) / 180;
  const lng1 = (center.lng * Math.PI) / 180;
  const d = radiusM / EARTH_R;
  const ring: LngLatPair[] = [];
  for (let i = 0; i < steps; i++) {
    const brg = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
    const lng2 = lng1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    ring.push([Math.round(((lng2 * 180) / Math.PI) * 1e6) / 1e6, Math.round(((lat2 * 180) / Math.PI) * 1e6) / 1e6]);
  }
  ring.push(ring[0]);
  return ring;
}

/**
 * The map's first view: the searched point and every listed park, padded a little; never smaller than about 600 m
 * across (so one park next to the point is not shown at street-corner zoom). [[west, south], [east, north]].
 */
export function resultsBounds(center: { lat: number; lng: number }, parks: readonly { lat: number; lng: number }[]): [LngLatPair, LngLatPair] {
  let w = center.lng;
  let e = center.lng;
  let s = center.lat;
  let n = center.lat;
  for (const p of parks) {
    w = Math.min(w, p.lng);
    e = Math.max(e, p.lng);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  const minHalfLat = 300 / 110_574;
  const minHalfLng = 300 / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  const cLat = (s + n) / 2;
  const cLng = (w + e) / 2;
  const halfLat = Math.max((n - s) / 2, minHalfLat);
  const halfLng = Math.max((e - w) / 2, minHalfLng);
  return [
    [cLng - halfLng, cLat - halfLat],
    [cLng + halfLng, cLat + halfLat],
  ];
}

/**
 * The honest line above the list: how many named parks were found within the chosen distance and, when the list
 * stops at MAX_PARKS, that it was cut. `placeSearch`: the list came from the Nominatim fallback, which answers at most
 * 40 places ranked by importance, so the count is what that search found, not every park in the circle.
 */
export function resultsSummary(shown: number, totalFound: number, radiusMi: RadiusMiles, placeSearch = false): string {
  // Q-SV2-04: "about", because a park counts when any part of it is inside the circle, while card distances are to
  // its middle (so a big park can read 3.2 mi in a 3 mi list).
  const within = `within about ${radiusShort(radiusMi)}`;
  const lead = placeSearch ? "The place search found " : "";
  if (shown < totalFound) {
    return `${lead}${totalFound} named parks ${within}. Showing the ${shown} nearest (the list stops at ${MAX_PARKS}).`;
  }
  return `${lead}${shown} named ${shown === 1 ? "park" : "parks"} ${within}.`;
}

/** "0.4 mi" / "12 mi": a distance in miles for the map pins' hover text. */
export function milesShort(m: number): string {
  const mi = m / METERS_PER_MILE;
  return `${Math.round(mi * 10) / 10 < 10 ? mi.toFixed(1) : String(Math.round(mi))} mi`;
}
