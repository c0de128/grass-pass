/**
 * `pnpm eval` (SPEC 6.4): run the real pass builder (src/lib/ai/build-pass.ts) on the 20 recorded
 * parks with the real open models on DigitalOcean, plus the no-AI template baseline, then score
 * M1-M8 and write evals/results/<date>.md + .json.
 *
 * - Park data comes ONLY from the recorded fixtures (replayed into the app's own source code);
 *   the model calls are live and paid. Nothing is invented: a missing fixture or a failed call is
 *   reported as such.
 * - Spend guard: EVAL_BUDGET_USD (default 1.00). No new model call starts once the measured spend
 *   (tokens x DO price) reaches it; those runs are reported as skipped.
 * - Settings (env): EVAL_MODELS (default "gemma-4-31B-it,llama-4-maverick"; "none" = baseline only),
 *   EVAL_RUNS (override runs per model), EVAL_CASES (comma case numbers), EVAL_BUDGET_USD,
 *   EVAL_AGE_BAND (audit R3: "4-6" | "6-10" | "10-13" | "13+", overrides cases.json's band; the run is then partial).
 */
import "@/lib/zod-config";
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { buildPass, type BuildDeps, type PassClock } from "@/lib/ai/build-pass";
import { MemoryStore } from "@/lib/cache/store";
import { setLogSink } from "@/lib/log";
import { resolveModelTarget, type ModelLogLine } from "@/lib/model";
import { AGE_BAND_INFO, AGE_BANDS, AgeBandSchema, type AgeBand } from "@/lib/pass/schema";
import type { FetchLike } from "@/lib/sources/common";
import { parseParkId } from "@/lib/sources/overpass-features";
import { localDay } from "@/lib/time";
import { TEMPLATE_MODEL, templatePass } from "./baseline";
import { evalEnv, envList } from "./env";
import {
  APP_ROOT,
  caseDataOrNull,
  createReplayFetch,
  fixturePath,
  loadCases,
  loadFixture,
  replayClock,
  type CaseData,
  type EvalCase,
  type EvalFixture,
} from "./fixture";
import { prettyJson } from "./json";
import { renderConsoleTable, renderHumanCheck, renderMarkdown } from "./report";
import {
  callCost,
  caseContext,
  runCost,
  scoreModel,
  type CallRecord,
  type CaseContext,
  type ModelScore,
  type RawItem,
  type RunRecord,
} from "./score";

export const RESULTS_DIR = path.join(APP_ROOT, "evals", "results");

export type ModelSpec = {
  id: string;
  runs: number;
  /**
   * MODEL_TIMEOUT_MS for this lane (a cap on every model call), or null for the app's own sized limits
   * (src/lib/pass/budget.ts; slow-provider fix after run 2026-10-06-8, which ran Gemma with a fixed 30 s).
   */
  timeoutMs: number | null;
  licence: string;
  where: string;
  /**
   * Self-hosted (2026-10-06): served by a local OpenAI-compatible server (Ollama) instead of DigitalOcean.
   * Never in the default model list; costs $0; needs no key. `reasoningEffort` is sent as MODEL_REASONING_EFFORT.
   */
  local?: { defaultBaseUrl: string; reasoningEffort?: string };
};

/** Where the self-hosted lane looks for Ollama (override with EVAL_LOCAL_BASE_URL; plain http only for localhost). */
export const LOCAL_BASE_URL = "http://localhost:11434/v1";

/** SPEC 6.4 runs (K4 = B: open models only + the no-AI template). */
export const MODEL_SPECS: Record<string, ModelSpec> = {
  "gemma-4-31B-it": { id: "gemma-4-31B-it", runs: 3, timeoutMs: null, licence: "Apache-2.0", where: "DigitalOcean serverless (US); park name + public facts only" },
  // The app's documented Llama setting: MODEL_TIMEOUT_MS=60000 (measured 47 s on 2026-10-05).
  "llama-4-maverick": { id: "llama-4-maverick", runs: 1, timeoutMs: 60_000, licence: "Llama 4 Community Licence", where: "DigitalOcean serverless (US); park name + public facts only" },
  // Self-host row (judge G1, 2026-10-06): Gemma 4 E2B (QAT Q4_0, `gemma4:e2b-it-qat`) on this laptop's CPU through Ollama,
  // re-tagged with an 8,192-token context (evals/selfhost/Modelfile; Ollama's default 4,096 is shorter than our longest prompt).
  // Thinking off (Ollama turns Gemma 4 thinking on by default). Timeout = the app's maximum (70 s).
  "gemma4-e2b-8k": {
    id: "gemma4-e2b-8k",
    runs: 1,
    timeoutMs: 70_000,
    licence: "Apache-2.0",
    where: "Your own computer (Ollama, CPU only); nothing leaves the machine",
    local: { defaultBaseUrl: LOCAL_BASE_URL, reasoningEffort: "none" },
  },
};

