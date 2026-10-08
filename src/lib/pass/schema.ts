/**
 * The `POST /api/pass` contract and the stored pass, shared by the route, the pass page and the
 * browser. No server-only imports: the client validates every answer with these schemas.
 */
import "@/lib/zod-config";
import { z } from "zod";
import { OctoberBoxSchema } from "@/lib/october";
import { ExampleLinkSchema } from "@/lib/parks/schema";
import { SpotSchema } from "@/lib/spot/types";
import { TripTipsSchema } from "@/lib/tips/schema";

// ---------- age bands (SPEC F2) ----------
// The plain constants live in ./constants (no zod, for the browser's first paint, UX-4-02); re-exported here.
import { AGE_BAND_SLUGS, AGE_BANDS, MAX_VARIANTS, type AgeBand } from "./constants";
export {
  AGE_BAND_INFO,
  AGE_BAND_SLUGS,
  AGE_BAND_STORAGE_KEY,
  AGE_BANDS,
  isAdultBand,
  AUTO_RETRY_CODES,
  DEFAULT_AGE_BAND,
  isAgeBand,
  MAP_DATA_FAILURE_CODES,
  MAX_VARIANTS,
  type AgeBand,
  type AgeBandInfo,
  type Audience,
} from "./constants";

export const AgeBandSchema = z.enum(AGE_BANDS) satisfies z.ZodType<AgeBand>;

// ---------- request ----------

export const PARK_ID_PATTERN = /^(node|way|relation)\/\d{1,15}$/;

export const PassRequestSchema = z.object({
  parkId: z.string().regex(PARK_ID_PATTERN),
  ageBand: AgeBandSchema,
  /** "Make a different pass": a new variant for today (max 3 per park and age band per day). */
  fresh: z.boolean().optional(),
});
export type PassRequest = z.infer<typeof PassRequestSchema>;


// ---------- the pass ----------

export const SectionIdSchema = z.enum(["park", "wild", "lucky"]);
export type SectionId = z.infer<typeof SectionIdSchema>;

export const SectionStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), note: z.string().max(400).optional() }),
  z.object({ status: z.literal("empty"), message: z.string() }),
  z.object({ status: z.literal("unavailable"), message: z.string() }),
  z.object({ status: z.literal("off"), message: z.string() }),
]);

export const PassItemSchema = z.object({
  section: SectionIdSchema,
  clue: z.string().min(1).max(120),
  lookWhere: z.string().max(60),
  difficulty: z.enum(["easy", "medium", "hard"]),
  /** Code-written, e.g. "seen 2 times since Sep 21 · iNaturalist". */
  evidence: z.string().max(160),
  /** What it is (answer key), code-written from the source. */
  answer: z.string().max(260),
  /** Fixed, code-written safety line, or null. */
  safety: z.string().max(120).nullable(),
  source: z.enum(["OpenStreetMap", "iNaturalist", "Google reviews via SerpApi"]),
  /** Park Finds: the mapped feature kind ("basketball", "bench"), for the row icon. Absent on older passes. */
  feature: z.string().regex(/^[a-z_]{1,40}$/).optional(),
  /**
   * The pool id this find came from ("osm-playground", "inat-48662", "lucky-dogs"): the same thing in the same
   * park on any pass, so visitor reports about it add up (src/lib/reports). Absent on passes made before accounts.
   */
  ref: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).optional(),
});
export type PassItem = z.infer<typeof PassItemSchema>;

/** Pass ids are readable and deterministic: w306191453-6to10-20261005-1 (band slugs from AGE_BAND_INFO). */
export const PASS_ID_PATTERN = new RegExp(`^[nwr]\\d{1,15}-(${AGE_BAND_SLUGS.join("|")})-\\d{8}-[1-9]$`);

