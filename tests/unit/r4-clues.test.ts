/**
 * Audit round 4 clue voice and repeats (judge C2, quality Q-4-04 + content notes, ux UX-4-04, eval M10).
 * The clues the checks are proven on are real model clues: from the recorded eval runs
 * (evals/results/2026-10-0*), the saved example passes, or the auditors' live passes (named where used).
 * The validateDraft plumbing tests (one riddle per pass, first word twice, a hint left out, hard items
 * kept) use short clues written for the test on real pool items, as the older check tests do.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { caseDataOrNull, loadFixture, type CaseData } from "../../evals/fixture";
import { OPENER_BANK, CLUE_VOICES, OLDER_VOICES, HARD_EXTRA, planRequest, systemPrompt, type Mix } from "@/lib/ai/prompt";
import {
  DROP_REASONS,
  fitToMix,
  isRiddleFrame,
  oddWording,
  parkLookProblem,
  questionCountMix,
  traitPartLeak,
  trimFillerOpening,
  validateDraft,
} from "@/lib/ai/validate";
import { chooseWords, factsFor, KIND_FACTS } from "@/lib/pool/park";
import { namePart, nameTraitParts } from "@/lib/pool/wild";
import type { PoolItem } from "@/lib/pool/types";
import { hardShortNote } from "@/lib/pass/short-copy";
import { DROP_REASON_INFO } from "@/lib/how/drop-reasons";

const data: Record<string, CaseData> = {};
beforeAll(async () => {
  for (const slug of ["arbor-hills-nature-preserve", "white-rock-lake-park", "trinity-river-audubon-center", "celebration-park"]) {
    const r = await caseDataOrNull(loadFixture(slug), "6-10");
    if (!r.data) throw new Error(r.problem ?? slug);
    data[slug] = r.data;
  }
}, 120_000);

const item = (slug: string, answer: RegExp): PoolItem => {
  const it = data[slug].pool.find((p) => answer.test(p.answer));
  if (!it) throw new Error(`no ${answer} in ${slug}`);
  return it;
};
/** One model item for `it`, its quote a real piece of its own source. */
const draft = (it: PoolItem, clue: string, quote = it.sourceText.split(/[.;]/).find((s) => s.trim().split(/\s+/).length >= 3)?.trim() ?? it.sourceText, difficulty = "medium") => ({
  itemId: it.id,
  clue,
  lookWhere: "",
  sourceQuote: quote.split(/\s+/).slice(0, 8).join(" "),
  difficulty,
});
const oneOf = (section: "park" | "wild", n = 1): Mix => ({
  n,
  min: { park: section === "park" ? 1 : 0, wild: section === "wild" ? 1 : 0, lucky: 0 },
  max: { park: section === "park" ? n : 0, wild: section === "wild" ? n : 0, lucky: 0 },
  hardMin: 0,
});

