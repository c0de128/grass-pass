/**
 * Kid voice (Kevin 2026-10-10): clues that sound like a fun grown-up talking to the pass's reader, per age band.
 * The real clues are today's live Celebration Park pass (ages 6-10), clue by clue, as Kevin reviewed them; the pool is
 * the recorded Celebration fixture (evals/fixtures). The checks are preferences (`kid_wording`): a clue goes first when
 * a spare can replace it, and a pass never prints short for wording alone.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { caseDataOrNull, loadFixture, type CaseData } from "../../evals/fixture";
import { KidPass } from "@/components/pass/KidPass";
import { PassPreview } from "@/components/pass/PassPreview";
import { kidWordingProblem, peopleNow, repeatedWord, voiceProblem } from "@/lib/ai/jargon";
import { OPENER_BANK, ADULT_OPENER_BANK, openersFor, readingRules, STOCK_OPENINGS, systemPrompt, type Mix } from "@/lib/ai/prompt";
import { FRAME_VERBS, fixCountOfThem, kindFirstOpening, kindFirstRewrite, rewriteStockFrame, stockOpening, validateDraft, validateSpot } from "@/lib/ai/validate";
import { AUDIENCE_COPY, wildEmptyLine } from "@/lib/pass/audience";
import { LUCKY_MAYBE, luckyLead } from "@/lib/pass/lucky-lead";
import { AGE_BAND_INFO, AGE_BANDS, PassSchema, type AgeBand, type Pass } from "@/lib/pass/schema";
import type { PoolItem } from "@/lib/pool/types";
import { FACT_BANK_VERSION, factsFor, KIND_FACTS, setFactBankForReplay } from "@/lib/pool/park";
import { LEGACY_FACT_BANK } from "../../evals/legacy-facts";
import { handlingInstruction } from "@/lib/safety/handling";

const ROOT = path.resolve(__dirname, "../..");
const fixture = (slug: string): Pass => PassSchema.parse((JSON.parse(readFileSync(path.join(ROOT, `tests/fixtures/${slug}.json`), "utf8")) as { pass: unknown }).pass);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

/** Today's live Celebration Park pass (ages 6-10), as printed. */
const LIVE = {
  basketball: "Spot 2 flat smooth areas with a metal ring on a tall post.",
  tennis: "Point to the flat area with a low net strung across its center.",
  soccer: "Check for a big grass area with a goal and its net at each end.",
  baseball: "Which place has players waiting on low benches in low dugouts?",
  playground: "Hunt for the tower where kids climb ladders and steps to the top.",
  fountain: "Notice water that glitters in the sun as it falls.",
  pond: "Peek at the water that shines like a mirror on a calm day.",
  lucky: "Where you might see a furry pet with four legs and a wagging tail.",
  riddle: "I have a roof and pillars to keep you dry. Sit at my tables for a snack in the shade!",
} as const;

