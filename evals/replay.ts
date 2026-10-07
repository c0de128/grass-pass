/**
 * `pnpm eval:replay` (free, no model, no network): re-run the REAL pass builder (build-pass.ts) on a
 * saved eval run, answering each model call with the raw answer that run recorded, in order. Every check,
 * refill plan and merge is today's code; only the model's words are the saved ones.
 *
 * - The clock is virtual: data steps take the recorded run's wall time minus its model time (before the first model
 *   call), and each
 *   replayed call takes its recorded latency, so the deadline logic sees the same time budget. The app's own
 *   time limits apply (src/lib/pass/budget.ts), on the virtual clock (BuildDeps.modelDeadline): no real waiting.
 * - A recorded timeout is replayed as a timeout at TODAY's limit for that call (the recording only says the answer
 *   took longer than the old limit, so this is the pessimistic reading: it never answers), and a recorded HTTP error
 *   as that status.
 * - Slow clock (slow-provider fix, EVAL_REPLAY_TPS): every answered call takes at least
 *   SLOW_CLOCK_OVERHEAD_MS + its answer tokens at that speed. A call slower than today's limit for it times out.
 * - Old budget (EVAL_REPLAY_OLD_BUDGET=1): the fixed limits before the slow-provider fix (30 s a call, 20 s a refill,
 *   the same whole request on a retry), to compare on the same clock.
 * - A call today's code makes that the saved run never made (a second refill, a retry after a timeout)
 *   has no recorded answer. Nothing is invented for it: it is answered with HTTP 400 (so it keeps
 *   nothing) and counted in `unrecorded`, with the size of what it asked for. The replay's M3 is then a
 *   LOWER bound; `optimisticComplete` counts those runs as complete if the unrecorded call filled them.
 * - A replayed refill reuses the saved refill answer even when today's refill asks for more items (or a
 *   different pool): items for ids the new refill did not offer are dropped as unknown_id, as they would be.
 */
import "@/lib/zod-config";
import { buildPass, type BuildDeps } from "@/lib/ai/build-pass";
import { MemoryStore } from "@/lib/cache/store";
import type { DropReason } from "@/lib/ai/validate";
import type { FetchLike } from "@/lib/sources/common";
import { parseParkId } from "@/lib/sources/overpass-features";
import { localDay } from "@/lib/time";
import { caseDataOrNull, createReplayFetch, fixturePath, loadCases, loadFixture, type CaseData, type EvalFixture } from "./fixture";
import { existsSync } from "node:fs";
import { passIdFor, runTemplateCase, type EvalResults } from "./run";
import { TEMPLATE_MODEL } from "./baseline";
import { caseContext, isComplete, scoreModel, type CallRecord, type CaseContext, type ModelScore, type RunRecord } from "./score";

/** Assumed latency of a call the saved run never made (run 2026-10-06-5: refill p50 6.3 s, first call p50 13.7 s). */
export const UNRECORDED_REFILL_MS = 6_300;
export const UNRECORDED_FIRST_MS = 13_700;
/** Slow clock: time before the first answer token (run 2026-10-06-8 fit: 0.6-1.1 s). */
export const SLOW_CLOCK_OVERHEAD_MS = 1_000;
/** The fixed limits before the slow-provider fix (EVAL_REPLAY_OLD_BUDGET=1). */
export const OLD_BUDGET = { passDeadlineMs: 85_000, modelTimeoutMs: 30_000, refillTimeoutMs: 20_000 } as const;

export type ReplayOptions = {
  /** Slow clock: answer tokens per second (null = the recorded latencies). */
  tps?: number | null;
  /** Use the old fixed limits (OLD_BUDGET) instead of the app's budget. */
  oldBudget?: boolean;
};

/** Latency of a recorded answered call on the slow clock (never faster than recorded). */
export function slowLatencyMs(c: CallRecord, tps: number | null | undefined): number {
  if (!tps || !(tps > 0) || typeof c.completionTokens !== "number") return c.latencyMs;
  return Math.max(c.latencyMs, Math.round(SLOW_CLOCK_OVERHEAD_MS + (c.completionTokens / tps) * 1000));
}

