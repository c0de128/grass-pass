/**
 * Trip tips, step 3: the code checks on every tip the model writes (the model never decides what is safe or true).
 *
 * SAFETY (drop the tip): a web address, @handle or phone number (src/lib/safety/contact.ts); an instruction to touch,
 * pick, catch, feed or hold something (src/lib/safety/handling.ts, the same check as the clues); going into the water
 * (swim, wade, splash in the creek...); drinking from a creek or pond; leaving the path; medicine or doses; eating
 * anything found in the park.
 *
 * GROUNDING (drop the tip): every place, weather or wildlife word in a tip must be backed by a real input fact
 * (`TOPICS`: "creek" needs a mapped creek, "rain" a rain chance of 30% or more, "ticks" a tick sighting...), and every
 * number in it must appear in a fact. The tip must cite a fact id from the input; its "why" line is that fact's text,
 * written by code. If the cited fact is about something else but another fact backs the tip, that fact is used.
 *
 * VOICE: a 13+ pass is held by the reader, so a tip that talks about "the kids" is dropped there.
 */
import { hasUrlOrMarkup } from "@/lib/safety/contact";
import { handlingInstruction } from "@/lib/safety/handling";
import { isAdultBand, type AgeBand } from "@/lib/pass/constants";
import type { FactTag, TipFact } from "./facts";
import { MAX_TIPS, TIP_ICONS, TIP_MAX, type TipIcon, type TripTip } from "./schema";

/** A tip as the model answers it (lenient: each one is checked on its own). */
export type TipDraft = { tip?: unknown; factId?: unknown; icon?: unknown };

export type TipDropReason = "shape" | "unknown_fact" | "unsafe" | "contact" | "handling" | "not_grounded" | "number" | "voice" | "duplicate";

/** A topic word in a tip, and the fact tags that back it (any one is enough). */
type Topic = { name: string; re: RegExp; backedBy: readonly FactTag[] };

