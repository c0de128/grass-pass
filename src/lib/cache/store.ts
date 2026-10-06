/**
 * Key-value store behind every cache, rate limit and cap (ADR 0002 §7).
 * - Production: Upstash Redis over its REST API (shared by all serverless instances).
 * - Local dev and tests: bounded in-memory maps, one per namespace, so a flood of
 *   junk in one namespace (e.g. the negative cache) can never evict another.
 *
 * Only strings are stored; callers JSON-encode and validate with zod on read.
 * Key-to-host rule (same idea as the model key): the Upstash token is sent only to an
 * https://*.upstash.io URL, never on a redirect, and is never logged.
 */
import { log, logOnce } from "@/lib/log";

export type Clock = () => number;

export interface Store {
  readonly kind: "memory" | "upstash";
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  del(key: string): Promise<void>;
  /**
   * Atomically add `by` (may be negative) and return the new value. A new key
   * gets `ttlSec`; an existing key keeps its expiry.
   */
  incr(key: string, by: number, ttlSec: number): Promise<number>;
  /**
   * Optional, one round trip (SEC-1-02): add 1 to `current`, read `previous`, and undo the add when
   * `previous * (1 - elapsed) + current > limit`. Returns the counts after the call.
   */
  rateHit?(current: string, previous: string, elapsed: number, limit: number, ttlSec: number): Promise<RateHit>;
  /**
   * Optional, one round trip: add 1 to every key only when none would pass its cap. `failed` is the
   * 1-based index of the first key that is full (nothing was added), or 0 with the new counts.
   */
  reserve?(keys: readonly string[], caps: readonly number[], ttlSec: number): Promise<Reserved>;
}

export type RateHit = { allowed: boolean; current: number; previous: number };
export type Reserved = { failed: number; counts: number[] };

export class StoreError extends Error {
  /**
   * Matched by name, not by class identity: Next bundles instrumentation.ts (the S8b example warm-up)
   * separately from pages and routes, and the globalThis singletons (queues, stores, in-flight builds)
   * throw the class of whichever bundle created them first.
   */
  static [Symbol.hasInstance](x: unknown): boolean {
    return x instanceof Error && x.name === "StoreError";
  }

  constructor(message: string, opts: { cause?: unknown } = {}) {
    super(message, { cause: opts.cause });
    this.name = "StoreError";
  }
}

const ttlMs = (ttlSec: number) => Math.max(1, Math.ceil(ttlSec)) * 1000;

/** Bounded in-memory store (oldest-written entry evicted first). */
export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private readonly map = new Map<string, { value: string; expiresAt: number }>();
  private readonly now: Clock;
  private readonly maxEntries: number;

  constructor(opts: { maxEntries?: number; now?: Clock } = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.maxEntries = opts.maxEntries ?? 5_000;
  }

  private live(key: string) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (this.now() >= e.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return e;
  }

  private write(key: string, value: string, expiresAt: number) {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  async get(key: string) {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSec: number) {
    this.write(key, value, this.now() + ttlMs(ttlSec));
  }

  async del(key: string) {
    this.map.delete(key);
  }

  async incr(key: string, by: number, ttlSec: number) {
    const e = this.live(key);
    const next = (e ? Number(e.value) || 0 : 0) + by;
    this.write(key, String(next), e ? e.expiresAt : this.now() + ttlMs(ttlSec));
    return next;
  }

  async rateHit(current: string, previous: string, elapsed: number, limit: number, ttlSec: number): Promise<RateHit> {
    const c = await this.incr(current, 1, ttlSec);
    const p = Number(this.live(previous)?.value) || 0;
    if (p * (1 - elapsed) + c > limit) {
      await this.incr(current, -1, ttlSec);
      return { allowed: false, current: c - 1, previous: p };
    }
    return { allowed: true, current: c, previous: p };
  }

  async reserve(keys: readonly string[], caps: readonly number[], ttlSec: number): Promise<Reserved> {
    for (let i = 0; i < keys.length; i++) {
      if ((Number(this.live(keys[i])?.value) || 0) + 1 > caps[i]) return { failed: i + 1, counts: [] };
    }
    const counts: number[] = [];
    for (const k of keys) counts.push(await this.incr(k, 1, ttlSec));
    return { failed: 0, counts };
  }

  get size() {
    return this.map.size;
  }

  clear() {
    this.map.clear();
  }
}

type Env = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const UPSTASH_TIMEOUT_MS = 3_000;

// INCRBY, then set the expiry only when the key has none (new key). One round trip, atomic.
const INCR_SCRIPT =
  "local v = redis.call('INCRBY', KEYS[1], ARGV[1]) if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end return v";

// Sliding-window hit (SEC-1-02: one command instead of incr + get + decr).
const RATE_SCRIPT =
  "local c = redis.call('INCRBY', KEYS[1], 1) if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[3]) end " +
  "local p = tonumber(redis.call('GET', KEYS[2]) or '0') or 0 " +
  "if p * (1 - tonumber(ARGV[1])) + c > tonumber(ARGV[2]) then redis.call('DECRBY', KEYS[1], 1) return {0, c - 1, p} end " +
  "return {1, c, p}";