export type UnrecordedCall = { caseN: number; run: number; callIndex: number; asked: number | null; poolIds: number | null };

/** Characters of the prompt today's code sends on one call (system and user message), to estimate prompt tokens offline. */
export type PromptSize = { call: number; systemChars: number; userChars: number };

export type ReplayRun = RunRecord & {
  unrecorded: UnrecordedCall[];
  dropLog: { reason: DropReason; itemId: string | null; clue: string | null; call: number }[];
  /** r7 follow-ups (M8): the size of every prompt today's code built, so a prompt change can be priced before a paid run. */
  promptSizes?: PromptSize[];
  /** Slow-provider fix: per model call today's code made, the items it asked for, its time limit and its max_tokens. */
  budget?: { asked: number | null; timeoutMs: number | null; maxTokens: number | null }[];
  /** Virtual time from the start of the pass to its end (the deadline check: never above PASS_DEADLINE_MS). */
  virtualMs?: number;
};

/** System and user message lengths of a chat-completions request body (0 when it is not one). */
export function promptSizeOf(body: unknown, call: number): PromptSize {
  if (typeof body !== "string") return { call, systemChars: 0, userChars: 0 };
  try {
    const j = JSON.parse(body) as { messages?: { role?: string; content?: unknown }[] };
    const len = (role: string) => (j.messages ?? []).filter((m) => m.role === role).reduce((a, m) => a + (typeof m.content === "string" ? m.content.length : 0), 0);
    return { call, systemChars: len("system"), userChars: len("user") };
  } catch {
    return { call, systemChars: 0, userChars: 0 };
  }
}

const isTimeoutRecord = (c: CallRecord) => c.status === null && (c.error === "TimeoutError" || c.error === "AbortError");

/** A chat-completions body holding a recorded call's raw items (only fields the app reads). */
export function completionBodyOf(c: CallRecord, model: string): string {
  return JSON.stringify({
    model: c.answeredModel ?? model,
    choices: [{ index: 0, finish_reason: c.finishReason ?? "stop", message: { role: "assistant", content: JSON.stringify({ items: c.rawItems ?? [] }) } }],
    usage: { prompt_tokens: c.promptTokens ?? 0, completion_tokens: c.completionTokens ?? 0 },
  });
}

function maxTokensOf(body: unknown): number | null {
  if (typeof body !== "string") return null;
  try {
    const n = (JSON.parse(body) as { max_tokens?: unknown }).max_tokens;
    return typeof n === "number" ? n : null;
  } catch {
    return null;
  }
}

function askedOf(body: unknown): { n: number | null; poolIds: number | null } {
  if (typeof body !== "string") return { n: null, poolIds: null };
  try {
    const j = JSON.parse(body) as { response_format?: { json_schema?: { schema?: { properties?: { items?: { minItems?: number; items?: { properties?: { itemId?: { enum?: unknown[] } } } } } } } } };
    const items = j.response_format?.json_schema?.schema?.properties?.items;
    return { n: typeof items?.minItems === "number" ? items.minItems : null, poolIds: Array.isArray(items?.items?.properties?.itemId?.enum) ? items.items.properties.itemId.enum.length : null };
  } catch {
    return { n: null, poolIds: null };
  }
}

