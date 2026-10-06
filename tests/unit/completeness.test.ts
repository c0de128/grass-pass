/**
 * Completeness and repeats after eval run 2026-10-06-5 (Gemma M3 98.0% -> 84.3%, M10 9.6%, 10-13 smoke 1 of 3).
 * The checks are proven on real model clues quoted from the saved runs (evals/results/2026-10-06-5.json,
 * 2026-10-06-partial-1439.json, the example passes) on the real recorded pools of those parks. The model-call
 * plumbing tests (a timed-out first call, a timed-out refill, a refused call) build the failure, as the older
 * failure tests do, and say so; every answer that is not built is a real recorded one.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { caseDataOrNull, loadFixture, type CaseData } from "../../evals/fixture";
import { templateDraft, templatePass } from "../../evals/baseline";
import { ASK_EXTRA, REFILL_SPARES } from "@/lib/ai/schema";
import { planRequest, refillPlan, refillRules, refillSparesFor, STOCK_FRAMES, systemPrompt, type Mix } from "@/lib/ai/prompt";
import {
  countProblem,
  isGenericClue,
  questionCountMix,
  stockOpening,
  traitWords,
  trimCountTrailer,
  validateDraft,
  voiceSwitch,
} from "@/lib/ai/validate";
import { MAX_MODEL_CALLS, REFILL_TIMEOUT_MS, WHOLE_RETRY_MIN_LEFT_MS } from "@/lib/ai/build-pass";
import { resetStores } from "@/lib/cache/store";
import { setLogSink } from "@/lib/log";
import { makePass, resetPassMaking } from "@/lib/pass/make";
import { disableSavedOsmForTests, resetSavedOsm } from "@/lib/sources/osm-snapshot";
import type { PoolItem } from "@/lib/pool/types";
import { modelRec, PARKS, passReplay, recordedShape, type Call } from "./support/pass-replay";

const data: Record<string, CaseData> = {};
beforeAll(async () => {
  for (const slug of ["arbor-hills-nature-preserve", "allen-station-park", "cedar-ridge-preserve", "zilker-metropolitan-park", "central-park", "connemara-meadow-preserve", "klyde-warren-park"]) {
    const r = await caseDataOrNull(loadFixture(slug), "6-10");
    if (!r.data) throw new Error(r.problem ?? slug);
    data[slug] = r.data;
  }
}, 120_000);

const item = (slug: string, id: string): PoolItem => {
  const it = data[slug].pool.find((p) => p.id === id);
  if (!it) throw new Error(`no ${id} in ${slug}`);
  return it;
};
const oneOf = (section: "park" | "wild", n = 1): Mix => ({
  n,
  min: { park: section === "park" ? 1 : 0, wild: section === "wild" ? 1 : 0, lucky: 0 },
  max: { park: section === "park" ? n : 0, wild: section === "wild" ? n : 0, lucky: 0 },
  hardMin: 0,
});
/** One model item for `it`, its quote a real piece of its own source. */
const draft = (it: PoolItem, clue: string, quote?: string) => ({
  itemId: it.id,
  clue,
  lookWhere: "",
  sourceQuote: quote ?? it.sourceText.split(/[.;]/).find((s) => s.trim().split(/\s+/).length >= 3)!.trim().split(/\s+/).slice(0, 8).join(" "),
  difficulty: "medium",
});

