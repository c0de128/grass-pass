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
import { dailyPace, noteDailyCommands, noteMonthlyCommands, RESTING_PCT } from "@/lib/limits/budget";
import { log, logOnce } from "@/lib/log";
import { localDay } from "@/lib/time";

export type Clock = () => number;

export interface Store {
  readonly kind: "memory" | "upstash";
  get(key: string): Promise<string | null>;
  /**
   * Optional (SEC-3-02): several keys in ONE round trip (Upstash MGET = 1 command). Callers fall back to
   * get() per key when a store lacks it.
   */
  getMany?(keys: readonly string[]): Promise<(string | null)[]>;
  /**
   * Optional (SEC-3-04): learn the shared monthly/daily command counters before the first counted
   * command of this process, so a new instance knows at once whether to rest or pause. Never throws.
   */
  prime?(): Promise<void>;
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
  /** Optional (item reports): every field of a hash (Upstash HGETALL = 1 command); {} when there is none. */
  hashGetAll?(key: string): Promise<Record<string, string>>;
  /**
   * Optional, one round trip (item reports, src/lib/reports): note one account's report unless it already
   * reported this item today (one field per account per kind, so thresholds count distinct accounts), keep
   * the "not safe" accounts, hide the item once enough distinct accounts said so, and drop fields older than
   * the keep window. See REPORT_SCRIPT.
   */
  recordReport?(w: ReportWrite): Promise<ReportWritten>;
}