/** The models a plain `pnpm eval` runs (hosted only; the self-host lane is opt-in by EVAL_MODELS). */
export const DEFAULT_MODELS = Object.values(MODEL_SPECS).filter((m) => !m.local).map((m) => m.id);

/** The app env one model lane runs with (the same variables a person sets in .env.local). */
export function modelEnv(spec: ModelSpec, env: Record<string, string | undefined>): Record<string, string | undefined> {
  if (spec.local) {
    return {
      MODEL_BASE_URL: env.EVAL_LOCAL_BASE_URL?.trim() || spec.local.defaultBaseUrl,
      MODEL_ID: spec.id,
      ...(spec.timeoutMs !== null ? { MODEL_TIMEOUT_MS: String(spec.timeoutMs) } : {}),
      MODEL_REASONING_EFFORT: spec.local.reasoningEffort,
      APP_CONTACT_URL: env.APP_CONTACT_URL,
    };
  }
  return {
    DO_INFERENCE_API_KEY: env.DO_INFERENCE_API_KEY,
    MODEL_ID: spec.id,
    ...(spec.timeoutMs !== null ? { MODEL_TIMEOUT_MS: String(spec.timeoutMs) } : {}),
    APP_CONTACT_URL: env.APP_CONTACT_URL,
  };
}

export type EvalSettings = {
  models: ModelSpec[];
  runsOverride: number | null;
  cases: number[] | null;
  budgetUsd: number;
  /** Audit R3: an age band other than cases.json's (a smoke of the 10-13 band); null = the file's band. */
  ageBand?: AgeBand | null;
  /** EVAL_LOCAL_PATIENT=1: self-hosted lanes get PATIENT_CLOCK instead of the app's own limits (never hosted lanes). */
  localPatient?: boolean;
  /** EVAL_MAX_CALLS: no model call starts once this many were made (a small live check); null = no call cap. */
  maxCalls?: number | null;
};

/**
 * The longer clock for EVAL_LOCAL_PATIENT=1 (self-host row, 2026-10-06): what a CPU-only model writes when the app's
 * 70 s model limit and 85 s pass deadline do not cut it off. Each call still stops at 4.5 min (under the 5 min
 * "the machine is unusable" line). The app itself never uses this clock.
 */
export const PATIENT_CLOCK: PassClock = { passDeadlineMs: 600_000, modelTimeoutMs: 270_000, refillTimeoutMs: 180_000 };

export function settingsFromEnv(env: Record<string, string | undefined>): EvalSettings {
  const list = envList(env.EVAL_MODELS);
  const ids = list === null ? DEFAULT_MODELS : list.includes("none") ? [] : list;
  const unknown = ids.filter((m) => !MODEL_SPECS[m]);
  if (unknown.length > 0) throw new Error(`EVAL_MODELS has models without a price/spec: ${unknown.join(", ")}`);
  const runs = Number(env.EVAL_RUNS);
  const budget = Number(env.EVAL_BUDGET_USD);
  const maxCalls = Number(env.EVAL_MAX_CALLS);
  return {
    models: ids.map((m) => MODEL_SPECS[m]),
    runsOverride: Number.isInteger(runs) && runs > 0 ? runs : null,
    cases: envList(env.EVAL_CASES)?.map(Number).filter((n) => Number.isInteger(n)) ?? null,
    budgetUsd: Number.isFinite(budget) && budget > 0 ? budget : 1,
    ageBand: ageBandFromEnv(env.EVAL_AGE_BAND),
    localPatient: env.EVAL_LOCAL_PATIENT?.trim() === "1",
    maxCalls: Number.isInteger(maxCalls) && maxCalls > 0 ? maxCalls : null,
  };
}

/** EVAL_AGE_BAND, checked (an unknown band is an error, never silently the default). */
export function ageBandFromEnv(v: string | undefined): AgeBand | null {
  const t = v?.trim();
  if (!t) return null;
  const r = AgeBandSchema.safeParse(t);
  if (!r.success) throw new Error(`EVAL_AGE_BAND must be one of ${AGE_BANDS.join(", ")}`);
  return r.data;
}

