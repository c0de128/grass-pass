/**
 * S6 on paper and in the eval scorer, from two REAL passes made on the builder's server with live SerpApi,
 * iNaturalist and gemma-4-31B-it (tests/fixtures/pass-*-lucky-live.json, 2026-10-06), and Lucky Finds pool
 * items built by the app's own code from the live SerpApi recordings.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { estimatedLines, KidPass, LUCKY_MAYBE, passDensity, TIGHT_LINE_BUDGET } from "@/components/pass/KidPass";
import { ParentStub } from "@/components/pass/ParentStub";
import { formatTime } from "@/lib/pass/format";
import { PassSchema, type Pass } from "@/lib/pass/schema";
import { LUCKY_KEYWORDS, luckyItem, MIN_MENTIONS } from "@/lib/pool/lucky";
import { countMentions } from "@/lib/sources/serpapi";
import { luckyGrounding, type CaseContext, type RunRecord } from "../../evals/score";
import { serpBody, serpFixture } from "./support/serpapi-replay";

const livePass = (name: string): Pass => {
  const raw = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures", `${name}.json`), "utf8")) as { pass: unknown };
  return PassSchema.parse(raw.pass);
};
const ARBOR = livePass("pass-arbor-hills-lucky-live");
const CELEBRATION = livePass("pass-celebration-lucky-live");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("the printed pass with Lucky Finds (real passes)", () => {
  it("each Lucky Find row says 'Maybe!' before its clue and carries the code-written review count", () => {
    const html = renderToStaticMarkup(<KidPass pass={ARBOR} />);
    expect((html.match(/class="gp-maybe"/g) ?? []).length).toBe(2);
    const t = text(html);
    for (const it of ARBOR.items.filter((i) => i.section === "lucky")) {
      expect(t).toContain(`${LUCKY_MAYBE} ${it.clue}`);
      expect(t).toContain(`(${it.evidence})`);
    }
    expect(ARBOR.items.filter((i) => i.section === "lucky").map((i) => i.evidence)).toEqual([
      "at least 20 visitor reviews since Oct 2024 mention dogs, newest Sep 2026 · Google reviews via SerpApi",
      "at least 20 visitor reviews since Oct 2024 mention bikes, newest Jul 2026 · Google reviews via SerpApi",
    ]);
  });

  it("the line estimate counts the 'Maybe!' and both real passes stay under the tight budget (measured in a browser: PrintFit 0.96 and 0.92, one page)", () => {
    const withoutMaybe = estimatedLines(ARBOR.items.map((i) => ({ ...i, section: "park" as const })));
    expect(estimatedLines(ARBOR.items)).toBeGreaterThanOrEqual(withoutMaybe);
    for (const p of [ARBOR, CELEBRATION]) {
      expect(estimatedLines(p.items)).toBeLessThanOrEqual(TIGHT_LINE_BUDGET);
      expect(passDensity(p.items, true)).toBe("snug");
    }
  });

  it("the grown-up's stub names Google reviews via SerpApi with the time the counts were made", () => {
    const t = text(renderToStaticMarkup(<ParentStub pass={CELEBRATION} passUrl="grass-pass.test/pass/x" />));
    expect(t).toContain(`Lucky Finds: counts of Google reviews via SerpApi (no review text), checked ${formatTime(CELEBRATION.dataCheckedAt.lucky!)}.`);
  });
});

describe("eval: Lucky Finds grounding (evals/score.ts luckyGrounding)", () => {
  const at = Date.parse(serpFixture("google-maps-reviews-arbor-hills-dog")._recording.fetchedAt);
  const count = (fixture: string, kw: keyof typeof LUCKY_KEYWORDS) => ({ keyword: kw, ...countMentions(serpBody(serpFixture(fixture)), LUCKY_KEYWORDS[kw].mentions, at) });
  const dog = luckyItem(count("google-maps-reviews-arbor-hills-dog", "dog"), at);
  const bike = luckyItem(count("google-maps-reviews-arbor-hills-bike", "bike"), at);
  const ducks = luckyItem(count("google-maps-reviews-celebration-park-ducks", "duck"), at); // 2 real mentions: below the bar

  const ctx = (pool: CaseContext["pool"]): CaseContext => ({
    caseN: 3, parkName: "Arbor Hills Nature Preserve", pool, n: 8, dataRich: true, totalObservations: 0, parkEmpty: false, wildEmpty: false, blockedNames: [], plan: null,
  });
  /** A run whose printed Lucky Finds are the live Arbor Hills pass's (its clues, the pool items' answers). */
  const run = (answers: string[]): RunRecord => ({
    caseN: 3, slug: "arbor-hills-nature-preserve", parkName: "Arbor Hills Nature Preserve", model: "gemma-4-31B-it", run: 1, kind: "pass",
    sections: { lucky: { status: "ok" } }, n: 8, dataRich: true, calls: [], wallMs: 0,
    items: ARBOR.items.filter((i) => i.section === "lucky").map((i, k) => ({ section: "lucky", clue: i.clue, lookWhere: i.lookWhere, answer: answers[k] })),
  });

  it("passes when every printed Lucky Find is a pool item with >= 3 counted mentions of its own keyword", () => {
    expect(luckyGrounding(run([dog.answer, bike.answer]), ctx([dog, bike]))).toEqual({ printed: 2, problems: [] });
  });

  it("flags a Lucky Find with fewer than 3 mentions, or one that is not in the pool", () => {
    expect(Number(/^(\d+)/.exec(ducks.evidence)?.[1])).toBeLessThan(MIN_MENTIONS);
    const r = luckyGrounding(run([ducks.answer, "A horse"]), ctx([ducks]));
    expect(r.printed).toBe(2);
    expect(r.problems).toEqual([`${ducks.answer}: only 2 mentions (needs ${MIN_MENTIONS})`, "A horse: not a Lucky Finds pool item"]);
  });
});