describe("refills ask for 2 spares and say which first words are taken", () => {
  it("2 or more missing: the missing items + REFILL_SPARES; 1 missing: + ASK_EXTRA", () => {
    expect(REFILL_SPARES).toBe(2);
    expect(refillSparesFor(1)).toBe(ASK_EXTRA);
    expect(refillSparesFor(2)).toBe(2);
    expect(refillSparesFor(5)).toBe(2);
  });

  it("a real pool (Klyde Warren, missed twice in run -5): 3 kept of 8 -> the refill asks for 5 + 2", () => {
    const plan = planRequest(data["klyde-warren-park"].pool, "6-10", "Klyde Warren Park")!;
    const kept = plan.pool.filter((p) => p.section === "park").slice(0, 3).map((p) => ({ item: p, clue: `Spot ${p.id}.` }));
    const rp = refillPlan(plan, kept)!;
    expect(rp.mix.n).toBe(plan.mix.n - 3);
    expect(rp.ask.n).toBe(Math.min(rp.mix.n + 2, rp.pool.length));
  });

  it("the refill prompt lists the first words already on the pass (7 refill items were dropped as repeats_opening in run -5)", () => {
    const rules = refillRules({ copied: [], generic: false, taken: ["count", "peek", "which", "peek"] });
    expect(rules).toContain('- Clues already on the pass start with: "Count", "Peek", "Which". Never start a clue with any of these words.');
    expect(refillRules({ copied: [], generic: false })).toHaveLength(1);
  });

  it("calls are bounded: at most MAX_MODEL_CALLS, a short refill timeout, and a whole retry only with a first call's time left", () => {
    expect(MAX_MODEL_CALLS).toBe(3);
    expect(REFILL_TIMEOUT_MS).toBe(20_000);
    expect(WHOLE_RETRY_MIN_LEFT_MS).toBe(25_000);
  });
});

describe("M10: worn-out clue frames and the bolted-on count sentence (run 2026-10-06-5)", () => {
  it("the frames Gemma repeated across parks are stock openings (a preference) and named in the prompt", () => {
    expect(stockOpening("Somewhere you will see a vine with large, intricate flowers.")).toBe("somewhere you will see"); // Arbor Hills
    expect(stockOpening("Where can you hear water gurgling as you get close?")).toBe("where can you hear"); // Klyde Warren
    expect(stockOpening("Somewhere you can hear water splashing as you get near.")).toBe("somewhere you can hear"); // Celebration
    expect(stockOpening("Where can you find a field with a reddish dirt infield?")).toBe("where can you find"); // Central Park
    expect(stockOpening("Hunt for a tree with bumpy, yellow-green fruit.")).toBe("hunt for a tree"); // Connemara
    expect(stockOpening("Where is the way that goes high over water with railings on the sides?")).toBeNull();
    const mix: Mix = { n: 8, min: { park: 2, wild: 2, lucky: 0 }, max: { park: 6, wild: 6, lucky: 0 }, hardMin: 0 };
    const sys = systemPrompt("6-10", mix, null, { month: 10, openers: ["Spot", "Where", "Somewhere"] });
    for (const f of STOCK_FRAMES) expect(sys).toContain(`"${f}"`);
    expect(sys).toContain('After "Somewhere" or "Where", go straight to the thing\'s own detail.');
    expect(sys).toContain("never switches to the thing talking (I, me, my) in a later sentence");
  });

  it("trimCountTrailer takes off the count sentence when the rest is a clue of its own (real clues)", () => {
    expect(trimCountTrailer("Notice the long seats for a rest. Count the 2 of them.")).toBe("Notice the long seats for a rest."); // Arbor Hills, -5
    expect(trimCountTrailer("Somewhere you can hear your feet clomp on planks. Count the 2 of them.")).toBe("Somewhere you can hear your feet clomp on planks."); // Cedar Ridge, -5
    expect(trimCountTrailer("Somewhere you will see a place to play. Count the 4 of them.")).toBe("Somewhere you will see a place to play."); // Zilker, -5
    expect(trimCountTrailer("Where can you hear your feet clomp on boards? Count them. There are 8.")).toBe("Where can you hear your feet clomp on boards?"); // Oak Point, -5
    expect(trimCountTrailer("Notice a long seat outdoors for a rest. There are 2.")).toBe("Notice a long seat outdoors for a rest."); // Arbor example pass
    expect(trimCountTrailer("Where are the seats with benches joined to their legs? Count the 4 of them.")).toBe("Where are the seats with benches joined to their legs?"); // Zilker, -5
    // A count task keeps its number sentence, and a trailer alone is not trimmed to nothing.
    expect(trimCountTrailer("Count the benches. There are 9.")).toBe("Count the benches. There are 9."); // Bob Woodruff, -5
    expect(trimCountTrailer("Count the tables for eating. There are 3.")).toBe("Count the tables for eating. There are 3."); // Arbor Hills, -5
    expect(trimCountTrailer("Count the 2 of them.")).toBe("Count the 2 of them.");
    expect(trimCountTrailer("Spot 2 flat smooth courts with a metal ring on a tall post.")).toBe("Spot 2 flat smooth courts with a metal ring on a tall post."); // Celebration fixture
  });

  it("validateDraft prints the trimmed clue and counts it (a Park Find of Arbor Hills)", () => {
    const bench = item("arbor-hills-nature-preserve", "osm-bench");
    const v = validateDraft({ items: [draft(bench, "Notice the long seats for a rest. Count the 2 of them.")] }, [bench], oneOf("park"), { hasMap: false });
    expect(v.items.map((i) => i.clue)).toEqual(["Notice the long seats for a rest."]);
    expect(v.trailersTrimmed).toBe(1);
  });
});

