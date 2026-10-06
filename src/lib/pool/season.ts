/**
 * Season check for Wild Finds plants (audit R1-M4). A Wikipedia sentence can be true and still wrong
 * for today: "white, five-petaled flowers" is right for a Callery pear, but it blooms in spring, so in
 * October a child would hunt for flowers that are not there. The quote check can't see "when".
 *
 * Evidence (code, never the model): iNaturalist "Flowers and Fruits" annotations (controlled term 12)
 * on observations of that species within PHENOLOGY_RADIUS_KM of the park, in the current calendar
 * month, all years (src/lib/sources/inat-phenology.ts). A plant may be described by its flowers (or
 * fruit/seeds/berries) only when enough of those annotated observations show flowers (or fruit).
 * Missing evidence means "not supported": the prompt says so, and a clue that still talks about
 * flowers or fruit is dropped by validate.ts.
 */

/** iNaturalist controlled term "Flowers and Fruits" and its values (GET /v1/controlled_terms, 2026-10-05). */
export const PHENOLOGY_TERM_ID = 12;
export const PHENOLOGY_FLOWERS = 13;
export const PHENOLOGY_FRUITS = 14;

/** At least this many annotated observations must show it ... */
export const SEASON_MIN_COUNT = 3;
/** ... and at least this share of all of that species' "Flowers and Fruits" annotations this month. */
export const SEASON_MIN_SHARE = 0.2;

/** Annotated observation counts for one species in one calendar month (all years, near the park). */
export type PhenologyCount = { flowers: number; fruits: number; annotated: number };

/** What the season check knows about one plant on today's pass. */
export type Season = {
  /** 1-12, Chicago time. */
  month: number;
  /** Enough recent-month records show flowers. */
  flowers: boolean;
  /** Enough recent-month records show fruit or seeds. */
  fruit: boolean;
  /** False when the phenology lookup failed (then neither is supported). */
  known: boolean;
};

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function monthName(month: number): string {
  const name = MONTH_NAMES[month - 1];
  if (!name) throw new RangeError("month must be 1-12");
  return name;
}

/** "2026-10-05" -> 10. */
export function monthOfDay(day: string): number {
  const m = /^\d{4}-(\d{2})-\d{2}$/.exec(day);
  const n = m ? Number(m[1]) : NaN;
  if (!(n >= 1 && n <= 12)) throw new RangeError("bad day");
  return n;
}

const supported = (count: number, annotated: number) => count >= SEASON_MIN_COUNT && annotated > 0 && count / annotated >= SEASON_MIN_SHARE;

/** The season for one plant from its counts (undefined counts = no records this month = not supported). */
export function seasonFrom(count: PhenologyCount | undefined, month: number, known: boolean): Season {
  if (!known || !count) return { month, flowers: false, fruit: false, known };
  return { month, flowers: supported(count.flowers, count.annotated), fruit: supported(count.fruits, count.annotated), known };
}

/**
 * The code-written season sentence at the end of a plant's SOURCE text (audit R1 follow-up). Like the
 * OpenStreetMap counts in Park Finds, it is true, written by code from real records, and quotable: a
 * flower clue may quote "photos from this area show it with flowers". It replaced a separate
 * season="..." tag attribute, which the Llama fallback copied as its sourceQuote 22 times (run 4).
 * No digits (the number check), no name words (the leak check).
 */
export function seasonSentence(s: Season): string {
  const m = monthName(s.month);
  if (!s.known) return `We could not check its flowers or fruit for ${m}.`;
  if (s.flowers && s.fruit) return `In ${m}, iNaturalist photos from this area show it with flowers and with fruit or seeds.`;
  if (s.flowers) return `In ${m}, iNaturalist photos from this area show it with flowers, not fruit.`;
  if (s.fruit) return `In ${m}, iNaturalist photos from this area show it with fruit or seeds, not flowers.`;
  return `In ${m}, iNaturalist photos from this area do not show it with flowers or fruit.`;
}

/**
 * Flower words: any word containing these stems ("wildflowers", "blooming", "five-petaled").
 * "Flowering plant" counts too: a kid reads it as "it has flowers".
 */
const FLOWER_RE = /flower|bloom|blossom|petal/i;
/** Fruit words ("fruits", "berries", "seed pods", "acorns", "nuts"). "Fruticose" (lichens) does not match. */
const FRUIT_RE = /fruit|berr(?:y|ies)|\bseed|\bpods?\b|\bacorns?\b|\bnuts?\b/i;

export type SeasonProblem = "flowers" | "fruit";

/** Why `text` describes this plant out of season, or null when it is fine. */
export function seasonProblem(text: string, season: Season): SeasonProblem | null {
  if (!season.flowers && FLOWER_RE.test(text)) return "flowers";
  if (!season.fruit && FRUIT_RE.test(text)) return "fruit";
  return null;
}
