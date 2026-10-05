/**
 * A pool item is one thing a pass MAY contain, built by code from real data (SPEC F3).
 * The model only ever sees `id`, `section`, `kind` and `sourceText`; it picks ids and writes words.
 * Everything else (answer, evidence, safety line) is code-written and never comes from the model.
 */
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
 * Distinct lower-case words of a name that would give it away: whole words of 3+ letters and
 * hyphen parts of 4+ letters ("red-shouldered hawk" -> red-shouldered, shouldered, hawk), minus
 * generic category words ("tree", "bird", "eastern").
 */
export function distinctiveWords(name: string): string[] {
  const out: string[] = [];
  const clean = (w: string) => w.replace(/^'+|'+$/g, "").replace(/'s$/, "");
  for (const raw of name.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}'-]+/u)) {
    const w = clean(raw.replace(/^-+|-+$/g, ""));
    if (w.length >= 3 && !GENERIC_WORDS.has(w)) out.push(w);
    if (w.includes("-")) {
      for (const part of w.split("-").map(clean)) if (part.length >= 4 && !GENERIC_WORDS.has(part)) out.push(part);
    }
  }
  return [...new Set(out)];
}