describe("C2: a name's own describing phrase is a hard leak; a lone colour word stays a preference", () => {
  it("finds the trait + part pairs of a name", () => {
    expect(nameTraitParts("Red-tailed Hawk")).toEqual([{ trait: "red", part: "tail" }]);
    expect(nameTraitParts("Eastern Amberwing")).toEqual([{ trait: "amber", part: "wing" }]);
    expect(nameTraitParts("Greater Yellowlegs")).toEqual([{ trait: "yellow", part: "leg" }]);
    expect(nameTraitParts("White-eyed Vireo")).toEqual([{ trait: "white", part: "eye" }]);
    expect(nameTraitParts("valley redstem")).toEqual([{ trait: "red", part: "stem" }]);
    expect(nameTraitParts("Red-winged Blackbird")).toEqual([{ trait: "red", part: "wing" }]);
    // No part in the name: only the lone colour word (a preference) is left.
    expect(nameTraitParts("Great Blue Heron")).toEqual([]);
    expect(nameTraitParts("White Morning-glory")).toEqual([]);
    expect(namePart("tailed")).toBe("tail");
    expect(namePart("leaved")).toBe("leaf");
    expect(namePart("spotted")).toBe("spot");
    expect(namePart("hawk")).toBeNull();
  });

  it("the pool carries them (Arbor Hills' Red-tailed Hawk, White Rock's Greater Yellowlegs)", () => {
    expect(item("arbor-hills-nature-preserve", /^Red-tailed Hawk/).nameTraitParts).toEqual([{ trait: "red", part: "tail" }]);
    expect(item("white-rock-lake-park", /^Greater Yellowlegs/).nameTraitParts).toContainEqual({ trait: "yellow", part: "leg" });
  });

  it("real clues that spell the name out are caught; real clues with a lone colour or another part are not", () => {
    const hawk = [{ trait: "red", part: "tail" }];
    // Arbor Hills example pass (judge round 4) and Llama in eval run 2026-10-06-4.
    expect(traitPartLeak("Glance up for a bird with a red tail.", hawk)).toBe("red tail");
    expect(traitPartLeak("Look up for a big bird with a red tail.", hawk)).toBe("red tail");
    // Eval runs: a red mark on another part, and Red-shouldered Hawk's 'red-brown patch' on its wings (no shoulder), are not the name.
    expect(traitPartLeak("Track a tiny insect with a red mark on its wing.", hawk)).toBeNull();
    expect(traitPartLeak("What has wings with a special red-brown patch?", [{ trait: "red", part: "shoulder" }])).toBeNull();
    expect(traitPartLeak("Find a hawk with red on its shoulder.", [{ trait: "red", part: "shoulder" }])).toBe("red shoulder");
    // Gemma, eval runs: Eastern Amberwing, White-eyed Vireo, Greater Yellowlegs.
    expect(traitPartLeak("Can you find a tiny bug with orange or amber wings?", [{ trait: "amber", part: "wing" }])).toBe("amber wing");
    expect(traitPartLeak("Squint to see a tiny bird with a white eye.", [{ trait: "white", part: "eye" }])).toBe("white eye");
    expect(traitPartLeak("Discover a big wading bird with yellow legs?", [{ trait: "yellow", part: "leg" }])).toBe("yellow leg");
  });

  it("validateDraft drops it as name_leak even with no spare; White Morning-glory's 'white flowers' stays a kept preference", () => {
    const hawk = item("arbor-hills-nature-preserve", /^Red-tailed Hawk/);
    const out = validateDraft({ items: [draft(hawk, "Glance up for a big bird with a red tail.")] }, data["arbor-hills-nature-preserve"].pool, oneOf("wild"));
    expect(out.drops).toEqual({ name_leak: 1 });
    expect(out.items).toHaveLength(0);
    const glory = item("white-rock-lake-park", /^White Morning-glory/);
    const kept = validateDraft({ items: [draft(glory, "Hunt for a vine with white flowers.", "show it with flowers")] }, data["white-rock-lake-park"].pool, oneOf("wild"));
    expect(kept.drops).toEqual({});
    expect(kept.items[0].style).toBe("name_trait");
  });
});

