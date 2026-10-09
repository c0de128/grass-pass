/**
 * Round 11 (SEC-11-01, judge T2): the trip-tips safety check and the absence wording, permanent probe lists.
 *
 * MUST_DROP holds every string the round-11 security auditor found KEPT (tests/unit/trip-tips-safety-r10.test.ts keeps
 * the round-10 lists), plus more wordings of the same gaps: a negation that is about something else ("not tired"), the
 * water word first ("shallow enough to stand in"), enter/leap/hug/splash around, storm drains and culverts, and food
 * "for the geese". GOOD_TIPS is ordinary trip advice that must never be dropped by these rules.
 */
import { describe, expect, it } from "vitest";
import { checkTips, mapAbsenceWording, unsafeTip } from "@/lib/tips/check";
import type { FactTag, TipFact } from "@/lib/tips/facts";
import { TIP_MAX } from "@/lib/tips/schema";

const MUST_DROP: readonly string[] = [
  // auditor-security round 11 (KEPT by the round-10 check)
  "Kids who are not tired can cool off in the creek",
  "Kids with no shoes can splash around the creek",
  "The creek is shallow enough for kids to stand in",
  "The ice on the pond is thick enough to walk on",
  "Kids can enter the creek near the bridge",
  "Leap across the creek on the stepping stones",
  "Let the kids hug the big tree with poison ivy on it",
  "Kids love to explore the storm drain by the creek",
  "Bring a snack for the geese",
  // more of the same gaps, other wordings
  "If nobody is tired, walk on the frozen pond",
  "Kids who don't mind the cold can wade in the creek",
  "The pond is shallow enough to wade",
  "The pond is fun to splash in",
  "The creek is perfect to play in",
  "The lake ice is solid enough to skate on",
  "Enter the pond at the shallow end",
  "Jump the creek at its narrowest spot",
  "Hop across the stream on the rocks",
  "Splash around in the pond shallows",
  "Peek into the culvert under the trail",
  "Explore the spillway below the pond",
  "Pack bread for the ducks",
  "Bring food for the squirrels",
  "Bring some crackers to share with the geese",
  "Hug the tree with the wasp nest",
];

const GOOD_TIPS: readonly string[] = [
  "Bring snacks for the kids",
  "Pack a snack for after the hunt",
  "Kids who are tired can rest on a bench in the shade",
  "Enter the park from the north parking lot",
  "Walk the loop trail before it gets hot",
  "Watch the geese from a bench by the pond",
  "Look for ducks on the pond from the bridge",
  "Stay away from the storm drain",
  "Don't let the kids enter the creek",
  "Never let anyone walk on the frozen pond",
  "Keep kids out of the creek",
  "Don't let the kids chase the geese",
  "Bring water bottles from home",
  "Wear closed-toe shoes: the creek bank can be muddy",
  "Use a restroom before you leave home",
  "The park map shows no restrooms; check before you go",
  "Bring water from home: the park map shows no fountain",
  "Pack sun hats for everyone",
  "Bring a jacket for each kid",
  "Use bug spray and check for ticks afterward",
  "Hug your grown-up before the hunt",
  "Play on the playground before the heat",
  "The splash pad is fun to play in",
  "Have a picnic at the shelter by the lake",
  "Bring a pencil for the pass",
];

const ALL_TAGS: readonly FactTag[] = [
  "clear", "hot", "warm", "afternoon_heat", "uv", "uv_high", "sunset", "winter", "drinking_water", "shelter", "shade_trees", "creek", "water",
  "playground", "splash_pad", "picnic", "bench", "bridge", "nature", "restroom", "paths", "poison_ivy", "tick", "fire_ant", "mosquito",
  "snake", "wasp", "stinging_plant", "caterpillar", "pass", "cold", "dogs",
];
const FACTS: TipFact[] = ALL_TAGS.map((t, i) => ({ id: `f-${i}`, group: "park", text: `Built fact for ${t}`, tags: [t] }));

describe("trip tips safety, round 11 probe list (permanent)", () => {
  it.each(MUST_DROP)("drops: %s", (tip) => {
    expect(unsafeTip(tip), tip).not.toBeNull();
    expect(checkTips([{ tip, factId: "f-0", icon: "path" }], FACTS, "6-10").kept, tip).toEqual([]);
  });

  it.each(GOOD_TIPS)("keeps: %s", (tip) => {
    expect(unsafeTip(tip), tip).toBeNull();
  });
});

describe("trip tips: an absence on the park map stays an absence on the map (judge round 11 T2)", () => {
  const facts: TipFact[] = [
    { id: "p-no-restroom", group: "park", text: "No restroom on the park map", tags: ["no_restroom"] },
    { id: "p-no-drinking-water", group: "park", text: "No drinking fountain on the park map", tags: ["no_drinking_water"] },
  ];

  it("rewrites the two real Celebration Park tips (Oct 9) to the map wording", () => {
    const r = checkTips(
      [
        { tip: "Plan a bathroom break before arrival as there are no restrooms", factId: "p-no-restroom", icon: "restroom" },
        { tip: "Bring drinks because there are no drinking fountains", factId: "p-no-drinking-water", icon: "water" },
      ],
      facts,
      "6-10",
    );
    expect(r.drops).toEqual({});
    expect(r.kept.map((k) => k.tip)).toEqual([
      "Plan a bathroom break before arrival as the park map shows no restrooms",
      "Bring drinks because the park map shows no drinking fountains",
    ]);
    expect(r.kept.map((k) => k.why)).toEqual(["No restroom on the park map", "No drinking fountain on the park map"]);
  });

  it.each([
    ["There are no restrooms, so go before you leave", "The park map shows no restrooms, so go before you leave"],
    ["There's no drinking fountain here: bring water", "The park map shows no drinking fountain: bring water"],
    ["The park has no restrooms; plan ahead", "The park map shows no restrooms; plan ahead"],
    ["The park doesn't have any bathrooms, so go first", "The park map shows no bathrooms, so go first"],
    ["Restrooms aren't available, so use one at home", "The park map shows no restrooms, so use one at home"],
    ["No restrooms here: go before you leave", "No restrooms on the park map: go before you leave"],
    ["Bring water from home: there's no fountain", "Bring water from home: the park map shows no fountain"],
  ])("%s -> %s", (from, to) => {
    expect(mapAbsenceWording(from)).toBe(to);
  });

  it("leaves map wording and ordinary tips alone", () => {
    for (const t of [
      "The park map shows no restrooms; check before you go",
      "No restroom on the park map, so go before you leave",
      "Use a restroom before you leave home",
      "Find the restroom first, before the hunt starts",
      "Bring bottles to refill at the drinking fountain",
    ]) {
      expect(mapAbsenceWording(t)).toBe(t);
    }
  });

  it("a rewrite that would be too long becomes the plain map line", () => {
    const long = "Please plan your bathroom stop carefully before arriving because there are no public restrooms at this park";
    const out = mapAbsenceWording(long);
    expect(out).toBe("The park map shows no restrooms; check before you go");
    expect(out.length).toBeLessThanOrEqual(TIP_MAX);
    expect(mapAbsenceWording("Bring plenty of bottles for everyone today because there is no drinking water anywhere at this park")).toBe(
      "The park map shows no drinking fountain; bring water from home",
    );
  });
});