describe("drop review: false positives in run -5's new drops (real clues, real pools)", () => {
  it("wrong_count: 'spaces' and 'still waters' and a table's 'flat tops' count the whole thing", () => {
    const fields = item("allen-station-park", "osm-sports-field");
    expect(countProblem("Somewhere you can see 4 open marked spaces used for games.", fields)).toBeNull();
    expect(countProblem("Who can count 4 open spaces for games?", fields)).toBeNull();
    const soccer = item("zilker-metropolitan-park", "osm-soccer");
    expect(countProblem("Notice the flat floor. Count the 2 spaces for kicking a ball.", soccer)).toBeNull();
    const ponds = item("cedar-ridge-preserve", "osm-water");
    expect(countProblem("Count the still waters. There are 2.", ponds)).toBeNull();
    const tables = item("arbor-hills-nature-preserve", "osm-picnic-table");
    expect(countProblem("Point to 3 flat tops where people share food.", tables)).toBeNull();
    // Still wrong: a part that is not one per thing, and a wrong number.
    expect(countProblem("Count the 3 hoops.", tables)).not.toBeNull();
    expect(countProblem("Point to 4 flat tops where people share food.", tables)).not.toBeNull();
  });

  it("broken_count: 'Who can find N ...?' is a challenge; 'Who is swimming in 2 spots ...?' still drops", () => {
    const ponds = item("allen-station-park", "osm-water");
    expect(questionCountMix("Who can find 2 places of still water with fish or ducks?", ponds)).toBeNull();
    expect(questionCountMix("Who is swimming in 2 spots of still water?", ponds)).not.toBeNull();
    const bench = item("arbor-hills-nature-preserve", "osm-bench");
    expect(questionCountMix("What long outdoor seat is made of stone, wood or metal? Count the 2.", bench)).not.toBeNull();
  });

  it("name_leak: a colour word of the name ('scarlet', 'gold') is the PM 1B preference like 'white'; the whole name is still a hard leak", () => {
    const sp = item("cedar-ridge-preserve", "inat-75833"); // Scarlet spiderling
    expect(sp.nameWords).not.toContain("scarlet");
    expect(sp.nameWords).toContain("scarlet spiderling");
    expect(sp.nameTraits).toContain("scarlet");
    const v = validateDraft({ items: [draft(sp, "Hunt for a plant with scarlet flowers.")] }, [sp], oneOf("wild"), { hasMap: false });
    // Kept only if it is not generic: either way it is never a name_leak any more.
    expect(v.drops.name_leak).toBeUndefined();
    const leak = validateDraft({ items: [draft(sp, "Hunt for a scarlet spiderling.")] }, [sp], oneOf("wild"), { hasMap: false });
    expect(leak.drops).toEqual({ name_leak: 1 });
  });
});

