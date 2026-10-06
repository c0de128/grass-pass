/**
 * Overpass API runner shared by every OpenStreetMap query (parks near a point now; park
 * features and geometry in S3/S5). ADR 0002 D2.
 *
 * Public Overpass is flaky (measured 2026-10-05: 504s, 4-90 s answers, overpass.private.coffee hung
 * 30-40 s on every try, maps.mail.ru answered a park-features query in 21 s while overpass-api.de 504'd), so:
 * - endpoints from OVERPASS_URLS (https only, up to 4), tried in order, each at most once;
 * - a TOTAL wait budget per query (default 50 s, park search 10 s), our own slot wait included:
 *   each attempt gets min(30 s, what is left AFTER it got a slot), and no new attempt starts with
 *   less than 8 s left, so a dead mirror can't stretch the wait;
 * - a circuit breaker per endpoint: a 429/5xx/timeout/server-busy remark sends traffic to the
 *   next endpoint until the breaker closes (429 honours Retry-After). A "Query timed out / out of
 *   memory" remark or an oversized answer is about THAT query, so it never trips the shared breaker
 *   and never fails over (SEC-1-01);
 * - at most 2 concurrent queries per process (politeness, ADR 0002); optional queries run at low
 *   priority so they never hold up a search or a features query (Q-1-06). "No slot of our own" is
 *   its own error code, so the UI never blames OpenStreetMap for our queue;
 * - the caller's signal (pass deadline, client gone) stops the query without blaming Overpass;
 * - bodies are read with a size cap (OVERPASS_MAX_BYTES);
 * - `[timeout:25]` in every query and a 30 s client timeout;
 * - Overpass can answer 200 with a "runtime error" remark and partial data; that is a failure.
 */
import "server-only";
import type { Store } from "@/lib/cache/store";
import { breakerRetryAfter, createSemaphore, QueueAbortedError, tripBreaker } from "@/lib/limits";
import { log } from "@/lib/log";
import { fetchText, parseRetryAfter, SourceError, userAgent, type FetchLike, type SourceErrorCode } from "./common";

export const OVERPASS_SOURCE = "overpass";
/**
 * Tried in this order. maps.mail.ru (VK Maps' public mirror) was verified live on 2026-10-05 with the
 * real Celebration Park features query (200, 21 s, same counts as the architect's check);
 * private.coffee stays last because it hung 30-40 s on every try that day.
 */
export const OVERPASS_DEFAULT_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
/** Server-side query timeout we put in every query. */
export const OVERPASS_QUERY_TIMEOUT_SEC = 25;
/**
 * R2-m2 (SEC-2-03): memory cap we put in every park query (`[maxsize:]`, bytes). Overpass's own default
 * is 512 MiB; a park query (features or the Find This Spot map) that needs more than this is refused at
 * once with an "out of memory" remark (-> too_heavy, cached 15 min) instead of running until our client
 * gives up. The biggest real park answers (White Rock Lake, 2026-10-06) run far below it.
 */
export const OVERPASS_MAXSIZE_BYTES = 128 * 1024 * 1024;

/** `[out:json][timeout:25][maxsize:134217728];` (the head of every park query). */
export function parkQueryHead(timeoutSec: number = OVERPASS_QUERY_TIMEOUT_SEC): string {
  return `[out:json][timeout:${timeoutSec}][maxsize:${OVERPASS_MAXSIZE_BYTES}];`;
}

/**
 * A query without its `[maxsize:]` setting. Replays of answers recorded before R2-m2 compare queries
 * this way: the memory cap changes nothing in an answer that came back whole.
 */
export function withoutMaxsize(query: string): string {
  return query.replace(/\[maxsize:\d+\]/g, "");
}
/** Client timeout per attempt (ADR 0002: 30 s, then fail over once). */
export const OVERPASS_CLIENT_TIMEOUT_MS = 30_000;
/** Longest we wait for one of the 2 concurrent slots (also capped by the query's total budget). */
export const OVERPASS_SLOT_MAX_WAIT_MS = 15_000;
export const OVERPASS_MAX_CONCURRENT = 2;
/** Breaker opening for an endpoint after a failure without Retry-After. */
export const OVERPASS_ERROR_OPEN_SEC = 60;
/** Attempts per query: each healthy endpoint at most once, up to this many. */
export const OVERPASS_MAX_ATTEMPTS = 3;
/** Total time one query may take across all attempts (keeps routes well under maxDuration = 90 s). */
export const OVERPASS_TOTAL_BUDGET_MS = 50_000;
/** Don't start another attempt with less than this left: a real answer takes 2-20 s. */
export const OVERPASS_MIN_ATTEMPT_MS = 8_000;
/** Biggest Overpass answer we read (SEC-1-01). Real park answers measured 2026-10-05/06: 5 KB to about 1.5 MB. */
export const OVERPASS_MAX_BYTES = 6 * 1024 * 1024;
/** How often a low-priority query looks for two free slots. */
const LOW_PRIORITY_POLL_MS = 250;

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

