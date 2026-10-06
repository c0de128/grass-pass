/**
 * Park search constants the browser needs on first paint, with NO zod import (audit R4 UX-4-02). The schemas in
 * ./schema.ts re-export these and are loaded by the browser on demand, when a search answer arrives.
 */

/** Search radius around the point (SPEC F1). */
export const PARK_RADIUS_M = 5_000;
/** At most this many parks, nearest first (SPEC F1). */
export const MAX_PARKS = 10;
/** "Use my location" is rounded to this many decimals in the browser and again on the server (~1 km). */
export const LOCATION_DECIMALS = 2;

export const PlaceQueryLimits = { min: 2, max: 100 } as const;
