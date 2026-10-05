/**
 * The `GET /api/parks` contract, shared by the route and the browser form.
 * No server-only imports here: the client validates the answer with the same schema.
 */
import "@/lib/zod-config";
import { z } from "zod";

/** Search radius around the point (SPEC F1). */
export const PARK_RADIUS_M = 5_000;
/** At most this many parks, nearest first (SPEC F1). */
export const MAX_PARKS = 10;
/** "Use my location" is rounded to this many decimals in the browser and again on the server (~1 km). */
export const LOCATION_DECIMALS = 2;

export const PlaceQueryLimits = { min: 2, max: 100 } as const;

/** Exact empty / failure copy (SPEC §5.4). */
export const PARKS_COPY = {
  noPlace: "We couldn't find that place. Try a town name or ZIP.",
  geocoderDown: "No data available: the map search isn't answering. Try 'Use my location' or an example park.",
  noParks: "No parks found within 5 km in OpenStreetMap.",
  overpassDown:
    "No data available: the OpenStreetMap server is busy. Try again in a minute, or pick an example park.",
} as const;

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
});
export type ParksResult = z.infer<typeof ParksResultSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryAfter: z.number().optional(),
    /** Which form control the error belongs to, when it is a field error. */
    field: z.enum(["q", "location"]).optional(),
  }),
});
export type ParksApiError = z.infer<typeof ApiErrorSchema>;