/** One item report (keys are built in src/lib/reports/index.ts `reportKeys`). */
export type ReportWrite = {
  /** Set once per account + item + day (NX); its existence makes a repeat a no-op. */
  dedupeKey: string;
  dedupeTtlSec: number;
  /**
   * The park's report hash: `<ref>|<kind>|<reporter id>` -> yyyymmdd of that account's latest report of that
   * kind (SEC-4-01: one field per account, so counts are distinct accounts), `<ref>|hide` -> yyyymmdd it was hidden.
   */
  hashKey: string;
  field: string;
  /** The same account's opposite opinion (found <-> notfound), deleted so one account holds one; "" = none. */
  otherField: string;
  /** The set of reporter ids that said "not safe" about this item (only touched for `unsafe`). */
  unsafeKey: string;
  unsafe: boolean;
  /** The reporter id (a per-park HMAC of the account, never the account key itself). */
  member: string;
  /** Distinct "not safe" accounts that hide the item. */
  hideAt: number;
  hideField: string;
  /** yyyymmdd (today). */
  day: number;
  /** Fields whose day (their value) is before this yyyymmdd are deleted (a hide too). */
  cutoff: number;
  ttlSec: number;
};
export type ReportWritten = { counted: boolean; unsafeAccounts: number; newlyHidden: boolean };

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

  async getMany(keys: readonly string[]) {
    return keys.map((k) => this.live(k)?.value ?? null);
  }

  async set(key: string, value: string, ttlSec: number) {
    this.write(key, value, this.now() + ttlMs(ttlSec));
  }

  async del(key: string) {
    this.map.delete(key);
  }

  /** Synchronous add: the multi-key operations below run without yielding, so they are atomic like the Lua scripts. */
  private incrNow(key: string, by: number, ttlSec: number): number {
    const e = this.live(key);
    const next = (e ? Number(e.value) || 0 : 0) + by;
    this.write(key, String(next), e ? e.expiresAt : this.now() + ttlMs(ttlSec));
    return next;
  }

  async incr(key: string, by: number, ttlSec: number) {
    return this.incrNow(key, by, ttlSec);
  }

  async rateHit(current: string, previous: string, elapsed: number, limit: number, ttlSec: number): Promise<RateHit> {
    const c = this.incrNow(current, 1, ttlSec);
    const p = Number(this.live(previous)?.value) || 0;
    if (p * (1 - elapsed) + c > limit) {
      this.incrNow(current, -1, ttlSec);
      return { allowed: false, current: c - 1, previous: p };
    }
    return { allowed: true, current: c, previous: p };
  }

  async reserve(keys: readonly string[], caps: readonly number[], ttlSec: number): Promise<Reserved> {
    for (let i = 0; i < keys.length; i++) {
      if ((Number(this.live(keys[i])?.value) || 0) + 1 > caps[i]) return { failed: i + 1, counts: [] };
    }
    const counts: number[] = [];
    // No await between the check and the adds (accounts audit: concurrent reserves overshot a per-key share).
    for (const k of keys) counts.push(this.incrNow(k, 1, ttlSec));
    return { failed: 0, counts };
  }

  private readonly hashes = new Map<string, { fields: Map<string, string>; expiresAt: number }>();
  private readonly sets = new Map<string, { members: Set<string>; expiresAt: number }>();

  private liveHash(key: string) {
    const h = this.hashes.get(key);
    if (h && this.now() >= h.expiresAt) {
      this.hashes.delete(key);
      return undefined;
    }
    return h;
  }

  async hashGetAll(key: string) {
    return Object.fromEntries(this.liveHash(key)?.fields ?? []);
  }

  /** Same steps as REPORT_SCRIPT (the Upstash version), in one synchronous run. */
  async recordReport(w: ReportWrite): Promise<ReportWritten> {
    if (this.live(w.dedupeKey)) return { counted: false, unsafeAccounts: 0, newlyHidden: false };
    this.write(w.dedupeKey, "1", this.now() + ttlMs(w.dedupeTtlSec));
    const expiresAt = this.now() + ttlMs(w.ttlSec);
    const h = this.liveHash(w.hashKey) ?? { fields: new Map<string, string>(), expiresAt };
    h.expiresAt = expiresAt;
    this.hashes.set(w.hashKey, h);
    h.fields.set(w.field, String(w.day));
    if (w.otherField) h.fields.delete(w.otherField);
    let unsafeAccounts = 0;
    let newlyHidden = false;
    if (w.unsafe) {
      let s = this.sets.get(w.unsafeKey);
      if (!s || this.now() >= s.expiresAt) s = { members: new Set(), expiresAt };
      s.members.add(w.member);
      s.expiresAt = expiresAt;
      this.sets.set(w.unsafeKey, s);
      unsafeAccounts = s.members.size;
      if (unsafeAccounts >= w.hideAt && !h.fields.has(w.hideField)) {
        h.fields.set(w.hideField, String(w.day));
        newlyHidden = true;
      }
    }
    for (const [f, v] of [...h.fields]) {
      const d = Number(v);
      if (Number.isFinite(d) && d < w.cutoff) h.fields.delete(f);
    }
    return { counted: true, unsafeAccounts, newlyHidden };
  }

  get size() {
    return this.map.size;
  }

  clear() {
    this.map.clear();
    this.hashes.clear();
    this.sets.clear();
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

/**
 * One item report (src/lib/reports). KEYS = dedupe, report hash, not-safe set. ARGV = dedupe ttl, field,
 * unsafe (1/0), reporter id, hide threshold, hide field, today (yyyymmdd), cutoff (yyyymmdd), keep ttl, the
 * opposite-opinion field ('' = none). The field's value is today's date (one field per account per kind:
 * SEC-4-01, thresholds count distinct accounts). Returns {counted, distinct not-safe accounts, newly hidden}.
 * Every field's value is a yyyymmdd, so fields older than the cutoff (and a hide older than it, and the old
 * per-day count fields, whose small values are below any date) are deleted: a park's hash never holds more
 * than the keep window.
 */
export const REPORT_SCRIPT =
  "if not redis.call('SET', KEYS[1], '1', 'NX', 'EX', ARGV[1]) then return {0, 0, 0} end " +
  "redis.call('HSET', KEYS[2], ARGV[2], ARGV[7]) if ARGV[10] ~= '' then redis.call('HDEL', KEYS[2], ARGV[10]) end " +
  "redis.call('EXPIRE', KEYS[2], ARGV[9]) " +
  "local n = 0 local hid = 0 " +
  "if ARGV[3] == '1' then redis.call('SADD', KEYS[3], ARGV[4]) redis.call('EXPIRE', KEYS[3], ARGV[9]) n = redis.call('SCARD', KEYS[3]) " +
  "if n >= tonumber(ARGV[5]) then hid = redis.call('HSETNX', KEYS[2], ARGV[6], ARGV[7]) end end " +
  "local all = redis.call('HGETALL', KEYS[2]) local cut = tonumber(ARGV[8]) " +
  "for i = 1, #all, 2 do local d = tonumber(all[i + 1]) " +
  "if d and d < cut then redis.call('HDEL', KEYS[2], all[i]) end end " +
  "return {1, n, hid}";

/**
 * SEC-3-03/04: add N to the monthly counter (UTC month) and the daily counter (Chicago day) at once; a new
 * key gets its expiry. Returns {month total, day total}. One round trip.
 */
const FLUSH_SCRIPT =
  "local m = redis.call('INCRBY', KEYS[1], ARGV[1]) if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end " +
  "local d = redis.call('INCRBY', KEYS[2], ARGV[1]) if redis.call('TTL', KEYS[2]) < 0 then redis.call('EXPIRE', KEYS[2], ARGV[3]) end " +
  "return {m, d}";

/** Upstash free plan: 500,000 commands a month (upstash.com/pricing/redis, checked 2026-10-05). */
export const UPSTASH_FREE_MONTHLY_COMMANDS = 500_000;
/**
 * Commands are counted in process and added to the shared counters in batches of this size. SEC-3-04: 10
 * (was 50), so a recycled serverless instance loses at most 9 uncounted commands and the counters stay
 * close to the real count; the flush itself costs 1 command per 10 (FLUSH_OVERHEAD in prelimit.ts).
 */
export const BUDGET_FLUSH_EVERY = 10;
/** 90 = RESTING_PCT: Grass Pass goes read-only there (src/lib/limits/budget.ts, SEC-2-01, SEC-3-04). */
export const BUDGET_ALERT_PCTS = [50, 80, RESTING_PCT] as const;
const MONTH_KEY_TTL_SEC = 40 * 24 * 3600;
const DAY_KEY_TTL_SEC = 3 * 24 * 3600;

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
  private primed: Promise<void> | null = null;

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
   * to a shared per-month counter and (SEC-3-03) a shared per-day counter. The instance whose batch crosses
   * 50%, 80% or 90% of the month logs it once, so the PM can react before the free quota runs out, and at
   * 90% the app rests read-only instead of failing closed at 100% (src/lib/limits/budget.ts). Crossing
   * today's pace is logged once too. Never throws.
   */
  private count(): void {
    this.unflushed++;
    if (this.unflushed < BUDGET_FLUSH_EVERY || this.flushing) return;
    void this.flushBudget();
  }

  private monthKey(now: number): { month: string; key: string } {
    const month = new Date(now).toISOString().slice(0, 7);
    return { month, key: `${this.prefix}meta:commands:${month}` };
  }

  private dayKey(now: number): { day: string; key: string } {
    const day = localDay(now);
    return { day, key: `${this.prefix}meta:commands-day:${day}` };
  }

  /**
   * SEC-3-04: before this process relies on its first command, read the shared counters (1 MGET), so a
   * new instance knows at once whether Grass Pass rests or is paused for today. Once per process; a
   * failure is ignored (the next flush reports the totals anyway).
   */
  prime(): Promise<void> {
    this.primed ??= (async () => {
      const now = this.clock();
      const m = this.monthKey(now);
      const d = this.dayKey(now);
      this.unflushed++; // the read is a command too (added at the next flush)
      try {
        const r = await this.send(["MGET", m.key, d.key]);
        const [mv, dv] = Array.isArray(r) ? r : [];
        noteMonthlyCommands(Number(mv ?? 0) || 0, this.monthlyBudget, m.month);
        noteDailyCommands(Number(dv ?? 0) || 0, d.day);
      } catch {
        // best effort; the store error is already logged
      }
    })();
    return this.primed;
  }

  /** Add the unflushed command count of this process to the shared counters; returns the new monthly total. */
  async flushBudget(): Promise<number | null> {
    if (this.flushing || this.unflushed === 0) return null;
    this.flushing = true;
    const n = this.unflushed + 1; // the flush itself is a command too
    this.unflushed = 0;
    const now = this.clock();
    const m = this.monthKey(now);
    const d = this.dayKey(now);
    try {
      const r = await this.send(["EVAL", FLUSH_SCRIPT, 2, m.key, d.key, n, MONTH_KEY_TTL_SEC, DAY_KEY_TTL_SEC]);
      const [total, dayTotal] = Array.isArray(r) ? r.map(Number) : [Number.NaN, Number.NaN];
      if (!Number.isFinite(total)) return null;
      noteMonthlyCommands(total, this.monthlyBudget, m.month);
      if (Number.isFinite(dayTotal)) {
        noteDailyCommands(dayTotal, d.day);
        const pace = dailyPace(this.monthlyBudget, now);
        if (dayTotal - n < pace && dayTotal >= pace) log("upstash_daily_pace", { used: dayTotal, pace, day: d.day }, "error");
      }
      for (const pct of BUDGET_ALERT_PCTS) {
        const at = Math.ceil((this.monthlyBudget * pct) / 100);
        if (total - n < at && total >= at) {
          log("upstash_budget", { pct, used: total, budget: this.monthlyBudget, month: m.month }, pct >= 80 ? "error" : "warn");
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

  async getMany(keys: readonly string[]) {
    if (keys.length === 0) return [];
    const r = await this.command(["MGET", ...keys.map((k) => this.prefix + k)]);
    if (!Array.isArray(r) || r.length !== keys.length) throw new StoreError("The shared store returned a bad MGET answer.");
    return r.map((v) => (typeof v === "string" ? v : null));
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

  async hashGetAll(key: string) {
    const r = await this.command(["HGETALL", this.prefix + key]);
    if (r === null) return {};
    const out: Record<string, string> = {};
    if (Array.isArray(r)) {
      for (let i = 0; i + 1 < r.length; i += 2) out[String(r[i])] = String(r[i + 1]);
      return out;
    }
    if (typeof r === "object") {
      for (const [k, v] of Object.entries(r as Record<string, unknown>)) out[k] = String(v);
      return out;
    }
    throw new StoreError("The shared store returned a bad HGETALL answer.");
  }

  async recordReport(w: ReportWrite): Promise<ReportWritten> {
    const r = await this.command([
      "EVAL",
      REPORT_SCRIPT,
      3,
      this.prefix + w.dedupeKey,
      this.prefix + w.hashKey,
      this.prefix + w.unsafeKey,
      Math.max(1, Math.ceil(w.dedupeTtlSec)),
      w.field,
      w.unsafe ? 1 : 0,
      w.member,
      Math.trunc(w.hideAt),
      w.hideField,
      Math.trunc(w.day),
      Math.trunc(w.cutoff),
      Math.max(1, Math.ceil(w.ttlSec)),
      w.otherField,
    ]);
    const a = Array.isArray(r) ? r.map(Number) : [];
    if (a.length !== 3 || !a.every(Number.isFinite)) throw new StoreError("The shared store returned a bad report answer.");
    return { counted: a[0] === 1, unsafeAccounts: a[1], newlyHidden: a[2] === 1 };
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
