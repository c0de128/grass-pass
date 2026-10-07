/**
 * Content tuning (2026-10-06): completeness on low-data parks (M3), latency (M7) and cross-park
 * repetition (M10). Park pools come from the REAL recorded fixtures (Celebration Park; the 20 eval
 * parks). Clues marked "smoke 2026-10-06" are real Gemma 4 31B clues from evals/results; the others
 * are test inputs built here (what a model might write).
 */
import { describe, expect, it } from "vitest";
import { dropReasons, type CaseContext, type RunRecord } from "../../evals/score";
import { dropList } from "../../evals/report";
import { withRefill } from "@/lib/ai/build-pass";
import {
  buildMessages,
  isStrong,
  LOW_DATA_SLACK,
  OPENER_BANK,
  openersFor,
  openingWord,
  planRequest,
  refillPlan,
  refillRules,
  sparesFor,
  systemPrompt,
  type Mix,
} from "@/lib/ai/prompt";
import { ASK_EXTRA } from "@/lib/ai/schema";
import {
  copiedRun,
  countProblem,
  isCutOff,
  isGenericClue,
  sameOpening,
  stockOpening,
  suffixStem,
  validateDraft,
} from "@/lib/ai/validate";
import { chooseWords, countNouns, factsFor, KIND_FACTS, parkPool } from "@/lib/pool/park";
import type { PoolItem } from "@/lib/pool/types";
import { looksOutsideNames } from "@/lib/pool/wild";
import { FEATURE_KIND_IDS, parseFeatures, parseParkId } from "@/lib/sources/overpass-features";
import { PARKS, rec } from "./support/pass-replay";

const celebration = parkPool(parseFeatures(rec(`overpass-features-${PARKS.celebration.slug}`).body, parseParkId(PARKS.celebration.id)!)!).items;
const byId = (id: string) => celebration.find((p) => p.id === id)!;

/** A Wild Find built here (test input), with the fields the checks read. */
function wildItem(id: string, answer: string, summary: string, nameWords: string[], looks = 1): PoolItem {
  return {
    id,
    section: "wild",
    kind: "animal",
    sourceText: `${answer}. ${summary}`,
    answer,
    evidence: "seen once since Sep 21 · iNaturalist",
    source: "iNaturalist",
    nameWords,
    safety: null,
    stationary: false,
    looks,
  };
}

const draftItem = (item: PoolItem, clue: string, quote: string, difficulty = "easy") => ({ itemId: item.id, clue, lookWhere: "", sourceQuote: quote, difficulty });

describe("which pools are low data, and how many spares they get", () => {
  it("looks-like words count only outside the species' own names", () => {
    // Real summaries from the eval fixtures: "black" and "white" are only in the warbler's name; "white oak
    // section" names the bur oak's group; the Wilson's warbler summary really describes it.
    expect(looksOutsideNames("The black-and-white warbler is a species of New World warbler.", ["black-and-white warbler", "black", "white", "warbler", "mniotilta varia"])).toBe(0);
    expect(looksOutsideNames("Quercus macrocarpa, the bur oak, is a species of oak in the white oak section.", ["bur oak", "quercus macrocarpa", "quercus"])).toBe(0);
    expect(looksOutsideNames("It is greenish above and yellow below, with rounded wings and a long, slim tail.", ["wilson's warbler", "warbler"])).toBe(4); // yellow, rounded, wings, tail
  });

  it("a strong item is a Park Find or a Wild Find with looks outside its names; older items count as strong", () => {
    expect(isStrong(byId("osm-bench"))).toBe(true);
    expect(isStrong(wildItem("inat-1", "A", "x", [], 0))).toBe(false);
    expect(isStrong(wildItem("inat-2", "B", "x", [], 2))).toBe(true);
    expect(isStrong({ ...wildItem("inat-3", "C", "x", []), looks: undefined })).toBe(true);
  });

  it("spares: ASK_EXTRA for a low-data pool, none otherwise", () => {
    expect(sparesFor(8 + LOW_DATA_SLACK - 1, 8)).toBe(ASK_EXTRA);
    expect(sparesFor(8 + LOW_DATA_SLACK, 8)).toBe(0);
    expect(sparesFor(30, 8)).toBe(0);
  });

  it("planRequest: Celebration (11 Park Finds) asks for exactly 8; 9 strong items for 8 is low data with 1 spare", () => {
    const cel = planRequest(celebration, "6-10", "Celebration Park")!;
    expect([cel.lowData, cel.mix.n, cel.ask.n]).toEqual([false, 8, 8]);
    expect(cel.openers).toEqual(openersFor("Celebration Park", 8));
    expect(cel.validate).toEqual({ hasMap: false, ask: cel.ask, lowData: false, band: "6-10" });
    const nine = planRequest(celebration.slice(0, 9), "6-10", "P")!;
    expect([nine.lowData, nine.mix.n, nine.ask.n]).toEqual([true, 8, 9]);
    expect(planRequest(celebration.slice(0, 2), "6-10", "P")).toBeNull(); // the "all empty" path: no model call
  });
});

