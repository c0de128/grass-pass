/**
 * Server-only client for open-weight models on any OpenAI-compatible
 * chat-completions server (plain fetch, no SDK). Default: gemma-4-31B-it on
 * DigitalOcean serverless inference (ADR 0001).
 *
 * - Strict `json_schema` output, validated again with zod. `finish_reason: length`,
 *   empty content, non-JSON and schema mismatches are all MODEL_BAD_OUTPUT.
 * - 30 s timeout: ~3x the slowest measured Gemma 4 31B answer (9.3 s, 2026-10-05).
 * - One retry on a network error or 5xx, after 500 ms, only if a normal answer still fits.
 * - Distinct error codes for not configured / network / provider / rate limit / quota / timeout / bad output.
 * - One JSON log line per attempt (model, latency, tokens, finish_reason, outcome). Never the key, never prompt text.
 * - Key-to-host rule (SEC-F-01): DO_INFERENCE_API_KEY goes ONLY to https://inference.do-ai.run.
 * - Never follows redirects (SEC-R2-01): the prompt body must not reach another origin.
 * - The model name shown to users comes from the model that actually answered.
 *
 * Adapted from projects/_practice2/app/src/lib/model.ts (resolveModelTarget, same author).
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import { log } from "@/lib/log";

export const DO_HOST = "inference.do-ai.run";
export const DO_BASE_URL = `https://${DO_HOST}/v1`;
export const DEFAULT_MODEL_ID = "gemma-4-31B-it";

/** ADR 0001: max_tokens 2,000, temperature 0.4. */
export const MAX_TOKENS = 2_000;
export const TEMPERATURE = 0.4;
/** Slowest measured Gemma 4 31B answer on DO (2026-10-05: 7.0-9.3 s). */
export const MEASURED_SLOWEST_MS = 9_300;
/** ADR 0001 / SPEC §6.3: 30 s. */
export const MODEL_TIMEOUT_MS = 30_000;
/** Routes that call the model export `maxDuration = 90` (SPEC §5.2); keep 20 s of headroom. */
export const ROUTE_MAX_DURATION_SEC = 90;
export const MAX_MODEL_TIMEOUT_MS = (ROUTE_MAX_DURATION_SEC - 20) * 1000;
export const MIN_MODEL_TIMEOUT_MS = 5_000;
export const RETRY_BACKOFF_MS = 500;
/** A retry starts only when at least this share of the timeout is left (12 s at 30 s). */
export const RETRY_BUDGET_SHARE = 0.4;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MODEL_ID_RE = /^[\w.:/-]{1,100}$/;

type Env = Record<string, string | undefined>;

// ---------- configuration ----------

/**
 * Where the open weights are served. Default: DigitalOcean. MODEL_BASE_URL (https,
 * or plain http only for localhost / 127.0.0.1) and MODEL_ID switch to any
 * OpenAI-compatible server (e.g. Ollama at http://localhost:11434/v1).
 * Unparseable or non-http(s) values fall back to DO. Plain http to any other host,
 * or a URL with user:pass@, is refused (`error` set) and no model call is made.
 */
export function modelEndpoint(env: Env = process.env): { baseUrl: string; model: string; error?: string } {
  const raw = env.MODEL_BASE_URL?.trim();
  const id = env.MODEL_ID?.trim();
  const model = id && MODEL_ID_RE.test(id) ? id : DEFAULT_MODEL_ID;
  let baseUrl = DO_BASE_URL;
  if (raw) {
    let u: URL | null = null;
    try {
      u = new URL(raw);
    } catch {
      /* keep the default */
    }
    if (u && (u.protocol === "https:" || u.protocol === "http:")) {
      if (u.username || u.password) {
        return { baseUrl: DO_BASE_URL, model, error: "MODEL_BASE_URL must not contain a user name or password" };
      }
      if (u.protocol === "http:" && !LOCAL_HOSTS.has(u.hostname)) {
        return {
          baseUrl: DO_BASE_URL,
          model,
          error: "MODEL_BASE_URL must use https (plain http is only allowed for localhost / 127.0.0.1)",
        };
      }
      baseUrl = raw.replace(/\/+$/, "");
    }
  }
  return { baseUrl, model };
}

