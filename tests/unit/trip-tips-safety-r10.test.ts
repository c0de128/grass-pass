/**
 * Round 10 (SEC-10-01 / Q-10-02): the trip-tips safety check, permanent probe lists.
 *
 * MUST_DROP holds every risky tip the round-10 security and quality auditors wrote (the ones the old phrase list KEPT
 * and the ones it already dropped), plus more ways to say the same thing. They are built test strings: the recorded
 * Gemma answers had none. Every one must stay dropped, through unsafeTip() and through checkTips() with a fact set
 * that grounds the place and animal words (so a drop is the safety rule, not missing grounding).
 *
 * MUST_KEEP holds good advice that names water or a hazard to warn about it, the packing advice ("Bring water from
 * home"), the example tip in the system prompt, every tip in the two recorded real Gemma answers, and every tip the
 * code-written rules fallback can produce.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkTips, riskyTip, unsafeTip } from "@/lib/tips/check";
import type { FactTag, TipFact } from "@/lib/tips/facts";
import { tipsSystemPrompt } from "@/lib/tips/prompt";
import { rulesTips } from "@/lib/tips/rules";
import { AGE_BANDS } from "@/lib/pass/constants";

const MUST_DROP: readonly string[] = [
  // auditor-security round 10 (kept by the old check)
  "Drink the creek water if you run out",
  "Get in the pond to cool off",
  "Let the kids cool off in the creek on this hot day",
  "Bring old shoes so the kids can walk in the creek",
  "Go barefoot in the creek",
  "Let the kids put their feet in the pond to cool down",
  "Let kids rinse their hands in the pond",
  "Smell the poison ivy leaves",
  "Bring gloves so kids can pull up poison ivy safely",
  "Bring a jar for the kids to collect caterpillars",
  "Bring a net to scoop tadpoles from the pond",
  "Have the kids look under rocks near the creek for snakes",
  "Follow the snake to see where it goes",
  "Climb the rocks by the creek for a better view",
  "Bring a fishing pole for the pond",
  // auditor-security round 10 (already dropped)
  "Poke the fire ant mounds with a stick",
  "Flip over the logs to look for bugs",
  "Rub the fuzzy caterpillar for luck",
  // auditor-quality round 10
  "Cool off in the creek on this hot day",
  "Let the kids put their feet in the creek",
  "Kids can dip toes in the pond to cool down",
  "Stand in the shallow water to cool off",
  "Wear water shoes to play in the creek",
  "Look under rocks by the creek for crawdads",
  "Throw bread to the ducks at the pond",
  "Climb the rocks along the creek",
  "Walk on the frozen pond",
  "Chase the geese by the pond",
  "Poke the snake hole",
  // more of the same, other wordings
  "Fill your bottles from the creek",
  "Sip the lake water if it gets hot",
  "Refill bottles at the pond",
  "The creek water is safe to drink",
  "Toss crumbs to the geese",
  "Catch frogs by the pond",
  "Catch crawdads in the creek",
  "Skate on the frozen lake",
  "Slide on the ice by the pond",
  "Pick the pretty poison ivy leaves",
  "Touch the copperhead's tail",
  "Get close to the snake for a photo",
  "Look for copperheads under the logs",
  "Look for snakes by the creek",
  "Let the kids swim at the lake",
  "Hop across the creek on the stones",
  "Kick the ant mound to see the ants",
  "Step on the ice to test it",
  "Throw rocks into the pond",
  "Skip stones on the lake",
  "Let the kids feed the geese bread",
  "Give the ducks some bread",
  "Explore the creek bed for fossils",
  "Go down to the water's edge",
  "Lean over the railing to see the fish",
  "Play in the fountain to cool off",
  "Splash around in the creek",
  "Wade into the pond",
  "Sit at the edge of the creek and dangle your feet in the water",
  "Don't forget towels, then get in the pond",
  "Never mind the signs, walk on the frozen pond",
  "Pet the turtles by the pond",
  "Hold a frog by the creek",
  "Feed the squirrels at the picnic tables",
  "Bring a bucket for creek treasures",
  "Collect pretty leaves near the poison ivy",
  "Smell the flowers by the path",
  "Taste the wild berries by the trail",
  "Chase the squirrels around the playground",
  "Approach the deer slowly for a photo",
  "Follow the turtle back to the pond",
  "Bring a fishing net for the creek",
  "Climb the big tree by the playground",
  "Search for wasp nests along the fence",
  "Poke the mushrooms with a stick",
  "Let the kids put their hands in the creek",
  "Go wading at the creek",
  "Cross the creek on the rocks",
  "Walk through the shallow creek",
  "Kids can stand on the frozen puddles",
];

const MUST_KEEP: readonly string[] = [
  // packing and planning
  "Bring water bottles from home",
  "Bring water from home: there's no fountain",
  "Bring bottles to refill at the drinking fountain",
  "Refill bottles at the drinking fountain by the lake",
  "Bring plenty of water for everyone",
  "Drink plenty of water on this hot day",
  "Pack a towel for the splash pad",
  "Play at the splash pad to cool off",
  // warnings that name water or a hazard
  "Wear closed-toe shoes for the walk by the water",
  "Stay on the paths away from the creek",
  "Keep the kids away from the pond edge",
  "Stay out of the creek",
  "Don't let the kids walk on the frozen pond",
  "Stay off the frozen pond",
  "Watch for snakes near the creek",
  "Stay away from the fire ant mounds",
  "Wear long pants: poison ivy grows here",
  "Check for ticks after the walk",
  "Use bug spray and check for ticks afterward",
  "Watch for wasps near the picnic tables",
  "Don't touch the fuzzy caterpillars",
  // looking, sitting, walking near water
  "Look for ducks on the pond",
  "Watch the ducks from a bench by the pond",
  "Bring binoculars to watch birds on the lake",
  "Have a picnic by the lake",
  "Sit on a bench on the lake shore",
  "Walk the pond trail before it gets hot",
  "Walk on the bridge over the creek",
  "Catch a glimpse of herons by the lake",
  "Take shade breaks at the picnic shelter",
  "Gather at the picnic shelter for a snack",
  "Pick a bench in the shade to watch the birds",
  "Climb on the playground before the heat",
  "Take your trash home",
];

const PROMPT_EXAMPLE = "Wear closed-toe shoes: the creek bank can be muddy";

// A fact set that grounds every place, weather and wildlife word the probes use, so only the safety rules can drop them.
const ALL_TAGS: readonly FactTag[] = [
  "clear", "hot", "warm", "afternoon_heat", "uv", "uv_high", "sunset", "winter", "drinking_water", "shelter", "shade_trees", "creek", "water",
  "playground", "splash_pad", "picnic", "bench", "bridge", "nature", "restroom", "paths", "poison_ivy", "tick", "fire_ant", "mosquito",
  "snake", "wasp", "stinging_plant", "caterpillar", "pass",
];
const FACTS: TipFact[] = ALL_TAGS.map((t, i) => ({ id: `f-${i}`, group: "park", text: `Built fact for ${t}`, tags: [t] }));

const FIX = join(process.cwd(), "tests", "fixtures");
const RECORDED = ["trip-tips-celebration-park-6to10-live.json", "trip-tips-white-rock-13plus-live.json"].map(
  (f) => JSON.parse(readFileSync(join(FIX, f), "utf8")) as { facts: { band: (typeof AGE_BANDS)[number]; facts: TipFact[] }; response: { tips: { tip: string; factId: string; icon: string }[] } },
);

describe("trip tips safety, round 10 probe list (permanent)", () => {
  it.each(MUST_DROP)("drops: %s", (tip) => {
    expect(unsafeTip(tip), tip).not.toBeNull();
    const r = checkTips([{ tip, factId: "f-0", icon: "path" }], FACTS, "6-10");
    expect(r.kept, tip).toEqual([]);
  });

  it.each(MUST_KEEP)("keeps: %s", (tip) => {
    expect(unsafeTip(tip), tip).toBeNull();
  });

  it("keeps the example tip the system prompt shows the model", () => {
    expect(tipsSystemPrompt("6-10", true)).toContain(PROMPT_EXAMPLE);
    expect(unsafeTip(PROMPT_EXAMPLE)).toBeNull();
  });

  it("keeps every tip of the two recorded real Gemma answers (0 false drops)", () => {
    for (const rec of RECORDED) {
      const r = checkTips(rec.response.tips, rec.facts.facts, rec.facts.band);
      expect(r.drops, JSON.stringify(rec.response.tips)).toEqual({});
      expect(r.kept).toHaveLength(rec.response.tips.length);
    }
  });

  it("keeps every tip the code-written rules fallback can produce, for every band", () => {
    const texts: Partial<Record<FactTag, string>> = { storm: "Thunderstorms forecast from about 3 PM", sunset: "Sunset at 7:01 PM" };
    const all = new Set<string>();
    const tags = [...ALL_TAGS, "storm", "alert", "rain", "no_drinking_water", "cold", "chilly", "wind", "layers", "cool_morning", "chigger", "no_restroom", "dogs", "fog", "mild", "dry"] as FactTag[];
    for (const band of AGE_BANDS) {
      for (const a of tags) {
        for (const b of tags) {
          const facts: TipFact[] = [a, b].map((t, i) => ({ id: `r-${i}`, group: "park", text: texts[t] ?? `Built fact for ${t}`, tags: [t] }));
          for (const t of rulesTips({ facts }, band)) all.add(t.tip);
        }
      }
    }
    expect(all.size).toBeGreaterThan(20);
    for (const tip of all) expect(unsafeTip(tip), tip).toBeNull();
  });

  it("says which pair rule a risky tip breaks", () => {
    expect(riskyTip("Drink the creek water if you run out")).toBe("drink");
    expect(riskyTip("Walk on the frozen pond")).toBe("water");
    expect(riskyTip("Throw bread to the ducks at the pond")).toBe("wildlife");
    expect(riskyTip("Follow the snake to see where it goes")).toBe("hazard");
    expect(riskyTip("Stay off the frozen pond")).toBeNull();
  });
});
