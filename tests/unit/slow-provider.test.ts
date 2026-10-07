/**
 * Slow provider (eval run 2026-10-06-8: DigitalOcean at 28.1 answer tokens/s instead of 47.3; M3 82.4%, M7 15.3 / 30.0 s,
 * M10 9.7%). The budget model is checked against the recorded calls it was fitted on; the pass builder is driven on a
 * virtual (fake) clock by the eval replay (evals/replay.ts) with run -8's own recorded calls. The only built inputs
 * are said so: slower data steps (a longer recorded wall time), the 403 bodies, and a hang.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  answerTokens,
  callNeedMs,
  CALL_MARGIN_MS,
  FIRST_CALL_MAX_MS,
  firstCallTimeoutMs,
  itemsThatFit,
  maxTokensFor,
  PASS_DEADLINE_MS,
  REFILL_MAX_MS,
  REFILL_MIN_MS,
  refillTimeoutMs,
  retryTokensPerS,
  slowTokensPerS,
  wholeRetryMinLeftMs,
  wholeRetrySize,
  wholeRetryTimeoutMs,
} from "@/lib/pass/budget";
import { callMaxTokens, PASS_MAX_TOKENS } from "@/lib/ai/build-pass";
import { callModel, errorIdOf, FORBIDDEN_BACKOFF_MS, ModelError, modelTimeoutCapMs, type ModelLogLine, type ModelRequest } from "@/lib/model";
import { planRequest, shortRetryPlan } from "@/lib/ai/prompt";
import { FRAME_VERBS, rewriteStockFrame, stockFrame } from "@/lib/ai/validate";
import { DROP_REASON_INFO } from "@/lib/how/drop-reasons";
import { factsFor, KIND_FACTS } from "@/lib/pool/park";
import { setLogSink } from "@/lib/log";
import { caseDataOrNull, loadFixture, type CaseData } from "../../evals/fixture";
import { replayRun, type ReplayRun } from "../../evals/replay";
import type { CallRecord, RunRecord } from "../../evals/score";
import { settingsFromEnv, SpendMeter } from "../../evals/run";
import recording from "../fixtures/do-gemma-4-31b-it-celebration-two-items.json";

const RESULTS = path.join(process.cwd(), "evals", "results");
type Results = { runs: RunRecord[]; meta: { ageBand: CaseData["band"] } };
const loadResults = (name: string) => JSON.parse(readFileSync(path.join(RESULTS, name), "utf8")) as Results;
const run8 = loadResults("2026-10-06-8.json");
const gemma = (r: RunRecord) => r.model === "gemma-4-31B-it";
const rec = (slug: string, run: number): RunRecord => {
  const r = run8.runs.find((x) => gemma(x) && x.slug === slug && x.run === run);
  if (!r) throw new Error(`no run -8 record ${slug} r${run}`);
  return r;
};
const answered = (c: CallRecord) => c.status === 200 && typeof c.completionTokens === "number" && Array.isArray(c.rawItems);

let restoreLog: () => void = () => undefined;
beforeAll(() => {
  restoreLog = setLogSink(() => undefined);
});
afterAll(() => restoreLog());

describe("the budget model, checked against the recorded calls it was fitted on", () => {
  it("max_tokens (1.5x the budgeted answer, 400-1,200) is above every answered Gemma call of runs -5 to -8", () => {
    let checked = 0;
    for (const name of ["2026-10-06-5.json", "2026-10-06-6.json", "2026-10-06-7.json", "2026-10-06-8.json"]) {
      for (const r of loadResults(name).runs.filter(gemma)) {
        for (const c of r.calls.filter(answered)) {
          // Without the riddle (the stricter case: the riddle only adds budget).
          expect(maxTokensFor(c.rawItems!.length, false, PASS_MAX_TOKENS), `${name} ${r.slug} r${r.run}`).toBeGreaterThan(c.completionTokens!);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(250);
    expect(maxTokensFor(8, true, PASS_MAX_TOKENS)).toBe(930);
    expect(maxTokensFor(3, false, PASS_MAX_TOKENS)).toBe(400);
    expect(maxTokensFor(20, true, PASS_MAX_TOKENS)).toBe(PASS_MAX_TOKENS);
    expect(callMaxTokens("gpt-oss-120b", 3, false)).toBe(2_000);
    expect(callMaxTokens("gemma-4-31B-it", 8, true)).toBe(930);
  });

  it("the answer size and speed: 8 clues + riddle = 620 tokens, 42.8 s at 15/s (first call), 32.5 s at 20/s (retry)", () => {
    expect(answerTokens(8, true)).toBe(620);
    expect(callNeedMs(8, true, 15)).toBe(42_834);
    expect(callNeedMs(8, true, 20)).toBe(32_500);
    expect([slowTokensPerS("gemma-4-31B-it"), retryTokensPerS("gemma-4-31B-it")]).toEqual([15, 20]);
    expect([slowTokensPerS("llama-4-maverick"), retryTokensPerS("llama-4-maverick")]).toEqual([10, 10]);
    // Run -8: the slowest answered first call was 29.6 s, so the first call now waits up to 40 s.
    const firsts = run8.runs.filter(gemma).flatMap((r) => (r.calls[0] && answered(r.calls[0]) ? [r.calls[0].latencyMs] : []));
    expect(Math.max(...firsts)).toBeLessThan(30_000);
    expect(FIRST_CALL_MAX_MS).toBe(40_000);
  });

  it("the retry speed (20/s) is under every retry that answered after a first-call timeout (runs -6 to -8)", () => {
    const speeds: number[] = [];
    for (const name of ["2026-10-06-6.json", "2026-10-06-7.json", "2026-10-06-8.json"]) {
      for (const r of loadResults(name).runs.filter(gemma)) {
        const [first, retry] = r.calls;
        if (first?.error === "TimeoutError" && retry && answered(retry)) speeds.push(retry.completionTokens! / (retry.latencyMs / 1000));
      }
    }
    expect(speeds.length).toBe(9);
    expect(Math.min(...speeds)).toBeGreaterThan(retryTokensPerS("gemma-4-31B-it"));
  });
});

describe("the rules, on a fake clock (pure functions of the time left)", () => {
  const first = (leftMs: number, capMs: number | null = null) => firstCallTimeoutMs({ leftMs, items: 8, spot: true, tps: 15, retryTps: 20, capMs });

  it("rule 1: the first call gets up to 40 s and keeps room for a 3-clue retry; with no room for one, it gets all of it", () => {
    expect(first(85_000)).toBe(40_000);
    expect(first(50_000)).toBe(50_000 - CALL_MARGIN_MS - callNeedMs(3, false, 20)); // 33.75 s
    expect(first(40_000)).toBe(37_000); // a retry could not fit anyway
    expect(first(15_000)).toBe(12_000);
    expect(first(85_000, 5_000)).toBe(5_000); // MODEL_TIMEOUT_MS caps every call
    // Llama 4 Maverick with its documented MODEL_TIMEOUT_MS=60000 (slower: 10 answer tokens/s for both).
    expect(firstCallTimeoutMs({ leftMs: 85_000, items: 9, spot: true, tps: 10, retryTps: 10, capMs: 60_000 })).toBe(57_000);
    // A set MODEL_TIMEOUT_MS is the first call's limit, not cut to the sized one (the self-host lane's 70 s).
    expect(first(85_000, 70_000)).toBe(68_750);
  });

  it("rule 1-4: no call ever runs past the deadline, whatever the time left", () => {
    for (let left = 15_000; left <= PASS_DEADLINE_MS; left += 250) {
      expect(first(left)).toBeLessThanOrEqual(left - CALL_MARGIN_MS);
      expect(wholeRetryTimeoutMs(left, null)).toBeLessThanOrEqual(left - CALL_MARGIN_MS);
      expect(refillTimeoutMs(left, 4, false, 15, null)).toBeLessThanOrEqual(left - CALL_MARGIN_MS);
      // The worst case: the first call and the whole retry both run to their limits.
      const t1 = first(left);
      const t2 = wholeRetryTimeoutMs(left - t1, null);
      expect(t1 + t2).toBeLessThanOrEqual(left);
    }
  });

  it("rule 2: the whole retry asks for what fits in the time left, the riddle only when it costs no clue", () => {
    // After a 40 s first call with fast data steps: the whole request again (8 + riddle).
    expect(wholeRetrySize(43_000, 8, true, 20)).toEqual({ items: 8, spot: true });
    expect(wholeRetrySize(25_000, 8, true, 20)).toEqual({ items: 5, spot: false });
    expect(itemsThatFit(25_000, 8, true, 20)).toBe(4);
    expect(wholeRetrySize(wholeRetryMinLeftMs(20), 8, false, 20)).toEqual({ items: 3, spot: false });
    expect(wholeRetrySize(wholeRetryMinLeftMs(20) - 1, 8, false, 20)).toEqual({ items: 0, spot: false });
    expect(wholeRetryTimeoutMs(45_000, null)).toBe(40_000);
    expect(wholeRetryTimeoutMs(30_000, null)).toBe(27_000);
  });

  it("rule 3: a refill is sized to its ask, 15-30 s", () => {
    expect(refillTimeoutMs(85_000, 4, false, 15, null)).toBe(21_500);
    expect(refillTimeoutMs(85_000, 1, false, 15, null)).toBe(REFILL_MIN_MS);
    expect(refillTimeoutMs(85_000, 7, false, 15, null)).toBe(REFILL_MAX_MS);
    expect(refillTimeoutMs(20_000, 4, false, 15, null)).toBe(17_000);
    expect(refillTimeoutMs(85_000, 4, false, 15, 5_000)).toBe(5_000);
  });

  it("eval only: EVAL_MAX_CALLS stops new model calls once reached (the small live check)", () => {
    const m = new SpendMeter(1, 2);
    expect(m.canStart()).toBe(true);
    m.add("gemma-4-31B-it", 10, 10);
    m.add("gemma-4-31B-it", 10, 10);
    expect(m.canStart()).toBe(false);
    expect(settingsFromEnv({ EVAL_MAX_CALLS: "8" }).maxCalls).toBe(8);
    expect(settingsFromEnv({}).maxCalls).toBeNull();
  });

  it("MODEL_TIMEOUT_MS is a cap only when set", () => {
    expect(modelTimeoutCapMs({})).toBeNull();
    expect(modelTimeoutCapMs({ MODEL_TIMEOUT_MS: "60000" })).toBe(60_000);
    expect(modelTimeoutCapMs({ MODEL_TIMEOUT_MS: "999999" })).toBe(70_000);
  });
});

describe("the real pass builder on run -8's recorded calls, on the replay's virtual clock", () => {
  const data: Record<string, CaseData> = {};
  const replay = async (r: RunRecord, opts: { tps?: number } = {}): Promise<ReplayRun> => {
    const fx = loadFixture(r.slug);
    data[r.slug] ??= (await caseDataOrNull(fx, run8.meta.ageBand)).data!;
    return replayRun(r, fx, run8.meta.ageBand, opts);
  };
  const complete = (x: ReplayRun) => x.kind === "pass" && x.n !== null && x.items.length >= x.n - 1;

  it("Celebration r1: the first call times out at 40 s (not 30), the whole request is asked again and answers: complete", async () => {
    const r = rec("celebration-park", 1);
    expect(r.calls[0].error).toBe("TimeoutError"); // recorded at the old 30 s limit
    const out = await replay(r);
    expect(out.budget![0].timeoutMs).toBe(40_000);
    expect(out.budget![1].asked).toBe(out.budget![0].asked);
    expect(complete(out)).toBe(true);
    expect(out.virtualMs!).toBeLessThanOrEqual(PASS_DEADLINE_MS);
  }, 60_000);

  it("Bethany Lakes r2 with 35 s of slow data steps (built): the retry is cut to 3 clues, answers, and the pass is short but honest", async () => {
    const r = rec("bethany-lakes-park", 2);
    // The replay's data time is the recorded wall time minus the model time: set it to exactly 35 s.
    const out = await replay({ ...r, wallMs: r.calls.reduce((a, c) => a + c.latencyMs, 0) + 35_000 });
    expect(out.budget![0].asked).toBeGreaterThan(3);
    expect(out.budget![1].asked).toBe(3);
    expect(out.budget![1].maxTokens).toBe(400);
    expect(out.kind).toBe("pass");
    expect(out.items).toHaveLength(3);
    expect(out.virtualMs!).toBeLessThanOrEqual(PASS_DEADLINE_MS);
  }, 60_000);

  it("Bob Woodruff r1 (first call AND retry timed out): two calls, an honest timeout, inside 85 s", async () => {
    const out = await replay(rec("bob-woodruff-park", 1));
    expect(out.kind).toBe("error");
    expect(out.errorCode).toBe("MODEL_TIMEOUT");
    expect(out.calls).toHaveLength(2);
    expect(out.virtualMs!).toBeLessThanOrEqual(PASS_DEADLINE_MS);
  }, 60_000);

  it("on a slow clock (17.6 answer tokens/s, run -8's slowest 5%), every timed-out run stays inside 85 s and 3 calls", async () => {
    for (const [slug, n] of [["bethany-lakes-park", 1], ["allen-station-park", 1], ["spring-creek-forest-preserve", 3], ["cedar-ridge-preserve", 3], ["white-rock-lake-park", 3]] as const) {
      const out = await replay(rec(slug, n), { tps: 17.6 });
      expect(out.virtualMs!, slug).toBeLessThanOrEqual(PASS_DEADLINE_MS);
      expect(out.calls.length, slug).toBeLessThanOrEqual(3);
    }
  }, 120_000);

  it("M10: run -8's printed 'Somewhere you will see ...' clues now print with a plain first word (Allen Station r2, Zilker r1)", async () => {
    const allen = await replay(rec("allen-station-park", 2));
    expect(allen.items.map((i) => i.clue)).toContain("Notice 2 still areas of water.");
    const zilker = await replay(rec("zilker-metropolitan-park", 1));
    expect(zilker.items.map((i) => i.clue)).toContain("Spot a low dirt hill in the center.");
    for (const i of [...allen.items, ...zilker.items]) {
      const f = stockFrame(i.clue);
      expect(f === null || f === "hunt for a tree", i.clue).toBe(true);
    }
  }, 60_000);

  it("the whole retry after a timeout is cut to fit only through the real plan (a real pool, Celebration)", () => {
    const plan = planRequest(data["celebration-park"]!.pool, "6-10", "Celebration Park")!;
    expect(shortRetryPlan(plan, plan.ask.n, "6-10")).toBe(plan);
    const short = shortRetryPlan(plan, 5, "6-10")!;
    expect([short.mix.n, short.ask.n]).toEqual([5, 5]);
    expect(short.pool).toBe(plan.pool);
    expect(Object.values(short.mix.min).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(5);
  });
});

describe("HTTP 403 from DigitalOcean: one short retry inside the call", () => {
  const recorded = recording.response;
  const schema = z.object({ items: z.array(z.object({ itemId: z.string(), clue: z.string() })).min(2).max(2) });
  const request: ModelRequest<z.infer<typeof schema>> = {
    task: "test",
    messages: recording.request.messages as ModelRequest<unknown>["messages"],
    jsonSchema: recording.request.jsonSchema,
    schemaName: recording.request.schemaName,
    schema,
  };
  // Built 403 body: DigitalOcean's error shape ({"id", "message"}, as its real 401 answer on 2026-10-06), with prompt text
  // in the message to prove only the id is logged.
  const forbidden = JSON.stringify({ id: "forbidden", message: "Celebration Park has 2 basketball courts" });
  const run = (statuses: number[]) => {
    const logs: ModelLogLine[] = [];
    let i = 0;
    const fetch = async (): Promise<Response> => {
      const s = statuses[Math.min(i++, statuses.length - 1)];
      return s === 200 ? new Response(JSON.stringify(recorded), { status: 200 }) : new Response(forbidden, { status: s });
    };
    const result = callModel(request, { env: { DO_INFERENCE_API_KEY: "test-key-not-real" }, fetch, logger: (l) => logs.push(l), backoffMs: 1 });
    return { result, logs, count: () => i };
  };

  it("a 403 then an answer: 2 attempts, the 403 logged with its short error id only", async () => {
    const { result, logs, count } = run([403, 200]);
    const r = await result;
    expect([r.attempts, count()]).toEqual([2, 2]);
    expect(logs[0]).toMatchObject({ outcome: "provider_error", upstreamStatus: 403, upstreamErrorId: "forbidden" });
    expect(JSON.stringify(logs)).not.toContain("basketball");
    expect(FORBIDDEN_BACKOFF_MS).toBe(1_000);
  });

  it("two 403s: MODEL_PROVIDER after one retry; a 401 (DigitalOcean's answer to a bad key) is never retried", async () => {
    const twice = run([403, 403, 200]);
    const e = await twice.result.catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ModelError);
    expect([(e as ModelError).code, (e as ModelError).upstreamStatus, twice.count()]).toEqual(["MODEL_PROVIDER", 403, 2]);
    const bad = run([401, 200]);
    await expect(bad.result).rejects.toBeInstanceOf(ModelError);
    expect(bad.count()).toBe(1);
  });

  it("errorIdOf keeps a short token only (the real DigitalOcean 401 body, 2026-10-06)", async () => {
    expect(await errorIdOf(new Response('{"id": "Unauthorized", "message": "Unable to authenticate you" }'))).toBe("Unauthorized");
    expect(await errorIdOf(new Response('{"error": {"code": "rate_limit_exceeded"}}'))).toBe("rate_limit_exceeded");
    expect(await errorIdOf(new Response('{"error": {"code": "has spaces from the prompt"}}'))).toBeUndefined();
    expect(await errorIdOf(new Response("<html>Forbidden</html>"))).toBeUndefined();
  });

  it("the call's timeout can run on a virtual clock (deadlineSignal): MODEL_TIMEOUT with the limit it was given", async () => {
    let given = 0;
    const ac = new AbortController();
    const p = callModel(request, {
      env: { DO_INFERENCE_API_KEY: "test-key-not-real" },
      timeoutMs: 37_000,
      logger: () => undefined,
      deadlineSignal: (ms) => {
        given = ms;
        return ac.signal;
      },
      fetch: (_u, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("t", "TimeoutError")), { once: true });
          ac.abort();
        }),
    });
    const e = await p.catch((x: unknown) => x);
    expect((e as ModelError).code).toBe("MODEL_TIMEOUT");
    expect(given).toBe(37_000);
  });
});

describe("M10: banned frames get a plain first word; the bridge fact rotates", () => {
  const none = new Set<string>();
  it("real run -8 clues", () => {
    expect(rewriteStockFrame("Somewhere you will see a low dirt hill in the center.", none, "Baseball field")).toBe("Spot a low dirt hill in the center.");
    expect(rewriteStockFrame("Somewhere you will see a vine with large, purple blooms.", new Set(["spot"]), "Purple passionflower")).toBe(
      "Notice a vine with large, purple blooms.",
    );
    expect(rewriteStockFrame("Somewhere there is a bug with blue on its tail end?", none, "Rambur's Forktail")).toBe("Spot a bug with blue on its tail end.");
    expect(rewriteStockFrame("Where can you see a spray of water bob up from a spout?", none, "Drinking fountains")).toBe("Spot a spray of water bob up from a spout.");
    expect(rewriteStockFrame("Somewhere there is a thing that sprays water into a bowl. Can you hear it splashing?", none, "Fountains")).toBe(
      "Spot a thing that sprays water into a bowl. Can you hear it splashing?",
    );
    // Run -5 (Celebration): a frame that hears becomes "Listen for".
    expect(rewriteStockFrame("Somewhere you can hear water splashing as you get near.", none, "Fountains")).toBe("Listen for water splashing as you get near.");
  });

  it("leaves other clues alone, skips a verb that starts like the answer, and keeps the clue when every word is taken", () => {
    expect(rewriteStockFrame("Hunt for a tree with bumpy, yellow-green fruit.", none, "Osage-orange")).toBe("Hunt for a tree with bumpy, yellow-green fruit.");
    expect(rewriteStockFrame("Somewhere a green back has brownish markings.", none, "American Bullfrog")).toBe("Somewhere a green back has brownish markings.");
    expect(rewriteStockFrame("Somewhere you will see a bird that bobs its tail.", none, "Spotted Sandpiper")).toBe("Notice a bird that bobs its tail.");
    const all = new Set(FRAME_VERBS.map((v) => v.split(" ")[0].toLowerCase()));
    expect(rewriteStockFrame("Somewhere you will see a bench.", all, "Benches")).toBe("Somewhere you will see a bench.");
    expect(DROP_REASON_INFO.stock_frame.kind).toBe("preference");
  });

  it("the bridge bank: 6 facts, the crossing fact has no 'path' and is on about 1 park in 3", () => {
    expect(KIND_FACTS.bridge).toHaveLength(6);
    expect(KIND_FACTS.bridge[0]).not.toMatch(/path|trail|walkway/);
    let withCrossing = 0;
    for (let i = 0; i < 60; i++) {
      const facts = factsFor("bridge", `way/${7000 + i * 7919}`, 3).join(" ");
      expect(facts).not.toMatch(/\bpaths?\b/);
      if (/water or a/.test(facts)) withCrossing++;
    }
    expect(withCrossing / 60).toBeLessThan(0.5);
  });
});
