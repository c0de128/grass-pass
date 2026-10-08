/**
 * Build one pass (SPEC F3-F5, F7, F11): park map -> wildlife -> pools (danger-filtered by code) ->
 * mix limits (code) -> ONE model call that picks ids and writes clues -> server checks -> at most
 * one retry when too few clues survive -> the pass, with every number and date written by code.
 *
 * Limits, the pass cache and in-flight dedup live in src/lib/pass/make.ts; this file gets callbacks
 * for charging (`onUpstream`, `reserveAiCall`) and pinning (`pin`) so the paid call is never
 * aborted once started (pattern: charge-started-paid-calls).
 */
import { safetyForBand } from "@/lib/pass/audience";
import "server-only";
import "@/lib/zod-config";
import { createJsonCache, WaiterAbortedError, type Store } from "@/lib/cache";
import type { QuotaTicket } from "@/lib/limits";
import { log } from "@/lib/log";
import { callModel, configuredModelId, MAX_TOKENS, ModelError, modelTimeoutCapMs, type ModelLogger } from "@/lib/model";
import {
  firstCallTimeoutMs,
  maxTokensFor,
  PASS_DEADLINE_MS,
  refillTimeoutMs,
  RETRY_TOKENS_PER_S_GEMMA,
  retryTokensPerS,
  slowTokensPerS,
  wholeRetryMinLeftMs,
  wholeRetrySize,
  wholeRetryTimeoutMs,
} from "@/lib/pass/budget";
import {
  PASS_COPY,
  type AgeBand,
  type ParkData,
  type Pass,
  type PassItem,
  type PassStep,
} from "@/lib/pass/schema";
import { parkPool } from "@/lib/pool/park";
import { LUCKY_COPY, loadLucky, type LuckyResult } from "@/lib/pool/lucky";
import type { PoolItem, Section, SectionState } from "@/lib/pool/types";
import { monthOfDay } from "@/lib/pool/season";
import { plantCandidateIds, WILD_DOWN_COPY, wildCandidates, wildPool, type WildSeasonInput } from "@/lib/pool/wild";
import { loadPhenology } from "@/lib/sources/inat-phenology";
import { localDay } from "@/lib/time";
import { SourceError, type FetchLike } from "@/lib/sources/common";
import {
  speciesCounts,
  SpeciesListSchema,
  taxaSummaries,
  TaxonSummarySchema,
  windowStart,
  type SpeciesList,
  type TaxonSummary,
} from "@/lib/sources/inat";
import type { ParkFeatures, ParkRef } from "@/lib/sources/overpass-features";
import { createDeadline, eitherSignal } from "@/lib/pass/deadline";
import { DATA_TOO_SLOW_COPY, loadFeatures, type FeaturesPlan } from "@/lib/pass/park-data";
import { explainShortSections, shortPassMessage } from "@/lib/pass/short-copy";
import {
  finishSpot,
  loadGeometry,
  planLateSpot,
  planSpot,
  settleWithin,
  SPOT_EARLY_WAIT_MS,
  SPOT_LATE_GRACE_MS,
  spotWaitMs,
  type GeometryResult,
  type SpotPlan,
} from "@/lib/spot/load";
import { SPOT_COPY } from "@/lib/spot/types";
import type { SpotTarget } from "@/lib/spot/pick-target";
import { buildMessages, mixFor, openingWord, planRequest, refillPlan, shortRetryPlan, type Mix, type RefillNotes, type RequestPlan } from "./prompt";
import { fixPlantWho } from "./jargon";
import { passJsonSchema, PassDraftEnvelope } from "./schema";
import { capDifficulty, mergeResults, parentNoteFor, retryThreshold, rewriteStockFrame, soundNotFirst, validateDraft, validateSpot, type DropReason, type SpotReason, type ValidateOptions, type ValidationResult } from "./validate";

type Env = Record<string, string | undefined>;

const HOUR = 3600;
const DAY = 24 * HOUR;
/** ADR 0002: species list 6 h, taxon summaries 7 days (park features: src/lib/pass/park-data.ts). */
export { FEATURES_TTL_SEC } from "@/lib/pass/park-data";
export const SPECIES_TTL_SEC = 6 * HOUR;
export const TAXA_TTL_SEC = 7 * DAY;

/** Whole pass must finish inside the route's maxDuration (90 s) with room to answer (src/lib/pass/budget.ts). */
export { PASS_DEADLINE_MS };
/** Don't start a model call with less than this left (a normal answer is 7-10 s). */
export const MODEL_MIN_LEFT_MS = 15_000;
/** Don't start a retry or a refill with less than this left. */
export const RETRY_MIN_LEFT_MS = 20_000;
/**
 * Completeness (run 2026-10-06-5): at most this many model calls per pass. The first call; then either
 * one whole-request retry after a failed first call (timeout, provider error, bad output) or a refill;
 * and one more refill when the pass is still short. Only a short or failed answer ever makes another
 * call, so a typical pass stays at one call (M8).
 */
