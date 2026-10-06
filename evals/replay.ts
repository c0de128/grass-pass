/**
 * `pnpm eval:replay` (free, no model, no network): re-run the REAL pass builder (build-pass.ts) on a
 * saved eval run, answering each model call with the raw answer that run recorded, in order. Every check,
 * refill plan and merge is today's code; only the model's words are the saved ones.
 *
 * - The clock is virtual: data steps take the recorded run's wall time minus its model time, and each
 *   replayed call takes its recorded latency, so the deadline logic sees the same time budget.
 * - A recorded timeout is replayed as a timeout (the fake call waits for the app's abort signal; the
 *   replay sets MODEL_TIMEOUT_MS to 5 s so this takes 5 real seconds) and a recorded HTTP error as that
 *   status.
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
/** The replay's model timeout (real seconds waited for a recorded timeout). */
export const REPLAY_TIMEOUT_MS = 5_000;

export type UnrecordedCall = { caseN: number; run: number; callIndex: number; asked: number | null; poolIds: number | null };

export type ReplayRun = RunRecord & { unrecorded: UnrecordedCall[]; dropLog: { reason: DropReason; itemId: string | null; clue: string | null; call: number }[] };

const isTimeoutRecord = (c: CallRecord) => c.status === null && (c.error === "TimeoutError" || c.error === "AbortError");

/** A chat-completions body holding a recorded call's raw items (only fields the app reads). */
export function completionBodyOf(c: CallRecord, model: string): string {
  return JSON.stringify({
    model: c.answeredModel ?? model,
    choices: [{ index: 0, finish_reason: c.finishReason ?? "stop", message: { role: "assistant", content: JSON.stringify({ items: c.rawItems ?? [] }) } }],
    usage: { prompt_tokens: c.promptTokens ?? 0, completion_tokens: c.completionTokens ?? 0 },
  });
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
export async function replayRun(rec: RunRecord, fx: EvalFixture, band: CaseData["band"]): Promise<ReplayRun> {
  const replay = createReplayFetch(fx);
  let virtual = 0;
  const now = () => fx._recording.fetchedAtMs + virtual;
  const recordedModelMs = rec.calls.reduce((a, c) => a + c.latencyMs, 0);
  const dataMs = Math.max(0, rec.wallMs - recordedModelMs);
  const calls: CallRecord[] = [];
  const unrecorded: UnrecordedCall[] = [];
  const dropLog: ReplayRun["dropLog"] = [];
  let k = 0;
  const modelFetch: FetchLike = async (_url, init) => {
    const i = k++;
    if (i === 0) virtual += dataMs;
    const saved = rec.calls[i];
    if (!saved) {
      const a = askedOf(init?.body);
      unrecorded.push({ caseN: rec.caseN, run: rec.run, callIndex: i, asked: a.n, poolIds: a.poolIds });
      virtual += i === 0 ? UNRECORDED_FIRST_MS : UNRECORDED_REFILL_MS;
      calls.push({ latencyMs: 0, status: null, error: "UNRECORDED", promptTokens: null, completionTokens: null, finishReason: null, answeredModel: null, rawItems: null, poolMatches: null });
      return new Response("{}", { status: 400 });
    }
    calls.push(saved);
    if (isTimeoutRecord(saved)) {
      // Wait for the app's own timeout to fire, so callModel classifies it as MODEL_TIMEOUT.
      await new Promise<void>((resolve) => {
        const sig = init?.signal;
        if (!sig) return resolve();
        if (sig.aborted) return resolve();
        sig.addEventListener("abort", () => resolve(), { once: true });
      });
      virtual += saved.latencyMs;
      throw new DOMException("replayed timeout", "TimeoutError");
    }
    virtual += saved.latencyMs;
    if (saved.status !== 200) return new Response("{}", { status: saved.status ?? 502 });
    return new Response(completionBodyOf(saved, rec.model), { status: 200, headers: { "content-type": "application/json" } });
  };
  const ref = parseParkId(fx._recording.parkId);
  if (!ref) throw new Error("bad park id");
  const day = localDay(now());
  let callNo = 0;
  const deps: BuildDeps = {
    store: new MemoryStore(),
    env: { DO_INFERENCE_API_KEY: "replay-no-network", MODEL_ID: rec.model, MODEL_TIMEOUT_MS: String(REPLAY_TIMEOUT_MS) },
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
    startedAt: now(),
    modelLogger: () => undefined,
    validateTrace: (d) => dropLog.push({ ...d, call: callNo }),
  };
  const base = { caseN: rec.caseN, slug: rec.slug, model: rec.model, run: rec.run, n: rec.n, dataRich: rec.dataRich, wallMs: 0 };
  const out = await buildPass({ ref, band, day, variant: rec.run, id: passIdFor(fx._recording.parkId, band, day, rec.run) }, deps);
  const extra = { calls, unrecorded, dropLog };
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
export async function replayResults(results: EvalResults, models: readonly string[]): Promise<{ summaries: ReplaySummary[]; skipped: string[] }> {
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
      runs.push(await replayRun(rec, fx, band));
    }
    const unrecorded = runs.flatMap((r) => r.unrecorded);
    const optimisticComplete = runs.filter((r) => r.dataRich && (isComplete(r) || r.unrecorded.length > 0)).length;
    summaries.push({ model, score: scoreModel(model, runs, contexts, true), runs, unrecorded, optimisticComplete });
  }
  return { summaries, skipped };
}
