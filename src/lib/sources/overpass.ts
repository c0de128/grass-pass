/**
 * Overpass API runner shared by every OpenStreetMap query (parks near a point now; park
 * features and geometry in S3/S5). ADR 0002 D2.
 *
 * Public Overpass is flaky (measured 2026-10-05: 504s, 4-90 s answers, one mirror hung 40 s), so:
 * - endpoints from OVERPASS_URLS (https only), tried in order, with ONE failover;
 * - a circuit breaker per endpoint: a 429/5xx/timeout/error-remark sends traffic to the
 *   next endpoint until the breaker closes (429 honours Retry-After);
 * - at most 2 concurrent queries per process (politeness, ADR 0002);
 * - `[timeout:25]` in every query and a 30 s client timeout;
 * - Overpass can answer 200 with a "runtime error" remark and partial data; that is a failure.
 */
import "server-only";
import type { Store } from "@/lib/cache/store";
import { breakerRetryAfter, createSemaphore, QueueAbortedError, tripBreaker } from "@/lib/limits";
import { log } from "@/lib/log";
import { fetchText, parseRetryAfter, SourceError, userAgent, type FetchLike, type SourceErrorCode } from "./common";

export const OVERPASS_SOURCE = "overpass";
export const OVERPASS_DEFAULT_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
/** Server-side query timeout we put in every query. */
export const OVERPASS_QUERY_TIMEOUT_SEC = 25;
/** Client timeout per attempt (ADR 0002: 30 s, then fail over once). */
export const OVERPASS_CLIENT_TIMEOUT_MS = 30_000;
/** Longest we wait for one of the 2 concurrent slots. */
export const OVERPASS_SLOT_MAX_WAIT_MS = 15_000;
export const OVERPASS_MAX_CONCURRENT = 2;
/** Breaker opening for an endpoint after a failure without Retry-After. */
export const OVERPASS_ERROR_OPEN_SEC = 60;
/** Attempts per query: the first healthy endpoint plus one failover. */
export const OVERPASS_MAX_ATTEMPTS = 2;

type Env = Record<string, string | undefined>;

/** OVERPASS_URLS (comma list), keeping only plain https URLs; falls back to the defaults. */
export function overpassEndpoints(env: Env = process.env): string[] {
  const raw = env.OVERPASS_URLS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const ok: string[] = [];
  for (const r of raw) {
    try {
      const u = new URL(r);
      if (u.protocol !== "https:" || u.username || u.password) continue;
      const s = u.toString();
      if (!ok.includes(s)) ok.push(s);
    } catch {
      /* skip */
    }
  }
  return ok.length > 0 ? ok.slice(0, 4) : [...OVERPASS_DEFAULT_URLS];
}

/** Breaker name per endpoint host, e.g. "overpass:overpass-api.de". */
export function breakerName(endpoint: string): string {
  return `${OVERPASS_SOURCE}:${new URL(endpoint).host}`;
}

type SemHolder = { sem: ReturnType<typeof createSemaphore> };
const SEM_KEY = Symbol.for("grass-pass.overpass-semaphore");
function processSemaphore() {
  const g = globalThis as unknown as Record<symbol, SemHolder | undefined>;
  return (g[SEM_KEY] ??= { sem: createSemaphore(OVERPASS_MAX_CONCURRENT) }).sem;
}

/** An Overpass "remark" that means the answer is incomplete (timeout, memory, runtime error). */
export function isErrorRemark(remark: unknown): boolean {
  return typeof remark === "string" && /error|timed? ?out|out of memory|too busy/i.test(remark);
}

export type OverpassDeps = {
  store: Store;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  env?: Env;
  /** Called right before the first request is sent (charge budgets here). */
  onStart?: () => void;
  now?: () => number;
  /** Tests: per-attempt timeout. */
  timeoutMs?: number;
};

export type OverpassResult = { json: Record<string, unknown>; endpoint: string; latencyMs: number };

type Attempt = { endpoint: string; code: SourceErrorCode; status?: number; retryAfter?: number };

/**
 * Run one Overpass QL query (must request `[out:json]`). Returns the parsed JSON object.
 * Throws SourceError: "not_called" (every endpoint's breaker is open, or no slot in time),
 * otherwise the last attempt's code ("rate_limited", "busy", "timeout", "network", "bad_output").
 */
