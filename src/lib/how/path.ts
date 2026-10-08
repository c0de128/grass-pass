/**
 * The 10-second explainer at the top of /how-it-works (Kevin, 2026-10-08: "I want the judges to understand it
 * within 10 seconds. Be sure to include how/where AI is used along the way."). A winding trail of eight steps,
 * each tagged with what does the work. Every line is checked against the code it names:
 *
 *  1 park    src/lib/sources/nominatim.ts + overpass-parks.ts (OpenStreetMap); src/lib/geo.ts roundCoord, 2 decimals = ~1 km
 *  2 data    src/lib/sources/overpass-features.ts (map), inat.ts (WILD_WINDOW_DAYS), serpapi.ts (review mention counts)
 *  3 safety  src/lib/safety/danger-taxa.ts BLOCKED_TAXA, applied in src/lib/pool/wild.ts before the prompt is built
 *  4 write   src/lib/ai/prompt.ts + build-pass.ts: the model picks finds by id (strict JSON schema of real ids) and writes
 *            each clue, its proof quote and the Find This Spot riddle (validateSpot)
 *  5 check   src/lib/ai/validate.ts: the proof quote must be in the find's own facts; touch / pick / catch is removed
 *  6 refill  build-pass.ts: a refill call for the missing finds from unused facts, MAX_MODEL_CALLS = 3 per pass
 *  7 print   src/components/pass/PrintFit.tsx: one US Letter page, the kid's hunt on top and the answer key below
 *  8 you     the phone goes away (the site's sign-off; Kevin's footer line itself is not reworded here)
 */
import { BLOCKED_TAXA } from "@/lib/safety/danger-taxa";
import { WILD_WINDOW_DAYS } from "@/lib/sources/inat";

/** What does the work at a step: real outside data, the open model, code, or the family. */
export type PathWho = "data" | "ai" | "code" | "you";

export const PATH_WHO: Record<PathWho, { badge: string; legend: string }> = {
  data: { badge: "Real data", legend: "Real data in" },
  ai: { badge: "AI · Gemma 4", legend: "Open model writes" },
  code: { badge: "Code checks", legend: "Code checks" },
  you: { badge: "Paper out", legend: "Paper out" },
};

export type PathStep = {
  id: string;
  who: PathWho;
  title: string;
  /** One line, 12 words or fewer (tests/unit/how-path.test.tsx). */
  line: string;
  /** A short, true label on the trail between this step and the next (like "data processing" in Kevin's picture). */
  handoff?: string;
};

/** A pass makes at most this many model calls (src/lib/ai/build-pass.ts MAX_MODEL_CALLS; a unit test keeps them equal). */
export const PATH_MAX_MODEL_CALLS = 3;

export const PATH_STEPS: readonly PathStep[] = [
  {
    id: "park",
    who: "data",
    title: "Pick a park & age",
    line: "Real parks from OpenStreetMap. Shared location is rounded to about 1 km.",
  },
  {
    id: "data",
    who: "data",
    title: "Gather what's really there",
    line: `The park map, ${WILD_WINDOW_DAYS} days of iNaturalist sightings, and review mentions.`,
    handoff: "each fact keeps its source",
  },
  {
    id: "safety",
    who: "code",
    title: "Take out anything risky",
    line: `Code removes ${BLOCKED_TAXA.length} groups that bite, sting or itch.`,
    handoff: "only park facts go to the AI",
  },
  {
    id: "write",
    who: "ai",
    title: "Gemma 4 writes the clues",
    line: "Picks real finds, writes kid-sized clues, proof quotes and the spot riddle.",
  },
  {
    id: "check",
    who: "code",
    title: "Code fact-checks every clue",
    line: "Proof quote must match its source; no touch, pick or catch.",
  },
  {
    id: "refill",
    who: "ai",
    title: "Gemma 4 fills any gaps",
    line: `Clues cut? New ones from unused facts, at most ${PATH_MAX_MODEL_CALLS} calls.`,
    handoff: "only checked clues print",
  },
  {
    id: "print",
    who: "code",
    title: "One page, ready to print",
    line: "The kid's hunt on top, your answer key below. Fits one page.",
  },
  {
    id: "grass",
    who: "you",
    title: "Touch grass",
    line: "Phone in the bag, pencil in hand. Go find it.",
  },
];