export type ModelTarget =
  | { ok: true; baseUrl: string; model: string; keyEnv: "DO_INFERENCE_API_KEY" | "MODEL_API_KEY"; apiKey: string | null }
  | { ok: false; reason: string };

/**
 * Which key goes to which host (SEC-F-01, 2026-10-02). DO_INFERENCE_API_KEY is a
 * full DigitalOcean account token (ACCEPTED-RISKS.md), so it is ONLY ever sent to
 * https://inference.do-ai.run on the default port. Any other host gets MODEL_API_KEY
 * (required for a hosted provider; optional for localhost, where no Authorization
 * header is sent if it is empty). A misconfigured host never falls back to the DO key.
 */
export function resolveModelTarget(env: Env = process.env): ModelTarget {
  const ep = modelEndpoint(env);
  if (ep.error) return { ok: false, reason: ep.error };
  const u = new URL(ep.baseUrl);
  if (u.protocol === "https:" && u.hostname === DO_HOST && u.port === "") {
    const key = env.DO_INFERENCE_API_KEY?.trim();
    return key
      ? { ok: true, baseUrl: ep.baseUrl, model: ep.model, keyEnv: "DO_INFERENCE_API_KEY", apiKey: key }
      : { ok: false, reason: "DO_INFERENCE_API_KEY is not set" };
  }
  const key = env.MODEL_API_KEY?.trim() || null;
  if (!key && !LOCAL_HOSTS.has(u.hostname)) {
    return { ok: false, reason: "MODEL_API_KEY is required for a hosted MODEL_BASE_URL" };
  }
  return { ok: true, baseUrl: ep.baseUrl, model: ep.model, keyEnv: "MODEL_API_KEY", apiKey: key };
}

/** True when the server can call a model (the right key for the configured host is set). */
export function hasModelKey(env: Env = process.env): boolean {
  return resolveModelTarget(env).ok;
}

/** The model the server is configured to ask (for progress text before an answer exists). */
export function configuredModelId(env: Env = process.env): string {
  return modelEndpoint(env).model;
}

/** Timeout from MODEL_TIMEOUT_MS (e.g. 60000 for the slower Llama fallback), clamped to 5-70 s. */
export function modelTimeoutMs(env: Env = process.env): number {
  const n = Number(env.MODEL_TIMEOUT_MS?.trim());
  if (!Number.isFinite(n) || n <= 0) return MODEL_TIMEOUT_MS;
  return Math.min(MAX_MODEL_TIMEOUT_MS, Math.max(MIN_MODEL_TIMEOUT_MS, Math.round(n)));
}

// ---------- errors ----------

export type ModelErrorCode =
  | "MODEL_NOT_CONFIGURED"
  | "MODEL_NETWORK"
  | "MODEL_PROVIDER"
  | "MODEL_RATE_LIMITED"
  | "MODEL_QUOTA"
  | "MODEL_TIMEOUT"
  | "MODEL_BAD_OUTPUT"
  | "ABORTED";

const STATUS: Record<ModelErrorCode, number> = {
  MODEL_NOT_CONFIGURED: 503,
  MODEL_NETWORK: 502,
  MODEL_PROVIDER: 502,
  MODEL_RATE_LIMITED: 503,
  MODEL_QUOTA: 503,
  MODEL_TIMEOUT: 504,
  MODEL_BAD_OUTPUT: 502,
  ABORTED: 499,
};

/** Short reason, for "<model> couldn't write clues right now (<reason>)". */
export function reasonFor(code: ModelErrorCode, timeoutMs: number = MODEL_TIMEOUT_MS): string {
  switch (code) {
    case "MODEL_NOT_CONFIGURED":
      return "this server has no AI key set up";
    case "MODEL_NETWORK":
      return "the AI service could not be reached";
    case "MODEL_PROVIDER":
      return "the AI service had a problem answering";
    case "MODEL_RATE_LIMITED":
      return "the AI service is busy";
    case "MODEL_QUOTA":
      return "the free AI budget is used up for now";
    case "MODEL_TIMEOUT":
      return `it took longer than ${Math.round(timeoutMs / 1000)} seconds`;
    case "MODEL_BAD_OUTPUT":
      return "the answer was not usable";
    case "ABORTED":
      return "the request was cancelled";
  }
}