describe("quick wins from run -5's machine-made list", () => {
  it("a clue that talks to the child and then lets the thing talk is odd_wording; a riddle is not", () => {
    expect(voiceSwitch("Watch for a plant with white blooms. I am poisonous!")).toBe("I am poisonous!"); // Central Park, -5
    expect(voiceSwitch("Check out a small wader. I travel to tropical oceans in winter!")).toBe("I travel to tropical oceans in winter!"); // White Rock, -5
    expect(voiceSwitch("Watch for a flying bug. I am the only one of my kind in my genus!")).not.toBeNull(); // Cedar Ridge, -5
    expect(voiceSwitch("Who has a red back? I am a true bug.")).toBeNull(); // Oak Point, -5: a riddle
    expect(voiceSwitch("Who is this? I have a low dirt hill in my center for a pitcher.")).toBeNull(); // Zilker, -5
    expect(voiceSwitch("I have a roof and pillars to keep you dry and cool while you eat a meal.")).toBeNull(); // Celebration fixture
    expect(voiceSwitch("Peek at the trees. Can you see a bird with a large head?")).toBeNull(); // Bob Woodruff, -5
    // Audit R5-S1: that -5 plant was white snakeroot. Its summary says "poisonous", so it is no longer in any pool,
    // and the clue itself is now a danger drop on any item. The voice switch is shown on another real plant.
    expect(data["central-park"].pool.some((p) => p.id === "inat-119048")).toBe(false);
    const plant = data["central-park"].pool.find((p) => p.section === "wild")!;
    const danger = validateDraft({ items: [draft(plant, "Watch for a plant with white blooms. I am poisonous!")] }, [plant], oneOf("wild"), { hasMap: false });
    expect(danger.drops).toEqual({ danger: 1 });
    const v = validateDraft({ items: [draft(plant, "Watch for a plant with white blooms. I am very tall!")] }, [plant], oneOf("wild"), { hasMap: false });
    expect(v.drops).toEqual({ odd_wording: 1 });
  });

  it("'helps the forest grow' is no trait a child can see: generic (Central Park squirrel, -5 M9 sample)", () => {
    const squirrel = item("central-park", "inat-46017");
    expect(squirrel.sourceText).toMatch(/forest regenerator/);
    expect(isGenericClue("Where is the tree animal that helps the forest grow?", squirrel.sourceText)).toBe(true);
  });

  it("traitWords: 'this' is a stop word before and after the plural is taken off (it matched every plant's season sentence)", () => {
    expect(traitWords("Somewhere you can spot fruit or seeds on this vine.")).toEqual([]);
    const passion = item("connemara-meadow-preserve", "inat-51450"); // Yellow passionflower
    expect(passion.sourceText).toMatch(/from this area/);
    // The live re-recording's refill2 clue: generic now (it printed when it was recorded).
    expect(isGenericClue("Somewhere you can spot fruit or seeds on this vine.", passion.sourceText)).toBe(true);
  });
});

describe("no-AI template: exempt from repeated openings (its masked sentences all open '____ is a ...')", () => {
  // Audit R5-C3: Arbor Hills' template no longer repeats an opening (its summaries lost their "is a species in the family
  // ..." sentences); Allen Station shows the same exemption.
  it("Allen Station: the same first words are kept for the template, dropped for a model answer", () => {
    const d = data["allen-station-park"];
    const t = templatePass(d.pool, d.mix!);
    expect(t.result.drops.repeats_opening).toBeUndefined();
    const plain = validateDraft(templateDraft(d.pool, d.mix!), d.pool, d.mix!, { hasMap: false, allowSourceCopies: true });
    expect(plain.drops.repeats_opening ?? 0).toBeGreaterThan(0);
    expect(t.result.items.length).toBeGreaterThan(plain.items.length);
  });
});

