/**
 * Build one pass (SPEC F3-F5, F7, F11): park map -> wildlife -> pools (danger-filtered by code) ->
 * mix limits (code) -> ONE model call that picks ids and writes clues -> server checks -> at most
 * one retry when too few clues survive -> the pass, with every number and date written by code.
 *
 * Limits, the pass cache and in-flight dedup live in src/lib/pass/make.ts; this file gets callbacks
 * for charging (`onUpstream`, `reserveAiCall`) and pinning (`pin`) so the paid call is never
 * aborted once started (pattern: charge-started-paid-calls).
 */
import "server-only";
import "@/lib/zod-config";
import { createJsonCache, type Store } from "@/lib/cache";
import type { QuotaTicket } from "@/lib/limits";
import { log } from "@/lib/log";
import { callModel, configuredModelId, MAX_TOKENS, ModelError, modelTimeoutMs, type ModelLogger } from "@/lib/model";
import {
  PASS_COPY,
  type AgeBand,
  type ParkData,
  type Pass,
  type PassItem,
  type PassStep,
} from "@/lib/pass/schema";
import { parkPool } from "@/lib/pool/park";
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
import { DATA_TOO_SLOW_COPY, loadFeatures } from "@/lib/pass/park-data";
import { finishSpot, geometryWithin, loadGeometry, planSpot, SPOT_WAIT_MS, type GeometryResult, type SpotPlan } from "@/lib/spot/load";
import type { SpotTarget } from "@/lib/spot/pick-target";
import { askMix, buildMessages, computeMix, type Mix } from "./prompt";
import { passJsonSchema, PassDraftEnvelope } from "./schema";
import { mergeResults, retryThreshold, validateDraft, validateSpot, type DropReason, type SpotReason, type ValidationResult } from "./validate";

type Env = Record<string, string | undefined>;

const HOUR = 3600;
const DAY = 24 * HOUR;
/** ADR 0002: species list 6 h, taxon summaries 7 days (park features: src/lib/pass/park-data.ts). */
export { FEATURES_TTL_SEC } from "@/lib/pass/park-data";
export const SPECIES_TTL_SEC = 6 * HOUR;
export const TAXA_TTL_SEC = 7 * DAY;

/** Whole pass must finish inside the route's maxDuration (90 s) with room to answer. */
export const PASS_DEADLINE_MS = 85_000;
/** Don't start a model call with less than this left (a normal answer is 7-10 s). */
export const MODEL_MIN_LEFT_MS = 15_000;
/** Don't start the one retry with less than this left. */
export const RETRY_MIN_LEFT_MS = 20_000;

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
  /** In-flight signal: aborts the FREE data steps when every client has left (never the model call). */
  signal: AbortSignal;
  emit: (step: PassStep, text: string) => void;
  /** Called right before the paid model call: it must then finish and be cached even if clients leave. */
  pin: () => void;
  /** Called right before the first upstream request (charges the per-IP daily share). */
  onUpstream: () => void;
  /** Reserve one model call against AI_DAILY_CAP; null when the cap is reached. */
  reserveAiCall: () => Promise<QuotaTicket | null>;
  /** When the request started (deadline). */
  startedAt: number;
  modelLogger?: ModelLogger;
  /** Called once the pools are ready and a model call will follow (S7 starts the October box here, in parallel). */
  onPoolsReady?: (park: { id: string; lat: number; lng: number }) => void;
};

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
      return "Checking every clue against its source…";
    case "retry":
      return "Some clues didn't pass the checks. Asking once more…";
  }
}