export const MAX_MODEL_CALLS = 3;
/**
 * Slow provider (run 2026-10-06-8): a whole-request retry (after a failed first call) is sized to the time left
 * (src/lib/pass/budget.ts): it starts only when an answer of MIN_PASS_ITEMS clues fits at the budgeted retry speed
 * (Gemma: 16.3 s left). It used to need a fixed 25 s and always asked for the same whole pass again.
 */
export const WHOLE_RETRY_MIN_LEFT_MS = wholeRetryMinLeftMs(RETRY_TOKENS_PER_S_GEMMA);

/** Failed first calls worth one whole-request retry inside the pass deadline (never quota, rate limit or a missing key). */
const RETRYABLE_FIRST: ReadonlySet<string> = new Set(["MODEL_TIMEOUT", "MODEL_PROVIDER", "MODEL_BAD_OUTPUT", "MODEL_NETWORK"]);
/** Failed refills after which another refill may still be tried (an answer that never came). */
const RETRYABLE_REFILL: ReadonlySet<string> = new Set(["MODEL_TIMEOUT", "MODEL_PROVIDER", "MODEL_BAD_OUTPUT", "MODEL_NETWORK"]);
/**
 * Q-5-04: a provider error is only worth another call when it can pass: 5xx, 408, and 403 (run -5 had a transient
 * 403). A 400 (request rejected), 401 (bad key) or 404 (wrong MODEL_ID) would fail the same way and use up a second
 * AI-cap unit, so it stops.
 */
export function retryableModelError(err: { code: string; upstreamStatus?: number }, refill: boolean): boolean {
  if (!(refill ? RETRYABLE_REFILL : RETRYABLE_FIRST).has(err.code)) return false;
  if (err.code !== "MODEL_PROVIDER" || err.upstreamStatus === undefined) return true;
  return err.upstreamStatus >= 500 || err.upstreamStatus === 408 || err.upstreamStatus === 403;
}

/** Why another model call is starting (Q-5-03: the progress line must say the true reason). */
export type RetryReason = "timeout" | "timeout_short" | "failed" | "failed_short" | "none_kept" | "refill" | "last_refill";

/** The progress line for a second or third model call. */
export function retryText(reason: RetryReason): string {
  switch (reason) {
    case "timeout":
      return "The AI didn't answer in time. Asking it again…";
    case "timeout_short":
      return "The AI didn't answer in time. Asking it again for fewer finds, so it can answer in the time left…";
    case "failed":
      return "The AI's answer didn't come through. Asking it again…";
    case "failed_short":
      return "The AI's answer didn't come through. Asking it again for fewer finds, so it can answer in the time left…";
    case "none_kept":
      return "None of the clues passed the checks. Asking the model again…";
    case "refill":
      return "A few clues didn't pass the checks. Asking the model for a few more…";
    case "last_refill":
      return "Still a few finds short. Asking for the last few…";
  }
}

const speciesCache = createJsonCache({ name: "inat-species", schema: SpeciesListSchema, ttlSec: SPECIES_TTL_SEC, maxEntries: 2_000 });
const taxaCache = createJsonCache({ name: "inat-taxon", schema: TaxonSummarySchema, ttlSec: TAXA_TTL_SEC, maxEntries: 20_000 });

export type BuildInput = { ref: ParkRef; band: AgeBand; day: string; variant: number; id: string };

export type BuildDeps = {
  store: Store;
  env: Env;
  now: () => number;
  /** Free data APIs (Overpass, iNaturalist). */
  fetchImpl?: FetchLike;
  /** The model call. */
  modelFetch?: FetchLike;
  /**
   * In-flight signal: aborts the FREE data steps when every client has left (never the model call).
   * Round 9 (Q-9-01): when it fires BEFORE the paid steps (Lucky Finds searches, the model call), the build stops
   * with WaiterAbortedError: nothing paid is started and no pass is saved (a pass already pinned finishes).
   */
  signal: AbortSignal;
  emit: (step: PassStep, text: string) => void;
  /** Called right before the paid model call: it must then finish and be cached even if clients leave. */
  pin: () => void;
  /** Called right before the first upstream request (charges the per-IP daily share). */
  onUpstream: () => void;
  /** Reserve one model call against AI_DAILY_CAP; null when the cap is reached. */
  reserveAiCall: () => Promise<QuotaTicket | null>;
  /** The server's example warm-up: its SerpApi searches stay inside the warm-up share (src/lib/limits/serpapi.ts). */
  warmup?: boolean;
  /** When the request started (deadline). */
  startedAt: number;
  modelLogger?: ModelLogger;
  /** Called once the pools are ready and a model call will follow (S7 starts the October box here, in parallel). */
  onPoolsReady?: (park: { id: string; lat: number; lng: number }) => void;
  /** SEC-3-02: what makePass already read about the park's features (saves reading the same keys again). */
  featuresPlan?: FeaturesPlan;
  /**
   * Accounts: pool ids visitors reported as not findable or not safe in this park (src/lib/reports
   * `excludedRefs`); they are left out of the pool, so the model never sees them.
   */
  exclude?: ReadonlySet<string>;
  /** Eval replay tooling only (evals/replay.ts): every item the checks drop, with its reason. */
  validateTrace?: ValidateOptions["trace"];
  /**
   * Eval self-host lane only (evals/run.ts with EVAL_LOCAL_PATIENT=1, 2026-10-06): a longer clock, to measure what a
   * CPU-only model writes when it is not cut off. No route sets it, so the app always uses PASS_DEADLINE_MS and the
   * sized call limits of src/lib/pass/budget.ts (capped by MODEL_TIMEOUT_MS when it is set, at most 70 s).
   */
  clock?: PassClock;
  /** Eval replay only (evals/replay.ts): the model call's timeout signal on a virtual clock. */
  modelDeadline?: (ms: number) => AbortSignal;
};

