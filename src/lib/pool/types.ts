/**
 * A pool item is one thing a pass MAY contain, built by code from real data (SPEC F3).
 * The model only ever sees `id`, `section`, `kind` and `sourceText`; it picks ids and writes words.
 * Everything else (answer, evidence, safety line) is code-written and never comes from the model.
 */
import type { Season } from "./season";

export type Section = "park" | "wild" | "lucky";

export type PoolItem = {
  /** Stable id the model must return, e.g. "osm-basketball" or "inat-130192". */
  id: string;
  section: Section;
  /** Short kind for the prompt, e.g. "basketball court", "plant", "bird". */
  kind: string;
  /** The ONLY text a clue may be grounded in (the `sourceQuote` must be a substring of it). */
  sourceText: string;
  /** What it is, for the parent's answer key, e.g. "Maximilian sunflower (Helianthus maximiliani)". */
  answer: string;
  /** Code-written evidence line, e.g. "seen 2 times since Sep 21 · iNaturalist". */
  evidence: string;
  /** Data source name for the pass, e.g. "OpenStreetMap" or "iNaturalist". */
  source: "OpenStreetMap" | "iNaturalist";
  /** Words a clue must not contain (it would give the answer away). Lower case. */
  nameWords: string[];
  /** Fixed safety line printed with the item, or null. */
  safety: string | null;
  /** True for things that stay put (landmarks, plants, fungi). */
  stationary: boolean;
  /** iNaturalist taxon (Wild Finds only), used for the second danger check. */
  taxon?: { taxonId: number; ancestorIds: number[] };
  /** Plants only (R1-M4): whether flowers / fruit are in season this month, from iNaturalist annotations. */
  season?: Season;
  /**
   * Park Finds only (audit R2-M5): what the map count counts. `of` = the singular nouns a count clue may
   * count (the whole thing, never a part: fields, not goals); `n` = the count in the source, or null when
   * the source states no count of 2 or more (one thing, or a creek), so no count clue is allowed.
   */
  count?: { of: string[]; n: number | null };
  /**
   * Wild Finds only (content tuning 2026-10-06): how many looks-like words its source has OUTSIDE the
   * species' own names (`looksOutsideNames`). 0 = a clue can only describe it with a name word or a
   * generic fact. Used to order the pool and to spot low-data pools (prompt.ts `planRequest`).
   */
  looks?: number;
};

export type SectionState =
  | { status: "ok" }
  /** No usable data: the exact SPEC §5.4 "No data available: ..." copy. */
  | { status: "empty"; message: string }
  /** The source didn't answer. */
  | { status: "unavailable"; message: string }
  /** Not switched on for this pass (Lucky Finds without SerpApi). */
  | { status: "off"; message: string };

/** Words that only name a category ("a flower", "a bird") and do not give the answer away. */
export const GENERIC_WORDS = new Set([
  "tree",
  "trees",
  "flower",
  "plant",
  "grass",
  "weed",
  "vine",
  "bush",
  "shrub",
  "fern",
  "moss",
  "lichen",
  "sedge",
  "rush",
  "reed",
  "herb",
  "bird",
  "bug",
  "beetle",
  "butterfly",
  "moth",
  "fly",
  "bee",
  "ant",
  "spider",
  "snake",
  "lizard",
  "frog",
  "toad",
  "turtle",
  "fish",
  "duck",
  "mushroom",
  "fungus",
  "snail",
  "slug",
  "worm",
  "dragonfly",
  "damselfly",
  "grasshopper",
  "cricket",
  "common",
  "eastern",
  "western",
  "northern",
  "southern",
  "american",
  "texas",
  "little",
  "great",
  "greater",
  "lesser",
  "small",
  "large",
  "giant",
  "annual",
  "white",
  "black",
  "brown",
  "green",
  "yellow",
  "orange",
  "red",
  "blue",
  "purple",
  "golden",
  "golden-eye",
  "spotted",
  "dotted",
  "hairy",
  "wild",
]);