describe("the live Celebration Park clues (ages 6-10)", () => {
  it("catches the four stiff Park Finds and the Lucky Find sentence piece", () => {
    expect(voiceProblem(LIVE.basketball, "6-10", "park")).toBe("areas");
    expect(voiceProblem(LIVE.tennis, "6-10", "park")).toBe("strung");
    expect(voiceProblem(LIVE.soccer, "6-10", "park")).toBe("area");
    expect(voiceProblem(LIVE.baseball, "6-10", "park")).toBe('"low" twice');
    expect(voiceProblem(LIVE.lucky, "6-10", "lucky")).toBe("a sentence piece");
    // Each reason on its own, without the word that trips first.
    expect(voiceProblem("Point to the flat court with a low net strung across it.", "6-10", "park")).toBe("strung");
    expect(voiceProblem("Point to the court with a low net across its center.", "6-10", "park")).toBe("center");
    expect(voiceProblem("Check for a big grass field with a goal at each end.", "6-10", "park")).toBe("check for");
    expect(voiceProblem("Which field has players waiting on benches in dugouts?", "6-10", "park")).toBe("players waiting");
  });

  it("the good ones pass untouched: the tower, the fountain, the pond and the Find This Spot riddle", () => {
    for (const c of [LIVE.playground, LIVE.fountain, LIVE.pond, LIVE.riddle]) expect(voiceProblem(c, "6-10", "park"), c).toBeNull();
    // "kids climb" says what the tower is for, not that kids are there now.
    expect(peopleNow(LIVE.playground)).toBeNull();
    // The riddle is checked by validateSpot, which is unchanged: still a valid riddle for the shelter's real fact sheet.
    const shelter = "Celebration Park has a picnic shelter on the map (OpenStreetMap). It has a roof held up by pillars and tables below it where people share a meal.";
    expect(validateSpot({ targetId: "osm-shelter", riddle: LIVE.riddle, sourceQuote: "a roof held up by pillars" }, { id: "osm-shelter", sourceText: shelter, nameWords: ["shelter", "pavilion", "gazebo"] })).toEqual({ ok: true, riddle: LIVE.riddle });
  });

  it("Kevin's kid-voice targets pass", () => {
    for (const c of [
      "Find 2 places where you can shoot a ball through a metal ring up high.",
      "Find a court with a low net right across the middle.",
      "Find a big grass field with a goal at each end.",
      "Find a field shaped like a diamond, with a bench area dug into the ground.",
    ]) expect(voiceProblem(c, "6-10", "park"), c).toBeNull();
    expect(voiceProblem("Can you spot a dog out for a walk?", "6-10", "lucky")).toBeNull();
    // "Find a ..." and "Can you spot ...?" are no longer stock openings (they were a preference to replace).
    expect(stockOpening("Find a big grass field with a goal at each end.")).toBeNull();
    expect(stockOpening("Can you spot a dog out for a walk?")).toBeNull();
    expect(stockOpening("Can you find a seat?")).toBe("can you find");
    expect(STOCK_OPENINGS).not.toContain("find a");
  });
});

describe("per band: one bad and one good clue each", () => {
  const cases: Record<AgeBand, { bad: [string, string, "park" | "wild" | "lucky"][]; good: [string, "park" | "wild" | "lucky"][] }> = {
    "4-6": {
      bad: [["Spot the flat area with a slide.", "area", "park"], ["Observe the smooth surface of the slide.", "observe", "park"]],
      good: [["Find a slide! Is it shiny or bumpy?", "park"], ["Look for a bird with a red chest.", "wild"]],
    },
    "6-10": {
      bad: [["Spot a structure with a roof.", "structure", "park"], ["Find a red bird with a red cap.", '"red" twice', "wild"]],
      good: [["Walk to a long seat made of wood.", "park"], ["Point to a tree with bark like puzzle pieces.", "wild"]],
    },
    "10-13": {
      bad: [["Hunt for 2 recreational fields with goals.", "recreational", "park"], ["Spot the gazebo located by the path.", "located", "park"]],
      // An older reader may meet "surface" and "observe".
      good: [["Observe the bumpy surface of the bark and find the deepest ridge.", "wild"], ["Which bird keeps bobbing its tail on the shore?", "wild"]],
    },
    "13+": {
      bad: [["Check for a dugout beside the infield.", "check for", "park"], ["Spot a little bird with a red cap.", "little", "wild"], ["Find the fields where teams are playing.", "teams are playing", "park"]],
      // Real terms are fine for teens and adults: "area", "center", "dugout", "backstop".
      good: [["Find the dugout and backstop beside the infield.", "park"], ["Spot the picnic area at the center of the park, under the roof.", "park"]],
    },
  };
  for (const band of AGE_BANDS) {
    it(`${band}: the bad clue is flagged, the good one is not`, () => {
      for (const [clue, why, section] of cases[band].bad) expect(voiceProblem(clue, band, section), clue).toBe(why);
      for (const [clue, section] of cases[band].good) expect(voiceProblem(clue, band, section), clue).toBeNull();
    });
  }

  it("no band (older callers): nothing is flagged", () => {
    expect(voiceProblem(LIVE.basketball, undefined, "park")).toBeNull();
  });

  it("the 13+ kid-wording check is unchanged", () => {
    expect(kidWordingProblem("Point to a ride with two wheels, pedals and handlebars that you might see today.")).toBe("a ride with");
    expect(voiceProblem("Point to a ride with two wheels, pedals and handlebars that you might see today.", "13+", "lucky")).toBe("a ride with");
  });

  it("repeated words and people who may not be there", () => {
    expect(repeatedWord("Spot a tree with a tree hole.")).toBe("tree");
    expect(repeatedWord("Find a bird with a black cap and a black tail.")).toBe("black");
    expect(repeatedWord("Find the bench that is next to the path.")).toBeNull();
    expect(repeatedWord("Find a tree with a hole, and a bird in it.")).toBeNull();
    // Recorded run -9 (6-10): "boxes and short boxes".
    expect(repeatedWord("Where are the boxes and short boxes painted on the ground?")).toBe("box");
    expect(repeatedWord("Point to 4 paths made of wooden boards laid side by side.")).toBeNull();
    // "Somewhere a big bird is soaring." is a whole sentence (recorded run -9), not a sentence piece.
    expect(voiceProblem("Somewhere a big bird is soaring.", "6-10", "wild")).toBeNull();
    // 13+ (recorded run 2026-10-07): "strung across the center" is plain adult English.
    expect(voiceProblem("Count the 4 flat courts where a low net is strung across the center.", "13+", "park")).toBeNull();
    expect(peopleNow("Spot the field where kids are playing tag.")).toBe("kids are playing");
    expect(peopleNow("Find a swing where kids swing high.")).toBeNull();
    // A people word on a Lucky Find (a rider passing) is not checked: that find is about who might come by.
    expect(voiceProblem("Watch for runners passing on the trail.", "6-10", "lucky")).toBeNull();
  });
});

