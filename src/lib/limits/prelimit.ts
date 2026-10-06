/**
 * In-process pre-limiter (SEC-1-02): a token bucket per client key, in memory, in front of every page
 * and route that touches the shared store (src/proxy.ts). Over the limit it answers 429 without any
 * Upstash command, so a curl loop can't spend the store's free monthly command quota.
 *
 * Per instance, not shared: it only bounds bursts. The shared per-IP limits behind it still apply.
 * Defaults: a burst of 40 requests, then 4 per second (PRELIMIT_BURST, PRELIMIT_PER_SEC).
 */
type Bucket = { tokens: number; at: number };
type Holder = { buckets: Map<string, Bucket> };
const HOLDER = Symbol.for("grass-pass.prelimit");
export const PRELIMIT_MAX_KEYS = 20_000;

function buckets(): Map<string, Bucket> {
  const g = globalThis as unknown as Record<symbol, Holder | undefined>;
  return (g[HOLDER] ??= { buckets: new Map() }).buckets;
}

export type PreLimitResult = { ok: true } | { ok: false; retryAfter: number };

export function preLimit(key: string, now: number, cfg: { preLimitBurst: number; preLimitPerSec: number }): PreLimitResult {
  const m = buckets();
  const prev = m.get(key);
  const refill = prev ? ((now - prev.at) / 1000) * cfg.preLimitPerSec : cfg.preLimitBurst;
  const tokens = Math.min(cfg.preLimitBurst, (prev?.tokens ?? 0) + Math.max(0, refill));
  m.delete(key); // re-insert: the Map's order is then least recently seen first
  if (tokens >= 1) {
    m.set(key, { tokens: tokens - 1, at: now });
    while (m.size > PRELIMIT_MAX_KEYS) {
      const oldest = m.keys().next().value;
      if (oldest === undefined) break;
      m.delete(oldest);
    }
    return { ok: true };
  }
  m.set(key, { tokens, at: now });
  return { ok: false, retryAfter: Math.max(1, Math.ceil((1 - tokens) / cfg.preLimitPerSec)) };
}

/** Tests: forget every bucket. */
export function resetPreLimit(): void {
  buckets().clear();
}