/** SPEC §6.3 copy for a failed model call. */
export function modelFailure(err: ModelError, modelId: string): { status: number; error: ApiError } {
  const name = modelDisplayName(modelId);
  const tail = "Your park data is below; try again in a minute.";
  switch (err.code) {
    case "MODEL_TIMEOUT":
      return { status: 504, error: { code: err.code, message: `${name} took too long. Try again. Your park data is below.` } };
    case "MODEL_QUOTA":
      return { status: 503, error: { code: err.code, message: PASS_COPY.paused, retryAfter: 3600 } };
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
export const WILD_SLOW_COPY = "No data available: iNaturalist was too slow when this pass was made.";

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

/** Mix limits for a pool (SPEC F2/F4). */
export function mixFor(pool: readonly PoolItem[], band: AgeBand): Mix | null {
  const n = (s: Section) => pool.filter((i) => i.section === s).length;
  return computeMix({ park: n("park"), wild: n("wild"), lucky: n("lucky") }, band);
}

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

/**
 * Spare pool items offered per section beyond the pass size (S8b, M7/M8): the model needs n items
 * plus room to choose, not every bench and all 16 species. Measured on the 20 eval parks: prompts of
 * 700-4,500 tokens before; completion tokens, not prompt tokens, set the latency (about 33 ms each).
 */
export const PROMPT_SPARES = 4;

/** At most n + PROMPT_SPARES items per section, in the pool's own order (best first). */
export function promptPool(pool: readonly PoolItem[], n: number): PoolItem[] {
  const seen: Record<Section, number> = { park: 0, wild: 0, lucky: 0 };
  return pool.filter((p) => ++seen[p.section] <= n + PROMPT_SPARES);
}

/**
 * max_tokens for the pass call: measured completions were 348-696 tokens (Gemma 4 31B and Llama 4
 * Maverick, 82 calls, S9). gpt-oss also spends tokens on reasoning, so it keeps the ADR 0001 budget.
 */
export function passMaxTokens(modelId: string): number {
  return modelId.toLowerCase().startsWith("gpt-oss") ? MAX_TOKENS : PASS_MAX_TOKENS;
}
export const PASS_MAX_TOKENS = 1_200;

export async function buildPass(input: BuildInput, deps: BuildDeps): Promise<BuildOutcome> {
  const left = () => deps.startedAt + PASS_DEADLINE_MS - deps.now();

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
  deps.emit("map", stepText("map", deps.env));
  const fr = await loadFeatures(input.ref, { store: data.store, env: data.env, now: data.now, fetchImpl: data.fetchImpl, signal: data.signal, onUpstream: data.onUpstream });
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

  deps.emit("wildlife", stepText("wildlife", deps.env));
  const wild = await loadWild(f, data);
  const park = parkPool(f);
  const lucky: SectionState = { status: "off", message: PASS_COPY.luckyOff };
  const sections: Pass["sections"] = { park: park.state, wild: wild.state, lucky };

  const geoWait = Math.min(SPOT_WAIT_MS, Math.max(0, left() - MODEL_MIN_LEFT_MS - 5_000));
  const spotPlan: SpotPlan = planSpot(await geometryWithin(geometry, geoWait), { parkName: f.park.name, features: f, variant: input.variant });
  const target = spotPlan.status === "target" ? spotPlan.target : null;

  const fullPool = poolForSpot([...park.items, ...wild.items], target, band);
  const fullMix = mixFor(fullPool, band);
  const pool = fullMix ? promptPool(fullPool, fullMix.n) : fullPool;
  const mix: Mix | null = mixFor(pool, band);
  if (!mix) {
    const bothEmpty = park.state.status === "empty" && wild.state.status === "empty";
    return {
      kind: "empty",
      parkName: f.park.name,
      message: bothEmpty
        ? PASS_COPY.allEmpty(f.park.name)
        : `Not enough real data for a pass at ${f.park.name} right now. Each section below says why.`,
      sections,
    };
  }

  const parkData = parkDataOf(f.park.name, fullPool);
  deps.onPoolsReady?.({ id: f.park.id, lat: f.park.lat, lng: f.park.lng });
  const modelId = configuredModelId(deps.env);
  // R2-M5: ask for up to ASK_EXTRA spare items; validateDraft keeps at most mix.n that pass every check.
  const ask = askMix(mix, { park: pool.filter((p) => p.section === "park").length, wild: pool.filter((p) => p.section === "wild").length, lucky: pool.filter((p) => p.section === "lucky").length });
  const messages = buildMessages(f.park.name, pool, band, ask, target ? { id: target.id, label: target.label, sourceText: target.sourceText } : null, {
    month: monthOfDay(input.day),
  });
  const jsonSchema = passJsonSchema({
    n: ask.n,
    itemIds: pool.map((p) => p.id) as [string, ...string[]],
    spotTargetId: target?.id ?? null,
  });

  let attempts = 0;
  let modelLatency = 0;
  let answered = modelId;
  let best: ValidationResult | null = null;
  let lastError: ModelError | null = null;
  /** The first riddle (of up to two calls) that passed every check. */
  let riddle: string | null = null;
  let riddleDrop: SpotReason | null = null;

  for (let call = 1; call <= 2; call++) {
    const remaining = left();
    if (remaining < (call === 1 ? MODEL_MIN_LEFT_MS : RETRY_MIN_LEFT_MS)) {
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
    const ticket = await deps.reserveAiCall();
    if (!ticket) {
      if (call === 1) return { kind: "error", status: 429, error: { code: "DAILY_LIMIT", message: PASS_COPY.paused, retryAfter: 3600 }, parkData };
      break;
    }
    if (call === 2) deps.emit("retry", stepText("retry", deps.env));
    else deps.emit("clues", stepText("clues", deps.env));
    // The paid call starts now: it counts, and it finishes (and is cached) even if every client leaves.
    ticket.commit();
    deps.pin();
    try {
      const r = await callModel(
        { task: "pass", messages, jsonSchema, schemaName: "grass_pass", schema: PassDraftEnvelope, maxTokens: passMaxTokens(modelId) },
        { env: deps.env, fetch: deps.modelFetch, timeoutMs: Math.min(modelTimeoutMs(deps.env), remaining - 3_000), logger: deps.modelLogger },
      );
      attempts += r.attempts;
      modelLatency += r.latencyMs;
      answered = r.modelLabel;
      deps.emit("check", stepText("check", deps.env));
      const v = validateDraft(r.data, pool, mix, { hasMap: target !== null, ask });
      if (target && riddle === null) {
        const sv = validateSpot(r.data.spot, target);
        if (sv.ok) riddle = sv.riddle;
        else riddleDrop = sv.reason;
      }
      log("pass_checks", {
        spot: target ? (riddle !== null ? "ok" : riddleDrop) : "none",
        call,
        model: r.modelLabel,
        n: mix.n,
        returned: v.returned,
        kept: v.items.length,
        drops: v.drops,
        belowMin: v.belowMin,
        hard: v.hardCount,
        lookWhereCleared: v.lookWhereCleared,
        quotesRepaired: v.quotesRepaired,
        hardMin: mix.hardMin,
      });
      best = better(best, v, mix);
      if (best && best.items.length >= retryThreshold(mix.n)) break;
    } catch (err) {
      if (!(err instanceof ModelError)) throw err;
      attempts += 1;
      lastError = err;
      // Only bad/under-filled output gets this second call (SPEC §6.3). Network and 5xx were already
      // retried once inside callModel; a timeout is never retried automatically.
      if (err.code !== "MODEL_BAD_OUTPUT") break;
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

  const items: PassItem[] = [...best.items]
    .sort((a, b) => SECTION_ORDER[a.item.section] - SECTION_ORDER[b.item.section])
    .map((v) => ({
      section: v.item.section,
      clue: v.clue,
      lookWhere: v.lookWhere,
      difficulty: v.difficulty,
      evidence: v.item.evidence,
      answer: v.item.answer,
      safety: v.item.safety,
      source: v.item.source,
      ...(v.item.section === "park" && v.item.id.startsWith("osm-") ? { feature: v.item.id.slice(4).replace(/-/g, "_") } : {}),
    }));
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
    parentNote: best.parentNote,
    model: { answered, attempts: Math.max(1, attempts), latencyMs: Math.round(modelLatency) },
    generatedAt: new Date(deps.now()).toISOString(),
    dataCheckedAt: {
      osm: new Date(fr.at).toISOString(),
      inat: wild.checkedAt === null ? null : new Date(wild.checkedAt).toISOString(),
    },
    wildSince: wild.since,
    ...(wild.seasonUnknown ? { seasonUnknown: true } : {}),
    spot: finishSpot(spotPlan, riddle),
  };
  return { kind: "pass", pass };
}
