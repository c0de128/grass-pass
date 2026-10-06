/**
 * Audit round 2, R2-M5 (judge M3, ux m3): clue variety and count accuracy.
 * Pools come from the REAL recorded fixtures (Celebration Park, Connemara Meadow Preserve, and the eval
 * parks). The clue strings marked "run 2026-10-06" are real Gemma 4 31B clues from
 * evals/results/2026-10-06.json; the others are test inputs built here (what a model might write).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadCases, loadCaseData, loadFixture, type CaseData } from "../../evals/fixture";
import { caseContext, countChecks, crossParkRepetition, type RunRecord } from "../../evals/score";
import { askMix, BAD_CLUE_EXAMPLES, CLUE_VOICES, computeMix, PROMPT_EXAMPLE_TEXTS, systemPrompt, voiceFor } from "@/lib/ai/prompt";
import { ASK_EXTRA } from "@/lib/ai/schema";
import {
  copiesPromptExample,
  countProblem,
  fitToMix,
  isGenericClue,
  nameLeak,
  ngrams,
  parentNoteFor,
  quoteIsOnlyName,
  trigramOverlap,
  validateDraft,
} from "@/lib/ai/validate";
import { countNouns, factsFor, KIND_FACTS, parkPool, seedHash } from "@/lib/pool/park";
import type { PoolItem } from "@/lib/pool/types";
import { looksScore } from "@/lib/pool/wild";
import { FEATURE_KINDS, FEATURE_KIND_IDS, parseFeatures, parseParkId } from "@/lib/sources/overpass-features";
import { PARKS, rec } from "./support/pass-replay";

const celebration = parkPool(parseFeatures(rec(`overpass-features-${PARKS.celebration.slug}`).body, parseParkId(PARKS.celebration.id)!)!).items;
const byId = (id: string) => celebration.find((p) => p.id === id)!;

describe("Park Finds facts rotate per park and never give the answer away", () => {
  it("each kind has 3+ facts with no name word, no digit and no 'map'", () => {
    for (const kind of FEATURE_KIND_IDS) {
      const facts = KIND_FACTS[kind];
      expect(facts.length, kind).toBeGreaterThanOrEqual(3);
      for (const f of facts) {
        expect(nameLeak(f, FEATURE_KINDS[kind].nameWords), `${kind}: ${f}`).toBeNull();
        expect(f, kind).not.toMatch(/\d|\bmap\b/i);
      }
    }
  });

  it("two facts per park, picked by park id: the 20 eval parks don't all share one fact sheet", () => {
    const sheets = new Set(Array.from({ length: 20 }, (_, i) => factsFor("bench", `way/${1000 + i * 7919}`, 3).join(" ")));
    expect(sheets.size).toBeGreaterThanOrEqual(3);
    expect(factsFor("bench", "way/1", 3)).toEqual(factsFor("bench", "way/1", 3)); // stable
    expect(seedHash("a")).toBe(seedHash("a"));
    // "It is" becomes "Each one is" for a count of 2 or more.
    expect(factsFor("bench", "way/188145317", 4).some((f) => f.startsWith("Each one "))).toBe(true);
  });

  it("a count of 1 is 'a bridge' with no number, so no count clue is possible (ux m3: 'There is 1.')", () => {
    const bridge = byId("osm-bridge");
    expect(bridge.sourceText).toContain("Celebration Park has a bridge on the map (OpenStreetMap).");
    expect(bridge.evidence).toBe("1 on the park map · OpenStreetMap");
    expect(bridge.count).toEqual({ of: expect.arrayContaining(["way", "bridge"]), n: null });
    expect(byId("osm-soccer").count?.n).toBe(25);
  });
});

describe("count accuracy (judge M3: 'Count the goals ... There are 25.' for 25 soccer FIELDS)", () => {
  const soccer = () => byId("osm-soccer");
  it("drops counts of a part, wrong numbers and counts of one thing", () => {
    // Real clues, run 2026-10-06:
    expect(countProblem("Look for a big grass field. How many nets for goals can you see? There are 25.", soccer())).toMatch(/counts "net/);
    expect(countProblem("How many ways over the water can you find? There is 1.", byId("osm-bridge"))).toMatch(/no count of 2 or more/);
    expect(countProblem("Count the hoops on the tall poles. There are 2.", byId("osm-basketball"))).toMatch(/counts "hoop/);
    // Built here:
    expect(countProblem("Count 24 big grass fields.", soccer())).toMatch(/says 24, the map count is 25/);
    expect(countProblem("How many big grass fields can you find? There are three.", byId("osm-basketball"))).not.toBeNull();
  });
  it("keeps counts of the whole thing with the map's number, in describing words", () => {
    expect(countProblem("Bet you can't find 25 big grass areas with goals at the ends!", soccer())).toBeNull();
    expect(countProblem("How many long outdoor seats can you find? There are 4.", byId("osm-bench"))).toBeNull();
    expect(countProblem("How many seats hang from chains? There are 4.", byId("osm-bench"))).toBeNull();
    expect(countNouns("bench").has("seat")).toBe(true);
    expect(countProblem("Find a long seat for a rest.", byId("osm-bench"))).toBeNull(); // not a count clue
  });
  it("Wild Finds: a number must be in the source with the same noun after it", () => {
    const item = { section: "wild" as const, sourceText: "Its flowers have 5 white petals and leaves 5 to 8 cm long." };
    expect(countProblem("Find 5 white petals.", item)).toBeNull();
    expect(countProblem("Find a flower with five petals.", item)).toBeNull();
    expect(countProblem("Count the 5 spots on its wings.", item)).toMatch(/"5 spot/);
    expect(countProblem("Find 7 petals.", item)).toMatch(/7 is not in the source/);
  });
});

describe("generic Wild Find clues (judge M3: 'Look for a tree with seeds or fruit')", () => {
  const src = "Osage-orange (Maclura pomifera). The distinctive fruit is roughly spherical, bumpy, 8 to 15 centimetres in diameter, and turns a bright yellow-green in the fall. In October, iNaturalist photos from this area show it with fruit or seeds, not flowers.";
  it("drops clues with no trait from the source", () => {
    expect(isGenericClue("Look for a tree with seeds or fruit.", src)).toBe(true); // real, run 2026-10-06
    expect(isGenericClue("Can you find a plant with flowers in October?", src)).toBe(true);
    expect(isGenericClue("Find a plant with purple blooms.", src)).toBe(true); // purple is not in this source
  });
  it("keeps clues with a source trait, also in the child's words", () => {
    expect(isGenericClue("Do you see a tree with bumpy, yellow-green balls?", src)).toBe(false);
    expect(isGenericClue("Find a round bumpy fruit.", src)).toBe(false);
  });
  it("a quote that is only the name proves nothing", () => {
    expect(quoteIsOnlyName("American green anole", "Green Anole (Anolis carolinensis)")).toBe(false);
    expect(quoteIsOnlyName("Green Anole", "Green Anole (Anolis carolinensis)")).toBe(true);
  });
});

describe("prompt examples are not copied, and clues don't repeat on one pass", () => {
  it("the prompt has no good example clue to copy; every quoted example is in the copy list", () => {
    const mix = computeMix({ park: 6, wild: 8, lucky: 0 }, "6-10")!;
    const sys = systemPrompt("6-10", mix, null, { month: 10, hasSeasonNotes: true, voice: CLUE_VOICES[0] });
    expect(sys).not.toMatch(/Good:|ways over the water|roof on posts|long outdoor seats/);
    for (const b of BAD_CLUE_EXAMPLES) expect(sys).toContain(b.clue);
    expect(PROMPT_EXAMPLE_TEXTS).toEqual(expect.arrayContaining(BAD_CLUE_EXAMPLES.map((b) => b.clue)));
  });
  it("copiesPromptExample: >= 60% of the clue's trigrams (and 3+) in an example", () => {
    expect(copiesPromptExample("How many goals can you find? There are 25.")).not.toBeNull();
    expect(copiesPromptExample("Look for a tree with seeds or fruit.")).not.toBeNull();
    expect(copiesPromptExample("Find a place to climb.")).toBeNull(); // shares only the opener
    expect(copiesPromptExample("Find a plant with purple blooms.")).toBeNull();
  });
  it("a near-repeat of a kept clue on the same pass is dropped", () => {
    expect(trigramOverlap("Can you find a long seat for resting?", "Can you find a long seat for resting here?")).toBeGreaterThanOrEqual(0.6);
    const pool = celebration;
    const mix = { n: 3, min: { park: 1, wild: 0, lucky: 0 }, max: { park: 3, wild: 0, lucky: 0 }, hardMin: 0 };
    const item = (id: string, clue: string) => ({ itemId: id, clue, lookWhere: "", sourceQuote: byId(id).sourceText.slice(-40), difficulty: "easy" });
    const out = validateDraft({ items: [item("osm-bench", "Can you spot a seat by a nice view?"), item("osm-fountain", "Can you spot a seat by a nice view?")] }, pool, mix);
    expect(out.drops).toEqual({ repeats_clue: 1 });
  });
  it("one writing voice per park name, stable", () => {
    expect(voiceFor("Celebration Park")).toBe(voiceFor("Celebration Park"));
    const voices = new Set(["Celebration Park", "Connemara Meadow Preserve", "Arbor Hills Nature Preserve", "White Rock Lake Park", "Zilker Metropolitan Park", "Golden Gate Park"].map((p) => voiceFor(p)));
    expect(voices.size).toBeGreaterThanOrEqual(3);
  });
});

describe("spares: ask for one more, print at most n", () => {
  it("askMix adds ASK_EXTRA inside what each section has", () => {
    const mix = computeMix({ park: 10, wild: 0, lucky: 0 }, "6-10")!;
    expect(askMix(mix, { park: 10, wild: 0, lucky: 0 })).toMatchObject({ n: 8 + ASK_EXTRA, max: { park: 8 + ASK_EXTRA, wild: 0 } });
    const small = computeMix({ park: 3, wild: 0, lucky: 0 }, "6-10")!;
    expect(askMix(small, { park: 3, wild: 0, lucky: 0 }).n).toBe(3); // nothing more to ask for
  });
  it("fitToMix keeps section minimums and at most n", () => {
    const it = (section: "park" | "wild") => ({ item: { section } });
    const mix = { n: 3, min: { park: 1, wild: 1, lucky: 0 }, max: { park: 2, wild: 2, lucky: 0 }, hardMin: 0 };
    const out = fitToMix([it("park"), it("park"), it("wild"), it("wild")], mix);
    expect(out.items.map((x) => x.item.section)).toEqual(["park", "park", "wild"]);
    expect(out.spares).toBe(1);
  });
});

describe("the grown-up's note is code-written from the pass (judge M3: 'Have fun exploring nature with your child!')", () => {
  const v = (item: Partial<PoolItem> & Pick<PoolItem, "section">, difficulty: "easy" | "medium" | "hard") => ({ item: { stationary: true, safety: null, ...item } as PoolItem, difficulty });
  it("names an easy find that stays put, then the finds near water", () => {
    const note = parentNoteFor([v({ section: "park", safety: "Stay with your grown-up near water." }, "easy"), v({ section: "park" }, "easy"), v({ section: "wild", stationary: false }, "hard")]);
    expect(note).toBe("Start with find 2: it's easy and it stays put. Find 1 is near water: stay close.");
  });
  it("without water, says which finds can move away; empty when nothing applies", () => {
    expect(parentNoteFor([v({ section: "wild", stationary: false }, "hard"), v({ section: "wild", stationary: false }, "hard"), v({ section: "park" }, "medium")])).toBe(
      "Finds 2 and 3 can move away, so tick them off when you see them.",
    );
    expect(parentNoteFor([v({ section: "park" }, "medium")])).toBe("");
  });
  it("uses the printed order (Park Finds first)", () => {
    expect(parentNoteFor([v({ section: "wild" }, "easy"), v({ section: "park" }, "hard")])).toBe("Start with find 2: it's easy and it stays put.");
  });
});

describe("Wild Finds pool: species that say how they look", () => {
  it("looksScore counts looks-like words", () => {
    expect(looksScore("Helianthus maximiliani is a North American species of sunflower known by the common name Maximilian sunflower.")).toBe(0);
    expect(looksScore("Apothecia are bright-orange with spiny projections around the rim.")).toBeGreaterThanOrEqual(2);
  });
});

describe("eval M10 (cross-park repetition) and M11 (count accuracy)", () => {
  let cel: CaseData;
  beforeAll(async () => {
    cel = await loadCaseData(loadFixture("celebration-park"), loadCases().ageBand);
  });
  const run = (caseN: number, clues: string[]): RunRecord => ({
    caseN,
    slug: `p${caseN}`,
    parkName: `Park ${caseN}`,
    model: "m",
    run: 1,
    kind: "pass",
    sections: {},
    n: 8,
    dataRich: true,
    items: clues.map((clue) => ({ section: "park", clue, lookWhere: "", answer: "x" })),
    calls: [],
    wallMs: 0,
  });
  it("M10: a clue counts as repeated when its 5-word run is on 2+ OTHER parks' passes", () => {
    const same = "How many ways over the water can you find?";
    const r = crossParkRepetition([run(1, [same, "Find red bark."]), run(2, [same]), run(3, [same]), run(1, [same])], "m");
    expect(r.clues).toBe(5);
    expect(r.repeated).toBe(4); // park 1's two copies (other parks 2, 3), park 2's and park 3's
    expect(r.top[0]).toMatchObject({ parks: 3 });
    expect(ngrams("a b c d e. f g h i j", 5).size).toBe(2); // never across a sentence end
    expect(crossParkRepetition([run(1, [same]), run(2, [same])], "m").repeated).toBe(0); // only one other park
  });
  it("M11: wrong counts on a printed pass, with the pool it was made from", () => {
    const ctx = caseContext(2, cel);
    const soccer = ctx.pool.find((p) => p.id === "osm-soccer")!;
    const r: RunRecord = { ...run(2, []), items: [{ section: "park", clue: "Count the goals. There are 25.", lookWhere: "", answer: soccer.answer }, { section: "park", clue: "Find 25 big grass fields.", lookWhere: "", answer: soccer.answer }] };
    const c = countChecks(r, ctx);
    expect(c.printedCountClues).toBe(2);
    expect(c.printedWrong).toBe(1);
  });
});
