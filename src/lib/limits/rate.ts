/**
 * Per-key rate limit (e.g. 3 passes per minute per IP) on a shared Store.
 * Sliding-window estimate from two fixed buckets (current + previous, weighted),
 * so a client can't fire 2x the limit across a bucket boundary.
 * Rejected hits are not counted. A store failure throws StoreError (callers answer 503).
 *
 * Store cost (SEC-1-02): one command per allowed hit (`rateHit`, a single EVAL), and a refusal is
 * remembered in this process until its Retry-After, so a client hammering after a 429 costs no
 * store command at all until it may try again.
 */
import type { Store } from "@/lib/cache/store";

export type LimitResult = { ok: true } | { ok: false; retryAfter: number };

/** In-process memo of refusals, per store: `name|key` -> allowed again at (ms). */
const REFUSED = Symbol.for("grass-pass.rate-refused");
const MAX_REFUSED = 20_000;
type Refused = WeakMap<Store, Map<string, number>>;

function refusalMap(store: Store): Map<string, number> {
  const g = globalThis as unknown as Record<symbol, Refused | undefined>;
  const all = (g[REFUSED] ??= new WeakMap());
  let m = all.get(store);
  if (!m) {
    m = new Map();
    all.set(store, m);
  }
  return m;
}

/** Remember a refusal until `untilMs` (bounded; the oldest entries go first). */
export function rememberRefusal(store: Store, id: string, untilMs: number): void {
  const m = refusalMap(store);
  m.delete(id);
  m.set(id, untilMs);
  while (m.size > MAX_REFUSED) {
    const oldest = m.keys().next().value;
    if (oldest === undefined) break;
    m.delete(oldest);
  }
}

/** Seconds left on a remembered refusal, or 0. */
export function refusalWait(store: Store, id: string, now: number): number {
  const m = refusalMap(store);
  const until = m.get(id);
  if (until === undefined) return 0;
  if (until <= now) {
    m.delete(id);
    return 0;
  }
  return Math.max(1, Math.ceil((until - now) / 1000));
}

export async function hitRateLimit(
  store: Store,
  opts: { name: string; key: string; limit: number; windowSec: number; now: number },
): Promise<LimitResult> {
  const memoId = `rl|${opts.name}|${opts.key}`;
  const waiting = refusalWait(store, memoId, opts.now);
  if (waiting > 0) return { ok: false, retryAfter: waiting };

  const windowMs = opts.windowSec * 1000;
  const bucket = Math.floor(opts.now / windowMs);
  // One hash tag per window pair, so the single-EVAL check stays valid even on a clustered store.
  const base = `rl:{${opts.name}:${opts.key}}:`;
  const ttl = opts.windowSec * 2 + 1;
  const elapsed = (opts.now - bucket * windowMs) / windowMs; // 0..1 into the current bucket

  let kept: number;
  let previous: number;
  if (store.rateHit) {
    const r = await store.rateHit(base + bucket, base + (bucket - 1), elapsed, opts.limit, ttl);
    if (r.allowed) return { ok: true };
    kept = r.current;
    previous = r.previous;
  } else {
    const current = await store.incr(base + bucket, 1, ttl);
    previous = Number(await store.get(base + (bucket - 1))) || 0;
    if (previous * (1 - elapsed) + current <= opts.limit) return { ok: true };
    await store.incr(base + bucket, -1, ttl);
    kept = current - 1;
  }

  const untilBucketEnd = Math.ceil(((bucket + 1) * windowMs - opts.now) / 1000);
  let retryAfter = untilBucketEnd;
  if (kept + 1 <= opts.limit && previous > 0) {
    // Allowed again once the previous bucket's weight has decayed enough.
    const neededElapsed = 1 - (opts.limit - kept - 1) / previous;
    retryAfter = Math.ceil((neededElapsed - elapsed) * opts.windowSec);
  }
  retryAfter = Math.max(1, Math.min(retryAfter, opts.windowSec));
  rememberRefusal(store, memoId, opts.now + retryAfter * 1000);
  return { ok: false, retryAfter };
}
