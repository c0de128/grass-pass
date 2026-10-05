/**
 * Circuit breaker for a shared upstream quota (SerpApi, Overpass, Nominatim, iNaturalist, the model):
 * once the upstream says "rate limited" (or keeps failing), stop calling it until its reset time.
 * State lives in the Store so every serverless instance sees it.
 */
import type { Store } from "@/lib/cache/store";

export const DEFAULT_OPEN_SEC = 60;

const key = (name: string) => `br:${name}`;

/** Open the breaker for `retryAfterSec` (default 60 s). Never shortens an already longer opening. */
export async function tripBreaker(store: Store, name: string, now: number, retryAfterSec?: number): Promise<void> {
  const sec = retryAfterSec && retryAfterSec > 0 ? Math.ceil(retryAfterSec) : DEFAULT_OPEN_SEC;
  const until = now + sec * 1000;
  const current = Number(await store.get(key(name))) || 0;
  if (current >= until) return;
  await store.set(key(name), String(until), sec);
}

/** Seconds until calls are allowed again; 0 when closed. */
export async function breakerRetryAfter(store: Store, name: string, now: number): Promise<number> {
  const until = Number(await store.get(key(name))) || 0;
  const left = until - now;
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

export async function resetBreaker(store: Store, name: string): Promise<void> {
  await store.del(key(name));
}