/** Eval-only time limits (see BuildDeps.clock). */
export type PassClock = { passDeadlineMs: number; modelTimeoutMs: number; refillTimeoutMs: number };

/** A pool without the items visitors' reports rule out (src/lib/reports). */
export function withoutReported<T extends { items: PoolItem[] }>(pool: T, exclude: ReadonlySet<string> | undefined): T {
  if (!exclude || exclude.size === 0) return pool;
  const items = pool.items.filter((i) => !exclude.has(i.id));
  return items.length === pool.items.length ? pool : { ...pool, items };
}

export type ApiError = { code: string; message: string; retryAfter?: number };

export type BuildOutcome =
  | { kind: "pass"; pass: Pass }
  | { kind: "empty"; parkName: string; message: string; sections: Pass["sections"] }
  | { kind: "error"; status: number; error: ApiError; parkData?: ParkData };

/** A short human name for a model id, for copy like "Gemma took too long" (never a fixed label). */
export function modelDisplayName(id: string): string {
  const l = id.toLowerCase();
  if (l.startsWith("gemma")) return "Gemma";
  if (l.includes("llama")) return "Llama";
  if (l.startsWith("qwen")) return "Qwen";
  return id;
}

export function stepText(step: PassStep, env: Env): string {
  switch (step) {
    case "map":
      return "Reading the park map (OpenStreetMap)…";
    case "wildlife":
      return "Checking what people spotted nearby in the last 14 days (iNaturalist)…";
    case "clues":
      return `Writing clues with ${configuredModelId(env)} (open model)…`;
    case "check":
      return "Fact-checking every clue against its source…";
    case "retry":
      return retryText("refill");
  }
}

/** The end of the "no model key" message: what helps (not "try again"). */
export const MODEL_NOT_CONFIGURED_TAIL = "Your park data is below. The person running this server needs to add a model key (see the README).";

/** SPEC §6.3 copy for a failed model call. */
export function modelFailure(err: ModelError, modelId: string): { status: number; error: ApiError } {
  const name = modelDisplayName(modelId);
  const tail = "Your park data is below; try again in a minute.";
  switch (err.code) {
    case "MODEL_TIMEOUT":
      return { status: 504, error: { code: err.code, message: `${name} took too long. Try again. Your park data is below.` } };
    case "MODEL_QUOTA":
      return { status: 503, error: { code: err.code, message: PASS_COPY.paused, retryAfter: 3600 } };
    case "MODEL_NOT_CONFIGURED":
      // R2-m6 (Q-2-05): trying again never helps here, so don't say "try again in a minute".
      return { status: 503, error: { code: err.code, message: `${name} couldn't write clues (${err.reason}). ${MODEL_NOT_CONFIGURED_TAIL}` } };
    case "MODEL_RATE_LIMITED":
      return {
        status: 503,
        error: { code: err.code, message: `${name} couldn't write clues right now (${err.reason}). ${tail}`, retryAfter: err.retryAfter ?? 60 },
      };
    default:
      return { status: err.status === 499 ? 502 : err.status, error: { code: err.code, message: `${name} couldn't write clues right now (${err.reason}). ${tail}` } };
  }
}

function parkDataOf(parkName: string, pool: readonly PoolItem[]): ParkData {
  return { parkName, items: pool.slice(0, 40).map((p) => ({ section: p.section, answer: p.answer, evidence: p.evidence })) };
}

// ---------- data ----------

/** Wild Finds copy when iNaturalist was stopped by the pass deadline (R1-M1). */
export const WILD_SLOW_COPY = "No data available: iNaturalist was too slow when this pass was made. Trying again in a minute may help.";

type WildResult = {
  items: PoolItem[];
  state: SectionState;
  blocked: number;
  checkedAt: number | null;
  since: string | null;
  /** R1 follow-up: a plant on offer has no season evidence because the phenology lookup failed (degraded pass). */
  seasonUnknown?: boolean;
};

/** True when some plant in the pool could not be season-checked (the iNaturalist phenology lookup failed). */
const seasonUnknownIn = (items: readonly PoolItem[]) => items.some((i) => i.season !== undefined && !i.season.known);

