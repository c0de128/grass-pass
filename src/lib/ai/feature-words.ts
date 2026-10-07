/**
 * Bench/shelter fix (2026-10-07): a Park Find clue must be about ITS OWN item. Two complete Celebration Park passes
 * (warm-up, gemma-4-31B-it) printed "Spot a place with a roof and pillars where people eat." and "Spot me! I have
 * pillars holding up a roof to keep you dry in the rain." with the answer "Benches". The roof and pillars came from the
 * picnic shelter's facts (the Find This Spot target, sent in the same prompt for the riddle); the bench's own fact sheet
 * says nothing about a roof. The proof quote was a real bench phrase, so grounding passed.
 *
 * Each word below is a thing a child would look for that marks one kind of built feature (a roof and pillars are a
 * shelter; a hoop is a basketball court). A Park Find clue that names one of these words is dropped
 * (`other_feature`) when the word belongs to other kinds only AND is not in the item's own SOURCE. The item's own
 * SOURCE always wins ("the top of the play tower" in a playground's facts allows "tower" in its clue). Only words
 * that clearly point at another feature are listed; general words (path, water, seat, grass, post) are not.
 */
import type { FeatureKind } from "@/lib/sources/overpass-features";

/** Same rule as validate.ts `singularWord` (kept here so validate.ts can import this module without a cycle). */
function singularWord(word: string): string {
  const w = word.toLowerCase();
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (/(?:ch|sh|x|ss|z)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

/** Signature word (singular, lower case) -> the feature kinds it belongs to. */
export const FEATURE_SIGNATURE_WORDS: Readonly<Record<string, readonly FeatureKind[]>> = {
  // The picnic shelter (the Celebration case).
  roof: ["shelter"],
  pillar: ["shelter"],
  pavilion: ["shelter"],
  canopy: ["shelter"],
  gazebo: ["shelter"],
  shelter: ["shelter"],
  table: ["picnic_table", "shelter"],
  // Courts and fields.
  hoop: ["basketball"],
  backboard: ["basketball"],
  racket: ["tennis", "pickleball"],
  racquet: ["tennis", "pickleball"],
  paddle: ["pickleball"],
  infield: ["baseball"],
  dugout: ["baseball"],
  pitcher: ["baseball"],
  goalpost: ["football"],
  // Play.
  ladder: ["playground", "slide", "climbing"],
  sandbox: ["sandbox"],
  seesaw: ["seesaw"],
  // Food and water.
  grill: ["bbq"],
  grate: ["bbq"],
  coal: ["bbq"],
  cooker: ["bbq"],
  // A decorative fountain can have a spout too (round-6 r7 test input "the spout you can hear splashing").
  spout: ["drinking_water", "fountain"],
  // Other built things.
  leash: ["dog_park"],
  lane: ["track"],
  flag: ["flagpole"],
  plaque: ["historic"],
};

/** The feature kind of a Park Find pool id ("osm-picnic-table" -> "picnic_table"), or null for any other id. */
export function featureKindOfId(id: string): FeatureKind | null {
  if (!id.startsWith("osm-")) return null;
  return id.slice(4).replace(/-/g, "_") as FeatureKind;
}

const wordsOf = (text: string) => (text.toLowerCase().match(/\p{L}+/gu) ?? []).map(singularWord);

/**
 * The first word of `clue` that marks another kind of feature and is not in the item's own SOURCE, or null.
 * Only Park Finds are checked (Wild and Lucky clues describe living things and come and go).
 */
export function otherFeatureWord(clue: string, item: { id: string; section: string; sourceText: string }): string | null {
  if (item.section !== "park") return null;
  const own = featureKindOfId(item.id);
  const ownWords = new Set(wordsOf(item.sourceText));
  for (const w of wordsOf(clue)) {
    const kinds = FEATURE_SIGNATURE_WORDS[w];
    if (!kinds) continue;
    if (own !== null && kinds.includes(own)) continue;
    if (ownWords.has(w)) continue;
    return w;
  }
  return null;
}