export type BadOutputReason = "finish_length" | "empty" | "not_json" | "schema" | "envelope";

export class ModelError extends Error {
  /**
   * Matched by name, not by class identity: Next bundles instrumentation.ts (the S8b example warm-up)
   * separately from pages and routes, and the globalThis singletons (queues, stores, in-flight builds)
   * throw the class of whichever bundle created them first.
   */
  static [Symbol.hasInstance](x: unknown): boolean {
    return x instanceof Error && x.name === "ModelError";
  }

  readonly code: ModelErrorCode;
  readonly status: number;
  readonly reason: string;
  readonly retryAfter?: number;
  readonly upstreamStatus?: number;
  readonly badOutput?: BadOutputReason;
  readonly info?: CompletionInfo;
  constructor(
    code: ModelErrorCode,
    opts: {
      retryAfter?: number;
      cause?: unknown;
      timeoutMs?: number;
      upstreamStatus?: number;
      badOutput?: BadOutputReason;
      info?: CompletionInfo;
    } = {},
  ) {
    const reason = reasonFor(code, opts.timeoutMs);
    super(`AI call failed: ${reason}.`, { cause: opts.cause });
    this.name = "ModelError";
    this.code = code;
    this.status = STATUS[code];
    this.reason = reason;
    this.retryAfter = opts.retryAfter;
    this.upstreamStatus = opts.upstreamStatus;
    this.badOutput = opts.badOutput;
    this.info = opts.info;
  }
}

// ---------- request / response ----------

export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };

export type ModelRequest<T> = {
  /** Short label for logs, e.g. "pass" or "photo-check". */
  task: string;
  messages: ChatMessage[];
  /** JSON schema sent with strict: true (all keys required, additionalProperties false, minItems/maxItems set). */
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  /** zod schema the parsed content must pass. */
  schema: z.ZodType<T>;
  maxTokens?: number;
  temperature?: number;
};

/** Values MODEL_REASONING_EFFORT may take (OpenAI-compatible `reasoning_effort`). */
export const REASONING_EFFORTS = ["none", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/**
 * Optional `reasoning_effort` for the request (self-host switch, 2026-10-06). Unset (the default, and
 * production on DigitalOcean) sends nothing, so the hosted request body is unchanged. Ollama turns
 * Gemma 4's thinking ON by default through its OpenAI API; `MODEL_REASONING_EFFORT=none` turns it off,
 * which on a CPU is the difference between ~3 s and ~20 s for a tiny answer (measured 2026-10-06).
 * Unknown values are ignored.
 */
export function reasoningEffort(env: Env = process.env): ReasoningEffort | null {
  const v = env.MODEL_REASONING_EFFORT?.trim().toLowerCase();
  return (REASONING_EFFORTS as readonly string[]).includes(v ?? "") ? (v as ReasoningEffort) : null;
}

export function buildRequestBody(
  req: Omit<ModelRequest<unknown>, "schema" | "task">,
  model: string,
  extra: { reasoningEffort?: ReasoningEffort | null } = {},
) {
  return {
    model,
    ...(extra.reasoningEffort ? { reasoning_effort: extra.reasoningEffort } : {}),
    messages: req.messages,
    max_tokens: req.maxTokens ?? MAX_TOKENS,
    temperature: req.temperature ?? TEMPERATURE,
    response_format: {
      type: "json_schema" as const,
      json_schema: { name: req.schemaName, strict: true, schema: req.jsonSchema },
    },
  };
}

const completionSchema = z.looseObject({
  model: z.string().nullish(),
  choices: z
    .array(
      z.looseObject({
        finish_reason: z.string().nullish(),
        message: z.looseObject({ content: z.string().nullish(), refusal: z.string().nullish() }).nullish(),
      }),
    )
    .min(1),
  usage: z
    .looseObject({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() })
    .nullish(),
});

export type CompletionInfo = {
  finishReason: string | null;
  promptTokens?: number;
  completionTokens?: number;
  /** The model id the server says answered (falls back to the requested id). */
  answeredModel: string;
};

/** Parse a chat-completions JSON body and validate its content, or throw MODEL_BAD_OUTPUT. */
export function parseCompletion<T>(json: unknown, schema: z.ZodType<T>, requestedModel: string): { data: T; info: CompletionInfo } {
  const c = completionSchema.safeParse(json);
  if (!c.success) throw new ModelError("MODEL_BAD_OUTPUT", { cause: c.error, badOutput: "envelope" });
  const choice = c.data.choices[0];
  const answered = c.data.model?.trim();
  const info: CompletionInfo = {
    finishReason: choice.finish_reason ?? null,
    promptTokens: c.data.usage?.prompt_tokens,
    completionTokens: c.data.usage?.completion_tokens,
    answeredModel: answered && MODEL_ID_RE.test(answered) ? answered : requestedModel,
  };
  const bad = (badOutput: BadOutputReason, cause?: unknown) => new ModelError("MODEL_BAD_OUTPUT", { cause, badOutput, info });
  // Hit max_tokens: the JSON is cut off or incomplete.
  if (choice.finish_reason === "length") throw bad("finish_length");
  const content = choice.message?.content;
  if (!content || !content.trim()) throw bad("empty");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw bad("not_json", e);
  }
  const data = schema.safeParse(parsed);
  if (!data.success) throw bad("schema", data.error);
  return { data: data.data, info };
}

