/**
 * Age bands and other pass constants the browser needs on first paint, with NO zod import (audit R4 UX-4-02: the
 * home page's first JavaScript must not carry the zod chunk; the schemas in ./schema.ts are loaded on demand,
 * when a pass is requested). ./schema.ts re-exports everything here, so server code keeps one import path.
 */

export const AGE_BANDS = ["4-6", "6-10", "10-13"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
export const DEFAULT_AGE_BAND: AgeBand = "6-10";
/** localStorage key for the remembered band (never sent anywhere except inside a pass request). */
export const AGE_BAND_STORAGE_KEY = "grass-pass:age-band";

/** A plain check for a stored or restored value (the same rule as AgeBandSchema). */
export function isAgeBand(v: unknown): v is AgeBand {
  return typeof v === "string" && (AGE_BANDS as readonly string[]).includes(v);
}

export const AGE_BAND_INFO: Record<AgeBand, { label: string; hint: string; items: number; hardMin: number; grade: string }> = {
  "4-6": { label: "Ages 4-6", hint: "6 finds, picture-simple words for a grown-up to read aloud", items: 6, hardMin: 0, grade: "1 (a grown-up reads it aloud)" },
  "6-10": { label: "Ages 6-10", hint: "8 finds, easy words", items: 8, hardMin: 0, grade: "2" },
  "10-13": { label: "Ages 10-13", hint: "8 finds, 2 of them hard", items: 8, hardMin: 2, grade: "5" },
};

/** Different passes per park + age band + day (SPEC §7). */
export const MAX_VARIANTS = 3;

/**
 * Pass failures caused by the free map data (OpenStreetMap busy or slow, or our own queue), where a
 * ready example pass is offered and the page tries ONE more time by itself (R2-M3).
 */
export const MAP_DATA_FAILURE_CODES: readonly string[] = ["OSM_UNAVAILABLE", "BUSY_HERE", "DATA_TOO_SLOW", "PARK_TOO_BIG"];
/** Of those, the ones where trying again soon can help (not PARK_TOO_BIG). */
export const AUTO_RETRY_CODES: readonly string[] = ["OSM_UNAVAILABLE", "BUSY_HERE", "DATA_TOO_SLOW"];