/** One saved run replayed through today's buildPass. */
export async function replayRun(rec: RunRecord, fx: EvalFixture, band: CaseData["band"], opts: ReplayOptions = {}): Promise<ReplayRun> {
  const replay = createReplayFetch(fx);
  let virtual = 0;
  /** The current call's timeout on the virtual clock (set by the app through BuildDeps.modelDeadline). */
  let deadline: { ac: AbortController; ms: number } | null = null;
  const modelDeadline = (ms: number): AbortSignal => {
    deadline = { ac: new AbortController(), ms };
    return deadline.ac.signal;
  };
  /** The call ran out of time on the virtual clock: the app's own deadline fires. */
  const timeOut = (): never => {
    const d = deadline;
    virtual += d?.ms ?? 0;
    const err = new DOMException("replayed timeout", "TimeoutError");
    d?.ac.abort(err);
    throw err;
  };
  const now = () => fx._recording.fetchedAtMs + virtual;
  const recordedModelMs = rec.calls.reduce((a, c) => a + c.latencyMs, 0);
  const dataMs = Math.max(0, rec.wallMs - recordedModelMs);
  const calls: CallRecord[] = [];
  const unrecorded: UnrecordedCall[] = [];
  const dropLog: ReplayRun["dropLog"] = [];
  const promptSizes: PromptSize[] = [];
  const budget: NonNullable<ReplayRun["budget"]> = [];
  let k = 0;
  const modelFetch: FetchLike = async (_url, init) => {
    const i = k++;
    promptSizes.push(promptSizeOf(init?.body, i));
    budget.push({ asked: askedOf(init?.body).n, timeoutMs: (deadline as { ms: number } | null)?.ms ?? null, maxTokens: maxTokensOf(init?.body) });
    const saved = rec.calls[i];
    if (!saved) {
      const a = askedOf(init?.body);
      unrecorded.push({ caseN: rec.caseN, run: rec.run, callIndex: i, asked: a.n, poolIds: a.poolIds });
      virtual += i === 0 ? UNRECORDED_FIRST_MS : UNRECORDED_REFILL_MS;
      calls.push({ latencyMs: 0, status: null, error: "UNRECORDED", promptTokens: null, completionTokens: null, finishReason: null, answeredModel: null, rawItems: null, poolMatches: null });
      return new Response("{}", { status: 400 });
    }
    if (isTimeoutRecord(saved)) {
      calls.push({ ...saved, latencyMs: (deadline as { ms: number } | null)?.ms ?? saved.latencyMs });
      timeOut();
    }
    if (saved.status !== 200) {
      calls.push(saved);
      virtual += saved.latencyMs;
      return new Response("{}", { status: saved.status ?? 502 });
    }
    const latency = slowLatencyMs(saved, opts.tps);
    const limit = (deadline as { ms: number } | null)?.ms ?? Number.POSITIVE_INFINITY;
    if (latency > limit) {
      calls.push({ ...saved, latencyMs: limit, status: null, error: "TimeoutError", completionTokens: null, rawItems: null, finishReason: null });
      timeOut();
    }
    calls.push(latency === saved.latencyMs ? saved : { ...saved, latencyMs: latency });
    virtual += latency;
    return new Response(completionBodyOf(saved, rec.model), { status: 200, headers: { "content-type": "application/json" } });
  };
  const ref = parseParkId(fx._recording.parkId);
  if (!ref) throw new Error("bad park id");
  const day = localDay(now());
  const startedAt = now();
  // The data steps (replayed at once) take the recorded data time BEFORE the first model call, as in a real pass, so
  // the app sizes the first call to the time really left.
  virtual += dataMs;
  let callNo = 0;
  const deps: BuildDeps = {
    store: new MemoryStore(),
    env: { DO_INFERENCE_API_KEY: "replay-no-network", MODEL_ID: rec.model, ...(rec.model.toLowerCase().includes("llama") ? { MODEL_TIMEOUT_MS: "60000" } : {}) },
    now,
    fetchImpl: replay.fetch,
    modelFetch,
    signal: new AbortController().signal,
    emit: (step) => {
      if (step === "clues" || step === "retry") callNo++;
    },
    pin: () => undefined,
    onUpstream: () => undefined,
    reserveAiCall: async () => ({ commit: () => undefined, release: async () => undefined, committed: true }),
    startedAt,
    modelLogger: () => undefined,
    validateTrace: (d) => dropLog.push({ ...d, call: callNo }),
    modelDeadline,
    ...(opts.oldBudget ? { clock: { ...OLD_BUDGET, modelTimeoutMs: rec.model.toLowerCase().includes("llama") ? 60_000 : OLD_BUDGET.modelTimeoutMs } } : {}),
  };
  const base = { caseN: rec.caseN, slug: rec.slug, model: rec.model, run: rec.run, n: rec.n, dataRich: rec.dataRich, wallMs: 0 };
  const out = await buildPass({ ref, band, day, variant: rec.run, id: passIdFor(fx._recording.parkId, band, day, rec.run) }, deps);
  const extra = { calls, unrecorded, dropLog, promptSizes, budget, virtualMs: now() - startedAt };
  if (replay.misses.length > 0) return { ...base, ...extra, parkName: rec.parkName, kind: "error", errorCode: "FIXTURE_MISS", sections: {}, items: [] };
  if (out.kind === "pass") {
    const p = out.pass;
    return {
      ...base,
      ...extra,
      parkName: p.park.name,
      kind: "pass",
      sections: p.sections,
      items: p.items.map((i) => ({ section: i.section, clue: i.clue, lookWhere: i.lookWhere, answer: i.answer })),
      removed: p.removed,
    };
  }
  if (out.kind === "empty") return { ...base, ...extra, parkName: out.parkName, kind: "empty", message: out.message, sections: out.sections, items: [] };
  return { ...base, ...extra, parkName: rec.parkName, kind: "error", errorCode: out.error.code, message: out.error.message, sections: {}, items: [] };
}

