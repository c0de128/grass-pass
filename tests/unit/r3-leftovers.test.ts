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
import { fitToMix, luckyLimit, mergeResults, type ValidationResult, type ValidItem } from "@/lib/ai/validate";
import { LUCKY_KEYWORDS, luckyItem } from "@/lib/pool/lucky";
import type { PoolItem } from "@/lib/pool/types";
import { countMentions } from "@/lib/sources/serpapi";
import { serpBody, serpFixture } from "./support/serpapi-replay";

const FIX = path.join(__dirname, "..", "fixtures");
type LivePass = { pass: { target: number; items: { section: string; clue: string; answer: string; difficulty: "easy" | "medium" | "hard" }[] } };
/** The real Arbor Hills pass of the S6 builder (2 Lucky Finds, 1 Wild Find). */
const arborLive = JSON.parse(readFileSync(path.join(FIX, "pass-arbor-hills-lucky-live.json"), "utf8")) as LivePass;

let arbor: CaseData;
let arborPool: PoolItem[];
beforeAll(async () => {
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