describe("the prompt says it, per band", () => {
  const mix: Mix = { n: 8, min: { park: 2, wild: 2, lucky: 1 }, max: { park: 5, wild: 5, lucky: 2 }, hardMin: 0 };
  it("kid bands: a fun grown-up's voice, no sign words, a full sentence after 'Maybe!'", () => {
    for (const band of ["4-6", "6-10", "10-13"] as const) {
      const s = systemPrompt(band, mix, null, { month: 10 });
      expect(s, band).toContain('- No sign words (area, center, "Check for"), no word twice in a clue, never people who may not be there.');
      expect(s, band).toContain('never a sentence piece such as "Where you might see ..."');
    }
    expect(readingRules("4-6", AGE_BAND_INFO["4-6"].grade)[0]).toContain("A grown-up reads each clue aloud");
    expect(readingRules("6-10", "2")[0]).toContain("Sound like a fun grown-up on a hunt");
    expect(systemPrompt("10-13", mix, null, { month: 10 })).toContain("a puzzle-like hint");
  });

  it("13+: a naturalist's challenge, real terms fine, and none of the kid lines", () => {
    const s = systemPrompt("13+", mix, null, { month: 10 });
    expect(s).toContain("Real terms are fine (dugout, backstop)");
    expect(s).not.toContain("No sign words");
    expect(s).not.toContain("fun grown-up");
  });

  it("the opener banks: kid verbs for kids, a naturalist's for 13+; no 'Notice', 'Check', 'Peek' or 'Somewhere'", () => {
    for (const w of ["Notice", "Check", "Peek", "Somewhere"]) {
      expect(OPENER_BANK as readonly string[]).not.toContain(w);
      expect(ADULT_OPENER_BANK as readonly string[]).not.toContain(w);
    }
    for (const w of ["Can", "Who", "Walk"]) expect(ADULT_OPENER_BANK as readonly string[]).not.toContain(w);
    for (const o of openersFor("Celebration Park", 10, "13+")) expect(ADULT_OPENER_BANK as readonly string[]).toContain(o);
    for (const o of openersFor("Celebration Park", 10, "4-6")) expect(OPENER_BANK as readonly string[]).toContain(o);
    expect(ADULT_OPENER_BANK.length).toBeGreaterThanOrEqual(10); // 8 finds + 2 spares
  });

  it("a rewritten frame gets a plain verb that fits every band ('Spot', 'Find', 'Look for' ...)", () => {
    expect([...FRAME_VERBS]).toEqual(["Spot", "Find", "Look for", "Hunt for", "Search for"]);
    expect(rewriteStockFrame("Somewhere you will see a vine with large, purple blooms.", new Set(["spot"]), "Purple passionflower")).toBe("Find a vine with large, purple blooms.");
    expect(rewriteStockFrame("Somewhere you will see a bench.", new Set(["spot", "find"]), "Benches")).toBe("Look for a bench.");
  });
});

