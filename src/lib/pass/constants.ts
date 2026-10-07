/**
 * Age bands and other pass constants the browser needs on first paint, with NO zod import (audit R4 UX-4-02: the
 * home page's first JavaScript must not carry the zod chunk; the schemas in ./schema.ts are loaded on demand,
 * when a pass is requested). ./schema.ts re-exports everything here, so server code keeps one import path.
 */

/**
 * THE list of age bands (Kevin, 2026-10-07: the three kid bands stay exactly as they were, plus "Teens & adults
 * (13+)"). Everything else (the picker tiles, the zod enum, pass ids, the prompt, the printed wording) is read
 * from this list and AGE_BAND_INFO below, so a band is added in one place.
 */
export const AGE_BANDS = ["4-6", "6-10", "10-13", "13+"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
export const DEFAULT_AGE_BAND: AgeBand = "6-10";
/** localStorage key for the remembered band (never sent anywhere except inside a pass request). */
export const AGE_BAND_STORAGE_KEY = "grass-pass:age-band";

/** A plain check for a stored or restored value (the same rule as AgeBandSchema). */
export function isAgeBand(v: unknown): v is AgeBand {
  return typeof v === "string" && (AGE_BANDS as readonly string[]).includes(v);
}

/** Who holds the pass: a kid with a grown-up (the printed copy talks about the grown-up), or a teen/adult on their own. */
export type Audience = "kid" | "adult";

export type AgeBandInfo = {
  /** Printed and shown with the pass ("Ages 6-10"). */
  label: string;
  /** The "For <label>: <hint>." line once a band is picked. */
  hint: string;
  items: number;
  hardMin: number;
  grade: string;
  /** The pass id part ("w306191453-6to10-20261005-1"); never changes for a band (saved passes use it). */
  slug: string;
  /** The picker tile's big text ("4–6", "13+"). */
  short: string;
  /** The picker tile's small line (Kevin's home-copy voice). */
  pickerHint: string;
  audience: Audience;
};

export const AGE_BAND_INFO: Record<AgeBand, AgeBandInfo> = {
  "4-6": { label: "Ages 4-6", hint: "6 finds, picture-simple words for a grown-up to read aloud", items: 6, hardMin: 0, grade: "1 (a grown-up reads it aloud)", slug: "4to6", short: "4–6", pickerHint: "6 finds, you read aloud", audience: "kid" },
  "6-10": { label: "Ages 6-10", hint: "8 finds, easy words", items: 8, hardMin: 0, grade: "2", slug: "6to10", short: "6–10", pickerHint: "8 finds, the sweet spot", audience: "kid" },
  "10-13": { label: "Ages 10-13", hint: "8 finds, 2 of them hard", items: 8, hardMin: 2, grade: "5", slug: "10to13", short: "10–13", pickerHint: "8 finds, 2 brain-benders", audience: "kid" },
  // Kevin 2026-10-07: "Teens & adults (13+)": 8 finds, real naturalist challenges (3 of them hard).
  "13+": { label: "Teens & adults (13+)", hint: "8 finds, real naturalist challenges, 3 of them hard", items: 8, hardMin: 3, grade: "8", slug: "13plus", short: "13+", pickerHint: "Teens & adults: 8 finds, real naturalist challenges", audience: "adult" },
};

/** The pass-id slug of every band, in AGE_BANDS order ("4to6|6to10|10to13|13plus" in the id patterns). */
export const AGE_BAND_SLUGS: readonly string[] = AGE_BANDS.map((b) => AGE_BAND_INFO[b].slug);

/** True for a band whose pass is held by a teen or adult (no grown-up wording on paper). */
export const isAdultBand = (band: AgeBand): boolean => AGE_BAND_INFO[band].audience === "adult";

/** Different passes per park + age band + day (SPEC §7). */
export const MAX_VARIANTS = 3;

/**
 * Pass failures caused by the free map data (OpenStreetMap busy or slow, or our own queue), where a
 * ready example pass is offered and the page tries ONE more time by itself (R2-M3).
 */
export const MAP_DATA_FAILURE_CODES: readonly string[] = ["OSM_UNAVAILABLE", "BUSY_HERE", "DATA_TOO_SLOW", "PARK_TOO_BIG"];
/** Of those, the ones where trying again soon can help (not PARK_TOO_BIG). */
export const AUTO_RETRY_CODES: readonly string[] = ["OSM_UNAVAILABLE", "BUSY_HERE", "DATA_TOO_SLOW"];