// ---------- spend guard ----------

export class SpendMeter {
  spentUsd = 0;
  calls = 0;
  constructor(
    readonly budgetUsd: number,
    readonly maxCalls: number | null = null,
  ) {}
  add(model: string, promptTokens: number | null, completionTokens: number | null) {
    this.calls++;
    this.spentUsd += callCost(model, promptTokens ?? 0, completionTokens ?? 0);
  }
  canStart(): boolean {
    return this.spentUsd < this.budgetUsd && (this.maxCalls === null || this.calls < this.maxCalls);
  }
}

// ---------- capturing the real model call ----------

type Choice = { finish_reason?: unknown; message?: { content?: unknown } };

/** Pull what the eval needs from a raw chat-completions body (never the request headers). */
export function parseCompletionBody(text: string): Pick<CallRecord, "promptTokens" | "completionTokens" | "finishReason" | "answeredModel" | "rawItems"> {
  const out: Pick<CallRecord, "promptTokens" | "completionTokens" | "finishReason" | "answeredModel" | "rawItems"> = {
    promptTokens: null,
    completionTokens: null,
    finishReason: null,
    answeredModel: null,
    rawItems: null,
  };
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return out;
  }
  const usage = json.usage as { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined;
  if (typeof usage?.prompt_tokens === "number") out.promptTokens = usage.prompt_tokens;
  if (typeof usage?.completion_tokens === "number") out.completionTokens = usage.completion_tokens;
  if (typeof json.model === "string") out.answeredModel = json.model.slice(0, 100);
  const choice = (Array.isArray(json.choices) ? json.choices[0] : undefined) as Choice | undefined;
  if (typeof choice?.finish_reason === "string") out.finishReason = choice.finish_reason;
  const content = choice?.message?.content;
  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content) as { items?: unknown };
      if (Array.isArray(parsed.items)) {
        out.rawItems = parsed.items.filter((x): x is RawItem => typeof x === "object" && x !== null && !Array.isArray(x)).slice(0, 20);
      }
    } catch {
      /* not JSON: rawItems stays null (counted as bad output by the app) */
    }
  }
  return out;
}