describe("live eval 2026-10-10-partial-0835 (6-10, M10 9.8%): kind-first openings, quiz questions, 'count 25 of them'", () => {
  // Real printed clues that repeated a 5-word run on 3+ parks.
  const KIND_FIRST = [
    "Spot a bird with a reddish-orange breast.",
    "Look for a plant with white flowers.",
    "Search for a tree with bumpy, yellow-green balls.",
    "Hunt for a bird with a black head and upper body.",
    "Look for a bird that is pale brown and grey.",
    "Spot a tree with bumpy, yellow-green balls in the fall.",
  ];
  it("a verb + 'a bird/plant/tree with/that' start is a stock opening (a preference: it goes first when a spare exists)", () => {
    for (const c of KIND_FIRST) expect(kindFirstOpening(c), c).not.toBeNull();
    for (const c of KIND_FIRST) expect(stockOpening(c), c).not.toBeNull();
    for (const c of [
      "Find a big grass field with a goal at each end.",
      "Find a court with a low net right across the middle.",
      "Spot the reddish-orange breast on a bird hopping in the grass.",
      "Point to the bumpy yellow-green balls hanging in a tree.",
    ]) expect(kindFirstOpening(c), c).toBeNull();
  });

  it("on the finished pass a kind-first clue leads with its trait (real live clues; word order only)", () => {
    expect(kindFirstRewrite("Spot a bird with a reddish-orange breast.")).toBe("Spot a reddish-orange breast on a bird.");
    expect(kindFirstRewrite("Look for a plant with white flowers.")).toBe("Look for white flowers on a plant.");
    expect(kindFirstRewrite("Search for a tree with bumpy, yellow-green balls.")).toBe("Search for bumpy, yellow-green balls on a tree.");
    expect(kindFirstRewrite("Hunt for a turtle with a yellow bottom shell.")).toBe("Hunt for a yellow bottom shell on a turtle.");
    expect(kindFirstRewrite("Look for a bird that is pale brown and grey.")).toBe("Look for a pale brown and grey bird.");
    expect(kindFirstRewrite("Search for a bird that is orange and black.")).toBe("Search for an orange and black bird.");
    // Left alone: a tail the trait can't carry, a non-describing "that is", a question, a number, other first words.
    for (const c of [
      "Spot a tree with bumpy, yellow-green balls in the fall.",
      "Look for a tree with bumpy fruit that is yellow-green.",
      "Look for a bird that is a large aquatic soaring kind.",
      "Which one of these is a tree with bumpy, yellow-green fruit in the fall?",
      "Walk to a tree with bark like puzzle pieces.",
      "Spot a bird with 2 white bars on each wing.",
      "Find a big grass field with a goal at each end.",
    ]) expect(kindFirstRewrite(c), c).toBe(c);
  });

  it("the prompt asks to lead with the trait, and 'Search' (a third 'for' verb) left the kid opener bank", () => {
    const s = systemPrompt("6-10", { n: 8, min: { park: 2, wild: 2, lucky: 0 }, max: { park: 6, wild: 6, lucky: 0 }, hardMin: 0 }, null, { month: 10 });
    expect(s).toContain('Lead with the trait, never "a bird/plant/tree with" or "a bird that is".');
    expect(OPENER_BANK as readonly string[]).not.toContain("Search");
    expect(OPENER_BANK.length).toBeGreaterThanOrEqual(10);
  });

  it("'Which tiny frog is dark colored?' is a quiz with nothing to find (kid bands only)", () => {
    expect(voiceProblem("Which tiny frog is dark colored?", "6-10", "wild")).toBe("a quiz question");
    expect(voiceProblem("What bird is black?", "4-6", "wild")).toBe("a quiz question");
    expect(voiceProblem("Which tree has bark like puzzle pieces?", "6-10", "wild")).toBeNull();
    expect(voiceProblem("Which frog is dark colored?", "13+", "wild")).toBeNull();
  });

  it("'count 25 of them' becomes 'count all 25' (the number is unchanged)", () => {
    expect(fixCountOfThem("Walk to the outdoor seats and count 25 of them.")).toBe("Walk to the outdoor seats and count all 25.");
    expect(fixCountOfThem("Walk to the benches and count two of them.")).toBe("Walk to the benches and count all two.");
    expect(fixCountOfThem("Count 2 of the benches by the path.")).toBe("Count 2 of the benches by the path.");
  });
});

