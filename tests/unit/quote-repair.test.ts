/**
 * S8c: the glued-field glitch. In the S8b eval run (evals/results/2026-10-05-2.json), 3 of 56 real
 * gemma-4-31B-it answers (all Trinity River Audubon Center) had the start of the next JSON field
 * glued onto every sourceQuote ("...across the park.专项parentNote: Help the child..."). The quotes
 * themselves were right. These tests use those real strings and the real recorded park data: the
 * repair cuts at the field marker, and the result must still be a real substring of the source.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { APP_ROOT, loadCaseData, loadCases, loadFixture, type CaseData } from "../../evals/fixture";
import { groundedQuote, isGrounded, normalizeForMatch, repairGluedQuote, validateDraft } from "@/lib/ai/validate";
import type { PoolItem } from "@/lib/pool/types";
import { wildPool } from "@/lib/pool/wild";
import { FEATURE_KINDS, type FeatureKind } from "@/lib/sources/overpass-features";

type RawItem = { itemId: string; sourceQuote: string; clue: string; lookWhere: string; difficulty: string; section?: string };
type Run = { caseN: number; model: string; run: number; calls: { rawItems: RawItem[] | null }[] };

const results = JSON.parse(readFileSync(path.join(APP_ROOT, "evals", "results", "2026-10-05-2.json"), "utf8")) as { runs: Run[] };
const cases = loadCases();
const data = new Map<number, CaseData>();

beforeAll(async () => {
  for (const n of [4, 9, 15, 16, 17]) {
    const c = cases.cases.find((x) => x.n === n)!;
    data.set(n, await loadCaseData(loadFixture(c.slug), cases.ageBand));
  }
});

/**
 * The pool as the model saw it in run 2026-10-05-2 (before audit R2-M5): every Park Find's source then
 * ended with its kind's one fixed description (FEATURE_KINDS.describe), and every species with a summary
 * was offered. R2-M5 rotates the Park Find facts and leaves out species with nothing to look for, so the
 * old real quotes are checked against today's source PLUS that old description, and the full species list.
 */
function legacyPool(d: CaseData): PoolItem[] {
  const park = d.pool
    .filter((p) => p.section === "park")
    .map((p) => ({ ...p, sourceText: `${p.sourceText} ${FEATURE_KINDS[p.id.slice(4).replace(/-/g, "_") as FeatureKind].describe}` }));
  const wild = d.species ? wildPool(d.species, d.summaries, "2026-09-21", undefined, { describableOnly: false }).items : [];
  return [...park, ...wild];
}

const source = (caseN: number, id: string) => {
  const p = legacyPool(data.get(caseN)!).find((i) => i.id === id);
  if (!p) throw new Error(`no pool item ${id} in case ${caseN}`);
  return p.sourceText;
};

