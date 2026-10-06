/**
 * Round-3 leftovers (builder M, 2026-10-06). Every input is real: pools from the recorded eval fixtures
 * (tests/fixtures/evals) built with the app's own pool code, Lucky Finds counted from the live SerpApi
 * recordings (tests/fixtures/serpapi), and clues from the live passes / eval runs they name.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { caseDataOrNull, loadFixture, type CaseData } from "../../evals/fixture";
import { planRequest, refillPlan } from "@/lib/ai/prompt";
import { fitToMix, isGenericClue, luckyLimit, mergeResults, sharedFrame, validateDraft, type ValidationResult, type ValidItem } from "@/lib/ai/validate";
import { LUCKY_KEYWORDS, luckyItem } from "@/lib/pool/lucky";
import { nameTraitWords } from "@/lib/pool/wild";
import type { PoolItem } from "@/lib/pool/types";
import { countMentions } from "@/lib/sources/serpapi";
import { MemoryStore } from "@/lib/cache/store";
import { PARKS_COPY } from "@/lib/parks/schema";
import { loadFeatures } from "@/lib/pass/park-data";
import { SourceError } from "@/lib/sources/common";
import { everyMirrorTimedOut } from "@/lib/sources/overpass";
import { serpBody, serpFixture } from "./support/serpapi-replay";

const FIX = path.join(__dirname, "..", "fixtures");
type LivePass = { pass: { target: number; items: { section: string; clue: string; answer: string; difficulty: "easy" | "medium" | "hard" }[] } };
/** The real Arbor Hills pass of the S6 builder (2 Lucky Finds, 1 Wild Find). */
const arborLive = JSON.parse(readFileSync(path.join(FIX, "pass-arbor-hills-lucky-live.json"), "utf8")) as LivePass;

let arbor: CaseData;
let arborPool: PoolItem[];
const data: Record<string, CaseData> = {};
beforeAll(async () => {
  for (const slug of ["white-rock-lake-park", "connemara-meadow-preserve"]) {
    const r = await caseDataOrNull(loadFixture(slug), "6-10");
    if (!r.data) throw new Error(r.problem ?? slug);
    data[slug] = r.data;
  }
  const r = await caseDataOrNull(loadFixture("arbor-hills-nature-preserve"), "6-10");
  if (!r.data) throw new Error(r.problem ?? "no data");
  arbor = r.data;
  // The two Lucky Finds Arbor Hills really qualified for (counted from the recorded review pages).
  const lucky = (["dog", "bike"] as const).map((k) => {
    const rec = serpFixture(`google-maps-reviews-arbor-hills-${k}`);
    const at = Date.parse(rec._recording.fetchedAt);
    const c = countMentions(serpBody(rec), LUCKY_KEYWORDS[k].mentions, at);
    return luckyItem({ keyword: k, ...c }, at);
  });
  arborPool = [...arbor.pool, ...lucky];
}, 120_000);

/** The live pass's printed items as validated items of this pool (matched by answer text). */
function arborKept(): ValidItem[] {
  return arborLive.pass.items.map((p) => {
    const item =
      arborPool.find((x) => x.section === p.section && x.answer === p.answer) ??
      arborPool.find((x) => x.section === p.section && p.answer.toLowerCase().startsWith(x.answer.toLowerCase().split(" (")[0]));
    if (!item) throw new Error(`no pool item for ${p.answer}`);
    return { item, clue: p.clue, lookWhere: "", difficulty: p.difficulty, sourceQuote: "" };
  });
}