export type ReplaySummary = {
  model: string;
  score: ModelScore;
  runs: ReplayRun[];
  unrecorded: UnrecordedCall[];
  /** Data-rich runs complete if every unrecorded call had filled the pass (upper bound). */
  optimisticComplete: number;
};

/** Replay every run of `models` in a saved results file (cases without a fixture are skipped and listed). */
export async function replayResults(
  results: EvalResults,
  models: readonly string[],
  opts: ReplayOptions = {},
): Promise<{ summaries: ReplaySummary[]; skipped: string[]; contexts: ReadonlyMap<number, CaseContext> }> {
  const band = results.meta.ageBand;
  const casesFile = loadCases();
  const fixtures = new Map<number, EvalFixture>();
  const caseData = new Map<number, { c: (typeof casesFile.cases)[number]; data: CaseData }>();
  const contexts = new Map<number, CaseContext>();
  const skipped: string[] = [];
  for (const c of casesFile.cases) {
    if (!results.meta.settings.cases.includes(c.n)) continue;
    if (!existsSync(fixturePath(c.slug))) {
      skipped.push(`case ${c.n}: no fixture`);
      continue;
    }
    const fx = loadFixture(c.slug);
    const r = await caseDataOrNull(fx, band);
    if (!r.data) {
      skipped.push(`case ${c.n}: ${r.problem}`);
      continue;
    }
    fixtures.set(c.n, fx);
    caseData.set(c.n, { c, data: r.data });
    contexts.set(c.n, caseContext(c.n, r.data));
  }
  const summaries: ReplaySummary[] = [];
  for (const model of models) {
    if (model === TEMPLATE_MODEL) {
      // The no-AI template has no model answer to replay: it is simply run again with today's checks.
      const runs: ReplayRun[] = [...caseData.values()].map(({ c, data }) => ({ ...runTemplateCase(c, data), unrecorded: [], dropLog: [] }));
      summaries.push({ model, score: scoreModel(model, runs, contexts, false), runs, unrecorded: [], optimisticComplete: runs.filter((r) => r.dataRich && isComplete(r)).length });
      continue;
    }
    const runs: ReplayRun[] = [];
    for (const rec of results.runs.filter((r) => r.model === model && r.kind !== "skipped")) {
      const fx = fixtures.get(rec.caseN);
      if (!fx) continue;
      // A run that never reached the model (no pass possible) replays to the same empty answer.
      runs.push(await replayRun(rec, fx, band, opts));
    }
    const unrecorded = runs.flatMap((r) => r.unrecorded);
    const optimisticComplete = runs.filter((r) => r.dataRich && (isComplete(r) || r.unrecorded.length > 0)).length;
    summaries.push({ model, score: scoreModel(model, runs, contexts, true), runs, unrecorded, optimisticComplete });
  }
  return { summaries, skipped, contexts };
}