describe("openers (M10: 'I dare you to find' on 16 clues, 'Find a place with a' on 8 parks in run 2026-10-06-2)", () => {
  it("each park gets its own stable set of different first words", () => {
    const a = openersFor("Celebration Park", 8);
    expect(a).toHaveLength(8);
    expect(new Set(a).size).toBe(8);
    for (const o of a) expect(OPENER_BANK).toContain(o);
    expect(openersFor("Celebration Park", 8)).toEqual(a);
    expect(openersFor("Klyde Warren Park", 8)).not.toEqual(a);
    expect(openingWord("  Psst, count the roofs.")).toBe("psst");
  });

  it("the prompt asks for them, bans the stock openings and 'a place with', and has no 'dares' voice", () => {
    const sys = buildMessages("Celebration Park", celebration, "6-10", planRequest(celebration, "6-10", "Celebration Park")!.ask, null, { month: 10 })[0].content;
    expect(sys).toContain(`For this park use these, one per clue, in any order: ${openersFor("Celebration Park", 8).join(", ")}.`);
    // r7 follow-ups (M8): the worn-out starts are named in a short form (STOCK_FRAMES_PROMPT), plus the round-6 water shape.
    expect(sys).toContain('Never start with "Can you find", "Find a", "Look for", "I dare you", "Do you see" or these worn-out starts: "Somewhere you will/can see/hear/find"');
    // Completeness + M10 (run 2026-10-06-5): the frames Gemma repeated across parks are named, and so is the count trailer.
    for (const f of ["Where can you hear/find/see/spot", "Somewhere you will/can see/hear/find", "Hunt for a tree", "Where is the water that"]) expect(sys).toContain(`"${f}"`);
    expect(sys).toContain('Never end a clue with an added sentence such as "Count them.", "Count the 2 of them." or "There are 2.".');
    expect(sys).toContain('Never write "a place with", "a place where" or "a spot where"');
    expect(sys).toContain("never copy 3 or more words in a row from the SOURCE");
    expect(sys).not.toMatch(/dares/);
  });

  it("stock openings and same first words are spotted", () => {
    expect(stockOpening("I dare you to find a seat.")).toBe("i dare you"); // real pattern, run 2026-10-06-2
    expect(stockOpening("Can you find 2 spots where water splashes?")).toBe("can you find");
    expect(stockOpening("Findable things: a seat.")).toBeNull();
    expect(sameOpening("Peek at the tall pole.", "Peek at the low net.")).toBe(true);
    expect(sameOpening("Peek at the tall pole.", "Peek under the bridge.")).toBe(false);
  });
});

