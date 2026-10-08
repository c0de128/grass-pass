/**
 * Trip tips (Kevin 2026-10-08, "How to make this a great trip"): made ONCE with the pass, in parallel with the clue call,
 * so the pass is not slower. One extra model call per pass (it counts against AI_DAILY_CAP like every call, after the
 * clue call took its slot), with a short clock: TIPS_BUDGET_MS from the start, then the code-written list is used.
 * Never throws and never fails the pass: any problem gives the rules list from the same real facts, with the honest
 * reason (schema.ts RULES_REASONS).
 */
import "server-only";
import type { QuotaTicket } from "@/lib/limits";
import { log } from "@/lib/log";
import { callModel, hasModelKey, ModelError, type ModelLogger } from "@/lib/model";
import type { FetchLike } from "@/lib/sources/common";
import type { WeatherFetch } from "@/lib/weather/park-weather";
import { checkTips, type TipCheck, type TipDraft } from "./check";
import { tipFacts, type TipFacts, type TipFactsInput } from "./facts";
import { tipsJsonSchema, tipsMessages, TIPS_MAX_TOKENS, TIPS_TEMPERATURE, TipsEnvelope } from "./prompt";
import { rulesTips } from "./rules";
import { MIN_TIPS, type RulesReason, type TripTips } from "./schema";

type Env = Record<string, string | undefined>;

/** The whole trip-tips step, weather wait included (Kevin: "short, never delay the pass"). */
export const TIPS_BUDGET_MS = 10_000;
/** The longest the tips wait for a forecast that is still loading (it started during the wildlife step). */
export const TIPS_WEATHER_WAIT_MS = 3_000;
/** Don't start the model call with less than this left of the budget (a tips answer took 2-5 s when measured). */
export const TIPS_MIN_CALL_MS = 4_000;

export type TipsTrace = {
  facts: TipFacts;
  request?: { messages: ReturnType<typeof tipsMessages>; jsonSchema: Record<string, unknown> };
  response?: unknown;
  check?: TipCheck;
  error?: string;
};

export type TipsDeps = {
  env: Env;
  now: () => number;
  modelFetch?: FetchLike;
  modelLogger?: ModelLogger;
  /** Reserve one model call against AI_DAILY_CAP; null when the cap is reached. */
  reserveAiCall: () => Promise<QuotaTicket | null>;
  /** Recording and tests only: what was sent and answered. */
  trace?: (t: TipsTrace) => void;
};

export type TipsStart = Omit<TipFactsInput, "forecast" | "alerts" | "nowMs"> & {
  /** The park's forecast lookup (src/lib/weather/park-weather.ts `cachedWeather`), started earlier; null = none. */
  weather: Promise<WeatherFetch> | null;
};

export type TipsRun = {
  /** Settles within about TIPS_BUDGET_MS with the model's tips or the rules list. Never rejects. */
  done: Promise<TripTips>;
  /** The rules list from the facts known right now (for a pass that can't wait any longer). */
  fallback: () => TripTips;
};

/** `p`'s value, or null after `ms` (or when it rejects). */
export function settle<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p.catch(() => null), new Promise<null>((r) => (timer = setTimeout(() => r(null), Math.max(0, ms))))]).finally(() => clearTimeout(timer));
}

export function rulesResult(facts: TipFacts, reason: RulesReason, nowMs: number): TripTips {
  return { source: "rules", forDate: facts.forDate, forecast: facts.forecast, items: rulesTips(facts, facts.band), reason, madeAt: new Date(nowMs).toISOString() };
}

/** Start the trip tips (see the file comment). */
export function startTripTips(start: TipsStart, deps: TipsDeps): TipsRun {
  const t0 = deps.now();
  const base = (w: WeatherFetch | null): TipFactsInput => ({
    ...start,
    nowMs: deps.now(),
    forecast: w?.forecast ?? null,
    alerts: w?.alerts ?? null,
  });
  let facts: TipFacts = tipFacts(base(null));
  const done = (async (): Promise<TripTips> => {
    try {
      const w = start.weather ? await settle(start.weather, TIPS_WEATHER_WAIT_MS) : null;
      facts = tipFacts(base(w));
      return await fromModel(facts, deps, t0);
    } catch (err) {
      log("trip_tips_failed", { error: err instanceof Error ? err.name : "unknown" }, "error");
      return rulesResult(facts, "no_answer", deps.now());
    }
  })();
  return { done, fallback: () => rulesResult(facts, "no_answer", deps.now()) };
}

/** The model's tips (or the rules list) for facts already gathered; `t0` = when the step's clock started. Never rejects for model errors. */
export async function fromModel(facts: TipFacts, deps: TipsDeps, t0: number): Promise<TripTips> {
  const trace: TipsTrace = { facts };
  const finish = (out: TripTips, extra: Record<string, unknown> = {}) => {
    deps.trace?.(trace);
    log("trip_tips", { source: out.source, reason: out.reason ?? null, items: out.items.length, forecast: facts.forecast, facts: facts.facts.length, ms: deps.now() - t0, ...extra });
    return out;
  };
  if (!hasModelKey(deps.env)) return finish(rulesResult(facts, "no_key", deps.now()));
  const left = TIPS_BUDGET_MS - (deps.now() - t0);
  if (left < TIPS_MIN_CALL_MS) return finish(rulesResult(facts, "no_answer", deps.now()), { skipped: "time" });
  const ticket = await deps.reserveAiCall();
  if (!ticket) return finish(rulesResult(facts, "budget", deps.now()));
  ticket.commit();
  const ids = facts.facts.map((f) => f.id) as [string, ...string[]];
  const messages = tipsMessages(facts);
  const jsonSchema = tipsJsonSchema(ids);
  trace.request = { messages, jsonSchema };
  try {
    const r = await callModel(
      { task: "trip-tips", messages, jsonSchema, schemaName: "trip_tips", schema: TipsEnvelope, maxTokens: TIPS_MAX_TOKENS, temperature: TIPS_TEMPERATURE },
      { env: deps.env, fetch: deps.modelFetch, timeoutMs: TIPS_BUDGET_MS - (deps.now() - t0), logger: deps.modelLogger, now: deps.now },
    );
    trace.response = r.data;
    const check = checkTips(r.data.tips as TipDraft[], facts.facts, facts.band);
    trace.check = check;
    if (check.kept.length < MIN_TIPS) return finish(rulesResult(facts, "failed_checks", deps.now()), { returned: check.returned, kept: check.kept.length, drops: check.drops });
    return finish(
      { source: "model", forDate: facts.forDate, forecast: facts.forecast, items: check.kept, model: r.modelLabel, madeAt: new Date(deps.now()).toISOString() },
      { returned: check.returned, kept: check.kept.length, drops: check.drops, model: r.modelLabel },
    );
  } catch (err) {
    if (!(err instanceof ModelError)) throw err;
    trace.error = err.code;
    const reason: RulesReason =
      err.code === "MODEL_NOT_CONFIGURED" ? "no_key" : err.code === "MODEL_QUOTA" ? "budget" : err.code === "MODEL_BAD_OUTPUT" ? "failed_checks" : "no_answer";
    return finish(rulesResult(facts, reason, deps.now()), { code: err.code });
  }
}
