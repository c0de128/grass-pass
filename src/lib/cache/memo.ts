/**
 * In-process memo for a value read from the shared store on every page view (SEC-1-02): one read per
 * `ttlMs` per instance, and concurrent callers share the same promise. A failed read is not kept.
 * Kept on globalThis (pattern: next-instrumentation-singletons-on-globalthis).
 */
type Entry = { at: number; value: Promise<unknown> };
const HOLDER = Symbol.for("grass-pass.memo");

function entries(): Map<string, Entry> {
  const g = globalThis as unknown as Record<symbol, Map<string, Entry> | undefined>;
  return (g[HOLDER] ??= new Map());
}

export function memoize<T>(key: string, ttlMs: number, load: () => Promise<T>, now: number = Date.now()): Promise<T> {
  const m = entries();
  const hit = m.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load();
  m.set(key, { at: now, value });
  value.catch(() => {
    if (m.get(key)?.value === value) m.delete(key);
  });
  return value;
}

/** Tests: forget every memoized value. */
export function resetMemo(): void {
  entries().clear();
}