describe("validateDraft: a stiff clue goes first when a spare can replace it, and prints when none can", () => {
  let data: CaseData;
  beforeAll(async () => {
    const r = await caseDataOrNull(loadFixture("celebration-park"), "6-10");
    if (!r.data) throw new Error(r.problem ?? "celebration-park");
    data = r.data;
  }, 120_000);
  const item = (id: string): PoolItem => {
    const it = data.pool.find((p) => p.id === id);
    if (!it) throw new Error(`no ${id}`);
    return it;
  };
  const draft = (it: PoolItem, clue: string, sourceQuote: string) => ({ itemId: it.id, clue, lookWhere: "", sourceQuote, difficulty: "medium" });
  const parkMix = (n: number): Mix => ({ n, min: { park: 1, wild: 0, lucky: 0 }, max: { park: n, wild: 0, lucky: 0 }, hardMin: 0 });

  it("the live basketball clue loses to a spare; alone it still prints (never a short pass for wording)", () => {
    // The live clue also copies "ring on a tall post" from its fact sheet (a copies_source preference, checked first),
    // so the same stiff wording without the copied run shows the kid_wording reason on its own.
    expect(validateDraft({ items: [draft(item("osm-basketball"), LIVE.basketball, "made of metal")] }, data.pool, parkMix(1), { hasMap: true, band: "6-10" }).items[0].style).toBe("copies_source");
    const bad = draft(item("osm-basketball"), "Spot 2 flat smooth areas with a hoop up high.", "made of metal");
    // (The live tower clue copies a 4-word run of its fact sheet, a style preference of its own, so a fresh one is the spare.)
    const spare = "Walk to the tall play tower with ladders and steps.";
    const good = draft(item("osm-playground"), spare, "Kids climb ladders and steps on it");
    const withSpare = validateDraft({ items: [bad, good] }, data.pool, parkMix(1), { hasMap: true, band: "6-10", ask: parkMix(2) });
    expect(withSpare.items.map((v) => v.clue)).toEqual([spare]);
    expect(withSpare.drops.kid_wording).toBe(1);
    const alone = validateDraft({ items: [bad] }, data.pool, parkMix(1), { hasMap: true, band: "6-10" });
    expect(alone.items).toHaveLength(1);
    expect(alone.items[0].style).toBe("kid_wording");
    // The same clue on a 13+ pass: "areas" is a normal word there.
    expect(validateDraft({ items: [bad] }, data.pool, parkMix(1), { hasMap: true, band: "13+" }).items[0].style).toBeUndefined();
  });

  it("'count 4 of them' prints as 'count all 4' and still passes the count check (the map counts 4 benches)", () => {
    const out = validateDraft({ items: [draft(item("osm-bench"), "Walk to the long seats and count 4 of them.", "a long seat outdoors where you can sit and rest")] }, data.pool, parkMix(1), { hasMap: true, band: "6-10" });
    expect(out.items.map((v) => v.clue)).toEqual(["Walk to the long seats and count all 4."]);
    const wrong = validateDraft({ items: [draft(item("osm-bench"), "Walk to the long seats and count 5 of them.", "a long seat outdoors where you can sit and rest")] }, data.pool, parkMix(1), { hasMap: true, band: "6-10" });
    expect(wrong.items).toHaveLength(0); // 5 is not the map count (dropped: a number not in its source)
  });

  it("the safety checks are unchanged: a touch clue is still a hard drop in every band", () => {
    for (const band of AGE_BANDS) {
      const out = validateDraft({ items: [draft(item("osm-bench"), "Touch the 4 long seats used for resting.", "a long seat outdoors where you can sit and rest")] }, data.pool, parkMix(1), { hasMap: true, band });
      expect(out.drops.handling, band).toBe(1);
    }
    expect(handlingInstruction("Walk to a long seat made of wood.")).toBeNull();
  });
});