describe("Park Finds facts vary their words per park (M10: copied fact phrases on 4-5 parks)", () => {
  it("every word choice in every fact is free of the kind's name words, digits and 'map'", () => {
    // The kind name test in r2-content.test.ts reads every template, choices included; here: each choice expands.
    for (const kind of FEATURE_KIND_IDS) {
      for (const t of KIND_FACTS[kind]) {
        expect(t, kind).not.toMatch(/[{}]/.test(t) ? /\{[^}|]*\}/ : /$^/); // a slot always has 2+ choices
        const out = chooseWords(t, "x");
        expect(out).not.toMatch(/[{}|]/);
      }
    }
  });

  it("choices are stable per park and differ between parks", () => {
    const t = "It has a {roof|cover} {on|held up by} {posts|poles|pillars}.";
    expect(chooseWords(t, "way/1|shelter|0")).toBe(chooseWords(t, "way/1|shelter|0"));
    const texts = new Set(Array.from({ length: 20 }, (_, i) => chooseWords(t, `way/${1000 + i * 7919}|shelter|0`)));
    expect(texts.size).toBeGreaterThanOrEqual(5);
    // Real parks: Celebration's bench fact reads differently from the old one fixed sentence.
    // Audit R3-C1: the old fixed words "long outdoor seat" now have choices too.
    expect(byId("osm-bench").sourceText).toContain("Each one is a long seat outdoors for resting.");
    const sheets = new Set(Array.from({ length: 20 }, (_, i) => factsFor("playground", `way/${3000 + i * 104729}`, 1).join(" ")));
    expect(sheets.size).toBeGreaterThanOrEqual(8);
  });

  it("a count may use a word choice for the whole thing ('3 covers' for 3 shelters)", () => {
    expect(countNouns("shelter").has("cover")).toBe(true);
    const shelter = { section: "park" as const, sourceText: "P has 3 picnic shelters on the map (OpenStreetMap).", count: { of: [...countNouns("shelter")], n: 3 } };
    expect(countProblem("Count the covers on poles. There are 3.", shelter)).toBeNull();
    expect(countProblem("Count the tables. There are 3.", shelter)).not.toBeNull();
  });
});