describe("R3-M1: Lucky Finds never crowd out Wild Finds (real Arbor Hills pass)", () => {
  it("the live Arbor pass printed 2 Lucky + 1 Wild; the mix asks for at least 2 Wild", () => {
    const plan = planRequest(arborPool, "6-10", arbor.parkName ?? "")!;
    expect(plan.mix.min.wild).toBe(2);
    expect(plan.mix.max.lucky).toBe(2);
    const kept = arborKept();
    expect(kept.filter((k) => k.item.section === "lucky")).toHaveLength(2);
    expect(kept.filter((k) => k.item.section === "wild")).toHaveLength(1);
  });

  it("with Wild below its minimum only 1 Lucky Find is kept, so the pass is short and the refill asks for a Wild Find, not a Lucky one", () => {
    const plan = planRequest(arborPool, "6-10", arbor.parkName ?? "")!;
    const { items } = fitToMix(arborKept(), plan.mix);
    expect(items.filter((k) => k.item.section === "lucky").map((k) => k.item.id)).toEqual(["lucky-dog"]);
    expect(items).toHaveLength(6); // below n - 1 = 7: build-pass makes the refill call
    const rp = refillPlan(plan, items)!;
    expect(rp.mix.min.wild).toBe(1);
    expect(rp.mix.max.lucky).toBe(0);
    expect(rp.pool.some((p) => p.section === "lucky")).toBe(false);
    expect(rp.pool.some((p) => p.section === "wild")).toBe(true);
  });

  it("once Wild reaches its minimum, a second Lucky Find may fill a free slot again", () => {
    const plan = planRequest(arborPool, "6-10", arbor.parkName ?? "")!;
    expect(luckyLimit({ park: 4, wild: 1, lucky: 0 }, plan.mix)).toBe(1);
    expect(luckyLimit({ park: 4, wild: 2, lucky: 0 }, plan.mix)).toBe(2);
    expect(luckyLimit({ park: 1, wild: 2, lucky: 0 }, plan.mix)).toBe(1);
  });

  it("merging a refill never brings the second Lucky Find back while Wild is short", () => {
    const plan = planRequest(arborPool, "6-10", arbor.parkName ?? "")!;
    const kept = arborKept();
    const result = (items: ValidItem[]): ValidationResult => ({
      items, drops: {}, returned: items.length, parentNote: "", belowMin: [], hardCount: 0, lookWhereCleared: 0, quotesRepaired: 0,
    });
    const first = result(kept.filter((k) => k.item.id !== "lucky-bike"));
    const refill = result(kept.filter((k) => k.item.id === "lucky-bike"));
    const merged = mergeResults(first, refill, plan.mix);
    expect(merged.items.filter((k) => k.item.section === "lucky")).toHaveLength(1);
    expect(merged.belowMin).toContain("wild");
    // A real second Wild Find from the same pool in the refill: it is taken, and then the second Lucky Find fits too.
    const wild2 = arborPool.find((p) => p.section === "wild" && !kept.some((k) => k.item.id === p.id))!;
    const withWild = mergeResults(first, result([...refill.items, { ...kept[0], item: wild2 }]), plan.mix);
    expect(withWild.items.filter((k) => k.item.section === "wild")).toHaveLength(2);
    expect(withWild.items.filter((k) => k.item.section === "lucky")).toHaveLength(2);
    expect(withWild.belowMin).toEqual([]);
  });
});

const wildItem = (slug: string, answer: RegExp): PoolItem => {
  const p = data[slug].pool.find((x) => x.section === "wild" && answer.test(x.answer));
  if (!p) throw new Error(`${slug}: no ${answer}`);
  return p;
};
/** A draft item whose quote is a real phrase of the item's own source (so only the clue is under test). */
const draftOf = (p: PoolItem, clue: string, quote: string) => {
  expect(p.sourceText.toLowerCase()).toContain(quote.toLowerCase());
  return { itemId: p.id, clue, lookWhere: "", sourceQuote: quote, difficulty: "medium" };
};
const oneWild = { n: 1, min: { park: 0, wild: 1, lucky: 0 }, max: { park: 0, wild: 1, lucky: 0 }, hardMin: 0 };

