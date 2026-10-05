/** Small geo helpers shared by the browser and the server (no imports, no I/O). */

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine). Good to well under 1% at park scale. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Round to `decimals` places (2 decimals = about 1 km, used for "Use my location"). */
export function roundCoord(value: number, decimals: number): number {
  const f = 10 ** decimals;
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export function isValidLatLng(p: LatLng): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

/** "0.4 mi (0.7 km)" style label for a distance in metres. US users read miles first. */
export function distanceLabel(m: number): string {
  const mi = m / 1609.344;
  const km = m / 1000;
  const fmt = (n: number) => (n < 10 ? n.toFixed(1) : String(Math.round(n)));
  return `${fmt(mi)} mi (${fmt(km)} km)`;
}