describe("the checks (style is a preference, truth and safety are not)", () => {
  it("copiedRun: a 4-word run of its own source with 2+ describing words; numbers and filler runs are fine", () => {
    const src = byId("osm-playground").sourceText;
    // Run 2026-10-06-5 (M10): the playground fact got more word choices ("kids climb steps and ladders to reach the top" was on 3 parks).
    expect(src).toContain("Kids climb ladders and steps on it to reach the top of the play tower.");
    expect(copiedRun("Peek at the top of the play tower.", src)).toBe("top of the play");
    expect(copiedRun("Spy a playset with ladders.", src)).toBeNull();
    expect(copiedRun("Count them. It has 2 of these.", "Celebration Park has 2 playgrounds.")).toBeNull();
    expect(copiedRun("It is in the middle of it.", "It is in the middle of it.")).toBeNull(); // fewer than 2 describing words
  });

  it("suffixStem: the child's words match the source ('wades' ~ 'wading'), so this clue is not generic", () => {
    // Real clue, run 2026-10-06-2 (dropped as generic then): the Great Blue Heron at Spring Creek.
    const src = "Great Blue Heron (Ardea herodias). The great blue heron is a large wading bird in the heron family Ardeidae.";
    expect(suffixStem("wades")).toBe("wad");
    expect(suffixStem("wading")).toBe("wad");
    expect(isGenericClue("I am a big bird that wades in the wet areas.", src)).toBe(false);
    expect(isGenericClue("Look for a tree with seeds or fruit.", src)).toBe(true);
  });

  it("isCutOff: a clue that stops mid-sentence (smoke 2026-10-06: 'Hunt for a ')", () => {
    expect(isCutOff("Hunt for a ")).toBe(true);
    expect(isCutOff("Track a bird with a")).toBe(true);
    expect(isCutOff("Spot the long seats for resting")).toBe(false);
    expect(isCutOff("Listen! Do you hear water splashing?")).toBe(false);
    expect(isCutOff("Stop and count the roofs. There are 4.")).toBe(false);
  });

  it("a style item goes first when there is a spare; it prints (counted) when there is none", () => {
    const bench = byId("osm-bench");
    const fountain = byId("osm-fountain");
    const bridge = byId("osm-bridge");
    const copy = draftItem(bench, "Psst, find a long seat outdoors for resting.", "a long seat outdoors for resting");
    // Round-6 C4: Celebration's fountain facts are things to see now (the sound fact is 1 of 5), so its clue is a sight clue.
    const items = [copy, draftItem(fountain, "Peek at a basin where water pours down.", "water"), draftItem(bridge, "Wander over a path that crosses a dip.", "cross over water")];
    // test input: the fountain/bridge quotes are checked like any other (short ones fail grounding), so use real source text
    items[1].sourceQuote = fountain.sourceText.slice(-30);
    items[2].sourceQuote = bridge.sourceText.slice(-30);
    const mix2: Mix = { n: 2, min: { park: 2, wild: 0, lucky: 0 }, max: { park: 2, wild: 0, lucky: 0 }, hardMin: 0 };
    const ask3: Mix = { ...mix2, n: 3, max: { park: 3, wild: 0, lucky: 0 } };
    const withSpare = validateDraft({ items }, celebration, mix2, { hasMap: false, ask: ask3 });
    expect(withSpare.items.map((i) => i.item.id)).toEqual(["osm-fountain", "osm-bridge"]);
    expect(withSpare.drops).toEqual({ copies_source: 1 });
    expect(withSpare.copied).toEqual(["a long seat outdoors"]);
    const noSpare = validateDraft({ items: items.slice(0, 2) }, celebration, mix2, { hasMap: false });
    expect(noSpare.items.map((i) => i.item.id)).toEqual(["osm-bench", "osm-fountain"]);
    expect(noSpare.items[0].style).toBe("copies_source");
    expect([noSpare.styleKept, noSpare.drops]).toEqual([1, {}]);
  });

  it("low data: a near-repeat is a preference; never safety, grounding, leaks or counts", () => {
    const bench = byId("osm-bench");
    const water = byId("osm-water");
    const mix: Mix = { n: 2, min: { park: 1, wild: 0, lucky: 0 }, max: { park: 2, wild: 0, lucky: 0 }, hardMin: 0 };
    const same = "Sneak to a quiet seat by the path.";
    const a = draftItem(bench, same, bench.sourceText.slice(-30));
    // Audit R4-C2: the same FIRST word twice is a drop on every pass now, so the near-repeat starts with another word.
    const b = draftItem(water, `Now ${same.charAt(0).toLowerCase()}${same.slice(1)}`, water.sourceText.slice(-30));
    expect(validateDraft({ items: [a, b] }, celebration, mix, { hasMap: false }).drops).toEqual({ repeats_clue: 1 });
    const low = validateDraft({ items: [a, b] }, celebration, mix, { hasMap: false, lowData: true });
    expect(low.items).toHaveLength(2);
    expect(low.styleKept).toBe(1);
    // The hard checks are the same on a low-data pool.
    const bad = [
      draftItem(bench, "Find the bench by the path.", bench.sourceText.slice(-30)), // name leak
      draftItem(water, "Spot a mirror of gold.", "a lake made of gold"), // not grounded
      draftItem(bench, "Count the 7 seats.", bench.sourceText.slice(-30)), // number not in source
    ];
    bad[2].itemId = "osm-bench";
    const out = validateDraft({ items: bad.slice(0, 2) }, celebration, mix, { hasMap: false, lowData: true });
    expect(out.drops).toEqual({ name_leak: 1, not_grounded: 1 });
    expect(out.failedIds).toEqual(["osm-bench", "osm-water"]);
    expect(validateDraft({ items: [bad[2]] }, celebration, mix, { hasMap: false, lowData: true }).drops).toEqual({ number_not_in_source: 1 });
  });

  it("low data: a name-only quote passes the generic check only when the clue's trait is in that quote", () => {
    const spider = wildItem("inat-67707", "Yellow Garden Spider (Argiope aurantia)", "The spider species Argiope aurantia is commonly known as the yellow garden spider.", ["garden spider", "argiope aurantia", "argiope", "aurantia"]);
    const snail = wildItem("inat-126257", "Globular Drop Snail (Helicina orbiculata)", "Helicina orbiculata is a species of land snail with an operculum.", ["globular drop snail", "globular", "helicina orbiculata", "helicina", "orbiculata"]);
    const pool = [spider, snail];
    const mix: Mix = { n: 2, min: { park: 0, wild: 1, lucky: 0 }, max: { park: 0, wild: 2, lucky: 0 }, hardMin: 0 };
    const yellow = draftItem(spider, "Peek at a web maker that is bright yellow!", "yellow garden spider"); // real clue, run 2026-10-06-2 (Spring Creek)
    const round = draftItem(snail, "What small shell has a round shape?", "land snail with an operculum"); // real refill clue, 2026-10-06
    expect(validateDraft({ items: [yellow, round] }, pool, mix, { hasMap: false }).drops).toEqual({ generic_clue: 2 });
    const low = validateDraft({ items: [yellow, round] }, pool, mix, { hasMap: false, lowData: true });
    expect(low.items.map((i) => i.item.id)).toEqual(["inat-67707"]);
    expect(low.drops).toEqual({ generic_clue: 1 });
  });

  it("cut-off clues are dropped as broken output", () => {
    const bench = byId("osm-bench");
    const mix: Mix = { n: 1, min: { park: 1, wild: 0, lucky: 0 }, max: { park: 1, wild: 0, lucky: 0 }, hardMin: 0 };
    expect(validateDraft({ items: [draftItem(bench, "Hunt for a ", bench.sourceText.slice(-30))] }, celebration, mix).drops).toEqual({ cut_off: 1 });
  });
});