export async function runOverpass(query: string, deps: OverpassDeps): Promise<OverpassResult> {
  const now = deps.now ?? (() => Date.now());
  const endpoints = overpassEndpoints(deps.env);
  const healthy: string[] = [];
  let shortestWait = Infinity;
  for (const e of endpoints) {
    const wait = await breakerRetryAfter(deps.store, breakerName(e), now());
    if (wait > 0) shortestWait = Math.min(shortestWait, wait);
    else healthy.push(e);
  }
  if (healthy.length === 0) {
    throw new SourceError(OVERPASS_SOURCE, "not_called", { started: false, retryAfter: shortestWait });
  }

  const sem = processSemaphore();
  const attempts: Attempt[] = [];
  let started = false;
  for (const endpoint of healthy.slice(0, OVERPASS_MAX_ATTEMPTS)) {
    if (deps.signal?.aborted) break;
    // A fresh wait budget per attempt: a slow first attempt must not cancel the failover.
    const slotSignal = deps.signal
      ? AbortSignal.any([deps.signal, AbortSignal.timeout(OVERPASS_SLOT_MAX_WAIT_MS)])
      : AbortSignal.timeout(OVERPASS_SLOT_MAX_WAIT_MS);
    let res;
    try {
      res = await sem.run(async () => {
        if (!started) deps.onStart?.();
        started = true;
        return fetchText(
          OVERPASS_SOURCE,
          endpoint,
          {
            method: "POST",
            headers: {
              "User-Agent": userAgent(deps.env),
              Accept: "application/json",
              "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            },
            body: new URLSearchParams({ data: query }).toString(),
          },
          { timeoutMs: deps.timeoutMs ?? OVERPASS_CLIENT_TIMEOUT_MS, fetchImpl: deps.fetchImpl, signal: deps.signal },
        );
      }, slotSignal);
    } catch (err) {
      if (err instanceof QueueAbortedError) {
        if (!started) throw new SourceError(OVERPASS_SOURCE, "not_called", { started: false, retryAfter: 5, cause: err });
        break;
      }
      if (!(err instanceof SourceError)) throw err;
      attempts.push({ endpoint, code: err.code });
      await tripBreaker(deps.store, breakerName(endpoint), now(), OVERPASS_ERROR_OPEN_SEC);
      log("upstream_call", { source: OVERPASS_SOURCE, endpoint: new URL(endpoint).host, outcome: err.code }, "warn");
      continue;
    }

    const base = { source: OVERPASS_SOURCE, endpoint: new URL(endpoint).host, status: res.status, latencyMs: res.latencyMs };
    if (res.status === 429) {
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"), now()) ?? OVERPASS_ERROR_OPEN_SEC;
      await tripBreaker(deps.store, breakerName(endpoint), now(), retryAfter);
      attempts.push({ endpoint, code: "rate_limited", status: 429, retryAfter });
      log("upstream_call", { ...base, outcome: "rate_limited", retryAfter }, "warn");
      continue;
    }
    if (res.status >= 500 || res.status === 403) {
      await tripBreaker(deps.store, breakerName(endpoint), now(), OVERPASS_ERROR_OPEN_SEC);
      attempts.push({ endpoint, code: "busy", status: res.status });
      log("upstream_call", { ...base, outcome: "busy" }, "warn");
      continue;
    }
    if (res.status !== 200) {
      // 400 = our query is wrong; another endpoint will say the same. Stop here.
      log("upstream_call", { ...base, outcome: "bad_status" }, "error");
      throw new SourceError(OVERPASS_SOURCE, "bad_output", { status: res.status, started: true });
    }
    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      json = null;
    }
    if (!json || typeof json !== "object" || Array.isArray(json) || !Array.isArray((json as { elements?: unknown }).elements)) {
      // Overpass sometimes answers 200 with an HTML error page when overloaded.
      await tripBreaker(deps.store, breakerName(endpoint), now(), OVERPASS_ERROR_OPEN_SEC);
      attempts.push({ endpoint, code: "bad_output", status: 200 });
      log("upstream_call", { ...base, outcome: "bad_output" }, "warn");
      continue;
    }
    const obj = json as Record<string, unknown>;
    if (isErrorRemark(obj.remark)) {
      await tripBreaker(deps.store, breakerName(endpoint), now(), OVERPASS_ERROR_OPEN_SEC);
      attempts.push({ endpoint, code: "busy", status: 200 });
      log("upstream_call", { ...base, outcome: "error_remark" }, "warn");
      continue;
    }
    log("upstream_call", { ...base, outcome: "ok", failover: attempts.length > 0 });
    return { json: obj, endpoint, latencyMs: res.latencyMs };
  }

  const last = attempts.at(-1);
  if (!last) throw new SourceError(OVERPASS_SOURCE, "network", { started, message: "overpass: aborted" });
  throw new SourceError(OVERPASS_SOURCE, last.code, { status: last.status, retryAfter: last.retryAfter, started: true });
}
