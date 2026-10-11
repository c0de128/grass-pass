/**
 * Search v2 (2026-10-10): where the results map's streets come from. OpenFreeMap (https://openfreemap.org): free, no
 * key, no cookies, commercial use allowed; attribution "OpenFreeMap © OpenMapTiles Data from OpenStreetMap"
 * (checked on openfreemap.org, its /privacy/ and /tos/ pages, 2026-10-10). Style, vector tiles, sprites and fonts all
 * come from this one origin (the style JSON was read on 2026-10-10), so the CSP adds only this origin.
 * No map library here: the CSP (src/lib/security-headers.ts) and the tests import it too.
 */
export const OPENFREEMAP_ORIGIN = "https://tiles.openfreemap.org";
/** Positron: a quiet light street map, so the green circle and the numbered pins stand out. */
export const OPENFREEMAP_STYLE_URL = `${OPENFREEMAP_ORIGIN}/styles/positron`;

/** MapLibre GL JS version the worker file below was copied from (kept equal to package.json by a unit test). */
export const MAPLIBRE_VERSION = "6.13.0";
/**
 * MapLibre's web worker, served from our own origin (public/vendor), so the CSP needs no blob: workers and the
 * bundler never has to find the worker next to its own chunk. Copied from node_modules/maplibre-gl/dist.
 */
export const MAPLIBRE_WORKER_URL = `/vendor/maplibre-gl-worker-${MAPLIBRE_VERSION}.mjs`;

/** If the street map has not drawn within this time, the page says "Map unavailable" (the list is still there). */
export const MAP_LOAD_TIMEOUT_MS = 15_000;

export const MAP_COPY = {
  unavailable: "Map unavailable right now. The list below has every park.",
  help: "Pins match the numbers in the list. Tap a pin to pick that park.",
  region: "Map of the parks in the list",
} as const;