describe("the one retry is a refill", () => {
  const plan = planRequest(celebration.slice(0, 9), "6-10", "P")!;
  const kept = (ids: string[]) => ids.map((id) => ({ item: byId(id), clue: `Peek ${id}`, difficulty: "easy" }));

  it("asks only for what is missing (+1 spare), from unused items, leaving out ones that failed when it can", () => {
    const k = kept(["osm-basketball", "osm-tennis", "osm-soccer", "osm-baseball", "osm-playground"]);
    const unused = plan.pool.filter((p) => !k.some((x) => x.item.id === p.id)).map((p) => p.id);
    const r = refillPlan(plan, k, [unused[0]])!;
    expect(r.mix.n).toBe(3);
    expect(r.pool.map((p) => p.id)).toEqual(unused.slice(1));
    expect(r.ask.n).toBe(3); // 3 unused left after the failed one: no room for a spare
    // When leaving the failed items out would not fill the need, they stay on offer.
    const all = refillPlan(plan, k, unused)!;
    expect(all.pool.map((p) => p.id)).toEqual(unused);
    // The used openers go last.
    expect(r.openers.length).toBeGreaterThan(0);
    expect(refillPlan(plan, kept(plan.pool.slice(0, 8).map((p) => p.id)))).toBeNull(); // nothing missing
  });

  it("the refill prompt says what went wrong, quoting at most 6 copied phrases", () => {
    const rules = refillRules({ copied: ["a", "b", "c", "d", "e", "f", "g"], generic: true }).join("\n");
    expect(rules).toContain("This is a second try");
    expect(rules).toContain('"f"');
    expect(rules).not.toContain('"g"');
    expect(rules).toContain("Some first-try clues were generic.");
    expect(systemPrompt("6-10", plan.ask, null, { month: 10, refill: { copied: [], generic: false } })).toContain("This is a second try");
  });

  it("withRefill keeps both answers' items and counts both answers' removals", () => {
    const mix = plan.mix;
    const first = { items: [], drops: { generic_clue: 2 }, returned: 9, parentNote: "", belowMin: [], hardCount: 0, lookWhereCleared: 0, quotesRepaired: 0 };
    const second = { ...first, drops: { name_leak: 1 }, returned: 3 };
    const merged = withRefill(first, second, mix);
    expect(merged.drops).toEqual({ generic_clue: 2, name_leak: 1 });
    expect(merged.returned).toBe(12);
  });
});

describe("eval: why items were dropped (replayed with the app's checks)", () => {
  it("dropReasons replays every call with the app's request plan; the report lists them largest first", () => {
    const plan = planRequest(celebration, "6-10", "Celebration Park")!;
    const ctx = { caseN: 2, parkName: "Celebration Park", pool: celebration, n: 8, dataRich: true, totalObservations: 0, parkEmpty: false, wildEmpty: true, blockedNames: [], plan } as CaseContext;
    const bench = byId("osm-bench");
    const run = {
      caseN: 2,
      slug: "celebration-park",
      parkName: "Celebration Park",
      model: "gemma-4-31B-it",
      run: 1,
      kind: "pass",
      sections: {},
      n: 8,
      dataRich: true,
      items: [],
      calls: [
        {
          latencyMs: 1,
          status: 200,
          error: null,
          promptTokens: 1,
          completionTokens: 1,
          finishReason: "stop",
          answeredModel: "gemma-4-31B-it",
          poolMatches: true,
          rawItems: [draftItem(bench, "Find the bench!", bench.sourceText.slice(-30)), draftItem(bench, "Hunt for a ", bench.sourceText.slice(-30))],
        },
      ],
      wallMs: 1,
    } as RunRecord;
    expect(dropReasons(run, ctx)).toEqual({ name_leak: 1, cut_off: 1 });
    expect(dropList({ name_leak: 1, generic_clue: 3 })).toBe("generic_clue 3, name_leak 1");
    expect(dropList({})).toBe("none");
  });
});
