/**
 * Round 8 (SEC-8-01): "Look, don't touch" in code, not only in the prompt. A printed clue, hint or riddle never tells the
 * reader to touch, pick, crush, catch, chase, pet, hold, eat, taste, poke, grab or collect anything (every age band; the
 * 13+ voices ask for "the closer mark that settles it", which can read as "handle it"). The prompt rule is unchanged.
 *
 * What counts: a contact verb used as an instruction to the reader: at the start of a sentence or after "and", "then",
 * "or" ("Find a leaf and crush it"), after "you" or "you can/could/may/should/will" ("Can you catch one?"), after "try
 * to" / "remember to", or "try touching". Also "run/use/put your fingers/hands" and "with your fingers/hands".
 * What does not: a negated verb ("Look, don't touch."), the verb used by someone else ("a place where people eat",
 * "watch dogs chase a ball"), a noun ("a touch of red", "a furry pet"), and fixed safe uses: "rails to hold on to",
 * "hold on to the rail", "hold your pass", "hold still", "catch a glimpse/sight of", "catch your breath", "feel the
 * breeze/sun/shade", "feel the boards bounce under your feet", "pick out", "pick a spot/path/bench", "lift your eyes",
 * "eat your lunch/snack". The size of a thing next to a hand ("as big as your hand") is not an instruction either.
 *
 * Pure and client-safe (no imports). Used by validate.ts (drop reason `handling`).
 */

/** Contact verbs (base form) that are an instruction when the reader is told to do them. */
const VERBS = new Set([
  "touch", "feel", "pick", "crush", "rub", "squeeze", "pinch", "taste", "eat", "lick", "catch", "chase", "pet", "hold",
  "grab", "collect", "poke", "prod", "pull", "peel", "lift", "stroke", "handle", "scoop", "squash", "shake", "feed", "uproot",
  "turn", "flip", "break",
]);
/** "-ing" forms after "try"/"go"/"start" ("try touching the bark"). */
const ING = new Map([...VERBS].map((v) => [v.endsWith("e") && !v.endsWith("ee") ? `${v.slice(0, -1)}ing` : /^(rub|pet|grab|prod|flip)$/.test(v) ? `${v}${v.at(-1)}ing` : `${v}ing`, v]));
/** Words that may sit between the trigger and the verb ("and gently crush", "you can carefully hold"). */
const ADVERBS = new Set(["gently", "carefully", "softly", "slowly", "quickly", "lightly", "now", "then", "just", "please", "go", "also", "even", "really", "first"]);
/** Words before which a verb is an instruction to the reader. */
const STARTERS = new Set(["and", "then", "or", "you", "you'll", "youll"]);
const MODALS = new Set(["can", "could", "may", "might", "should", "will", "must", "would"]);
/** "try to touch", "remember to pick": a "to" after one of these is an instruction. */
const TO_LEADS = new Set(["try", "trying", "remember", "want", "need", "able", "sure", "forget", "chance", "time", "how", "dare"]);
const ING_LEADS = new Set(["try", "go", "start", "keep", "enjoy"]);
const NEGATIONS = new Set(["don't", "dont", "do", "not", "never", "no", "without", "doesn't", "won't", "can't", "cannot", "nobody", "avoid"]);

/** Safe objects right after the verb (articles and "your" skipped): "hold still", "catch a glimpse", "feel the breeze". */
const SAFE_AFTER: Record<string, ReadonlySet<string>> = {
  hold: new Set(["on", "onto", "still", "tight", "up", "pass", "map", "sheet", "paper", "list", "page", "rail", "rails", "railing", "railings", "handrail", "handrails", "breath", "hands"]),
  catch: new Set(["glimpse", "sight", "view", "sound", "whiff", "breeze", "eye", "reflection", "shadow", "sunset", "sunrise", "light", "breath", "bus"]),
  feel: new Set(["breeze", "wind", "sun", "sunshine", "shade", "air", "warmth", "heat", "cool", "coolness", "spray", "mist", "rain", "free", "how", "like", "proud", "small", "tall"]),
  pick: new Set(["out", "spot", "place", "path", "trail", "bench", "seat", "side", "direction", "route", "favorite", "favourite", "winner", "team", "time", "day", "table"]),
  lift: new Set(["eyes", "head", "gaze", "chin"]),
  eat: new Set(["lunch", "snack", "snacks", "picnic", "meal", "breakfast", "dinner", "sandwich", "sandwiches"]),
  pull: new Set(["up"]),
  shake: new Set(["hands"]),
  turn: new Set(["left", "right", "around", "back"]),
  break: new Set(["time"]),
};
/** "turn"/"flip" are contact only with "over" soon after ("turn over a log", "flip it over"). */
const NEEDS_OVER = new Set(["turn", "flip"]);
/** "feel the boards bounce under your feet": walking on a bridge or a path is not handling anything. */
const UNDER_FEET_RE = /\b(?:under|beneath|below)\s+your\s+(?:feet|shoes|boots)\b/i;
const FILLER = new Set(["a", "an", "the", "your", "my", "its", "their", "this", "that", "one", "some", "of"]);
/**
 * "eat" is an instruction only with something to eat after it ("eat the berries", "eat one", "eat it"). A picnic place
 * clue ("Find a table to sit and eat.", "where you eat meals", "eat with your friends") is about the reader's own food.
 */