describe("buildPass calls (built failures; every other answer is a real recording)", () => {
  let logs: string[] = [];
  let restore: () => void;
  beforeEach(() => {
    resetStores();
    resetPassMaking();
    disableSavedOsmForTests();
    logs = [];
    restore = setLogSink((_l, line) => logs.push(line));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetSavedOsm();
    restore();
  });
  const modelCalls = (calls: Call[]) => calls.filter((c) => c.host === "inference.do-ai.run");
  /** Built: a call that never answers, until the app's own timeout aborts it (Cedar Ridge 10-13 in smoke 1439). */
  const hang = (c: Call) =>
    new Promise<Response>((_, reject) => {
      const s = c.init?.signal;
      s?.addEventListener("abort", () => reject(s.reason), { once: true });
    });
  const env = { DO_INFERENCE_API_KEY: "test-key-not-real", MODEL_TIMEOUT_MS: "5000" };

  it("a first call that times out gets ONE whole retry inside the deadline (the real Celebration answer: 8 of 8)", async () => {
    let n = 0;
    const r = passReplay({ model: (c) => (++n === 1 ? hang(c) : undefined) });
    const out = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, { ip: "192.0.2.90", fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env });
    if (out.kind !== "pass") throw new Error(out.kind);
    expect(out.pass.items).toHaveLength(8);
    expect(out.pass.model.attempts).toBe(2);
    expect(modelCalls(r.calls)).toHaveLength(2);
    expect(recordedShape(JSON.parse(modelCalls(r.calls)[1].body!).messages)).toEqual(recordedShape(modelRec(PARKS.celebration.slug).request.messages));
    expect(logs.filter((l) => l.includes('"event":"pass_call_failed"') && l.includes('"code":"MODEL_TIMEOUT"') && l.includes('"refill":false'))).toHaveLength(1);
  }, 30_000);

  it("a refill that times out is followed by one more refill (Connemara: real first answer, built hang, real refill)", async () => {
    let n = 0;
    const r = passReplay({ model: (c) => (++n === 2 ? hang(c) : undefined) });
    const out = await makePass({ parkId: PARKS.connemara.id, ageBand: "6-10" }, { ip: "192.0.2.91", fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env });
    if (out.kind !== "pass") throw new Error(out.kind);
    const calls = modelCalls(r.calls);
    expect(calls).toHaveLength(3);
    // Nothing changed between the two refills, so the second one is the same request (answered by the real refill).
    expect(JSON.parse(calls[2].body!).messages).toEqual(JSON.parse(calls[1].body!).messages);
    expect(recordedShape(JSON.parse(calls[2].body!).messages)).toEqual(recordedShape(modelRec(PARKS.connemara.slug).refill!.request.messages));
    expect(logs.filter((l) => l.includes('"event":"pass_call_failed"') && l.includes('"code":"MODEL_TIMEOUT"') && l.includes('"refill":true'))).toHaveLength(1);
    expect(out.pass.items).toHaveLength(6); // the real refill keeps none: 6 of 8, honestly
  }, 30_000);

  it("a rate-limited first call (built 429) is never retried", async () => {
    const r = passReplay({ model: () => new Response("slow down", { status: 429 }) });
    const out = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, { ip: "192.0.2.92", fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env });
    expect(out.kind).toBe("error");
    expect(modelCalls(r.calls)).toHaveLength(1);
  });
});

describe("live check follow-up (builder T, 2026-10-06, recorded data + live Gemma)", () => {
  it("'Who is the only one in its own family?' is trivia, not a trait: generic", () => {
    // The real pool item of Klyde Warren Park (recorded fixture), and the real live clue.
    const chat = data["klyde-warren-park"].pool.find((p) => /^Yellow-breasted Chat/.test(p.answer))!;
    expect(chat.sourceText).toMatch(/own/);
    expect(isGenericClue("Who is the only one in its own family?", chat.sourceText)).toBe(true);
  });
});