/**
 * Small words that never give an answer away, in any name ("Sheila and Jody Grant Children's Park"
 * must not make "and" or "the" a forbidden word: the S9 eval dropped >= 8 good clues that way).
 */
export const NAME_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "of",
  "at",
  "in",
  "on",
  "for",
  "with",
  "to",
  "by",
  "from",
  "or",
  "near",
  "into",
  "over",
  "under",
  "its",
  "his",
  "her",
  "their",
  "our",
  "your",
  "de",
  "la",
  "el",
  "del",
  "los",
  "las",
  "san",
  "st",
  "mt",
  "saint",
]);

/**
 * Generic place words inside OpenStreetMap names ("Rowlett Creek Trail", "Bob Woodruff Park (North)").
 * They name where something is, not what it is. When the place word IS the answer (a pond, a creek),
 * the feature kind's own nameWords (overpass-features.ts) still forbid it.
 */
export const PLACE_WORDS = new Set([
  "park",
  "parks",
  "trail",
  "trails",
  "path",
  "area",
  "center",
  "centre",
  "preserve",
  "nature",
  "creek",
  "lake",
  "pond",
  "river",
  "branch",
  "north",
  "south",
  "east",
  "west",
  "upper",
  "lower",
  "old",
  "new",
  "city",
  "county",
  "community",
  "children",
  "kids",
  "family",
  "memorial",
  "loop",
  // R1 follow-up (run 4: "near a garden" for "Jeanne's Pavilion at the Shadow Garden" was counted as a
  // leak of a picnic shelter). Landscape words in a name say where the thing is, not what it is.
  "garden",
  "gardens",
  "meadow",
  "meadows",
  "field",
  "fields",
  "grove",
  "hill",
  "hills",
  "woods",
  "forest",
  "ridge",
  "point",
  "plaza",
  "square",
  "commons",
  "spring",
  "springs",
]);

/**
 * R1 follow-up: the words of a feature kind's own label that its nameWords do NOT forbid ("court" for
 * a tennis court, "field" for a soccer field). The design lets a clue say them ("Count the hoops on the
 * court."), so an OpenStreetMap name that contains them ("Taube Family Championship Court") must not
 * forbid them either. Words the kind does forbid stay forbidden: "Baseball Diamonds" still blocks
 * "diamond" (a real giveaway for a baseball field, and in that kind's nameWords).
 */
export function kindLabelWords(kind: { label: string; plural: string; nameWords: readonly string[] }): Set<string> {
  const forbidden = new Set(kind.nameWords.flatMap((w) => w.toLowerCase().split(/[^\p{L}\p{N}]+/u)));
  const words = `${kind.label} ${kind.plural}`.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return new Set(words.filter((w) => w.length > 0 && !forbidden.has(w)));
}

/**
 * Distinct lower-case words of a name that would give it away: whole words of 3+ letters and
 * hyphen parts of 4+ letters ("red-shouldered hawk" -> red-shouldered, shouldered, hawk), minus
 * generic category words ("tree", "bird", "eastern") and stopwords ("and", "the").
 * `place: true` (OpenStreetMap names of park features) also drops generic place words ("park", "trail").
 * `allowed` drops words the caller allows (a feature kind's own label words, `kindLabelWords`).
 */
export function distinctiveWords(name: string, opts: { place?: boolean; allowed?: ReadonlySet<string> } = {}): string[] {
  const out: string[] = [];
  const skip = (w: string) =>
    GENERIC_WORDS.has(w) || NAME_STOPWORDS.has(w) || (opts.place === true && PLACE_WORDS.has(w)) || opts.allowed?.has(w) === true;
  const clean = (w: string) => w.replace(/^'+|'+$/g, "").replace(/'s$/, "");
  for (const raw of name.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}'-]+/u)) {
    const w = clean(raw.replace(/^-+|-+$/g, ""));
    if (w.length >= 3 && !skip(w)) out.push(w);
    if (w.includes("-")) {
      for (const part of w.split("-").map(clean)) if (part.length >= 4 && !skip(part)) out.push(part);
    }
  }
  return [...new Set(out)];
}