const EAT_OBJECT = new Set(["a", "an", "the", "one", "some", "it", "them", "this", "these", "those", "its", "any", "berries", "berry", "fruit", "fruits", "seeds", "nuts", "leaves", "mushrooms", "mushroom", "acorns", "acorn", "flowers", "petals", "nectar"]);
/** "run your fingers along", "with your hands": touching with the hands. */
const HANDS_RE = /\b(?:(?:run|rub|use|put|place|press|slide|trace|brush|wrap)\s+(?:your|a)\s+|with\s+(?:your|a|both)\s+)(?:fingers?|fingertips?|hands?|palms?|thumbs?)\b/i;

const words = (sentence: string): string[] => (sentence.toLowerCase().replace(/[’‘]/g, "'").match(/[a-z]+(?:'[a-z]+)?/g) ?? []);

/** The first object word after position i, skipping articles and "your" ("hold the rail" -> "rail"). */
function objectAfter(t: readonly string[], i: number): string | undefined {
  let j = i + 1;
  while (j < t.length && FILLER.has(t[j])) j++;
  return t[j];
}

/** Is the verb at position i an instruction to the reader (by what comes right before it)? */
function instructed(t: readonly string[], i: number, ing: boolean): boolean {
  let j = i - 1;
  if (ing) return j >= 0 && ING_LEADS.has(t[j]);
  while (j >= 0 && ADVERBS.has(t[j])) j--;
  if (j < 0) return true; // the sentence starts with it
  const w = t[j];
  if (w === "to") return j > 0 && TO_LEADS.has(t[j - 1]);
  if (STARTERS.has(w)) return true;
  // "you can hold", "can you hold", "who can catch"
  if (MODALS.has(w)) return j > 0 && (t[j - 1] === "you" || t[j - 1] === "who");
  if (w === "you" || (j > 0 && t[j - 1] === "you" && MODALS.has(w))) return true;
  return false;
}

/**
 * The contact instruction a text gives ("crush a leaf", "your fingers"), or null. Checked per sentence, so a safety
 * line after a full stop ("Look, don't touch.") never makes the next sentence's verb look negated.
 */
export function handlingInstruction(text: string): string | null {
  const hands = HANDS_RE.exec(text);
  if (hands) return hands[0].toLowerCase();
  for (const sentence of text.split(/(?<=[.!?;:])\s+|,\s+(?=(?:and|then|or)\b)/)) {
    const t = words(sentence);
    for (let i = 0; i < t.length; i++) {
      const base = VERBS.has(t[i]) ? t[i] : ING.get(t[i]);
      if (!base) continue;
      const ing = !VERBS.has(t[i]);
      if (!instructed(t, i, ing)) continue;
      if (t.slice(Math.max(0, i - 3), i).some((w) => NEGATIONS.has(w))) continue;
      if (NEEDS_OVER.has(base) && !t.slice(i + 1, i + 5).includes("over")) continue;
      const next = t[i + 1];
      const obj = objectAfter(t, i);
      const safe = SAFE_AFTER[base];
      if (safe && ((next !== undefined && safe.has(next)) || (obj !== undefined && safe.has(obj)))) continue;
      if (base === "feel" && UNDER_FEET_RE.test(sentence)) continue;
      if (base === "eat" && !(next !== undefined && EAT_OBJECT.has(next))) continue;
      return `${t[i]} ${t.slice(i + 1, i + 3).join(" ")}`.trim();
    }
  }
  return null;
}
