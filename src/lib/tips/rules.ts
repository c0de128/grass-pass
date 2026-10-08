/**
 * Trip tips, the fallback: a short code-written list from the SAME real facts (src/lib/tips/facts.ts), shown when the
 * model can't help (no answer, too slow, no key, today's AI budget used, or too few of its tips passed the checks). The
 * page labels it "Basic tips from the forecast and park map (<why>)". Deterministic: the same facts give the same list.
 *
 * Each rule fires only when a fact backs it, and its "why" is that fact's text. Kid bands talk to the grown-up planning
 * the trip; 13+ talks to the person holding the pass (src/lib/pass/audience.ts).
 */
import { isAdultBand, type AgeBand } from "@/lib/pass/constants";
import type { FactTag, TipFact, TipFacts } from "./facts";
import { MAX_TIPS, type TipIcon, type TripTip } from "./schema";

type Rule = {
  /** The first fact with one of these tags backs the tip (in this order). */
  tags: readonly FactTag[];
  icon: TipIcon;
  kid: string | ((f: TipFact) => string);
  adult: string | ((f: TipFact) => string);
};

/** "Thunderstorms forecast from about 3 PM" -> "3 PM". */
const timeIn = (text: string): string | null => /(\d{1,2}(?::\d{2})? [AP]M)/.exec(text)?.[1] ?? null;

/** In priority order: weather safety first, then comfort, then the park, then the pass. */
const RULES: readonly Rule[] = [
  {
    tags: ["storm"],
    icon: "time",
    kid: (f) => (timeIn(f.text) ? `Plan to be home before ${timeIn(f.text)}` : "Check the sky and head home if you hear thunder"),
    adult: (f) => (timeIn(f.text) ? `Plan to be out of the park before ${timeIn(f.text)}` : "Head indoors if you hear thunder"),
  },
  { tags: ["alert"], icon: "time", kid: "Read the official weather alert before you go", adult: "Read the official weather alert before you go" },
  { tags: ["rain"], icon: "umbrella", kid: "Pack rain jackets or an umbrella", adult: "Pack a rain jacket or an umbrella" },
  { tags: ["hot", "afternoon_heat"], icon: "water", kid: "Bring plenty of water for everyone", adult: "Bring plenty of water" },
  { tags: ["no_drinking_water"], icon: "water", kid: "Bring water bottles from home", adult: "Bring a water bottle from home" },
  { tags: ["afternoon_heat"], icon: "time", kid: "Go early, before the afternoon heat", adult: "Go early, before the afternoon heat" },
  { tags: ["uv_high"], icon: "hat", kid: "Pack sun hats for everyone", adult: "Wear a sun hat" },
  { tags: ["uv"], icon: "sunscreen", kid: "Put sunscreen on everyone before you go", adult: "Put on sunscreen before you go" },
  { tags: ["cold"], icon: "jacket", kid: "Bundle up: coats, hats and gloves", adult: "Wear a warm coat, hat and gloves" },
  { tags: ["chilly", "wind"], icon: "jacket", kid: "Bring a jacket for each kid", adult: "Bring a jacket" },
  { tags: ["layers", "cool_morning"], icon: "layers", kid: "Dress the kids in layers they can peel off", adult: "Dress in layers you can peel off" },
  {
    tags: ["tick", "mosquito", "chigger"],
    icon: "bugspray",
    kid: (f) => (f.tags.includes("tick") ? "Use bug spray and check for ticks afterward" : "Use bug spray before the hunt"),
    adult: (f) => (f.tags.includes("tick") ? "Use bug spray and check for ticks afterward" : "Use bug spray before you start"),
  },
  { tags: ["poison_ivy"], icon: "shoes", kid: "Wear long pants and closed-toe shoes", adult: "Wear long pants and closed-toe shoes" },
  { tags: ["fire_ant", "snake", "stinging_plant", "caterpillar"], icon: "shoes", kid: "Wear closed-toe shoes and watch where you step", adult: "Wear closed-toe shoes and watch where you step" },
  { tags: ["creek", "water"], icon: "shoes", kid: "Wear closed-toe shoes for the walk by the water", adult: "Wear closed-toe shoes for the walk by the water" },
  { tags: ["drinking_water"], icon: "water", kid: "Bring bottles to refill at the drinking fountain", adult: "Bring a bottle to refill at the drinking fountain" },
  { tags: ["no_restroom"], icon: "restroom", kid: "Use a restroom before you leave home", adult: "Use a restroom before you leave home" },
  { tags: ["restroom"], icon: "restroom", kid: "Find the restroom first, before the hunt starts", adult: "Find the restroom first, before you start" },
  { tags: ["shelter"], icon: "shade", kid: "Take shade breaks at the picnic shelter", adult: "Take a shade break at the picnic shelter" },
  { tags: ["sunset"], icon: "time", kid: (f) => `Finish before dark: ${f.text.toLowerCase()}`, adult: (f) => `Finish before dark: ${f.text.toLowerCase()}` },
  { tags: ["picnic"], icon: "snack", kid: "Pack a snack to eat at a picnic table", adult: "Pack a snack for a picnic table break" },
  { tags: ["paths", "nature"], icon: "path", kid: "Keep the kids on the paths", adult: "Stay on the paths" },
  { tags: ["pass"], icon: "pencil", kid: "Bring a pencil to check off each find", adult: "Bring a pencil to check off each find" },
];

/** At least this many rules tips (the pass fact is always there, so a list is never empty). */
export const MIN_RULES_TIPS = 4;

/** The code-written list (4-6 tips when the facts allow; never a tip without a fact). */
export function rulesTips(facts: Pick<TipFacts, "facts">, band: AgeBand): TripTip[] {
  const adult = isAdultBand(band);
  const out: TripTip[] = [];
  const usedIcons = new Map<TipIcon, number>();
  for (const r of RULES) {
    if (out.length >= MAX_TIPS) break;
    const fact = r.tags.map((t) => facts.facts.find((f) => f.tags.includes(t))).find((f) => f !== undefined);
    if (!fact) continue;
    // At most two tips with the same picture (two water tips on a hot day without a fountain is fine; three is noise).
    if ((usedIcons.get(r.icon) ?? 0) >= (r.icon === "time" || r.icon === "shoes" ? 1 : 2)) continue;
    const words = adult ? r.adult : r.kid;
    const tip = typeof words === "string" ? words : words(fact);
    if (out.some((t) => t.tip === tip)) continue;
    out.push({ tip, why: fact.text, icon: r.icon });
    usedIcons.set(r.icon, (usedIcons.get(r.icon) ?? 0) + 1);
  }
  return out;
}