// All-or-nothing reserve across several counters (global, per key, per network). ARGV = caps..., ttl.
const RESERVE_SCRIPT =
  "local n = #KEYS for i = 1, n do local v = tonumber(redis.call('GET', KEYS[i]) or '0') or 0 " +
  "if v + 1 > tonumber(ARGV[i]) then return {i} end end " +
  "local out = {0} for i = 1, n do local v = redis.call('INCRBY', KEYS[i], 1) " +
  "if redis.call('TTL', KEYS[i]) < 0 then redis.call('EXPIRE', KEYS[i], ARGV[n + 1]) end out[#out + 1] = v end return out";

/** Upstash free plan: 500,000 commands a month (upstash.com/pricing/redis, checked 2026-10-05). */
export const UPSTASH_FREE_MONTHLY_COMMANDS = 500_000;
/** Commands are counted in process and added to the shared monthly counter in batches of this size. */
export const BUDGET_FLUSH_EVERY = 50;
export const BUDGET_ALERT_PCTS = [50, 90] as const;

const intOr = (v: string | undefined, d: number) => {
  const n = Number(v?.trim());
  return Number.isInteger(n) && n > 0 ? n : d;
};

export type UpstashConfig = { ok: true; url: string; token: string } | { ok: false; reason: string };

/**
 * Read the Upstash REST credentials. Accepts UPSTASH_REDIS_REST_URL/TOKEN, or the
 * KV_REST_API_URL/TOKEN names some Vercel Marketplace installs use.
 */
export function upstashConfig(env: Env = process.env): UpstashConfig | null {
  const url = (env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL)?.trim();
  const token = (env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN)?.trim();
  if (!url && !token) return null;
  if (!url || !token) return { ok: false, reason: "Upstash URL and token must both be set" };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "Upstash URL is not a valid URL" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "Upstash URL must use https" };
  if (u.username || u.password) return { ok: false, reason: "Upstash URL must not contain a user name or password" };
  if (!u.hostname.endsWith(".upstash.io") || u.port !== "") {
    return { ok: false, reason: "Upstash URL must be an https://<name>.upstash.io address" };
  }
  return { ok: true, url: `${u.origin}`, token };
}

export class UpstashStore implements Store {
  readonly kind = "upstash" as const;
  private readonly url: string;
  private readonly token: string;
  private readonly prefix: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly monthlyBudget: number;
  private readonly clock: Clock;
  /** Commands sent by this process and not yet added to the shared monthly counter. */
  private unflushed = 0;
  private flushing = false;

  constructor(opts: {
    url: string;
    token: string;
    prefix?: string;
    fetch?: FetchLike;
    timeoutMs?: number;
    /** UPSTASH_MONTHLY_COMMANDS: log a warning at 50% and an error at 90% of it. */
    monthlyBudget?: number;
    now?: Clock;
  }) {
    this.url = opts.url;
    this.token = opts.token;
    this.prefix = opts.prefix ?? "gp:";
    this.fetchImpl = opts.fetch ?? ((u, i) => fetch(u, i));
    this.timeoutMs = opts.timeoutMs ?? UPSTASH_TIMEOUT_MS;
    this.monthlyBudget = opts.monthlyBudget ?? UPSTASH_FREE_MONTHLY_COMMANDS;
    this.clock = opts.now ?? (() => Date.now());
  }

  /**
   * Monthly command budget (SEC-1-02): every BUDGET_FLUSH_EVERY commands, one extra command adds them
   * to a shared per-month counter. The instance whose batch crosses 50% or 90% logs it once, so the PM
   * can react before the free quota runs out and the store fails closed. Never throws.
   */
  private count(): void {
    this.unflushed++;
    if (this.unflushed < BUDGET_FLUSH_EVERY || this.flushing) return;
    void this.flushBudget();
  }

  /** Add this process's unflushed command count to the shared monthly counter; returns the new total. */
  async flushBudget(): Promise<number | null> {
    if (this.flushing || this.unflushed === 0) return null;
    this.flushing = true;
    const n = this.unflushed + 1; // the flush itself is a command too
    this.unflushed = 0;
    const month = new Date(this.clock()).toISOString().slice(0, 7);
    try {
      const total = Number(await this.send(["EVAL", INCR_SCRIPT, 1, `${this.prefix}meta:commands:${month}`, n, 40 * 24 * 3600]));
      if (!Number.isFinite(total)) return null;
      for (const pct of BUDGET_ALERT_PCTS) {
        const at = Math.ceil((this.monthlyBudget * pct) / 100);
        if (total - n < at && total >= at) {
          log("upstash_budget", { pct, used: total, budget: this.monthlyBudget, month }, pct >= 90 ? "error" : "warn");
        }
      }
      return total;
    } catch {
      return null; // best effort; the store error is already logged
    } finally {
      this.flushing = false;
    }
  }

  private async command(args: (string | number)[]): Promise<unknown> {
    this.count();
    return this.send(args);
  }

