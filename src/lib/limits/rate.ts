/**
 * Per-key rate limit (e.g. 3 passes per minute per IP) on a shared Store.
 * Sliding-window estimate from two fixed buckets (current + previous, weighted),
 * so a client can't fire 2x the limit across a bucket boundary.
 * Rejected hits are not counted. A store failure throws StoreError (callers answer 503).
 */
import type { Store } from "@/lib/cache/store";

export type LimitResult = { ok: true } | { ok: false; retryAfter: number };

export async function hitRateLimit(
  store: Store,
  opts: { name: string; key: string; limit: number; windowSec: number; now: number },
): Promise<LimitResult> {
  const windowMs = opts.windowSec * 1000;
  const bucket = Math.floor(opts.now / windowMs);
  const base = `rl:${opts.name}:${opts.key}:`;
  const ttl = opts.windowSec * 2 + 1;

  const current = await store.incr(base + bucket, 1, ttl);
  const prevRaw = await store.get(base + (bucket - 1));
  const previous = Number(prevRaw) || 0;
  const elapsed = (opts.now - bucket * windowMs) / windowMs; // 0..1 into the current bucket
  const estimate = previous * (1 - elapsed) + current;
  if (estimate <= opts.limit) return { ok: true };

  await store.incr(base + bucket, -1, ttl);
  const kept = current - 1;
  const untilBucketEnd = Math.ceil(((bucket + 1) * windowMs - opts.now) / 1000);
  let retryAfter = untilBucketEnd;
  if (kept + 1 <= opts.limit && previous > 0) {
    // Allowed again once the previous bucket's weight has decayed enough.
    const neededElapsed = 1 - (opts.limit - kept - 1) / previous;
    retryAfter = Math.ceil((neededElapsed - elapsed) * opts.windowSec);
  }
  return { ok: false, retryAfter: Math.max(1, Math.min(retryAfter, opts.windowSec)) };
}