/** Tests: how many of our Overpass slots are in use / waited for right now. */
export function overpassSlots(): { active: number; waiting: number } {
  const sem = processSemaphore();
  return { active: sem.active, waiting: sem.waiting };
}

/** A remark that means THIS query was too heavy (not that the server is down): no breaker, no failover. */
export function isHeavyQueryRemark(remark: unknown): boolean {
  return typeof remark === "string" && /query timed out|out of memory/i.test(remark);
}

/** An Overpass "remark" that means the answer is incomplete (timeout, memory, runtime error). */
export function isErrorRemark(remark: unknown): boolean {
  return typeof remark === "string" && /error|timed? ?out|out of memory|too busy/i.test(remark);
}

export type OverpassDeps = {
  store: Store;
  fetchImpl?: FetchLike;
  /** The caller's signal (pass deadline, every client gone). Its abort is never blamed on Overpass. */
  signal?: AbortSignal;
  env?: Env;
  /** Called right before the first request is sent (charge budgets here). */
  onStart?: () => void;
  now?: () => number;
  /** Tests: per-attempt timeout. */
  timeoutMs?: number;
  /** Total budget across attempts, our slot waits included (default OVERPASS_TOTAL_BUDGET_MS). */
  totalBudgetMs?: number;
  /**
   * "low" (optional queries such as the Find This Spot map and background refreshes): starts only
   * while BOTH polite slots are free and nobody waits, so it never makes a park search or a pass's
   * features query wait (Q-1-06).
   */
  priority?: "normal" | "low";
  /** Body cap in bytes (default OVERPASS_MAX_BYTES). */
  maxBytes?: number;
};

export type OverpassResult = { json: Record<string, unknown>; endpoint: string; latencyMs: number };

type Attempt = { endpoint: string; code: SourceErrorCode; status?: number; retryAfter?: number };

/** Wait until a low-priority query may take a slot (both free, no waiters). Rejects with QueueAbortedError. */
async function lowPriorityTurn(sem: ReturnType<typeof createSemaphore>, signal: AbortSignal): Promise<void> {
  while (sem.active > 0 || sem.waiting > 0) {
    if (signal.aborted) throw new QueueAbortedError();
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(t);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const t = setTimeout(done, LOW_PRIORITY_POLL_MS);
      signal.addEventListener("abort", done, { once: true });
    });
  }
  if (signal.aborted) throw new QueueAbortedError();
}

