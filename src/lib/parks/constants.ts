/**
 * Park search constants the browser needs on first paint, with NO zod import (audit R4 UX-4-02). The schemas in
 * ./schema.ts re-export these and are loaded by the browser on demand, when a search answer arrives.
 */

/** Metres in one international mile. */
export const METERS_PER_MILE = 1609.344;

/** Search v2 (Kevin 2026-10-10): the distances a visitor can choose, in miles. Nothing else is accepted. */
export const RADIUS_MILES = [1, 3, 5, 10] as const;
export type RadiusMiles = (typeof RADIUS_MILES)[number];
/** The distance picked until the visitor chooses another. */
export const DEFAULT_RADIUS_MILES: RadiusMiles = 3;

export function isRadiusMiles(n: unknown): n is RadiusMiles {
  return typeof n === "number" && (RADIUS_MILES as readonly number[]).includes(n);
}

/** The search circle in whole metres (3 mi -> 4,828 m). */
export function radiusMeters(mi: RadiusMiles): number {
  return Math.round(mi * METERS_PER_MILE);
}

/** "3 mi (4.8 km)": miles first, kilometres in brackets. */
export function radiusLabel(mi: RadiusMiles): string {
  const km = (mi * METERS_PER_MILE) / 1000;
  return `${mi} mi (${km < 10 ? km.toFixed(1) : String(Math.round(km))} km)`;
}

/** "3 mi" for running text. */
export function radiusShort(mi: RadiusMiles): string {
  return `${mi} mi`;
}

/** Default search circle in metres (3 mi). Only used where no choice was made (saved-index checks, old tests). */
export const PARK_RADIUS_M = radiusMeters(DEFAULT_RADIUS_MILES);
/**
 * At most this many parks, nearest first. Search v2: 20 (was 10), so a wider circle shows more of what is in it;
 * the page says when the list was cut ("The 20 nearest of 312 ...").
 */
export const MAX_PARKS = 20;
/** "Use my location" is rounded to this many decimals in the browser and again on the server (~1 km). */
export const LOCATION_DECIMALS = 2;

export const PlaceQueryLimits = { min: 2, max: 100 } as const;