  private async send(args: (string | number)[]): Promise<unknown> {
    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store",
        // The token must never follow a redirect to another host.
        redirect: "error",
      });
    } catch (err) {
      log("store_error", { store: "upstash", cmd: String(args[0]), outcome: "network", latencyMs: Date.now() - started, errName: err instanceof Error ? err.name : typeof err }, "error");
      throw new StoreError("The shared store did not answer.", { cause: err });
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch (err) {
      log("store_error", { store: "upstash", cmd: String(args[0]), outcome: "bad_body", upstreamStatus: res.status }, "error");
      throw new StoreError("The shared store sent an unreadable answer.", { cause: err });
    }
    const body = json as { result?: unknown; error?: unknown } | null;
    if (!res.ok || !body || typeof body !== "object" || "error" in body) {
      log("store_error", { store: "upstash", cmd: String(args[0]), outcome: "error", upstreamStatus: res.status }, "error");
      throw new StoreError(`The shared store refused a command (HTTP ${res.status}).`);
    }
    return body.result ?? null;
  }

  async get(key: string) {
    const r = await this.command(["GET", this.prefix + key]);
    return typeof r === "string" ? r : null;
  }

  async set(key: string, value: string, ttlSec: number) {
    await this.command(["SET", this.prefix + key, value, "EX", Math.max(1, Math.ceil(ttlSec))]);
  }

  async del(key: string) {
    await this.command(["DEL", this.prefix + key]);
  }

  async incr(key: string, by: number, ttlSec: number) {
    const r = await this.command(["EVAL", INCR_SCRIPT, 1, this.prefix + key, Math.trunc(by), Math.max(1, Math.ceil(ttlSec))]);
    const n = Number(r);
    if (!Number.isFinite(n)) throw new StoreError("The shared store returned a non-number count.");
    return n;
  }

  async rateHit(current: string, previous: string, elapsed: number, limit: number, ttlSec: number): Promise<RateHit> {
    const r = await this.command([
      "EVAL",
      RATE_SCRIPT,
      2,
      this.prefix + current,
      this.prefix + previous,
      String(Math.min(1, Math.max(0, elapsed))),
      Math.trunc(limit),
      Math.max(1, Math.ceil(ttlSec)),
    ]);
    const a = Array.isArray(r) ? r.map(Number) : [];
    if (a.length !== 3 || !a.every(Number.isFinite)) throw new StoreError("The shared store returned a bad rate-limit answer.");
    return { allowed: a[0] === 1, current: a[1], previous: a[2] };
  }

  async reserve(keys: readonly string[], caps: readonly number[], ttlSec: number): Promise<Reserved> {
    const r = await this.command([
      "EVAL",
      RESERVE_SCRIPT,
      keys.length,
      ...keys.map((k) => this.prefix + k),
      ...caps.map((c) => Math.trunc(c)),
      Math.max(1, Math.ceil(ttlSec)),
    ]);
    const a = Array.isArray(r) ? r.map(Number) : [];
    if (a.length === 0 || !a.every(Number.isFinite)) throw new StoreError("The shared store returned a bad reserve answer.");
    if (a[0] !== 0) return { failed: a[0], counts: [] };
    if (a.length !== keys.length + 1) throw new StoreError("The shared store returned a bad reserve answer.");
    return { failed: 0, counts: a.slice(1) };
  }
}

type StoreHolder = { upstash?: Store | null; memory: Map<string, MemoryStore> };
const HOLDER_KEY = Symbol.for("grass-pass.stores");

/** Kept on globalThis so route handlers and instrumentation share one instance (pattern: next-instrumentation-singletons). */
function holder(): StoreHolder {
  const g = globalThis as unknown as Record<symbol, StoreHolder | undefined>;
  return (g[HOLDER_KEY] ??= { upstash: undefined, memory: new Map() });
}

/**
 * The store for a namespace. With Upstash configured, every namespace shares the
 * Redis database (keys are prefixed by the caller). Without it, each namespace gets
 * its own bounded memory map (fine for one local process; production must set Upstash).
 */
export function getStore(namespace: string, opts: { maxEntries?: number; env?: Env } = {}): Store {
  const env = opts.env ?? process.env;
  const h = holder();
  if (h.upstash === undefined) {
    const cfg = upstashConfig(env);
    if (cfg?.ok) {
      h.upstash = new UpstashStore({
        url: cfg.url,
        token: cfg.token,
        monthlyBudget: intOr(env.UPSTASH_MONTHLY_COMMANDS, UPSTASH_FREE_MONTHLY_COMMANDS),
      });
    } else {
      h.upstash = null;
      if (cfg && !cfg.ok) logOnce("upstash-config", "store_config_error", { reason: cfg.reason }, "error");
      if (env.VERCEL_ENV === "production") {
        logOnce("memory-in-prod", "store_memory_in_production", {
          note: "Limits and caches are per instance. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
        });
      }
    }
  }
  if (h.upstash) return h.upstash;
  let m = h.memory.get(namespace);
  if (!m) {
    m = new MemoryStore({ maxEntries: opts.maxEntries });
    h.memory.set(namespace, m);
  }
  return m;
}

/** Tests: forget every store so the next getStore() re-reads the env. */
export function resetStores(): void {
  const h = holder();
  h.upstash = undefined;
  h.memory.clear();
}