export const TOPICS: readonly Topic[] = [
  // "warm jackets" is cold-weather advice, "stay cool" is hot-weather advice: each is left to its own topic.
  { name: "heat", re: /\b(hot|heat|warm(?:est|er)?(?!\s+(?:jackets?|coats?|clothes|clothing|layers?|hats?|sweaters?|gloves|socks))|sweaty|sweating|overheat\w*)\b/i, backedBy: ["hot", "warm", "afternoon_heat"] },
  { name: "cold", re: /\b(cold|chilly|(?<!stay |keep )cool(?:er|est)?(?!\s+(?:off|down))|coats?|jackets?|sweaters?|sweatshirts?|hoodies?|gloves|mittens|layers?)\b/i, backedBy: ["cold", "chilly", "layers", "cool_morning", "wind", "rain"] },
  { name: "rain", re: /\b(rain|rainy|raining|rainfall|umbrellas?|raincoats?|rain jackets?|ponchos?|wet(?!\s+wipes?)|puddles?)\b/i, backedBy: ["rain", "storm"] },
  { name: "mud", re: /\b(mud|muddy)\b/i, backedBy: ["rain", "storm", "creek", "water"] },
  { name: "storm", re: /\b(storms?|stormy|thunder\w*|lightning)\b/i, backedBy: ["storm"] },
  { name: "sun", re: /\b(sunscreen|sunblock|sunburn\w*|sunglasses|sunny|uv|sun)\b/i, backedBy: ["uv", "uv_high", "clear", "hot", "warm"] },
  { name: "shade", re: /\b(shade|shady|shaded)\b/i, backedBy: ["shelter", "shade_trees"] },
  { name: "shelter", re: /\b(shelters?|pavilions?|gazebos?)\b/i, backedBy: ["shelter"] },
  { name: "wind", re: /\b(wind\w*|breez\w*|gusts?|gusty)\b/i, backedBy: ["wind"] },
  { name: "dark", re: /\b(sunset|dark|dusk|nightfall)\b/i, backedBy: ["sunset"] },
  { name: "creek", re: /\b(creeks?|streams?|rivers?|brooks?)\b/i, backedBy: ["creek"] },
  { name: "pond", re: /\b(ponds?|lakes?)\b/i, backedBy: ["water"] },
  { name: "waterside", re: /\b(shore\w*|banks?|water's edge|waterside)\b/i, backedBy: ["creek", "water"] },
  { name: "fountain", re: /\b(fountains?|refill\w*)\b/i, backedBy: ["drinking_water", "no_drinking_water"] },
  { name: "restroom", re: /\b(restrooms?|bathrooms?|toilets?|potty|loo)\b/i, backedBy: ["restroom", "no_restroom"] },
  { name: "playground", re: /\b(playgrounds?|swings?|slides?)\b/i, backedBy: ["playground"] },
  { name: "splash", re: /\bsplash pads?\b/i, backedBy: ["splash_pad"] },
  { name: "picnic", re: /\b(picnic\w*|tables?)\b/i, backedBy: ["picnic", "shelter"] },
  { name: "bench", re: /\bbench(?:es)?\b/i, backedBy: ["bench"] },
  { name: "bridge", re: /\bbridges?\b/i, backedBy: ["bridge"] },
  { name: "dogs", re: /\b(dogs?|dog park)\b/i, backedBy: ["dogs"] },
  { name: "trails", re: /\b(trails?)\b/i, backedBy: ["paths", "nature"] },
  { name: "mosquito", re: /\bmosquito\w*\b/i, backedBy: ["mosquito"] },
  { name: "tick", re: /\bticks?\b/i, backedBy: ["tick"] },
  { name: "chigger", re: /\bchiggers?\b/i, backedBy: ["chigger"] },
  { name: "bugs", re: /\b(bug ?spray|insect repellent|repellent|bugs?|insects?|bug bites?)\b/i, backedBy: ["mosquito", "tick", "chigger", "fire_ant"] },
  { name: "poison_ivy", re: /\bpoison (?:ivy|oak|sumac)\b/i, backedBy: ["poison_ivy"] },
  { name: "ants", re: /\b(ants?|ant hills?|ant mounds?|mounds?)\b/i, backedBy: ["fire_ant"] },
  { name: "snake", re: /\bsnakes?\b/i, backedBy: ["snake"] },
  { name: "wasp", re: /\b(wasps?|bees?|hornets?|yellow ?jackets?|stings?|stinging)\b/i, backedBy: ["wasp", "stinging_plant", "caterpillar", "fire_ant"] },
  { name: "nettle", re: /\bnettles?\b/i, backedBy: ["stinging_plant"] },
  { name: "caterpillar", re: /\bcaterpillars?\b/i, backedBy: ["caterpillar"] },
  { name: "tall_grass", re: /\b(tall grass|long grass|brush)\b/i, backedBy: ["tick", "chigger", "nature"] },
  { name: "fog", re: /\b(fog|foggy|mist)\b/i, backedBy: ["fog"] },
  { name: "winter", re: /\b(snow\w*|ice|icy|slippery|frost\w*)\b/i, backedBy: ["winter", "rain"] },
  { name: "alert", re: /\b(alerts?|warnings?|advisory|advisories)\b/i, backedBy: ["alert"] },
  { name: "nature", re: /\b(preserve|reserve|wild ?life)\b/i, backedBy: ["nature", "poison_ivy", "tick", "snake"] },
];

/** Advice we never give, whatever the model says (each a full-word pattern). */
const UNSAFE: readonly RegExp[] = [
  // Into the water.
  /\b(swim\w*|wad(?:e|ing)|splash(?:ing)? (?:in|into|around in)|dip (?:your|their)|jump in|get in(?:to)? the water|into the (?:creek|stream|pond|lake|river|water)|paddl\w*|kayak\w*|canoe\w*|rock[- ]hop\w*)\b/i,
  // Drinking from it.
  /\bdrink\w* (?:from|out of) (?:the |a )?(?:creek|stream|pond|lake|river|fountain in the pond)\b/i,
  // Leaving the path.
  /\b(off[- ]trail|off the (?:path|trail)s?|leave the (?:path|trail)|shortcuts?|bushwhack\w*|explore the woods|into the woods|cross the (?:creek|stream))\b/i,
  // Medicine and doses (a tip is never medical advice).
  /\b(\d+\s?mg|milligrams?|doses?|dosage|ibuprofen|acetaminophen|tylenol|advil|motrin|aspirin|benadryl|antihistamines?|medicines?|medications?|epipens?|epinephrine|inhalers?|pills?|deet\b)/i,
  // Eating or picking what grows there, and wildlife contact the handling check may phrase differently.
  /\b(forag\w*|berries|mushrooms|edible|feed(?:ing)? (?:the )?(?:ducks?|birds?|geese|squirrels?|animals?|fish|turtles?)|pet the|hold (?:a|the) (?:snake|frog|toad|turtle|lizard))\b/i,
];

/** A kid's grown-up is the reader on 4-13 passes; on a 13+ pass the reader holds it alone. */
const KID_WORDS = /\b(kids?|kiddos?|child(?:ren)?|little ones?|toddlers?|your young\w*|grown-?ups?)\b/i;

const norm = (s: string) => s.normalize("NFKC").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();

/** Topics the tip talks about. */
export function topicsIn(tip: string): Topic[] {
  return TOPICS.filter((t) => t.re.test(tip));
}

/** Numbers in a text ("88°F" -> 88; "7:01 PM" -> 7, 01; "40%" -> 40). */
const numbersIn = (s: string) => s.match(/\d+/g) ?? [];

export type TipCheck = { kept: TripTip[]; drops: Partial<Record<TipDropReason, number>>; returned: number };

/** Why a tip is unsafe (the first rule it breaks), or null. */
export function unsafeTip(tip: string): "contact" | "handling" | "unsafe" | null {
  if (hasUrlOrMarkup(tip)) return "contact";
  if (handlingInstruction(tip)) return "handling";
  if (UNSAFE.some((re) => re.test(tip))) return "unsafe";
  return null;
}

/**
 * Check the model's tips against the facts it was given. Keeps at most MAX_TIPS, in the model's order. `why` is always
 * the code-written text of a real fact.
 */
export function checkTips(drafts: readonly TipDraft[], facts: readonly TipFact[], band: AgeBand): TipCheck {
  const drops: TipCheck["drops"] = {};
  const drop = (r: TipDropReason) => {
    drops[r] = (drops[r] ?? 0) + 1;
  };
  const byId = new Map(facts.map((f) => [f.id, f]));
  const allTags = new Set(facts.flatMap((f) => f.tags));
  const allNumbers = new Set(facts.flatMap((f) => numbersIn(f.text).map((n) => String(Number(n)))));
  const seen = new Set<string>();
  const kept: TripTip[] = [];
  for (const d of drafts) {
    if (typeof d.tip !== "string" || typeof d.factId !== "string" || typeof d.icon !== "string" || !(TIP_ICONS as readonly string[]).includes(d.icon)) {
      drop("shape");
      continue;
    }
    const tip = norm(d.tip).replace(/\.$/, "");
    if (tip.length < 3 || tip.length > TIP_MAX) {
      drop("shape");
      continue;
    }
    const cited = byId.get(d.factId);
    if (!cited) {
      drop("unknown_fact");
      continue;
    }
    const unsafe = unsafeTip(tip);
    if (unsafe) {
      drop(unsafe);
      continue;
    }
    if (isAdultBand(band) && KID_WORDS.test(tip)) {
      drop("voice");
      continue;
    }
    if (numbersIn(tip).some((n) => !allNumbers.has(String(Number(n))))) {
      drop("number");
      continue;
    }
    const topics = topicsIn(tip);
    if (topics.some((t) => !t.backedBy.some((tag) => allTags.has(tag)))) {
      drop("not_grounded");
      continue;
    }
    // The why: the cited fact when it backs one of the tip's topics (or the tip names none), else the first fact that does.
    const backs = (f: TipFact) => topics.some((t) => t.backedBy.some((tag) => f.tags.includes(tag)));
    const why = topics.length === 0 || backs(cited) ? cited : facts.find(backs);
    if (!why) {
      drop("not_grounded");
      continue;
    }
    const key = tip.toLowerCase();
    if (seen.has(key)) {
      drop("duplicate");
      continue;
    }
    seen.add(key);
    kept.push({ tip, why: why.text, icon: d.icon as TipIcon });
    if (kept.length >= MAX_TIPS) break;
  }
  return { kept, drops, returned: drafts.length };
}