// ---------- logging ----------

export type ModelLogLine = {
  task: string;
  model: string;
  answeredModel?: string;
  attempt: number;
  outcome: "ok" | "network" | "provider_error" | "rate_limited" | "quota" | "timeout" | "bad_output" | "aborted";
  latencyMs: number;
  upstreamStatus?: number;
  finishReason?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  badOutput?: BadOutputReason;
  errName?: string;
};

export type ModelLogger = (line: ModelLogLine) => void;
export const defaultModelLogger: ModelLogger = (line) =>
  log("model_call", line, line.outcome === "ok" ? "info" : "warn");

// ---------- the call ----------

export type CallOptions = {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Where keys and MODEL_BASE_URL / MODEL_ID / MODEL_TIMEOUT_MS come from. Default: process.env. */
  env?: Env;
  /**
   * Caller cancel signal. Paid calls should usually NOT pass the client's request
   * signal: once started, let them finish and cache the result (charge-started-paid-calls).
   */
  signal?: AbortSignal;
  timeoutMs?: number;
  backoffMs?: number;
  minRetryBudgetMs?: number;
  logger?: ModelLogger;
  now?: () => number;
};

export type ModelResult<T> = {
  data: T;
  info: CompletionInfo;
  /** What to show users: the model that actually answered. */
  modelLabel: string;
  latencyMs: number;
  attempts: number;
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function retryAfterSeconds(res: Response): number | undefined {
  const n = Number(res.headers.get("retry-after"));
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : undefined;
}

/** Make one structured-output model call. Throws ModelError on every failure. */
export async function callModel<T>(req: ModelRequest<T>, opts: CallOptions = {}): Promise<ModelResult<T>> {
  const env = opts.env ?? process.env;
  const target = resolveModelTarget(env);
  if (!target.ok) throw new ModelError("MODEL_NOT_CONFIGURED", { cause: target.reason });
  const { apiKey, baseUrl, model } = target;

  const doFetch = opts.fetch ?? ((u: string, i?: RequestInit) => fetch(u, i));
  const now = opts.now ?? (() => Date.now());
  const logLine = opts.logger ?? defaultModelLogger;
  const timeoutMs = opts.timeoutMs ?? modelTimeoutMs(env);
  const backoffMs = opts.backoffMs ?? RETRY_BACKOFF_MS;
  const minRetryBudgetMs = opts.minRetryBudgetMs ?? Math.round(timeoutMs * RETRY_BUDGET_SHARE);

  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal ? AbortSignal.any([deadline, opts.signal]) : deadline;
  const body = JSON.stringify(buildRequestBody(req, model, { reasoningEffort: reasoningEffort(env) }));
  const started = now();
  const base = { task: req.task, model };

  /** Map an exception (fetch, body read or backoff) to a ModelError, logging it. */
  const fail = (attempt: number, t0: number, err: unknown, upstreamStatus?: number): ModelError => {
    const latencyMs = now() - t0;
    const errName = err instanceof Error ? err.name : typeof err;
    if (opts.signal?.aborted) {
      logLine({ ...base, attempt, outcome: "aborted", latencyMs, upstreamStatus, errName });
      return new ModelError("ABORTED", { cause: err });
    }
    if (deadline.aborted) {
      logLine({ ...base, attempt, outcome: "timeout", latencyMs, upstreamStatus, errName });
      return new ModelError("MODEL_TIMEOUT", { cause: err, timeoutMs });
    }
    if (err instanceof SyntaxError) {
      logLine({ ...base, attempt, outcome: "bad_output", latencyMs, upstreamStatus, errName, badOutput: "envelope" });
      return new ModelError("MODEL_BAD_OUTPUT", { cause: err, badOutput: "envelope", upstreamStatus });
    }
    logLine({ ...base, attempt, outcome: "network", latencyMs, upstreamStatus, errName });
    return new ModelError("MODEL_NETWORK", { cause: err, upstreamStatus });
  };
  const canRetry = () => timeoutMs - (now() - started) >= minRetryBudgetMs;

  for (let attempt = 1; ; attempt++) {
    const t0 = now();
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
        signal,
        cache: "no-store",
        // SEC-R2-01: OpenAI-compatible APIs never redirect a POST. Following one would send the prompt (body)
        // to another origin, even over plain http. A redirect is a network error here, never followed.
        redirect: "error",
      });
    } catch (err) {
      const e = fail(attempt, t0, err);
      if (e.code === "MODEL_NETWORK" && attempt === 1 && canRetry()) {
        try {
          await sleep(backoffMs, signal);
        } catch (sleepErr) {
          throw fail(attempt, t0, sleepErr);
        }
        continue;
      }
      throw e;
    }

    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      const latencyMs = now() - t0;
      const upstreamStatus = res.status;
      if (res.status === 429) {
        logLine({ ...base, attempt, outcome: "rate_limited", latencyMs, upstreamStatus });
        throw new ModelError("MODEL_RATE_LIMITED", { retryAfter: retryAfterSeconds(res), upstreamStatus });
      }
      if (res.status === 402) {
        logLine({ ...base, attempt, outcome: "quota", latencyMs, upstreamStatus });
        throw new ModelError("MODEL_QUOTA", { upstreamStatus });
      }
      logLine({ ...base, attempt, outcome: "provider_error", latencyMs, upstreamStatus });
      if (res.status >= 500 && attempt === 1 && canRetry()) {
        try {
          await sleep(backoffMs, signal);
        } catch (sleepErr) {
          throw fail(attempt, t0, sleepErr, res.status);
        }
        continue;
      }
      throw new ModelError("MODEL_PROVIDER", { upstreamStatus });
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch (err) {
      throw fail(attempt, t0, err, res.status);
    }

    const latencyMs = now() - t0;
    try {
      const { data, info } = parseCompletion(json, req.schema, model);
      logLine({
        ...base,
        attempt,
        outcome: "ok",
        latencyMs,
        upstreamStatus: res.status,
        answeredModel: info.answeredModel,
        finishReason: info.finishReason,
        promptTokens: info.promptTokens,
        completionTokens: info.completionTokens,
      });
      return { data, info, modelLabel: info.answeredModel, latencyMs: now() - started, attempts: attempt };
    } catch (err) {
      const me = err instanceof ModelError ? err : new ModelError("MODEL_BAD_OUTPUT", { cause: err, badOutput: "envelope" });
      logLine({
        ...base,
        attempt,
        outcome: "bad_output",
        latencyMs,
        upstreamStatus: res.status,
        badOutput: me.badOutput,
        answeredModel: me.info?.answeredModel,
        finishReason: me.info?.finishReason,
        promptTokens: me.info?.promptTokens,
        completionTokens: me.info?.completionTokens,
      });
      throw me;
    }
  }
}