async function loadWild(f: ParkFeatures, deps: BuildDeps): Promise<WildResult> {
  const since = windowStart(deps.now());
  const key = `${f.park.id}|${since}`;
  const center = { lat: f.park.lat, lng: f.park.lng };
  const srcDeps = { store: deps.store, fetchImpl: deps.fetchImpl, signal: deps.signal, env: deps.env, onStart: deps.onUpstream, now: deps.now };
  const down = (err: unknown): WildResult => {
    if (err instanceof SourceError) {
      log("pass_source_failed", { source: err.source, code: err.code, started: err.started, upstreamStatus: err.status }, "warn");
      // R1-M1: stopped by the pass deadline -> say "too slow", not "didn't answer".
      const message = err.code === "aborted" ? WILD_SLOW_COPY : WILD_DOWN_COPY;
      return { items: [], state: { status: "unavailable", message }, blocked: 0, checkedAt: null, since: null };
    }
    throw err;
  };

  let list: SpeciesList;
  let checkedAt: number;
  const hit = await speciesCache.get(key, deps.now());
  if (hit) {
    list = hit.value;
    checkedAt = hit.storedAt;
  } else {
    try {
      list = await speciesCounts(center, since, srcDeps);
    } catch (err) {
      return down(err);
    }
    checkedAt = deps.now();
    await speciesCache.set(key, list, { now: checkedAt });
  }

  // Summaries only for the candidates that survive the first danger check. Never an empty id list.
  const { candidates } = wildCandidates(list);
  const summaries: TaxonSummary[] = [];
  const missing: number[] = [];
  for (const c of candidates) {
    const s = await taxaCache.get(String(c.taxonId), deps.now());
    if (s) summaries.push(s.value);
    else missing.push(c.taxonId);
  }
  if (missing.length > 0) {
    try {
      const got = await taxaSummaries(missing, srcDeps);
      const at = deps.now();
      const byId = new Map(got.map((t) => [t.id, t]));
      for (const id of missing) {
        const t = byId.get(id) ?? { id, summary: null, ancestorIds: [] };
        summaries.push(t);
        await taxaCache.set(String(id), t, { now: at });
      }
    } catch (err) {
      const partial = wildPool(list, summaries, since, { month: monthOfDay(localDay(deps.now())), phenology: null });
      if (partial.state.status === "ok") return { ...partial, checkedAt, since, seasonUnknown: seasonUnknownIn(partial.items) };
      return down(err);
    }
  }
  // R1-M4: season evidence for the plants (never throws; null = flowers/fruit unsupported).
  const month = monthOfDay(localDay(deps.now()));
  const season: WildSeasonInput = { month, phenology: await loadPhenology(f.park.id, center, month, plantCandidateIds(list), srcDeps) };
  const pool = wildPool(list, summaries, since, season);
  return { ...pool, checkedAt, since, seasonUnknown: seasonUnknownIn(pool.items) };
}

// ---------- the pass ----------


/**
 * S5: when the X is the park's only <kind> (its only shelter, say), the pass doesn't also ask for it
 * as a Park Find, unless dropping it would make the pass shorter.
 */
export function poolForSpot(pool: PoolItem[], target: Pick<SpotTarget, "poolKind"> | null, band: AgeBand): PoolItem[] {
  if (!target?.poolKind) return pool;
  const id = `osm-${target.poolKind.replace(/_/g, "-")}`;
  const without = pool.filter((p) => p.id !== id);
  if (without.length === pool.length) return pool;
  return mixFor(without, band)?.n === mixFor(pool, band)?.n ? without : pool;
}

const SECTION_ORDER: Record<Section, number> = { park: 0, wild: 1, lucky: 2 };

/** The better of two answers, topped up with the other's valid items (S8b: a leaky item gets its second chance in the retry). */
function better(a: ValidationResult | null, b: ValidationResult | null, mix: Mix): ValidationResult | null {
  if (!a) return b;
  if (!b) return a;
  return b.items.length > a.items.length ? mergeResults(b, a, mix) : mergeResults(a, b, mix);
}

// S8b / R2-M5: promptPool, PROMPT_SPARES and the request plan live in prompt.ts (the eval scorer replays them).
export { mixFor, PROMPT_SPARES, promptPool } from "./prompt";

/**
 * Content tuning: the first answer plus the refill's valid items (the refill only had unused ids), with
 * the removals of both calls counted (the pass footer reports every clue the checks removed).
 */
export function withRefill(first: ValidationResult, refill: ValidationResult, mix: Mix): ValidationResult {
  const merged = mergeResults(first, refill, mix);
  const drops: ValidationResult["drops"] = { ...first.drops };
  for (const [k, n] of Object.entries(refill.drops) as [DropReason, number][]) drops[k] = (drops[k] ?? 0) + n;
  return { ...merged, drops, returned: first.returned + refill.returned, openersTrimmed: (first.openersTrimmed ?? 0) + (refill.openersTrimmed ?? 0),
    questionsFixed: (first.questionsFixed ?? 0) + (refill.questionsFixed ?? 0),
  };
}

/**
 * max_tokens for the pass call: measured completions were 348-696 tokens (Gemma 4 31B and Llama 4
 * Maverick, 82 calls, S9). gpt-oss also spends tokens on reasoning, so it keeps the ADR 0001 budget.
 */
export function passMaxTokens(modelId: string): number {
  return modelId.toLowerCase().startsWith("gpt-oss") ? MAX_TOKENS : PASS_MAX_TOKENS;
}
export const PASS_MAX_TOKENS = 1_200;