export const PassSchema = z.object({
  id: z.string().regex(PASS_ID_PATTERN),
  park: z.object({ id: z.string(), name: z.string(), lat: z.number(), lng: z.number() }),
  ageBand: AgeBandSchema,
  /** Chicago calendar day the pass belongs to (cache key). */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  variant: z.number().int().min(1).max(MAX_VARIANTS),
  /** How many finds this age band asks for (SPEC F2). */
  target: z.number().int().min(1).max(8),
  items: z.array(PassItemSchema).max(8),
  sections: z.object({ park: SectionStateSchema, wild: SectionStateSchema, lucky: SectionStateSchema }),
  /** Clues dropped by the server checks (SPEC §6.2), shown honestly in the footer. */
  removed: z.object({ notGrounded: z.number().int().min(0), other: z.number().int().min(0) }),
  /** Species seen nearby but left off for safety (ADR 0003). */
  safetyFiltered: z.number().int().min(0),
  parentNote: z.string().max(200),
  model: z.object({
    /** The model id the provider said answered (never a hard-coded label). */
    answered: z.string().max(100),
    attempts: z.number().int().min(1),
    latencyMs: z.number().int().min(0),
  }),
  generatedAt: z.string(),
  /** `lucky` (S6): when the Google review counts (SerpApi) were made; absent when no search answered and on older passes. */
  dataCheckedAt: z.object({ osm: z.string(), inat: z.string().nullable(), lucky: z.string().optional() }),
  /** First day of the iNaturalist window ("2026-09-21"), when iNat answered. */
  wildSince: z.string().nullable(),
  /**
   * R1 follow-up: true when the iNaturalist season lookup (flowers/fruit this month) failed for this
   * pass, so its plants were described without flowers or fruit. The pass is "degraded" (make.ts) and
   * is re-made after DEGRADED_RETRY_SEC. Absent when the check worked or there were no plants.
   */
  seasonUnknown: z.boolean().optional(),
  /** October special (S7): monarch counts, checked when the pass was made. Absent outside October and on older passes. */
  october: OctoberBoxSchema.optional(),
  /** Find This Spot (S5): the map + riddle, or why there is none. Absent on passes made before S5. */
  spot: SpotSchema.optional(),
  /**
   * Trip tips (Kevin 2026-10-08, src/lib/tips): screen only, made once with the pass from that day's forecast, the park
   * map and the sightings. Absent on passes made before trip tips (the page says so).
   */
  tripTips: TripTipsSchema.optional(),
});
export type Pass = z.infer<typeof PassSchema>;

// ---------- streamed answer (application/x-ndjson) ----------

export const PASS_STEPS = ["map", "wildlife", "clues", "check", "retry"] as const;
export const PassStepSchema = z.enum(PASS_STEPS);
export type PassStep = z.infer<typeof PassStepSchema>;

export const ApiErrorBody = z.object({
  code: z.string(),
  message: z.string(),
  retryAfter: z.number().optional(),
  /** R2-M3: a ready example pass to open instead, when the map data couldn't be read. */
  example: ExampleLinkSchema.optional(),
});


/** What we could still show when the model failed: real park data, never printed as a pass. */
export const ParkDataSchema = z.object({
  parkName: z.string(),
  items: z.array(z.object({ section: SectionIdSchema, answer: z.string(), evidence: z.string() })).max(40),
});
export type ParkData = z.infer<typeof ParkDataSchema>;

export const PassLineSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("step"), step: PassStepSchema, text: z.string() }),
  /**
   * G2: first line when the server runs a model on its own computer with the longer clock (src/lib/pass/local-clock.ts):
   * how long the page should wait (ms, at most 20 min + 10 s). Never sent with the normal clock.
   */
  z.object({ type: z.literal("clock"), local: z.literal(true), waitMs: z.number().int().positive().max(1_210_000) }),
  z.object({ type: z.literal("result"), pass: PassSchema, cached: z.boolean() }),
  /** No pass: the park has no usable data at all (SPEC §5.4 "All empty"). */
  z.object({
    type: z.literal("empty"),
    parkName: z.string(),
    message: z.string(),
    sections: z.object({ park: SectionStateSchema, wild: SectionStateSchema, lucky: SectionStateSchema }),
  }),
  z.object({ type: z.literal("error"), status: z.number().int(), error: ApiErrorBody, parkData: ParkDataSchema.optional() }),
]);
export type PassLine = z.infer<typeof PassLineSchema>;

/** Non-streamed error body (guards, limits): `{ error: {...}, parkData? }`. */
export const PassErrorResponseSchema = z.object({ error: ApiErrorBody, parkData: ParkDataSchema.optional() });

// ---------- copy (SPEC §5.4, §6.3) ----------

export const PASS_COPY = {
  allEmpty: (park: string) =>
    `No data available for ${park}. We found no mapped features or recent wildlife sightings here. Try a bigger park from the list.`,
  notAPark: "We couldn't read that park on OpenStreetMap. Pick another park from the list.",
  paused: "Clue writing is paused for today since the free budget is used. Passes made earlier still work.",
  passGone: "No data available: this pass isn't saved here anymore (passes are kept for 30 days), or the link is wrong.",
  /** SEC-7-04: a self-hosted server with a model on its own computer builds only 1-2 passes at once. */
  localBusy: "The AI on this computer is still writing another pass, and it can only do one at a time. Please try again in a minute.",
  variantLimit: `That's ${MAX_VARIANTS} different passes for this park and age today, the most we make. Print one of them, pick another park, or come back tomorrow.`,
} as const;
