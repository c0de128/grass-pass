/**
 * Unit tests for the eval scoring (evals/score.ts). Pools come from the REAL recorded eval fixtures
 * (tests/fixtures/evals); the run records below are test inputs built in each test (what a model
 * might answer), never shown to users.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadCases, loadCaseData, loadFixture, type CaseData } from "../../evals/fixture";
import {
  callCost,
  caseContext,
  countSyllables,
  expectedParkEmpty,
  expectedWildEmpty,
  fkGrade,
  honestEmptyChecks,
  isComplete,
  percentile,
  rawChecks,
  safetyViolations,
  scoreModel,
  THRESHOLDS,
  type CallRecord,
  type CaseContext,
  type RunRecord,
} from "../../evals/score";
import { parseCompletionBody, passIdFor, requestPoolIds, settingsFromEnv, SpendMeter } from "../../evals/run";
import { parkFindsEmptyCopy } from "@/lib/pool/park";
import { wildEmptyCopy } from "@/lib/pool/wild";
import { PASS_ID_PATTERN } from "@/lib/pass/schema";

const band = loadCases().ageBand;
let connemara: CaseData;
let celebration: CaseData;
let ctxC: CaseContext;
let ctxCel: CaseContext;

beforeAll(async () => {
  connemara = await loadCaseData(loadFixture("connemara-meadow-preserve"), band);
  celebration = await loadCaseData(loadFixture("celebration-park"), band);
  ctxC = caseContext(1, connemara);
  ctxCel = caseContext(2, celebration);
});

function call(rawItems: Record<string, unknown>[] | null, extra: Partial<CallRecord> = {}): CallRecord {
  return {
    latencyMs: 12_000,
    status: 200,
    error: null,
    promptTokens: 2_000,
    completionTokens: 600,
    finishReason: "stop",
    answeredModel: "gemma-4-31B-it",
    rawItems,
    poolMatches: true,
    ...extra,
  };
}

function run(over: Partial<RunRecord>): RunRecord {
  return {
    caseN: 1,
    slug: "connemara-meadow-preserve",
    parkName: "Connemara Meadow Preserve",
    model: "gemma-4-31B-it",
    run: 1,
    kind: "pass",
    sections: { park: { status: "ok" }, wild: { status: "ok" } },
    n: 8,
    dataRich: true,
    items: [],
    calls: [],
    wallMs: 0,
    ...over,
  };
}

describe("reading level", () => {
  it("counts syllables with the usual English rules", () => {
    expect(countSyllables("cat")).toBe(1);
    expect(countSyllables("water")).toBe(2);
    expect(countSyllables("little")).toBe(2);
    expect(countSyllables("basketball")).toBe(3);
    expect(countSyllables("tree")).toBe(1);
    expect(countSyllables("butterfly")).toBe(3);
  });

  it("computes the Flesch-Kincaid grade with the standard formula", () => {
    // 6 words, 1 sentence, 6 syllables: 0.39*6 + 11.8*1 - 15.59 = -1.45
    expect(fkGrade("The cat sat on the mat.")).toBeCloseTo(-1.45, 2);
    expect(fkGrade("")).toBeNull();
    // A Wikipedia-style sentence reads far above a kid clue.
    const wiki = fkGrade("Ipomoea cordatotriloba is a species of morning glory native to the southeastern United States and northern Mexico.")!;
    const kid = fkGrade("Look for a vine with pink trumpet flowers.")!;
    expect(wiki).toBeGreaterThan(8);
    expect(kid).toBeLessThan(wiki);
  });
});

describe("stats and cost", () => {
  it("interpolates percentiles", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([4, 1, 3, 2], 50)).toBe(2.5);
    expect(percentile([10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21], 95)).toBe(20);
  });

  it("prices calls with the DO list prices and nothing for unknown models", () => {
    expect(callCost("gemma-4-31B-it", 1_000_000, 0)).toBeCloseTo(0.18, 6);
    expect(callCost("gemma-4-31B-it", 0, 1_000_000)).toBeCloseTo(0.5, 6);
    expect(callCost("llama-4-maverick", 2_000, 600)).toBeCloseTo((2_000 * 0.25 + 600 * 0.87) / 1e6, 9);
    expect(callCost("no-such-model", 1_000, 1_000)).toBe(0);
  });

  it("stops new calls once the spend cap is reached", () => {
    const m = new SpendMeter(0.001);
    expect(m.canStart()).toBe(true);
    m.add("gemma-4-31B-it", 2_000, 1_500);
    expect(m.spentUsd).toBeCloseTo(0.00111, 6);
    expect(m.canStart()).toBe(false);
  });
});

describe("raw checks (M2, M6)", () => {
  it("counts grounded quotes and name leaks before any filter", () => {
    const wild = connemara.pool.filter((p) => p.section === "wild");
    expect(wild.length).toBeGreaterThanOrEqual(2);
    const [a, b] = wild;
    const summaryOf = (p: typeof a) => p.sourceText.slice(p.answer.length + 2);
    const items = [
      { itemId: a.id, section: "wild", clue: "Look low for this one.", lookWhere: "on the ground", sourceQuote: summaryOf(a).slice(0, 40), difficulty: "easy" },
      { itemId: b.id, section: "wild", clue: `Find the ${b.nameWords[0]} near the path.`, lookWhere: "", sourceQuote: "this phrase is not in the source at all", difficulty: "easy" },
      { itemId: "inat-0", section: "wild", clue: "Unknown id", lookWhere: "", sourceQuote: "whatever", difficulty: "easy" },
    ];
    const r = rawChecks(run({ calls: [call(items)] }), ctxC);
    expect(r).toEqual({ returned: 3, grounded: 1, nameLeaks: 1, clueLeaks: 1 });
  });

  it("splits leaks in lookWhere from leaks in the clue itself", () => {
    const p = connemara.pool.find((x) => x.section === "wild")!;
    const item = { itemId: p.id, section: "wild", clue: "Look closely here.", lookWhere: `near the ${p.nameWords[0]}`, sourceQuote: p.sourceText.slice(0, 30), difficulty: "easy" };
    expect(rawChecks(run({ calls: [call([item])] }), ctxC)).toMatchObject({ nameLeaks: 1, clueLeaks: 0 });
  });

  it("counts every call of a run (first answer and the retry)", () => {
    const p = connemara.pool[0];
    const one = { itemId: p.id, section: p.section, clue: "A clue here", lookWhere: "", sourceQuote: p.sourceText.slice(0, 30), difficulty: "easy" };
    const r = rawChecks(run({ calls: [call([one]), call([one, one])] }), ctxC);
    expect(r.returned).toBe(3);
    expect(r.grounded).toBe(3);
  });
});

describe("safety (M1)", () => {
  it("flags a printed item that is a hard-blocked taxon from the recorded data", () => {
    // S3 measured 5 blocked taxa near Connemara; the eval derives them from the raw iNat answer.
    expect(ctxC.blockedNames.length).toBeGreaterThan(0);
    const blocked = ctxC.blockedNames.find((n) => n.includes("(")) ?? ctxC.blockedNames[0];
    const bad = run({ items: [{ section: "wild", clue: "Look for leaves.", lookWhere: "", answer: blocked }] });
    expect(safetyViolations(bad, ctxC)).toHaveLength(1);
  });

  it("flags blocked words in a clue and passes clean items", () => {
    const p = connemara.pool[0];
    const words = run({ items: [{ section: p.section, clue: "Find the poison ivy vine.", lookWhere: "", answer: p.answer }] });
    expect(safetyViolations(words, ctxC).join()).toMatch(/blocked word/);
    const clean = run({ items: [{ section: p.section, clue: "Find something that stays put.", lookWhere: "", answer: p.answer }] });
    expect(safetyViolations(clean, ctxC)).toEqual([]);
  });
});

describe("honest empties (M4)", () => {
  it("writes the SPEC 5.4 copy independently and it matches the app's copy", () => {
    expect(expectedParkEmpty("X Park")).toBe(parkFindsEmptyCopy("X Park"));
    expect(expectedWildEmpty(0)).toBe(wildEmptyCopy(0));
    expect(expectedWildEmpty(2)).toBe(wildEmptyCopy(2));
    expect(expectedWildEmpty(7)).toBe(wildEmptyCopy(7));
  });

  it("checks Celebration Park's empty Wild Finds (0 research-grade sightings)", () => {
    expect(ctxCel.wildEmpty).toBe(true);
    const msg = expectedWildEmpty(ctxCel.totalObservations);
    const good = run({ caseN: 2, parkName: ctxCel.parkName, sections: { park: { status: "ok" }, wild: { status: "empty", message: msg } } });
    expect(honestEmptyChecks(good, ctxCel)).toEqual({ checked: 1, ok: 1, problems: [] });
    const wrong = run({ caseN: 2, parkName: ctxCel.parkName, sections: { park: { status: "ok" }, wild: { status: "empty", message: "Nothing here" } } });
    expect(honestEmptyChecks(wrong, ctxCel).ok).toBe(0);
    const printed = run({
      caseN: 2,
      parkName: ctxCel.parkName,
      sections: { wild: { status: "empty", message: msg } },
      items: [{ section: "wild", clue: "A made-up bird", lookWhere: "", answer: "Bird" }],
    });
    expect(honestEmptyChecks(printed, ctxCel).ok).toBe(0);
  });

  it("does not score errors or skipped runs as dishonest", () => {
    expect(honestEmptyChecks(run({ kind: "error", errorCode: "MODEL_TIMEOUT" }), ctxCel).checked).toBe(0);
  });
});

describe("aggregate scores", () => {
  it("applies the SPEC thresholds and reports failures as FAIL", () => {
    const p = connemara.pool;
    const goodItems = p.slice(0, 8).map((x) => ({ itemId: x.id, section: x.section, clue: "Look up high.", lookWhere: "", sourceQuote: x.sourceText.slice(0, 30), difficulty: "easy" }));
    const printed = p.slice(0, 8).map((x) => ({ section: x.section, clue: "Look up high.", lookWhere: "", answer: x.answer }));
    const runs: RunRecord[] = [
      run({ run: 1, items: printed, calls: [call(goodItems, { latencyMs: 8_000 })] }),
      run({ run: 2, items: printed.slice(0, 5), calls: [call(goodItems, { latencyMs: 25_000 })] }),
      run({ run: 3, kind: "error", errorCode: "MODEL_TIMEOUT", calls: [call(null, { latencyMs: 30_000, status: null, error: "TimeoutError", promptTokens: null, completionTokens: null })] }),
    ];
    const s = scoreModel("gemma-4-31B-it", runs, new Map([[1, ctxC]]));
    expect(s.m1.pass).toBe(true);
    expect(s.m2.rate).toBe(1);
    expect(s.m3).toMatchObject({ complete: 1, dataRichRuns: 3, pass: false });
    expect(s.m7.p50Ms).toBe(25_000);
    expect(s.m7.passP50).toBe(false);
    expect(s.errors).toEqual({ MODEL_TIMEOUT: 1 });
    expect(s.m8.costPerPass).toBeLessThan(THRESHOLDS.m8);
    expect(s.m5.medianGrade).not.toBeNull();
    expect(isComplete(runs[0])).toBe(true);
    expect(isComplete(runs[1])).toBe(false);
  });

  it("never counts the template as a model for latency or cost", () => {
    const s = scoreModel("no-AI template", [run({ model: "no-AI template", calls: [call([], { latencyMs: 0, promptTokens: 0, completionTokens: 0 })] })], new Map([[1, ctxC]]), false);
    expect(s.m7.p50Ms).toBeNull();
    expect(s.m8.costPerPass).toBe(0);
  });
});

describe("run helpers", () => {
  it("reads the model's items, tokens and model id from a chat-completions body", () => {
    const body = JSON.stringify({
      model: "gemma-4-31B-it",
      usage: { prompt_tokens: 2100, completion_tokens: 640 },
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ items: [{ itemId: "osm-bench" }, "junk"], parentNote: "Have fun" }) } }],
    });
    expect(parseCompletionBody(body)).toEqual({
      promptTokens: 2100,
      completionTokens: 640,
      finishReason: "stop",
      answeredModel: "gemma-4-31B-it",
      rawItems: [{ itemId: "osm-bench" }],
    });
    expect(parseCompletionBody("not json").rawItems).toBeNull();
  });

  it("reads the pool ids from the strict schema in the request", () => {
    const body = JSON.stringify({ response_format: { json_schema: { schema: { properties: { items: { items: { properties: { itemId: { enum: ["a", "b"] } } } } } } } } });
    expect(requestPoolIds(body)).toEqual(["a", "b"]);
    expect(requestPoolIds("{}")).toBeNull();
  });

  it("makes pass ids the app accepts", () => {
    expect(passIdFor("way/306191453", "6-10", "2026-10-05", 2)).toMatch(PASS_ID_PATTERN);
    expect(passIdFor("relation/13307353", "10-13", "2026-10-05", 1)).toBe("r13307353-10to13-20261005-1");
  });

  it("reads settings from env with safe defaults", () => {
    const d = settingsFromEnv({});
    expect(d.models.map((m) => m.id)).toEqual(["gemma-4-31B-it", "llama-4-maverick"]);
    expect(d.models.map((m) => m.runs)).toEqual([3, 1]);
    expect(d.budgetUsd).toBe(1);
    expect(settingsFromEnv({ EVAL_MODELS: "none" }).models).toEqual([]);
    expect(settingsFromEnv({ EVAL_CASES: "1, 2", EVAL_RUNS: "1" })).toMatchObject({ cases: [1, 2], runsOverride: 1 });
    expect(() => settingsFromEnv({ EVAL_MODELS: "gpt-5" })).toThrow(/without a price/);
  });
});