/**
 * Slow provider: max_tokens for one call, sized to what it asks (budget.ts `maxTokensFor`: 1.5x the budgeted answer,
 * 400-1,200). gpt-oss keeps its full budget (its reasoning tokens count too).
 */
export function callMaxTokens(modelId: string, items: number, spot: boolean): number {
  const ceiling = passMaxTokens(modelId);
  return ceiling === PASS_MAX_TOKENS ? maxTokensFor(items, spot, ceiling) : ceiling;
}

export async function buildPass(input: BuildInput, deps: BuildDeps): Promise<BuildOutcome> {
  const left = () => deps.startedAt + (deps.clock?.passDeadlineMs ?? PASS_DEADLINE_MS) - deps.now();

  // R1-M1: ONE deadline for every data stage (Overpass features + geometry, iNaturalist), so the
  // model always keeps MODEL_MIN_LEFT_MS and the whole pass answers inside PASS_DEADLINE_MS.
  const dataDeadline = createDeadline(left() - MODEL_MIN_LEFT_MS);
  try {
    return await buildWithDeadline(input, { ...deps, signal: eitherSignal(dataDeadline.signal, deps.signal) }, deps, left);
  } finally {
    dataDeadline.clear();
  }
}

/** buildPass after the deadline is set: `data` carries the deadline signal for the free data steps. */
async function buildWithDeadline(input: BuildInput, data: BuildDeps, deps: BuildDeps, left: () => number): Promise<BuildOutcome> {
  const { band } = input;
  // Round 9 (Q-9-01): every client left before the paid steps. Stop here: no SerpApi search, no model call, no saved
  // pass (the aborted data steps would otherwise read as "too slow" on a pass nobody waited for). Only the client
  // signal counts (deps.signal); the data deadline (data.signal) is a real "too slow".
  const stopIfClientGone = () => {
    if (deps.signal.aborted) {
      log("pass_stopped_client_gone", { park: input.ref.type + "/" + input.ref.id, id: input.id });
      throw new WaiterAbortedError();
    }
  };
  deps.emit("map", stepText("map", deps.env));
  const fr = await loadFeatures(
    input.ref,
    { store: data.store, env: data.env, now: data.now, fetchImpl: data.fetchImpl, signal: data.signal, onUpstream: data.onUpstream },
    data.featuresPlan,
  );
  stopIfClientGone();
  if (!fr.ok) return fr.outcome;
  const f = fr.value;
  // SEC-1-01 / Q-1-06: the optional Find This Spot geometry starts only once features confirmed a
  // named park; it runs at low priority alongside the wildlife step (never throws).
  const geometry: Promise<GeometryResult> = loadGeometry(input.ref, {
    store: data.store,
    env: data.env,
    now: data.now,
    fetchImpl: data.fetchImpl,
    signal: data.signal,
    onUpstream: data.onUpstream,
  });

  // S6 Lucky Finds (SerpApi), alongside the wildlife step. Its own deadline, NOT the client-gone signal:
  // a search that was sent is paid for, so it finishes and its counts are cached (never throws).
  const luckyDeadline = createDeadline(left() - MODEL_MIN_LEFT_MS);
  const luckyLoad: Promise<LuckyResult> = loadLucky(f.park, f, {
    store: data.store,
    env: data.env,
    now: data.now,
    fetchImpl: data.fetchImpl,
    signal: luckyDeadline.signal,
    // Q-9-01: no NEW search is sent once every client has left (a sent one still finishes and is cached).
    stopBefore: deps.signal,
    onUpstream: data.onUpstream,
    warmup: data.warmup,
  })
    .catch((err: unknown): LuckyResult => {
      log("lucky_failed", { park: f.park.id, kind: err instanceof Error ? err.name : "unknown" }, "error");
      return { items: [], state: { status: "unavailable", message: LUCKY_COPY.down }, checkedAt: null, searches: 0 };
    })
    .finally(() => luckyDeadline.clear());

  deps.emit("wildlife", stepText("wildlife", deps.env));
  const wild = await loadWild(f, data);
  const park = withoutReported(parkPool(f), deps.exclude);
  const luckyResult = withoutReported(await luckyLoad, deps.exclude);
  stopIfClientGone();
  const lucky: SectionState = luckyResult.state;
  const sections: Pass["sections"] = { park: park.state, wild: wild.state, lucky };

  // Audit Q-3-02: the model waits at most SPOT_EARLY_WAIT_MS for the optional map (a cached or saved
  // outline is ready at once). A map still loading keeps loading while the model writes; it is added
  // after the answer if it arrived (with the code-written riddle), else the pass says it was too slow.
  const geoWait = Math.min(SPOT_EARLY_WAIT_MS, spotWaitMs(deps.now() - deps.startedAt, left()));
  const early = await settleWithin(geometry, geoWait);
  let spotPlan: SpotPlan = early ? planSpot(early, { parkName: f.park.name, features: f, variant: input.variant }) : { status: "none", message: SPOT_COPY.slow };
  const target = spotPlan.status === "target" ? spotPlan.target : null;

  const basePool = poolForSpot([...park.items, ...withoutReported(wild, deps.exclude).items], target, band);
  // Lucky Finds are "maybe" extras: they never make a pass on their own (the park + wild pool must fill one).
  const fullPool = mixFor(basePool, band) ? [...basePool, ...luckyResult.items] : basePool;
  const plan = planRequest(fullPool, band, f.park.name);
  if (!plan) {
    const bothEmpty = park.state.status === "empty" && wild.state.status === "empty";
    return {
      kind: "empty",
      parkName: f.park.name,
      // Audit R3-T1: the headline gives the real count, and every section with some data says why it isn't enough.
      message: bothEmpty ? PASS_COPY.allEmpty(f.park.name) : shortPassMessage(f.park.name, fullPool.length),
      sections: explainShortSections(f.park.name, sections, { park: park.items, wild: wild.items }),
    };
  }

  const { mix } = plan;
  const parkData = parkDataOf(f.park.name, fullPool);
  deps.onPoolsReady?.({ id: f.park.id, lat: f.park.lat, lng: f.park.lng });
  const modelId = configuredModelId(deps.env);
  const promptSpot = target ? { id: target.id, label: target.label, sourceText: target.sourceText } : null;
  const month = monthOfDay(input.day);
  /** One request: the messages and strict schema for a plan (the whole pass, or the refill). */
  const requestFor = (p: RequestPlan, spot: typeof promptSpot, refill?: RefillNotes) => ({
    messages: buildMessages(f.park.name, p.pool, band, p.ask, spot, { month, openers: p.openers, ...(refill ? { refill } : {}) }),
    jsonSchema: passJsonSchema({ n: p.ask.n, itemIds: p.pool.map((x) => x.id) as [string, ...string[]], spotTargetId: spot?.id ?? null }),
  });

  let attempts = 0;
  let modelLatency = 0;
  let answered = modelId;
  let best: ValidationResult | null = null;
  let lastError: ModelError | null = null;
  /** Did the previous call fail (no answer)? Picks the honest progress line for the next call (Q-5-03). */
  let prevFailed: ModelError | null = null;
  let refills = 0;
  /** The first riddle (of up to two calls) that passed every check. */
  let riddle: string | null = null;
  let riddleDrop: SpotReason | null = null;
  /** Judge R7 T2: was the riddle ever asked for (a short whole retry may leave it out)? For the missing-riddle log. */
  let riddleAsked = false;
  /** The last answer's own check result (the refill is told what went wrong in it). */
  let lastCheck: ValidationResult | null = null;

  /** Whole-request retries used (at most one, after a failed first call). */
  let wholeRetries = 0;
  /** Ids whose clue failed a content check in ANY earlier call (a second refill skips them too). */
  const failedSoFar = new Set<string>();
  /** Slow provider (src/lib/pass/budget.ts): the budgeted answer speed, and MODEL_TIMEOUT_MS as a cap when set. */
  const tps = slowTokensPerS(modelId);
  const retryTps = retryTokensPerS(modelId);
  const capMs = deps.clock ? deps.clock.modelTimeoutMs : modelTimeoutCapMs(deps.env);
  for (let call = 1; call <= MAX_MODEL_CALLS; call++) {
    const remaining = left();
    const isRefill: boolean = call > 1 && best !== null && best.items.length > 0;
    if (remaining < (call === 1 ? MODEL_MIN_LEFT_MS : isRefill ? RETRY_MIN_LEFT_MS : wholeRetryMinLeftMs(retryTps))) {
      if (call === 1) {
        return {
          kind: "error",
          status: 504,
          error: { code: "DATA_TOO_SLOW", message: DATA_TOO_SLOW_COPY },
          parkData,
        };
      }
      break;
    }
    // Content tuning: a later call refills only what the earlier answers could not fill (unused ids only).
    // When no answer kept anything yet (or the first call failed), it is the whole request again (SPEC 6.3).
    const refill: boolean = isRefill;
    if (call > 1 && !refill) {
      if (wholeRetries >= 1) break;
      wholeRetries++;
    }
    let spotAsk = target !== null && riddle === null;
    let callPlan: RequestPlan | null;
    if (refill && best) callPlan = refillPlan(plan, best.items, [...failedSoFar]);
    else if (call > 1 && !deps.clock) {
      // Slow provider: the whole retry asks for what an answer can carry in the time left (budget.ts rule 2).
      const size = wholeRetrySize(remaining, plan.ask.n, spotAsk, retryTps);
      if (size.items === 0) break;
      callPlan = shortRetryPlan(plan, size.items, band);
      spotAsk = spotAsk && size.spot;
    } else callPlan = plan;
    if (!callPlan) break;
    // Round-7 quality Q-7-06: "fewer finds" only when the retry asks for fewer than the pass promises (not fewer spares).
    const shorter = !refill && call > 1 && callPlan.ask.n < plan.mix.n;
    const callSpot = spotAsk ? promptSpot : null;
    if (callSpot) riddleAsked = true;
    const notes: RefillNotes | undefined =
      refill && best
        ? {
            copied: lastCheck?.copied ?? [],
            generic: (lastCheck?.drops.generic_clue ?? 0) > 0,
            ...((lastCheck?.drops.jargon ?? 0) > 0 ? { jargon: true } : {}),
            taken: best.items.map((k) => openingWord(k.clue)),
          }
        : undefined;
    const { messages, jsonSchema } = requestFor(callPlan, callSpot, notes);
    // Q-9-01: the last check before the first paid call is reserved and pinned (later calls are pinned already).
    if (call === 1) stopIfClientGone();
    const ticket = await deps.reserveAiCall();
    if (!ticket) {
      if (call === 1) return { kind: "error", status: 429, error: { code: "DAILY_LIMIT", message: PASS_COPY.paused, retryAfter: 3600 }, parkData };
      break;
    }
    if (call > 1) {
      const reason: RetryReason = prevFailed
        ? prevFailed.code === "MODEL_TIMEOUT"
          ? shorter ? "timeout_short" : "timeout"
          : shorter ? "failed_short" : "failed"
        : !refill
          ? "none_kept"
          : refills === 0 ? "refill" : "last_refill";
      if (refill) refills++;
      deps.emit("retry", retryText(reason));
    } else deps.emit("clues", stepText("clues", deps.env));
    prevFailed = null;
    // The paid call starts now: it counts, and it finishes (and is cached) even if every client leaves.
    ticket.commit();
    deps.pin();
    // Slow provider: each call's limit is sized from what it asks (src/lib/pass/budget.ts). The eval/local clock
    // (deps.clock) keeps its fixed limits.
    const askSpot = callSpot !== null;
    const timeoutMs = deps.clock
      ? Math.min(deps.clock.modelTimeoutMs, refill ? deps.clock.refillTimeoutMs : Number.POSITIVE_INFINITY, remaining - 3_000)
      : call === 1
        ? firstCallTimeoutMs({ leftMs: remaining, items: callPlan.ask.n, spot: askSpot, tps, retryTps, capMs })
        : refill
          ? refillTimeoutMs(remaining, callPlan.ask.n, askSpot, tps, capMs)
          : wholeRetryTimeoutMs(remaining, capMs);
    const maxTokens = callMaxTokens(modelId, callPlan.ask.n, askSpot);
    try {
      const r = await callModel(
        { task: "pass", messages, jsonSchema, schemaName: "grass_pass", schema: PassDraftEnvelope, maxTokens },
        { env: deps.env, fetch: deps.modelFetch, timeoutMs, logger: deps.modelLogger, now: deps.now, ...(deps.modelDeadline ? { deadlineSignal: deps.modelDeadline } : {}) },
      );
      attempts += r.attempts;
      modelLatency += r.latencyMs;
      answered = r.modelLabel;
      deps.emit("check", stepText("check", deps.env));
      const v = validateDraft(r.data, callPlan.pool, callPlan.mix, { ...callPlan.validate, hasMap: target !== null, prior: refill && best ? best.items : [], ...(deps.validateTrace ? { trace: deps.validateTrace } : {}) });
      if (callSpot && target && riddle === null) {
        const sv = validateSpot(r.data.spot, target);
        if (sv.ok) riddle = sv.riddle;
        else riddleDrop = sv.reason;
      }
      log("pass_checks", {
        spot: target ? (riddle !== null ? "ok" : riddleDrop) : "none",
        call,
        refill,
        model: r.modelLabel,
        n: callPlan.mix.n,
        asked: callPlan.ask.n,
        timeoutMs,
        maxTokens,
        lowData: callPlan.lowData,
        returned: v.returned,
        kept: v.items.length,
        drops: v.drops,
        belowMin: v.belowMin,
        hard: v.hardCount,
        lookWhereCleared: v.lookWhereCleared,
        quotesRepaired: v.quotesRepaired,
        styleKept: v.styleKept,
        openersTrimmed: v.openersTrimmed,
        trailersTrimmed: v.trailersTrimmed,
        questionsFixed: v.questionsFixed,
        hardMin: callPlan.mix.hardMin,
      });
      lastCheck = v;
      for (const id of v.failedIds ?? []) failedSoFar.add(id);
      best = refill && best ? withRefill(best, v, mix) : better(best, v, mix);
      if (best && best.items.length >= retryThreshold(mix.n)) break;
    } catch (err) {
      if (!(err instanceof ModelError)) throw err;
      attempts += 1;
      lastError = err;
      prevFailed = err;
      log("pass_call_failed", { call, refill, code: err.code, upstreamStatus: err.upstreamStatus ?? null, timeoutMs, asked: callPlan.ask.n, maxTokens });
      // Completeness (run 2026-10-06-5, Cedar Ridge 10-13: the first call timed out at 30 s and the pass was
      // lost): a failed first call gets ONE whole-request retry while the deadline allows it; a failed refill
      // may be followed by one more refill. Quota, rate limits and a missing key are never retried.
      // (Network errors and 5xx were already retried once inside callModel.)
      if (!retryableModelError(err, refill)) break;
    }
  }

  if (!best || best.items.length === 0) {
    if (lastError) {
      const m = modelFailure(lastError, modelId);
      return { kind: "error", ...m, parkData };
    }
    return {
      kind: "error",
      status: 502,
      error: {
        code: "MODEL_BAD_OUTPUT",
        message: `${modelDisplayName(modelId)} couldn't write clues right now (none of its clues passed our checks). Your park data is below; try again in a minute.`,
      },
      parkData,
    };
  }

  if (!early) {
    // Audit Q-3-02: the map that was still loading when the model started.
    const late = await settleWithin(geometry, Math.min(SPOT_LATE_GRACE_MS, Math.max(0, left() - 3_000)));
    if (late) spotPlan = planLateSpot(late, { parkName: f.park.name, features: f, variant: input.variant, keptIds: new Set(best.items.map((v) => v.item.id)) });
    log("spot_late", { park: f.park.id, ready: late !== null, status: spotPlan.status, ms: deps.now() - deps.startedAt });
  }

  // M10 (run 2026-10-06-8): a printed clue that still starts with a banned frame ("Somewhere you will see a ...") gets a
  // plain first word that no other clue on the pass starts with (validate.ts `rewriteStockFrame`). Done here, on the
  // finished pass, like the lichen fix below, so the refill prompts list the first words the model really wrote.
  const firstWords = new Set(best.items.map((v) => openingWord(v.clue)));
  let framesRewritten = 0;
  const clueOf = (v: ValidationResult["items"][number]): string => {
    const out = rewriteStockFrame(v.clue, firstWords, v.item.answer);
    if (out !== v.clue) {
      framesRewritten++;
      firstWords.add(openingWord(out));
    }
    return out;
  };
  // Judge R7: a very common Park Find is never "hard" for ages 4-10, and a sound clue is never Find 1. The grown-up's
  // tip is written again from this final order and these labels (it names finds by number and "easy").
  const printed = soundNotFirst(
    [...best.items].sort((a, b) => SECTION_ORDER[a.item.section] - SECTION_ORDER[b.item.section]).map((v) => capDifficulty(v, band)),
  );
  const parentNote = parentNoteFor(printed, band);
  const items: PassItem[] = printed
    .map((v) => ({
      section: v.item.section,
      // Round-6 Q-6-03: "Who has bright-orange parts ...?" for a lichen reads as an animal: the printed clue says "What".
      // Done here, on the finished pass, so the refill prompts still list the first words the model really wrote.
      // Round 8 (Q-8-04): every plant and fungus, not only lichens ("Who has large, intricate flowers" for a passionflower).
      clue: v.item.section === "wild" ? fixPlantWho(clueOf(v), v.item) : clueOf(v),
      lookWhere: v.lookWhere,
      difficulty: v.difficulty,
      evidence: v.item.evidence,
      answer: v.item.answer,
      // Teens & adults (13+): the grown-up water line reads "Stay on the path near water." (src/lib/pass/audience.ts).
      safety: safetyForBand(v.item.safety, band),
      source: v.item.source,
      ...(v.item.section === "park" && v.item.id.startsWith("osm-") ? { feature: v.item.id.slice(4).replace(/-/g, "_") } : {}),
      ref: v.item.id,
    }));
  if (framesRewritten > 0) log("pass_frames_rewritten", { park: f.park.id, n: framesRewritten });
  // Judge R7 T2: say why a pass with a Find This Spot map prints the fixed line instead of a riddle.
  if (spotPlan.status === "target" && riddle === null) {
    const why = !target ? "map_arrived_after_the_clues" : !riddleAsked ? "not_asked_short_retry" : riddleDrop ?? "no_answer";
    log("spot_riddle_missing", { park: f.park.id, id: input.id, reason: why, target: spotPlan.target.kind, walkM: spotPlan.target.walk?.meters ?? null }, "warn");
  }
  const dropped = best.drops as Record<DropReason, number | undefined>;
  const other = Object.entries(dropped)
    .filter(([k]) => k !== "not_grounded")
    .reduce((a, [, v]) => a + (v ?? 0), 0);

  const pass: Pass = {
    id: input.id,
    park: { id: f.park.id, name: f.park.name, lat: f.park.lat, lng: f.park.lng },
    ageBand: band,
    day: input.day,
    variant: input.variant,
    target: mix.n,
    items,
    sections,
    removed: { notGrounded: dropped.not_grounded ?? 0, other },
    safetyFiltered: wild.blocked,
    parentNote,
    model: { answered, attempts: Math.max(1, attempts), latencyMs: Math.round(modelLatency) },
    generatedAt: new Date(deps.now()).toISOString(),
    dataCheckedAt: {
      osm: new Date(fr.at).toISOString(),
      inat: wild.checkedAt === null ? null : new Date(wild.checkedAt).toISOString(),
      ...(luckyResult.checkedAt ? { lucky: luckyResult.checkedAt } : {}),
    },
    wildSince: wild.since,
    ...(wild.seasonUnknown ? { seasonUnknown: true } : {}),
    spot: finishSpot(spotPlan, riddle),
  };
  return { kind: "pass", pass };
}