describe("Lucky Finds lead, per band", () => {
  it("kids: 'Maybe!' before a full question; 13+: 'If you're lucky:' unless the clue already hedges", () => {
    expect(luckyLead({ section: "lucky", clue: "Can you spot a dog out for a walk?" }, "6-10")).toBe(LUCKY_MAYBE);
    expect(luckyLead({ section: "lucky", clue: "Can you spot a dog out for a walk?" }, "4-6")).toBe("Maybe!");
    expect(luckyLead({ section: "lucky", clue: "Can you spot a dog out for a walk?" })).toBe("Maybe!");
    expect(luckyLead({ section: "lucky", clue: "Watch for a rider in a helmet on the trail." }, "13+")).toBe(AUDIENCE_COPY.adult.luckyLead);
    expect(luckyLead({ section: "lucky", clue: "You might see a rider in a helmet on the trail." }, "13+")).toBeNull();
    expect(luckyLead({ section: "park", clue: "Find a bench." }, "13+")).toBeNull();
    expect(AUDIENCE_COPY.adult.luckyLead).not.toMatch(/!/);
  });
});

describe("empty Wild Finds: a friendly line on the hunt side, the full reason for the grown-up", () => {
  const REASON = "No data available: no research-grade sightings within 1.5 km in the last 14 days on iNaturalist.";
  it("picks 'none' or 'few' from the code-written reason, in the band's voice", () => {
    expect(wildEmptyLine(REASON, "6-10")).toBe("No animal or plant sightings were reported here in the last 2 weeks, so today is all about the park!");
    expect(wildEmptyLine("No data available: only 2 research-grade sightings within 1.5 km in the last 14 days on iNaturalist.", "4-6")).toBe(AUDIENCE_COPY.kid.wildEmpty.few);
    expect(wildEmptyLine(REASON, "13+")).toBe(AUDIENCE_COPY.adult.wildEmpty.none);
    expect(AUDIENCE_COPY.adult.wildEmpty.none).not.toMatch(/!|kids?\b/i);
  });

  it("the screen pass (6-10, live Celebration): the kid line in Wild Finds, the iNaturalist reason in the grown-up's stub", () => {
    const pass = fixture("pass-celebration-complete-live");
    const html = renderToStaticMarkup(<PassPreview pass={pass} />);
    const wild = html.slice(html.indexOf('id="sec-wild"'), html.indexOf("</section>", html.indexOf('id="sec-wild"')));
    expect(text(wild)).toContain(AUDIENCE_COPY.kid.wildEmpty.none);
    expect(text(wild)).not.toContain("research-grade");
    expect(html).toContain('data-testid="wild-empty-reason"');
    expect(text(html)).toContain(REASON);
  });

  it("13+ screen pass: the adult line, never the kid one", () => {
    const html = renderToStaticMarkup(<PassPreview pass={fixture("pass-celebration-13plus-live")} />);
    expect(text(html)).toContain(AUDIENCE_COPY.adult.wildEmpty.none);
    expect(text(html)).not.toContain(AUDIENCE_COPY.kid.wildEmpty.none);
    expect(text(html)).toContain(REASON);
  });

  it("the printed kid half invents no wildlife (no Wild Finds rows on a pass without them)", () => {
    const t = text(renderToStaticMarkup(<KidPass pass={fixture("pass-celebration-complete-live")} />));
    expect(t).not.toMatch(/seen (once|\d+ times) since/);
  });
});

function expandAll(template: string): string[] {
  const m = /\{([^{}]*)\}/.exec(template);
  if (!m) return [template];
  return m[1].split("|").flatMap((alt) => expandAll(template.slice(0, m.index) + alt + template.slice(m.index + m[0].length)));
}

