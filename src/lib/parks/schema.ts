/**
 * The `GET /api/parks` contract, shared by the route and the browser form.
 * No server-only imports here: the client validates the answer with the same schema.
 */
import "@/lib/zod-config";
import { z } from "zod";
import { MAX_PARKS } from "./constants";
// The plain constants live in ./constants (no zod, for the browser's first paint, UX-4-02); re-exported here.
export { LOCATION_DECIMALS, MAX_PARKS, PARK_RADIUS_M, PlaceQueryLimits } from "./constants";

/** Exact empty / failure copy (SPEC §5.4). */
export const PARKS_COPY = {
  noPlace: "We couldn't find that place. Try a town name or ZIP.",
  geocoderDown: 'No data available: the map search isn\'t answering. Try "Use my location" or an example park.',
  noParks: "No parks within 5 km in OpenStreetMap.",
  // Audit Q-3-06: no fixed "in a minute" (the page shows its own countdown when it retries by itself).
  overpassDown: "No data available: the OpenStreetMap server is busy. Try again shortly or pick an example park.",
  /** Audit Q-3-01: this park's live map query ran into our timeout; it is not asked again for `minutes` more. */
  parkSlow: (minutes: number) =>
    `No data available: this park's map took too long to load from OpenStreetMap a moment ago, so we won't ask for it again for about ${minutes} minute${minutes === 1 ? "" : "s"}. Meanwhile, open an example pass or pick another park.`,
  /** Our OWN per-process Overpass slots were busy (Q-1-06): not OpenStreetMap's fault. */
  busyHere: "Grass Pass is busy with other lookups. Try again in a few seconds.",
  /** Overpass said this one park's query was too heavy (SEC-1-01). */
  parkTooBig:
    "No data available: OpenStreetMap couldn't read this park in time (it may be very big). Try a smaller park nearby.",
  /** Search answered from the saved Dallas-area park list because live Overpass didn't answer (R1-B1). */
  savedIndex:
    "OpenStreetMap didn't answer in time. This list is a saved copy of OpenStreetMap parks around Dallas (see date below), so new parks may be missing.",
  /** Search answered from the OpenStreetMap place search because live Overpass didn't answer (R1-B1). */
  nominatimParks:
    "OpenStreetMap didn't answer in time. This list uses the OpenStreetMap place search (Nominatim) instead, so it may miss some parks.",
} as const;

/** A ready example pass offered when a search can't answer (R1-B1). */
export const ExampleLinkSchema = z.object({
  name: z.string().min(1).max(120),
  href: z.string().regex(/^\/pass\/[a-z0-9-]{1,80}\?example=1$/),
});
export type ExampleLink = z.infer<typeof ExampleLinkSchema>;

export const ParkSchema = z.object({
  /** OSM reference, e.g. "way/306191453". Stable id for the pass step. */
  id: z.string().regex(/^(node|way|relation)\/\d{1,15}$/),
  name: z.string().min(1).max(120),
  kind: z.enum(["park", "nature_reserve"]),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Straight-line distance from the searched point to the park's centre, metres. */
  distanceM: z.number().int().min(0),
});
export type Park = z.infer<typeof ParkSchema>;

export const ParksResultSchema = z.object({
  query: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("text"),
      text: z.string(),
      /** What Nominatim matched, e.g. "Allen, Collin County, Texas, United States"; null when nothing matched. */
      matched: z.string().nullable(),
    }),
    z.object({ kind: z.literal("location") }),
  ]),
  /** The point parks are measured from (null when the place was not found). */
  center: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  radiusM: z.number(),
  parks: z.array(ParkSchema).max(MAX_PARKS),
  /** Named parks found within the radius before keeping the nearest MAX_PARKS. */
  totalFound: z.number().int().min(0),
  /** Why the list is empty, with the exact copy to show; null when there are parks. */
  empty: z
    .object({ reason: z.enum(["no_place", "no_parks"]), message: z.string() })
    .nullable(),
  /** When the data shown was fetched from OpenStreetMap (ISO time; cached answers keep their real time). */
  checkedAt: z.string(),
  /** True when the park list came from our cache. */
  cached: z.boolean(),
  /**
   * Set when live Overpass didn't answer and the list came from somewhere else (R1-B1): our saved
   * Dallas-area park list (real Overpass answer, `checkedAt` is its fetch time) or Nominatim.
   * `message` is the exact note to show above the list.
   */
  fallback: z.object({ kind: z.enum(["saved_index", "nominatim"]), message: z.string() }).nullish(),
});
export type ParksResult = z.infer<typeof ParksResultSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryAfter: z.number().optional(),
    /** Which form control the error belongs to, when it is a field error. */
    field: z.enum(["q", "location"]).optional(),
    /** A ready example pass to open instead (when the search couldn't answer). */
    example: ExampleLinkSchema.optional(),
  }),
});
export type ParksApiError = z.infer<typeof ApiErrorSchema>;