describe("C2: clue voice", () => {
  it("the opener bank holds no rotating fancy verbs, and no voice asks for 'I and my' riddles", () => {
    for (const w of ["Explore", "Glance", "Track", "Seek", "Discover", "Scan", "Squint", "Tiptoe", "Sneak", "Wander", "Spy"]) expect(OPENER_BANK).not.toContain(w);
    expect(OPENER_BANK.length).toBeGreaterThanOrEqual(9); // 8 finds + 1 spare get different first words
    for (const v of [...CLUE_VOICES, ...OLDER_VOICES]) expect(v).not.toMatch(/\bI and my\b|talks about itself/);
    const sys = systemPrompt("6-10", { n: 8, min: { park: 2, wild: 2, lucky: 1 }, max: { park: 5, wild: 5, lucky: 1 }, hardMin: 0 });
    expect(sys).toContain("At most ONE clue on the pass may be a riddle");
    expect(sys).toContain('never as a one-word opener such as "Maybe!"');
    expect(sys).toContain("for a red-tailed hawk never say a red tail");
  });

  it("odd openings: 'Explore for', 'Wander to find', 'Glance up for', 'Track a ride' (real clues)", () => {
    expect(oddWording("Explore for a bug with red shoulders.")).toBe("explore for");
    expect(oddWording("Explore to find me. I have 4 of my kind. I give shade from the sun.")).toBe("explore to find");
    expect(oddWording("Wander to find a smooth slope you sit on and whoosh down.")).toBe("wander to find");
    expect(oddWording("Glance up for a bird with a crest on its head.")).toBe("glance up for");
    expect(oddWording("Track a ride with two wheels and pedals that you might see.")).toBe("track a ride");
    expect(oddWording("Spot a smooth slope you sit on and whoosh down.")).toBeNull();
    expect(oddWording("Watch for a bird with a crest on its head.")).toBeNull();
  });

  it("'Maybe!' as an opener is filler (UX-4-04, the Arbor Hills Lucky Find); 'maybe' inside the sentence stays", () => {
    expect(trimFillerOpening("Maybe! Track a ride with two wheels and pedals that you might see.")).toBe("Track a ride with two wheels and pedals that you might see.");
    expect(trimFillerOpening("Perhaps, a dog on a leash trots by the path today.")).toBe("A dog on a leash trots by the path today.");
    expect(trimFillerOpening("Maybe you will see a dog on a leash trot by the path.")).toBe("Maybe you will see a dog on a leash trot by the path.");
  });

  it("a question mixed with a count is caught; a count task or 'Can you spot 4 ...?' stays (real clues)", () => {
    const park = { count: { of: ["roof", "shelter"], n: 4 } };
    // Quality audit round 4, live 10-13 pass; judge round 4; eval runs.
    expect(questionCountMix("Which roof held up by poles has tables below it? Count 4 of them.", park)).not.toBeNull();
    expect(questionCountMix("Which long seat outdoors can you find 2 of?", { count: { of: ["seat"], n: 2 } })).not.toBeNull();
    expect(questionCountMix("Who left signs that tell something from long ago? Count the 2 markers.", { count: { of: ["sign"], n: 2 } })).not.toBeNull();
    expect(questionCountMix("Which 4 roofed spots have poles and tables for picnics?", park)).not.toBeNull();
    expect(questionCountMix("Can you spot 4 long outdoor seats for resting?", { count: { of: ["seat"], n: 4 } })).toBeNull();
    expect(questionCountMix("Count the 4 walkways with railings on both sides.", park)).toBeNull();
    // A Wild Find question with a number from its source is not a map count.
    expect(questionCountMix("Which bird has 2 white bars on each wing?", {})).toBeNull();
  });

  it("at most one 'I am' riddle per pass, and no first word twice on a pass (both are drops now)", () => {
    const pool = data["celebration-park"].pool;
    const parks = pool.filter((p) => p.section === "park").slice(0, 3);
    const mix: Mix = { n: 3, min: { park: 1, wild: 0, lucky: 0 }, max: { park: 3, wild: 0, lucky: 0 }, hardMin: 0 };
    expect(isRiddleFrame("Point to me; I am a board with words and pictures.")).toBe(true);
    expect(isRiddleFrame("Discover my small arc of water that bobs up from my spout.")).toBe(true);
    expect(isRiddleFrame("Point to a board with words and pictures about the park.")).toBe(false);
    const riddles = validateDraft(
      { items: [draft(parks[0], "Point to me; I am a long seat for a rest."), draft(parks[1], "Hunt for me; I am a seat on a coil."), draft(parks[2], "Watch for water that sprays up.")] },
      pool,
      mix,
    );
    expect(riddles.drops.riddle_frame).toBe(1);
    const glance = validateDraft(
      { items: [draft(parks[0], "Glance at the paths to count them."), draft(parks[1], "Glance at a seat on a coil."), draft(parks[2], "Watch for water that sprays up.")] },
      pool,
      mix,
    );
    expect(glance.drops.repeats_opening).toBe(1);
    expect(glance.items.map((v) => v.clue)).not.toContain("Glance at a seat on a coil.");
  });

  it("a Park Find's 'on the ground' hint is left out (quality round 4: a bridge and a picnic shelter); a path hint stays", () => {
    expect(parkLookProblem("on the ground", "osm-bridge")).not.toBeNull();
    expect(parkLookProblem("on the ground", "osm-shelter")).not.toBeNull();
    expect(parkLookProblem("up in the sky", "osm-tower")).not.toBeNull();
    expect(parkLookProblem("near the water", "osm-water")).not.toBeNull();
    expect(parkLookProblem("by the path", "osm-bench")).toBeNull();
    expect(parkLookProblem("near the water", "osm-fountain")).toBeNull();
    const pool = data["celebration-park"].pool;
    const shelter = pool.find((p) => p.id === "osm-shelter") ?? pool.find((p) => p.section === "park")!;
    const out = validateDraft({ items: [{ ...draft(shelter, "Spot a roof that keeps the rain off the tables."), lookWhere: "on the ground" }] }, pool, oneOf("park"));
    expect(out.items[0].lookWhere).toBe("");
    expect(out.lookWhereCleared).toBe(1);
  });

  it("every new drop reason is explained on /how-it-works", () => {
    for (const r of ["odd_wording", "riddle_frame"] as const) {
      expect(DROP_REASONS).toContain(r);
      expect(DROP_REASON_INFO[r].kind).toBe("always");
    }
  });
});