describe("option A (Kevin 2026-10-10): the code-written Park Finds facts are words a warm grown-up says out loud", () => {
  it("every expansion of every fact template passes the kid-band voice check (the model quotes these word for word)", () => {
    let n = 0;
    for (const [kind, bank] of Object.entries(KIND_FACTS)) {
      for (const t of bank) {
        for (const f of expandAll(t)) {
          n++;
          for (const band of ["4-6", "6-10", "10-13"] as const) expect(voiceProblem(f, band, "park"), `${kind} ${band}: ${f}`).toBeNull();
        }
      }
    }
    expect(n).toBeGreaterThan(1000);
  });

  it("the live stiff phrases are gone from the bank", () => {
    const all = Object.values(KIND_FACTS).flat().join(" ");
    for (const bad of [/strung/, /\bcent(?:er|re)\b/, /\bareas?\b/, /\bstructure\b/, /\bsurface\b/, /\blofty\b/, /for resting/, /\{low\|sunken\} dugouts/, /low benches/]) {
      expect(all, String(bad)).not.toMatch(bad);
    }
  });

  it("sizes in units are a kid-band preference (live 10-13: '8 to 15 centimetres wide'); 13+ may keep them", () => {
    expect(voiceProblem("Can you spot a bumpy, yellow-green sphere that is 8 to 15 centimetres wide?", "10-13", "wild")).toBe("8 to 15 centimetres");
    expect(voiceProblem("Find a leaf about 10 cm long.", "6-10", "wild")).toBe("10 cm");
    expect(voiceProblem("Find a fruit that is 8 to 15 centimetres wide.", "13+", "wild")).toBeNull();
    expect(voiceProblem("Count the 4 courts in a row.", "6-10", "park")).toBeNull();
  });
});

describe("older eval runs replay against the facts their model saw (evals/legacy-facts.ts)", () => {
  it("the legacy bank is the pre-rewrite text, kind for kind, and the hook switches factsFor to it and back", () => {
    expect(Object.keys(LEGACY_FACT_BANK).sort()).toEqual(Object.keys(KIND_FACTS).sort());
    for (const k of Object.keys(KIND_FACTS) as (keyof typeof KIND_FACTS)[]) expect(LEGACY_FACT_BANK[k].length, k).toBe(KIND_FACTS[k].length);
    expect(LEGACY_FACT_BANK.tennis[0]).toContain("strung across its center");
    const now = factsFor("bench", "way/188145317", 4);
    setFactBankForReplay(LEGACY_FACT_BANK);
    try {
      expect(factsFor("bench", "way/188145317", 4).join(" ")).toMatch(/for (resting|taking a break|a rest)\./);
    } finally {
      setFactBankForReplay(null);
    }
    expect(factsFor("bench", "way/188145317", 4)).toEqual(now);
    expect(FACT_BANK_VERSION).toBe("kid-voice-2026-10-10b");
  });
});

describe("official eval 2026-10-10 (M10 6.4%): the repeated frames and fact phrases", () => {
  it("'Where is the water that ...?' gets a plain verb; the rest still says what to see", () => {
    const none = new Set<string>();
    expect(rewriteStockFrame("Where is the water that pours into a bowl?", none, "Fountains")).toBe("Spot the water that pours into a bowl.");
    expect(rewriteStockFrame("Where is the water that shows the sky like a mirror?", new Set(["spot"]), "Pond or lake")).toBe("Find the water that shows the sky like a mirror.");
  });

  it("'the place where' is a stock phrase (a preference), and the shared fact runs have more wordings", () => {
    expect(stockOpening("Walk to the place where you can slide and climb.")).toBe("the place where");
    expect(kindFirstRewrite("Walk to the place where kids use ladders to get to the top.")).toBe("Walk to where kids use ladders to get to the top.");
    expect(kindFirstRewrite("Find the place where you can slide.")).toBe("Find the place where you can slide.");
    const all = (kind: keyof typeof KIND_FACTS) => KIND_FACTS[kind].flatMap((t) => expandAll(t));
    expect(all("water").filter((f) => /ripples spread across it when a fish jumps/i.test(f))).toHaveLength(0);
    expect(new Set(all("bench").map((f) => (/where you can (.*)\.$/.exec(f) ?? [])[1]).filter(Boolean)).size).toBe(6);
    expect(all("swing").some((f) => /^It is a seat that hangs/.test(f))).toBe(true);
    expect(all("swing").some((f) => /^It is a seat (hung on|dangling from)/.test(f))).toBe(true);
  });
});