/** The itemId enum the app put in the strict schema (to prove the eval scores against the same pool). */
export function requestPoolIds(body: unknown): string[] | null {
  if (typeof body !== "string") return null;
  try {
    const j = JSON.parse(body) as {
      response_format?: { json_schema?: { schema?: { properties?: { items?: { items?: { properties?: { itemId?: { enum?: unknown } } } } } } } };
    };
    const e = j.response_format?.json_schema?.schema?.properties?.items?.items?.properties?.itemId?.enum;
    return Array.isArray(e) ? e.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

/** The request's max_tokens (null when absent or unreadable). */
export function requestMaxTokens(body: unknown): number | null {
  if (typeof body !== "string") return null;
  try {
    const m = (JSON.parse(body) as { max_tokens?: unknown }).max_tokens;
    return typeof m === "number" && Number.isFinite(m) ? m : null;
  } catch {
    return null;
  }
}

/** A rough prompt size for a request that never answered: about 4 characters per token. */
export const roughPromptTokens = (body: unknown): number | null => (typeof body === "string" ? Math.ceil(body.length / 4) : null);

export function capturingModelFetch(pool: readonly { id: string }[], calls: CallRecord[], meter: SpendMeter, model: string): FetchLike {
  // S8b: the app sends at most n + 4 items per section (promptPool), so the sent ids must be a SUBSET of
  // the scoring pool (same ids, same source texts), not the whole pool.
  const poolIds = new Set(pool.map((p) => p.id));
  /** Q-5-02: calls that never answered, by request body; a later answer to the same request gives their prompt size. */
  const unansweredByBody = new Map<string, CallRecord[]>();
  return async (url, init) => {
    const body = typeof init?.body === "string" ? init.body : null;
    const ids = requestPoolIds(init?.body);
    const poolMatches = ids === null ? null : ids.length > 0 && ids.every((id) => poolIds.has(id));
    const t0 = performance.now();
    try {
      const res = await fetch(url, init);
      const text = await res.text();
      const latencyMs = Math.round(performance.now() - t0);
      const parsed = res.ok ? parseCompletionBody(text) : { promptTokens: null, completionTokens: null, finishReason: null, answeredModel: null, rawItems: null };
      calls.push({ latencyMs, status: res.status, error: res.ok ? null : `HTTP ${res.status}`, poolMatches, ...parsed });
      if (body !== null && parsed.promptTokens !== null) {
        for (const earlier of unansweredByBody.get(body) ?? []) earlier.estPromptTokens = parsed.promptTokens;
        unansweredByBody.delete(body);
      }
      meter.add(model, parsed.promptTokens, parsed.completionTokens);
      return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch (err) {
      const latencyMs = Math.round(performance.now() - t0);
      const rec: CallRecord = {
        latencyMs,
        status: null,
        error: err instanceof Error ? err.name : "error",
        promptTokens: null,
        completionTokens: null,
        finishReason: null,
        answeredModel: null,
        rawItems: null,
        poolMatches,
        // Q-5-02: a call that never answered may still be billed: priced at least at its prompt size (refined
        // when a later answer to the same request reports its real prompt tokens), up to a full max_tokens answer.
        estPromptTokens: roughPromptTokens(body),
        maxTokens: requestMaxTokens(body),
      };
      calls.push(rec);
      if (body !== null) unansweredByBody.set(body, [...(unansweredByBody.get(body) ?? []), rec]);
      meter.add(model, rec.estPromptTokens ?? null, null);
      throw err;
    }
  };
}

// ---------- one model run on one case ----------

/** Longer than the app's own 85 s pass deadline plus every model timeout: only a real hang reaches it. */
export const CASE_GUARD_MS = 150_000;


export function passIdFor(parkId: string, band: AgeBand, day: string, variant: number): string {
  const ref = parseParkId(parkId);
  if (!ref) throw new Error("bad park id");
  return `${ref.type[0]}${ref.id}-${AGE_BAND_INFO[band].slug}-${day.replace(/-/g, "")}-${variant}`;
}

export async function runModelCase(
  c: EvalCase,
  fx: EvalFixture,
  data: CaseData,
  spec: ModelSpec,
  run: number,
  band: AgeBand,
  env: Record<string, string | undefined>,
  meter: SpendMeter,
  clock?: PassClock,
): Promise<RunRecord> {
  const replay = createReplayFetch(fx);
  const now = replayClock(fx);
  const calls: CallRecord[] = [];
  const modelLog: ModelLogLine[] = [];
  const day = localDay(now());
  const t0 = performance.now();
  const deps: BuildDeps = {
    // Trip tips are their own model call and not what the evals measure (clues).
    tripTips: false,
    store: new MemoryStore(),
    env: modelEnv(spec, env),
    now,
    fetchImpl: replay.fetch,
    modelFetch: capturingModelFetch(data.pool, calls, meter, spec.id),
    signal: new AbortController().signal,
    emit: () => undefined,
    pin: () => undefined,
    onUpstream: () => undefined,
    reserveAiCall: async () => (meter.canStart() ? { commit: () => undefined, release: async () => undefined, committed: true } : null),
    startedAt: now(),
    modelLogger: (l) => modelLog.push(l),
    ...(clock ? { clock } : {}),
  };
  const base = { caseN: c.n, slug: c.slug, model: spec.id, run, n: data.mix?.n ?? null, dataRich: data.dataRich, calls };
  const ref = parseParkId(c.parkId);
  if (!ref) throw new Error(`bad park id ${c.parkId}`);
  // Harness guard (S8b): the 2026-10-06 full run hung for 10+ minutes inside one Llama case with no CPU use.
  // A case that outlives every app deadline is recorded as an error instead of stalling the whole eval.
  let guardTimer: ReturnType<typeof setTimeout> | undefined;
  const guardMs = clock ? clock.passDeadlineMs + 60_000 : CASE_GUARD_MS;
  const hung = new Promise<"hung">((resolve) => {
    guardTimer = setTimeout(() => resolve("hung"), guardMs);
  });
  const built = await Promise.race([buildPass({ ref, band, day, variant: run, id: passIdFor(c.parkId, band, day, run) }, deps), hung]);
  clearTimeout(guardTimer);
  const wallMs = Math.round(performance.now() - t0);
  if (built === "hung") {
    return {
      ...base,
      parkName: data.parkName,
      kind: "error",
      errorCode: "EVAL_CASE_HUNG",
      message: `No answer from the pass builder after ${guardMs / 1000} s (model calls finished: ${calls.length}).`,
      sections: {},
      items: [],
      wallMs,
    };
  }
  const outcome = built;
  if (replay.misses.length > 0) {
    return { ...base, parkName: data.parkName, kind: "error", errorCode: "FIXTURE_MISS", message: replay.misses.join("; "), sections: {}, items: [], wallMs };
  }
  if (outcome.kind === "pass") {
    const p = outcome.pass;
    return {
      ...base,
      parkName: p.park.name,
      kind: "pass",
      sections: p.sections,
      items: p.items.map((i) => {
        // r7 follow-ups: the taxon id of a printed Wild Find, so M1 judges it by id (from the pool item with this answer).
        const taxonId = i.section === "wild" ? data.pool.find((x) => x.section === "wild" && x.answer === i.answer)?.taxon?.taxonId : undefined;
        return { section: i.section, clue: i.clue, lookWhere: i.lookWhere, answer: i.answer, difficulty: i.difficulty, ...(taxonId ? { taxonId } : {}) };
      }),
      removed: p.removed,
      wallMs,
    };
  }
  if (outcome.kind === "empty") {
    return { ...base, parkName: outcome.parkName, kind: "empty", message: outcome.message, sections: outcome.sections, items: [], wallMs };
  }
  const skipped = outcome.error.code === "DAILY_LIMIT" && calls.length === 0;
  return {
    ...base,
    parkName: data.parkName,
    kind: skipped ? "skipped" : "error",
    errorCode: skipped ? "EVAL_BUDGET_REACHED" : outcome.error.code,
    message: outcome.error.message,
    sections: {},
    items: [],
    wallMs,
  };
}

/** The no-AI template on one case (same pool, mix and checks; no model). */
export function runTemplateCase(c: EvalCase, data: CaseData): RunRecord {
  const base = { caseN: c.n, slug: c.slug, model: TEMPLATE_MODEL, run: 1, n: data.mix?.n ?? null, dataRich: data.dataRich, calls: [] as CallRecord[], wallMs: 0 };
  const sections: RunRecord["sections"] = {
    ...(data.park ? { park: data.park.state } : {}),
    ...(data.wild ? { wild: data.wild.state } : {}),
  };
  if (!data.parkName) return { ...base, parkName: null, kind: "error", errorCode: "NOT_A_PARK", sections, items: [] };
  if (!data.mix) {
    return { ...base, parkName: data.parkName, kind: "empty", message: "Not enough real data for a pass (template).", sections, items: [] };
  }
  const { draft, result } = templatePass(data.pool, data.mix);
  return {
    ...base,
    parkName: data.parkName,
    kind: "pass",
    sections,
    // The template's own "answer" goes through the same raw checks (M2/M6) as a model answer.
    calls: [
      {
        latencyMs: 0,
        status: null,
        error: null,
        promptTokens: 0,
        completionTokens: 0,
        finishReason: null,
        answeredModel: TEMPLATE_MODEL,
        rawItems: draft.items,
        poolMatches: true,
      },
    ],
    items: result.items.map((v) => ({ section: v.item.section, clue: v.clue, lookWhere: v.lookWhere, answer: v.item.answer, difficulty: v.difficulty, ...(v.item.taxon ? { taxonId: v.item.taxon.taxonId } : {}) })),
  };
}

// ---------- the whole eval ----------

export type EvalCaseInfo = { n: number; slug: string; name: string; parkId: string; note: string; fixture: string | null; fetchedAt: string | null; pool: { park: number; wild: number }; n_items: number | null; dataRich: boolean; problem: string | null };

export type EvalResults = {
  meta: {
    startedAt: string;
    finishedAt: string;
    day: string;
    ageBand: AgeBand;
    partial: boolean;
    settings: { models: string[]; runs: Record<string, number>; cases: number[]; budgetUsd: number };
    modelSpecs: ModelSpec[];
    keyPresent: boolean;
    notes: string[];
  };
  cases: EvalCaseInfo[];
  runs: RunRecord[];
  scores: ModelScore[];
  spend: { usd: number; modelCalls: number; promptTokens: number; completionTokens: number };
};

const say = (s: string) => process.stdout.write(`${s}\n`);

export async function runEval(settings: EvalSettings, env: Record<string, string | undefined>): Promise<EvalResults> {
  const startedAt = new Date();
  const casesFile = loadCases();
  const band = settings.ageBand ?? casesFile.ageBand;
  const chosen = casesFile.cases.filter((c) => !settings.cases || settings.cases.includes(c.n));
  const notes: string[] = [
    "Kevin chose K4 = B: open models only plus a no-AI template baseline. No closed model was run.",
    `Park data: recorded live fixtures (tests/fixtures/evals), replayed into the app's own source code. Model calls: live, ${settings.models.length > 0 && settings.models.every((m) => m.local) ? "a self-hosted Ollama server (no DigitalOcean call)" : "DigitalOcean serverless inference"}.`,
    "Find This Spot (the X-marks-the-spot map and riddle) is not in this eval: its map geometry was not recorded for these parks, so every pass here is made without a SPOT, like the first run. On the live site a park with a landmark also gets a riddle in the same model call (a few dozen more answer tokens).",
  ];

  // Silence the app's per-request JSON logs during the eval (they hold no secrets; the eval keeps its own records).
  const restore = setLogSink(() => undefined);
  try {
    const loaded: { c: EvalCase; fx: EvalFixture | null; data: CaseData | null; problem: string | null }[] = [];
    for (const c of chosen) {
      if (!existsSync(fixturePath(c.slug))) {
        loaded.push({ c, fx: null, data: null, problem: "No data available: no recorded fixture for this park (see tests/fixtures/evals/RECORDING-LOG.md)." });
        continue;
      }
      const fx = loadFixture(c.slug);
      const r = await caseDataOrNull(fx, band);
      loaded.push({ c, fx, data: r.data, problem: r.problem });
    }
    const cases: EvalCaseInfo[] = loaded.map(({ c, fx, data, problem }) => ({
      n: c.n,
      slug: c.slug,
      name: c.name,
      parkId: c.parkId,
      note: c.note,
      fixture: fx ? path.relative(APP_ROOT, fixturePath(c.slug)).replace(/\\/g, "/") : null,
      fetchedAt: fx?._recording.fetchedAt ?? null,
      pool: { park: data?.park?.items.length ?? 0, wild: data?.wild?.items.length ?? 0 },
      n_items: data?.mix?.n ?? null,
      dataRich: data?.dataRich ?? false,
      problem,
    }));
    const contexts = new Map<number, CaseContext>();
    for (const l of loaded) if (l.data) contexts.set(l.c.n, caseContext(l.c.n, l.data));
    const usable = loaded.filter((l): l is { c: EvalCase; fx: EvalFixture; data: CaseData; problem: null } => l.fx !== null && l.data !== null);

    const runs: RunRecord[] = usable.map((l) => runTemplateCase(l.c, l.data));
    say(`template baseline: ${runs.filter((r) => r.kind === "pass").length} passes from ${usable.length} cases`);

    const keyPresent = resolveModelTarget({ DO_INFERENCE_API_KEY: env.DO_INFERENCE_API_KEY }).ok;
    const meter = new SpendMeter(settings.budgetUsd, settings.maxCalls ?? null);
    const runsPer: Record<string, number> = {};
    // A hosted lane needs the DO key; a self-hosted lane needs only a valid local MODEL_BASE_URL.
    const ready = settings.models.filter((spec) => (spec.local ? resolveModelTarget(modelEnv(spec, env)).ok : keyPresent));
    for (const spec of settings.models) {
      if (ready.includes(spec)) continue;
      notes.push(
        spec.local
          ? `No data available for ${spec.id}: EVAL_LOCAL_BASE_URL is not a usable local server address, so it was not run.`
          : `No data available for ${spec.id}: DO_INFERENCE_API_KEY is not set, so it was not run.`,
      );
    }
    for (const spec of ready.filter((s) => s.local)) {
      notes.push(
        `Self-hosted lane ${spec.id}: served by Ollama at ${modelEnv(spec, env).MODEL_BASE_URL} on the machine that ran the eval (CPU only), thinking off (MODEL_REASONING_EFFORT=${spec.local?.reasoningEffort ?? "unset"}). Cost $0 (no paid call); electricity not counted.`,
        settings.localPatient
          ? `PATIENT CLOCK (EVAL_LOCAL_PATIENT=1, eval only): model calls up to ${PATIENT_CLOCK.modelTimeoutMs / 1000} s, refills up to ${PATIENT_CLOCK.refillTimeoutMs / 1000} s, whole pass up to ${PATIENT_CLOCK.passDeadlineMs / 1000} s. The app itself stops a model call at 70 s and a pass at 85 s, so these passes show what the model writes when not cut off, not what the app would print.`
          : `App clock: the app's own limits (each model call sized to what it asks${spec.timeoutMs !== null ? `, at most ${spec.timeoutMs / 1000} s` : ""}; whole pass 85 s), exactly what a person running the app with these settings gets.`,
      );
    }
    if (ready.length > 0) {
      // One lane per model (models run side by side; inside a lane, one call at a time so latency is clean).
      await Promise.all(
        ready.map(async (spec) => {
          const n = settings.runsOverride ?? spec.runs;
          runsPer[spec.id] = n;
          for (let run = 1; run <= n; run++) {
            for (const l of usable) {
              const r = await runModelCase(l.c, l.fx, l.data, spec, run, band, env, meter, spec.local && settings.localPatient ? PATIENT_CLOCK : undefined);
              runs.push(r);
              const lat = r.calls.map((x) => `${(x.latencyMs / 1000).toFixed(1)} s`).join(" + ");
              say(`${spec.id} run ${run} case ${l.c.n} ${l.c.name}: ${r.kind}${r.errorCode ? ` ${r.errorCode}` : ""} ${r.items.length}/${r.n ?? "-"} items${lat ? `, ${lat}` : ""}, spend so far $${meter.spentUsd.toFixed(4)}`);
            }
          }
        }),
      );
    }

    const models = [...settings.models.map((m) => m.id), TEMPLATE_MODEL];
    const scores = models.map((m) => scoreModel(m, runs, contexts, m !== TEMPLATE_MODEL));
    const modelRuns = runs.filter((r) => r.model !== TEMPLATE_MODEL);
    const allCalls = modelRuns.flatMap((r) => r.calls);
    const partial =
      settings.cases !== null || settings.runsOverride !== null || band !== casesFile.ageBand || !DEFAULT_MODELS.every((id) => settings.models.some((m) => m.id === id)) || settings.models.some((m) => m.local) || ready.length < settings.models.length;
    return {
      meta: {
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        day: localDay(startedAt.getTime()),
        ageBand: band,
        partial,
        settings: { models: settings.models.map((m) => m.id), runs: runsPer, cases: chosen.map((c) => c.n), budgetUsd: settings.budgetUsd },
        modelSpecs: settings.models,
        keyPresent,
        notes,
      },
      cases,
      runs: runs.sort((a, b) => a.model.localeCompare(b.model) || a.run - b.run || a.caseN - b.caseN),
      scores,
      spend: {
        usd: modelRuns.reduce((a, r) => a + runCost(r), 0),
        modelCalls: allCalls.length,
        promptTokens: allCalls.reduce((a, c) => a + (c.promptTokens ?? 0), 0),
        completionTokens: allCalls.reduce((a, c) => a + (c.completionTokens ?? 0), 0),
      },
    };
  } finally {
    restore();
  }
}

/** evals/results/<day>.md/.json (partial runs: <day>-partial-<HHMM>); never overwrites an earlier full run. */
export function resultPaths(results: EvalResults, dir = RESULTS_DIR): { md: string; json: string } {
  const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(results.meta.startedAt))
    .replace(":", "");
  // Self-hosted-only runs get their own name so they are never mistaken for a hosted partial run.
  const selfhost = results.meta.modelSpecs.length > 0 && results.meta.modelSpecs.every((m) => m.local);
  const patient = results.meta.notes.some((n) => n.startsWith("PATIENT CLOCK"));
  const first = selfhost ? `${results.meta.day}-selfhost-${patient ? "patient-" : ""}${hhmm}` : results.meta.partial ? `${results.meta.day}-partial-${hhmm}` : results.meta.day;
  let stem = first;
  let i = 2;
  while (existsSync(path.join(dir, `${stem}.json`))) stem = `${first}-${i++}`;
  return { md: path.join(dir, `${stem}.md`), json: path.join(dir, `${stem}.json`) };
}

/** Write evals/results/human-check.md (the M9 kid-check sheet) for `results`; returns its path, or null when there is nothing to check. */
export function writeHumanCheck(results: EvalResults, mdName: string, dir = RESULTS_DIR): string | null {
  const form = renderHumanCheck(results, mdName);
  if (!form) return null;
  const human = path.join(dir, "human-check.md");
  writeFileSync(human, form);
  return human;
}

export function writeResults(results: EvalResults, dir = RESULTS_DIR): { md: string; json: string } {
  mkdirSync(dir, { recursive: true });
  const p = resultPaths(results, dir);
  writeFileSync(p.json, prettyJson(results, 4));
  writeFileSync(p.md, renderMarkdown(results, path.basename(p.json)));
  // The kid-check sheet always follows the latest full run (it used to be written only when missing, so it went
  // stale). `pnpm eval:human-check` rebuilds it from any saved results JSON.
  if (!results.meta.partial) writeHumanCheck(results, path.basename(p.md), dir);
  const ledger = path.join(dir, "SPEND.md");
  if (!existsSync(ledger)) {
    writeFileSync(
      ledger,
      "# Eval spend ledger (DigitalOcean serverless inference)\n\nTokens are counted from each answer's `usage`; USD = tokens x the DO price list in evals/score.ts (prompt tokens at the full input price).\n\n| Started (UTC) | Results | Model calls | Prompt tokens | Completion tokens | USD |\n|---|---|---|---|---|---|\n",
    );
  }
  const s = results.spend;
  appendFileSync(ledger, `| ${results.meta.startedAt} | ${path.basename(p.md)} | ${s.modelCalls} | ${s.promptTokens} | ${s.completionTokens} | $${s.usd.toFixed(4)} |\n`);
  return p;
}

export async function main(): Promise<EvalResults> {
  const env = evalEnv();
  const settings = settingsFromEnv(env);
  const results = await runEval(settings, env);
  const p = writeResults(results);
  say("");
  say(renderConsoleTable(results));
  say(`\nWrote ${path.relative(APP_ROOT, p.md)} and ${path.relative(APP_ROOT, p.json)}. Spend this run: $${results.spend.usd.toFixed(4)} (${results.spend.modelCalls} model calls).`);
  return results;
}

/**
 * `pnpm eval:check` (free, no model): every case through the real buildPass twice, in two lanes at
 * once like `pnpm eval`, with the model switched off. Proves the fixtures answer every request the
 * app makes (also when its caches are warm from other parks) before any paid run.
 */
export async function checkReplay(): Promise<{ lane: number; caseN: number; band: AgeBand; kind: RunRecord["kind"]; errorCode?: string; message?: string }[]> {
  const casesFile = loadCases();
  // No key: the app refuses to call the model (MODEL_NOT_CONFIGURED), so nothing is ever spent.
  const meter = new SpendMeter(1);
  const noKey = {};
  const spec = MODEL_SPECS["gemma-4-31B-it"];
  const out: { lane: number; caseN: number; band: AgeBand; kind: RunRecord["kind"]; errorCode?: string; message?: string }[] = [];
  const restore = setLogSink(() => undefined);
  // Teens & adults (2026-10-07): every case is also replayed for the 13+ band (its own mix: 8 finds, 3 hard).
  const bands: AgeBand[] = [...new Set<AgeBand>([casesFile.ageBand, "13+"])];
  try {
    const loaded: { c: EvalCase; fx: EvalFixture; data: CaseData; band: AgeBand }[] = [];
    for (const band of bands) {
      for (const c of casesFile.cases) {
        const fx = loadFixture(c.slug);
        const r = await caseDataOrNull(fx, band);
        if (!r.data) throw new Error(`case ${c.n} (${band}): ${r.problem}`);
        loaded.push({ c, fx, data: r.data, band });
      }
    }
    await Promise.all(
      [1, 2].map(async (lane) => {
        for (const l of loaded) {
          const r = await runModelCase(l.c, l.fx, l.data, spec, lane, l.band, noKey, meter);
          out.push({ lane, caseN: l.c.n, band: l.band, kind: r.kind, errorCode: r.errorCode, message: r.errorCode === "FIXTURE_MISS" ? r.message : undefined });
        }
      }),
    );
  } finally {
    restore();
  }
  return out;
}

/**
 * Recompute the scores of a saved results file from its raw run records with the current scorer
 * (no network, no model). Contexts come from the same recorded fixtures.
 */
export async function rescore(results: EvalResults): Promise<EvalResults> {
  const casesFile = loadCases();
  const contexts = new Map<number, CaseContext>();
  for (const c of casesFile.cases) {
    if (!results.meta.settings.cases.includes(c.n) || !existsSync(fixturePath(c.slug))) continue;
    const r = await caseDataOrNull(loadFixture(c.slug), results.meta.ageBand);
    if (r.data) contexts.set(c.n, caseContext(c.n, r.data));
  }
  const models = [...results.meta.settings.models, TEMPLATE_MODEL];
  return { ...results, scores: models.map((m) => scoreModel(m, results.runs, contexts, m !== TEMPLATE_MODEL)) };
}