describe("glued-field quotes (real Gemma answers, 2026-10-05-2)", () => {
  it("cuts the glued parentNote off and keeps only the real source words (verbatim strings)", () => {
    const cases: [number, string, string, string][] = [
      // [case, item id, the model's quote exactly as returned, what is kept]
      [16, "osm-viewpoint", "A viewpoint is a spot with a good view across the park.专项parentNote: Help the child find a scenic overlook.", "a viewpoint is a spot with a good view across the park"],
      [16, "inat-170070", "a shrub or small tree native to northern Mexico as well as TexasparentNote: This is a native woody plant.", "a shrub or small tree native to northern mexico as well as texas"],
      [16, "inat-194109", "flowering plant in the daisy family known by the common names Spanish gold house parentNote: Look for bright yellow petals.", "flowering plant in the daisy family known by the common names spanish gold"],
      [16, "osm-picnic-table", "outdoor table with benches attached. parentNote: Great spot for a snack break.", "outdoor table with benches attached"],
      [16, "osm-viewpoint", "a spot with a good view across the park. periodontalNote: Watch for scenic vistas together.", "a spot with a good view across the park"],
      [15, "osm-bench", "A bench is a long outdoor seat for resting.`, ", "a bench is a long outdoor seat for resting"],
      [17, "osm-bench", "a long outdoor seat for resting.一件-bench-sourceQuote: a long outdoor seat for resting.一件-bench-sourceQuote: a long outdoor seat for", "a long outdoor seat for resting"],
    ];
    for (const [n, id, quote, kept] of cases) {
      const src = source(n, id);
      expect(isGrounded(quote, src), quote).toBe(true);
      const g = groundedQuote(quote, src)!;
      expect(g).toBe(kept);
      expect(normalizeForMatch(src).includes(g)).toBe(true);
      expect(g).not.toMatch(/note|quote|[^\p{Script=Latin}\p{Script=Common}]/iu);
    }
  });

  it("every glued quote in the saved run is either repaired to a real substring or still dropped", () => {
    let glued = 0;
    let repaired = 0;
    for (const r of results.runs.filter((x) => x.model.startsWith("gemma") && data.has(x.caseN))) {
      for (const c of r.calls) {
        for (const it of c.rawItems ?? []) {
          if (!/parentNote|sourceQuote/.test(it.sourceQuote)) continue;
          glued++;
          const src = source(r.caseN, it.itemId);
          const g = groundedQuote(it.sourceQuote, src);
          if (g === null) continue;
          repaired++;
          expect(normalizeForMatch(src).includes(g)).toBe(true);
          expect(g.length).toBeGreaterThanOrEqual(8);
        }
      }
    }
    expect(glued).toBe(24); // 23 Trinity quotes + the Zilker bench
    expect(repaired).toBe(24);
  });

  it("the Trinity run-1 answers now keep their clues instead of an error pass", () => {
    const d = data.get(16)!;
    const r = results.runs.find((x) => x.caseN === 16 && x.run === 1 && x.model.startsWith("gemma"))!;
    for (const c of r.calls) {
      const v = validateDraft({ items: c.rawItems ?? [] }, legacyPool(d), d.mix!);
      expect(v.drops.not_grounded ?? 0).toBe(0);
      expect(v.quotesRepaired).toBe(8);
      // R2-M5's stricter clue checks (generic clue, wrong count) may drop some of these old clues; none is ungrounded.
      expect(v.items.length + (v.drops.generic_clue ?? 0) + (v.drops.wrong_count ?? 0) + (v.drops.copies_example ?? 0) + (v.drops.repeats_clue ?? 0) +
        // Audit R4-C2: the old opener bank ("Wander to find ...") and the "I am" voice are drops now too.
        (v.drops.odd_wording ?? 0) + (v.drops.riddle_frame ?? 0) + (v.drops.repeats_opening ?? 0) + (v.drops.broken_count ?? 0)).toBeGreaterThanOrEqual(d.mix!.n - 2);
      for (const i of v.items) expect(normalizeForMatch(i.item.sourceText).includes(i.sourceQuote)).toBe(true);
    }
  });

  it("never accepts text that is not in the source", () => {
    const src = source(16, "osm-viewpoint");
    // Invented words before the marker: nothing to repair.
    expect(isGrounded("a spot with a golden castle on top parentNote: Fun!", src)).toBe(false);
    // More than two junk words before the marker: dropped, not stretched.
    expect(isGrounded("a spot with a good view across the park and a big red slide parentNote: x", src)).toBe(false);
    // No marker: a near miss stays a miss (no fuzzy prefix matching).
    expect(isGrounded("a spot with a good view across the park house", src)).toBe(false);
    expect(repairGluedQuote("a spot with a good view across the park house", src)).toBeNull();
    // Real model mistakes seen in the same run stay dropped: a paraphrase tail, skipped words, "...".
    expect(isGrounded("A bench is a long outdoor seat for resting. paraphrased as: A bench is a long outdoor seat for resting.", source(4, "osm-bench"))).toBe(false);
    expect(isGrounded("a place with things to climb, slide and swing on. exciting things to do here", source(9, "osm-playground"))).toBe(false);
    // A marker right at the start leaves nothing long enough to prove anything.
    expect(isGrounded("parentNote: a spot with a good view", src)).toBe(false);
    expect(isGrounded("a spot parentNote: x", src)).toBe(false);
  });
});