describe("R3-M2a: a colour or size word of the species' own name is a name leak (real example clues)", () => {
  it("name trait words: colours, patterns and sizes of the common name, and the colour a compound word starts with", () => {
    expect(nameTraitWords("White Morning-glory")).toEqual(["white"]);
    expect(nameTraitWords("Eastern Amberwing")).toEqual(["amber"]);
    expect(nameTraitWords("Eastern Redcedar")).toEqual(["red"]);
    expect(nameTraitWords("Little Blue Heron")).toEqual(["little", "blue"]);
    expect(nameTraitWords("Rambur's Forktail")).toEqual([]);
    expect(nameTraitWords("Redbud")).toEqual([]); // "bud" is too short to be a compound
  });

  it("White Rock: 'Hunt for a plant with white flowers.' (White Morning-glory) and '... orange or amber wings.' (Eastern Amberwing) are dropped", () => {
    const glory = wildItem("white-rock-lake-park", /^White Morning-glory/);
    const amber = wildItem("white-rock-lake-park", /^Eastern Amberwing/);
    expect(glory.nameWords).toContain("white");
    expect(amber.nameWords).toContain("amber");
    const pool = data["white-rock-lake-park"].pool;
    const a = validateDraft({ items: [draftOf(glory, "Hunt for a plant with white flowers.", "show it with flowers")] }, pool, oneWild);
    expect(a.drops).toEqual({ name_leak: 1 });
    const quote = amber.sourceText.match(/[^.]*orange[^.]*/i)?.[0].trim().split(/\s+/).slice(0, 8).join(" ") ?? "";
    const b = validateDraft({ items: [draftOf(amber, "Explore for a tiny flyer with orange or amber wings.", quote)] }, pool, oneWild);
    expect(b.drops).toEqual({ name_leak: 1 });
  });

  it("a trait that is not a name word still passes (J's 10-13 smoke: Rambur's Forktail)", () => {
    const fork = wildItem("white-rock-lake-park", /^Rambur's Forktail/);
    expect(isGenericClue("Is its tail blue on segments 8 and 9?", fork.sourceText)).toBe(false);
    expect(fork.nameWords).not.toContain("blue");
  });
});

describe("R3-M2b: the same sentence frame twice on one pass is a repeat", () => {
  // The live Arbor Hills example (builder J's review, reports/R3-builder-J-2026-10-06.md).
  const seat = "Wander to a long seat for a rest. Count them. There are 2.";
  const roof = "Track a place with a roof and tables below. Count them. There are 4.";
  it("'Count them. There are N.' twice is a shared frame; a lone 'There are N.' is not", () => {
    expect(sharedFrame(seat, roof)).toBe("count them / there are #");
    expect(sharedFrame("Hunt for 4 roofs held up by poles. There are 4.", "Notice 2 flat hard areas with rings. There are 2.")).toBeNull();
    expect(sharedFrame("Hunt for 4 roofs held up by poles with tables below them.", "Track 2 long outdoor seats for taking a break.")).toBeNull();
  });
});

describe("R3-M2c: generic Wild Find clues (real clues from the example passes and the recorded Connemara refill)", () => {
  it("'Track a grass moth.' and 'Sneak up on a medium-sized bird of prey.' carry no trait of their own", () => {
    const moth = wildItem("connemara-meadow-preserve", /Blepharomastix/);
    expect(isGenericClue("Track a grass moth.", moth.sourceText)).toBe(true);
    const hawk = wildItem("connemara-meadow-preserve", /^Red-shouldered Hawk/i);
    expect(hawk.sourceText).toContain("medium-sized hawk");
    expect(isGenericClue("Sneak up on a medium-sized bird of prey.", hawk.sourceText)).toBe(true);
  });

  it("clues with a real trait stay (Connemara recorded answer)", () => {
    const club = wildItem("connemara-meadow-preserve", /^Hercules' club/);
    expect(isGenericClue("Scan for a tree with thick, corky lumps on the bark that have spines.", club.sourceText)).toBe(false);
    const lichen = wildItem("connemara-meadow-preserve", /^Golden-eye Lichen/);
    expect(isGenericClue("Notice a tiny growth with bright-orange parts and spiny projections?", lichen.sourceText)).toBe(false);
  });
});

describe("R3-M6 (Q-3-01 option 3): a park is 'slow' only when every mirror tried timed out", () => {
  /** Never answers: only our own per-attempt timeout ends it (a built condition, like R2-m2's test). */
  const hang = (init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      const s = init?.signal;
      const stop = () => reject(s?.reason ?? new DOMException("aborted", "AbortError"));
      if (s?.aborted) stop();
      s?.addEventListener("abort", stop);
    });
  /** The real Overpass 504 "too busy" page (tests/fixtures/overpass-504-too-busy.json). */
  const busy504 = () => {
    const r = JSON.parse(readFileSync(path.join(FIX, "overpass-504-too-busy.json"), "utf8")) as { body: string; status?: number };
    return new Response(r.body, { status: 504, headers: { "content-type": "text/html" } });
  };

  it("first mirror hangs, the second answers 504: no 15-minute block, and the next try is sent", async () => {
    const store = new MemoryStore();
    const calls: string[] = [];
    const fetchImpl = (u: string, init?: RequestInit) => {
      calls.push(new URL(u).host);
      return calls.length === 1 ? hang(init) : Promise.resolve(busy504());
    };
    const deps = { store, env: {}, now: () => Date.now(), fetchImpl, timeoutMs: 50 };
    const first = await loadFeatures({ type: "way", id: 11 }, deps);
    if (first.ok) throw new Error("expected a failure");
    expect(first.outcome.error.code).toBe("OSM_UNAVAILABLE");
    expect(first.outcome.error.message).toBe(PARKS_COPY.overpassDown); // not "won't ask again for 15 minutes"
    const sent = calls.length;
    // A new store (breakers closed, as after OVERPASS_ERROR_OPEN_SEC) would retry: the park itself is not blocked.
    await loadFeatures({ type: "way", id: 11 }, { ...deps, store: new MemoryStore() });
    expect(calls.length).toBeGreaterThan(sent);
  });

  it("everyMirrorTimedOut: two or more different mirrors, all timeouts (or the only mirror configured)", () => {
    const err = (codes: ("timeout" | "busy")[]) =>
      new SourceError("overpass", codes.at(-1)!, { started: true, attempts: codes.map((code, i) => ({ endpoint: `https://m${i}.example/api/interpreter`, code })) });
    expect(everyMirrorTimedOut(err(["timeout", "timeout"]))).toBe(true);
    expect(everyMirrorTimedOut(err(["timeout"]))).toBe(false); // one dead mirror says nothing about the park
    expect(everyMirrorTimedOut(err(["timeout"]), 1)).toBe(true); // ... unless it is the only mirror
    expect(everyMirrorTimedOut(err(["busy", "timeout"]))).toBe(false);
    expect(everyMirrorTimedOut(new SourceError("overpass", "timeout", { started: false }))).toBe(false); // budget ran out, nothing tried
  });
});
