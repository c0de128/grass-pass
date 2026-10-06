/**
 * Find This Spot (SPEC F9, S5): what a pass stores, and every line of its fixed copy.
 * Client-safe (no server-only imports): the pass page, the print page and the browser read it.
 *
 * The map is stored already projected and simplified (integer map units, north up), so drawing it
 * never needs OpenStreetMap again. Every shape on it is a real OSM object; nothing is invented.
 */
import "@/lib/zod-config";
import { z } from "zod";

/** Map box in map units. Printed about 4.2 in wide, so 1 unit is about 0.7 pt. */
export const MAP_W = 420;
export const MAP_H = 260;

/** Most points one stored map may hold (keeps a cached pass small). */
export const MAX_MAP_POINTS = 6_000;

/** A polyline or ring: flat [x0, y0, x1, y1, ...] in map units. */
const Coord = z.number().int().min(-2 * MAP_W).max(3 * MAP_W);
export const LineSchema = z
  .array(Coord)
  .min(4)
  .max(2 * MAX_MAP_POINTS)
  .refine((a) => a.length % 2 === 0, "odd coordinate count");
export const PointSchema = z.tuple([Coord, Coord]);
export type Line = z.infer<typeof LineSchema>;
export type Point = z.infer<typeof PointSchema>;

export const SpotMapSchema = z.object({
  w: z.literal(MAP_W),
  h: z.literal(MAP_H),
  /** Park boundary (one or more outer rings or pieces). */
  outline: z.array(LineSchema).max(60),
  /** Roads and drives (highway=service/residential/...). */
  roads: z.array(LineSchema).max(400),
  /** Foot paths, cycle paths, tracks, steps. */
  paths: z.array(LineSchema).max(400),
  /** Creeks and ditches (lines). */
  waterways: z.array(LineSchema).max(200),
  /** Ponds and lakes (closed rings). */
  water: z.array(LineSchema).max(100),
  /** Sports pitches and courts (closed rings). */
  pitches: z.array(LineSchema).max(200),
  /** Parking lots (closed rings). */
  parking: z.array(LineSchema).max(60),
  /** The X. */
  target: PointSchema,
  /** The start marker (an entrance or parking lot), when OSM has one. */
  start: PointSchema.nullable(),
  /** Scale bar: its length in map units and its label ("100 m (330 ft)"). */
  scale: z.object({ units: z.number().positive().max(MAP_W), label: z.string().max(40) }),
});
export type SpotMap = z.infer<typeof SpotMapSchema>;

const OsmId = z.string().regex(/^(node|way|relation)\/\d{1,15}$/);

export const SpotOkSchema = z.object({
  status: z.literal("ok"),
  target: z.object({
    osmId: OsmId,
    /** S3 feature kind label, e.g. "picnic shelter", "soccer field". */
    label: z.string().max(60),
    /** OSM name, cleaned, or null. */
    name: z.string().max(80).nullable(),
    /** Code-written answer for the stub, e.g. "The picnic shelter". */
    answer: z.string().max(160),
  }),
  start: z.object({ osmId: OsmId, label: z.string().max(60) }).nullable(),
  /** Straight-line distance and compass direction from the start to the X (code-measured). */
  walk: z.object({ meters: z.number().int().min(0).max(20_000), direction: z.string().max(12) }).nullable(),
  /** The riddle printed on the kid's pass. */
  riddle: z.string().min(1).max(140),
  /** "model": the open model wrote it and it passed every check; "code": the fixed fallback line. */
  riddleBy: z.enum(["model", "code"]),
  map: SpotMapSchema,
  /** When the OSM geometry was fetched (a cached answer keeps its real time). */
  checkedAt: z.string(),
});
export type SpotOk = z.infer<typeof SpotOkSchema>;

export const SpotSchema = z.discriminatedUnion("status", [
  SpotOkSchema,
  /** No map on this pass; `message` is the exact on-screen copy (SPEC §5.4). */
  z.object({ status: z.literal("none"), message: z.string().max(240) }),
]);
export type Spot = z.infer<typeof SpotSchema>;

// ---------- copy ----------

export const SPOT_COPY = {
  /** SPEC §5.4, exact. */
  noLandmark: "No Find This Spot today: this park has no single landmark on the map (OpenStreetMap).",
  noOutline: "No Find This Spot today: this park is mapped as a single point, so there is no park outline to draw (OpenStreetMap).",
  busy: "No Find This Spot today: the OpenStreetMap server was busy and we couldn't draw the map. Make a different pass to try again.",
  slow: "No Find This Spot today: the OpenStreetMap server was too slow, so we couldn't draw the map. Make a different pass to try again.",
  attribution: "© OpenStreetMap contributors",
  /** Fixed riddle when the model's riddle failed our checks (never a guess about the place). */
  codeRiddle: (hasStart: boolean) =>
    hasStart ? "Follow the map from START to the X. What is there?" : "Use the map to find the X. What is there?",
} as const;