/**
 * Run one Overpass QL query (must request `[out:json]`). Returns the parsed JSON object.
 * Throws SourceError:
 * - "not_called": every endpoint's breaker is open (no request sent);
 * - "queue_full": OUR per-process slots stayed busy (no request sent; not Overpass's fault);
 * - "aborted": the caller's signal fired (deadline / client gone); never trips a breaker;
 * - "too_heavy": Overpass said this query timed out / ran out of memory, or the answer was over the
 *   size cap; no breaker, no failover;
 * - otherwise the last attempt's code ("rate_limited", "busy", "timeout", "network", "bad_output").
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
  const perAttempt = deps.timeoutMs ?? OVERPASS_CLIENT_TIMEOUT_MS;
  const budget = deps.totalBudgetMs ?? OVERPASS_TOTAL_BUDGET_MS;
  const minAttempt = Math.min(OVERPASS_MIN_ATTEMPT_MS, perAttempt, budget);
  const t0 = Date.now();
  const leftMs = () => budget - (Date.now() - t0);
  const aborted = () => new SourceError(OVERPASS_SOURCE, "aborted", { started, message: "overpass: stopped by the caller (deadline or client gone)" });

  for (const endpoint of healthy.slice(0, OVERPASS_MAX_ATTEMPTS)) {
    if (deps.signal?.aborted) throw aborted();
    if (attempts.length > 0 && leftMs() < minAttempt) {
      log("upstream_call", { source: OVERPASS_SOURCE, endpoint: new URL(endpoint).host, outcome: "skipped_budget", leftMs: leftMs() }, "warn");
      break;
    }
    // The wait for one of OUR slots counts against the same total budget (Q-1-02), capped at 15 s.
    const slotWait = Math.max(1, Math.min(OVERPASS_SLOT_MAX_WAIT_MS, leftMs()));
    const slotSignal = deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(slotWait)]) : AbortSignal.timeout(slotWait);
    let res;
    try {
      if (deps.priority === "low") await lowPriorityTurn(sem, slotSignal);
      res = await sem.run(async () => {
        // Measured AFTER the slot is ours: a long queue wait leaves less time for the request itself.
        const attemptTimeout = Math.min(perAttempt, leftMs());
        if (attemptTimeout < Math.min(1_000, perAttempt)) throw new QueueAbortedError();
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
          { timeoutMs: attemptTimeout, fetchImpl: deps.fetchImpl, signal: deps.signal, maxBytes: deps.maxBytes ?? OVERPASS_MAX_BYTES },
        );
      }, slotSignal);
    } catch (err) {
      if (err instanceof QueueAbortedError) {
        if (deps.signal?.aborted) throw aborted();
        if (!started) {
          log("upstream_call", { source: OVERPASS_SOURCE, outcome: "queue_full", active: sem.active, waiting: sem.waiting }, "warn");
          throw new SourceError(OVERPASS_SOURCE, "queue_full", { started: false, retryAfter: 5, cause: err });
        }
        break;
      }
      if (!(err instanceof SourceError)) throw err;
      if (err.code === "aborted") throw aborted();
      // An oversized answer is about this query, not the server: no breaker, no failover.
      if (err.code === "bad_output") {
        log("upstream_call", { source: OVERPASS_SOURCE, endpoint: new URL(endpoint).host, outcome: "too_large" }, "warn");
        throw new SourceError(OVERPASS_SOURCE, "too_heavy", { started: true, cause: err });
      }
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
    if (isHeavyQueryRemark(obj.remark)) {
      // SEC-1-01: a query too heavy for Overpass fails the same way on every mirror. It says nothing
      // about the server's health, so it must not open the SHARED breaker for everyone.
      log("upstream_call", { ...base, outcome: "too_heavy" }, "warn");
      throw new SourceError(OVERPASS_SOURCE, "too_heavy", { status: 200, started: true });
    }
    if (isErrorRemark(obj.remark)) {
      await tripBreaker(deps.store, breakerName(endpoint), now(), OVERPASS_ERROR_OPEN_SEC);
      attempts.push({ endpoint, code: "busy", status: 200 });
      log("upstream_call", { ...base, outcome: "error_remark" }, "warn");
      continue;
    }
    log("upstream_call", { ...base, outcome: "ok", failover: attempts.length > 0 });
    return { json: obj, endpoint, latencyMs: res.latencyMs };
  }

  if (deps.signal?.aborted) throw aborted();
  const last = attempts.at(-1);
  if (!last) throw new SourceError(OVERPASS_SOURCE, "timeout", { started, message: "overpass: the time budget ran out" });
  throw new SourceError(OVERPASS_SOURCE, last.code, {
    status: last.status,
    retryAfter: last.retryAfter,
    started: true,
    attempts: attempts.map((a) => ({ endpoint: a.endpoint, code: a.code })),
  });
}

/**
 * Audit Q-3-01 (option 3): true only when every mirror we tried timed out, and we tried at least two
 * different mirrors (or the only one configured). One dead mirror also shows up as a timeout (and its
 * breaker already sends the next try elsewhere), so a single timeout says nothing about the park.
 */
export function everyMirrorTimedOut(err: SourceError, configured: number = OVERPASS_DEFAULT_URLS.length): boolean {
  if (err.source !== OVERPASS_SOURCE || err.code !== "timeout") return false;
  const tried = err.attempts ?? [];
  if (tried.length === 0 || tried.some((a) => a.code !== "timeout")) return false;
  return new Set(tried.map((a) => a.endpoint)).size >= Math.min(2, Math.max(1, configured));
}