describe("Q-4-04: ages 10-13 promise 2 hard finds", () => {
  it("the request asks for one hard item more than the pass promises", () => {
    const plan = planRequest(data["arbor-hills-nature-preserve"].pool, "10-13", "Arbor Hills Nature Preserve")!;
    expect(plan.mix.hardMin).toBe(2);
    expect(plan.ask.hardMin).toBe(2 + HARD_EXTRA);
    expect(planRequest(data["arbor-hills-nature-preserve"].pool, "6-10", "Arbor Hills Nature Preserve")!.ask.hardMin).toBe(0);
  });

  it("hard items are the last to go when spares are trimmed", () => {
    const pool = data["celebration-park"].pool.filter((p) => p.section === "park").slice(0, 4);
    const v = pool.map((p, i) => ({ item: p, difficulty: i < 2 ? "easy" : "hard" }));
    const mix: Mix = { n: 3, min: { park: 1, wild: 0, lucky: 0 }, max: { park: 4, wild: 0, lucky: 0 }, hardMin: 2 };
    const kept = fitToMix(v, mix).items;
    expect(kept.filter((x) => x.difficulty === "hard")).toHaveLength(2);
    expect(kept).toHaveLength(3);
  });

  it("the grown-up's stub says so when fewer hard finds made it (never for the younger bands)", () => {
    const items = (hard: number) => Array.from({ length: 6 }, (_, i) => ({ difficulty: (i < hard ? "hard" : "easy") as "hard" | "easy" })) as never;
    expect(hardShortNote({ ageBand: "10-13", items: items(1) })).toBe("Ages 10-13 aim for 2 hard finds; only 1 of today's finds is marked hard, because fewer hard clues passed our checks.");
    expect(hardShortNote({ ageBand: "10-13", items: items(0) })).toContain("none of today's finds is marked hard");
    expect(hardShortNote({ ageBand: "10-13", items: items(2) })).toBeNull();
    expect(hardShortNote({ ageBand: "6-10", items: items(0) })).toBeNull();
  });
});

describe("M10 fix A: the fact phrases that repeated across parks in run 2026-10-06-4 now have word choices", () => {
  it("each hot phrase reads at least 6 ways across 40 park ids", () => {
    const hot: [Parameters<typeof factsFor>[0], number, RegExp][] = [
      ["bridge", 0, /over|above/],
      ["baseball", 0, /base/],
      ["creek", 0, /water/],
      ["drinking_water", 0, /water/],
      ["drinking_water", 1, /spout/],
      ["bench", 2, /lean/],
      ["playground", 0, /climb/],
      ["volleyball", 0, /net/],
      ["tennis", 0, /net/],
      ["picnic_table", 0, /table/],
    ];
    for (const [kind, at, re] of hot) {
      const t = KIND_FACTS[kind][at];
      expect(t, kind).toMatch(re);
      const ways = new Set(Array.from({ length: 40 }, (_, i) => chooseWords(t, `way/${5000 + i * 7919}|${kind}|${at}`)));
      expect(ways.size, `${kind} fact ${at}`).toBeGreaterThanOrEqual(6);
    }
  });
});
