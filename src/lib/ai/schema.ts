/**
 * Model output schemas (SPEC §6.2). OWNER: S3 (Builder A); S5 owns the `spot` part (PM, 2026-10-05).
 * S5: when code picks a Find This Spot target, the request schema REQUIRES `spot` with `targetId` an
 * enum of that one id (src/lib/spot/pick-target.ts); `items` keeps minItems = maxItems = n either way.
 * The riddle gets the same checks as a clue (validate.ts `validateSpot`).
 *
 * Three layers:
 * 1. `PassItemDraft` / `SpotDraft` / `PassDraft`: the spec's zod schemas, applied PER ITEM in
 *    validate.ts so one bad item is dropped instead of sinking the whole pass.
 * 2. `passRequestSchema()`: the strict schema for ONE request, built by code from the pool and the
 *    mix: `items` has exactly n entries (`minItems` = `maxItems` = n) and `itemId` is an enum of the real
 *    pool ids. S8c (M7, answer tokens): `section` is NOT asked for; code fills it from the pool item
 *    (validate.ts) and the quote is capped at QUOTE_WIRE_MAX. Its JSON Schema (`passJsonSchema()`) is
 *    generated from the same zod source and sent with `strict: true`. Measured 2026-10-05: without
 *    minItems, Gemma 4 31B on DO returned `{"cards":[]}` in 3 of 7 runs.
 * 3. `PassDraftEnvelope`: the lenient shape the answer is first parsed with (so a 121-character clue
 *    costs one item, not a retry).
 */
import "@/lib/zod-config";
import { z } from "zod";

export const Difficulty = z.enum(["easy", "medium", "hard"]);
export const SectionEnum = z.enum(["park", "wild", "lucky"]);

export const CLUE_MIN = 8;
export const CLUE_MAX = 120;
export const LOOK_WHERE_MAX = 60;
export const QUOTE_MIN = 4;
export const QUOTE_MAX = 240;
/**
 * S8c (M7): the request schema caps a quote at this many characters. A grounding quote needs a short
 * phrase (median 55 characters, 10 words, in the 2026-10-05-2 run); long whole-sentence quotes were
 * where the glued-field glitch happened. A quote cut at this length by the server's JSON grammar is
 * still checked as a substring like any other.
 */
export const QUOTE_WIRE_MAX = 90;
export const RIDDLE_MAX = 140;
export const PARENT_NOTE_MAX = 200;
/** Smallest pass we print (a tiny park with 3 real finds is still honest; fewer is "all empty"). */
export const MIN_PASS_ITEMS = 3;
export const MAX_PASS_ITEMS = 8;
/**
 * Audit R2-M5: the request asks for up to this many items MORE than the pass prints, and code keeps the
 * first n that pass every check. The stricter clue checks (generic, wrong count, copies) drop more
 * items; asking for one spare costs about 60 answer tokens, a second call costs a whole call (the smoke
 * run before this change needed a second call on 3 of 6 passes).
 */
export const ASK_EXTRA = 1;
/**
 * The most spares any request asks for (the request schema's size check). Content tuning (2026-10-06):
 * only low-data pools get ASK_EXTRA spares now; other pools ask for exactly n (prompt.ts `sparesFor`).
 */
export const ASK_EXTRA_MAX = ASK_EXTRA;

export const PassItemDraft = z.object({
  itemId: z.string().min(1).max(64), // must exist in the pool
  section: SectionEnum, // must match the pool item
  clue: z.string().min(CLUE_MIN).max(CLUE_MAX),
  lookWhere: z.string().max(LOOK_WHERE_MAX), // "near the water", "on tree bark"
  sourceQuote: z.string().min(QUOTE_MIN).max(QUOTE_MAX), // substring of the pool item's sourceText
  difficulty: Difficulty,
});
export type PassItemDraft = z.infer<typeof PassItemDraft>;

export const SpotDraft = z.object({
  targetId: z.string(), // must equal the code-picked target
  riddle: z.string().min(CLUE_MIN).max(RIDDLE_MAX),
  sourceQuote: z.string().min(QUOTE_MIN).max(QUOTE_MAX),
});
export type SpotDraft = z.infer<typeof SpotDraft>;

export const PassDraft = z.object({
  items: z.array(PassItemDraft).min(MIN_PASS_ITEMS).max(MAX_PASS_ITEMS),
  spot: SpotDraft.nullable(),
  parentNote: z.string().max(PARENT_NOTE_MAX), // no digits allowed (code check)
});
export type PassDraft = z.infer<typeof PassDraft>;

/** P1 vision check (not used in S3). */
export const PhotoCheck = z.object({
  labels: z.array(z.string().max(40)).max(10),
  peoplePresent: z.boolean(),
  targetVisible: z.boolean(),
});

/** First parse of the model's JSON: right overall shape, items checked one by one later. */
export const PassDraftEnvelope = z.object({
  items: z.array(z.unknown()).max(20), // >= MAX_PASS_ITEMS + ASK_EXTRA_MAX
  spot: z.unknown().optional(),
  parentNote: z.unknown().optional(),
});
export type PassDraftEnvelope = z.infer<typeof PassDraftEnvelope>;

type NonEmpty<T> = [T, ...T[]];

export type RequestSchemaOptions = {
  /** Exactly this many items (the mix computed by code). */
  n: number;
  /** Real pool ids; the model can only answer with these. */
  itemIds: NonEmpty<string>;
  /** S5: the code-picked Find This Spot target, or null (no `spot` asked for). */
  spotTargetId: string | null;
};

/** The strict zod schema for one request (source of the JSON Schema sent to the model). */
export function passRequestSchema(o: RequestSchemaOptions) {
  if (!Number.isInteger(o.n) || o.n < 1 || o.n > MAX_PASS_ITEMS + ASK_EXTRA_MAX) throw new RangeError("n out of range");
  const item = z.object({
    itemId: z.enum(o.itemIds),
    clue: z.string().min(CLUE_MIN).max(CLUE_MAX),
    lookWhere: z.string().max(LOOK_WHERE_MAX),
    sourceQuote: z.string().min(QUOTE_MIN).max(QUOTE_WIRE_MAX),
    difficulty: Difficulty,
  });
  // R2-M5: no parentNote in the request: the model's notes were filler ("Have fun exploring nature with
  // your child!"); code writes the grown-up's tip from the pass's real items (validate.ts parentNoteFor).
  const base = {
    items: z.array(item).length(o.n),
  };
  if (o.spotTargetId === null) return z.object(base);
  return z.object({
    ...base,
    spot: z.object({
      targetId: z.enum([o.spotTargetId]),
      riddle: z.string().min(CLUE_MIN).max(RIDDLE_MAX),
      sourceQuote: z.string().min(QUOTE_MIN).max(QUOTE_WIRE_MAX),
    }),
  });
}

/**
 * JSON Schema for `response_format.json_schema.schema` (strict). Generated from the zod schema
 * above; `$schema` is removed (some OpenAI-compatible servers reject unknown top-level keys).
 * Throws if the generated schema ever loses minItems/maxItems on `items`.
 */
export function passJsonSchema(o: RequestSchemaOptions): Record<string, unknown> {
  const generated = z.toJSONSchema(passRequestSchema(o), { target: "draft-7" }) as Record<string, unknown>;
  const { $schema: _drop, ...schema } = generated;
  void _drop;
  const items = (schema.properties as Record<string, Record<string, unknown>> | undefined)?.items;
  if (!items || items.minItems !== o.n || items.maxItems !== o.n) {
    throw new Error("pass JSON schema lost minItems/maxItems");
  }
  return schema;
}
