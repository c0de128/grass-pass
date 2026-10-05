/**
 * Typed TTL cache on top of a Store. Every entry carries `storedAt` so the UI
 * can always say when a result was generated or fetched (RULES-2-01).
 * Values are validated with zod on read: a bad or old-shaped entry is a miss, never a crash.
 * A cache read that fails (store down) is a miss and is logged; a write that fails is logged and ignored.
 */
import "@/lib/zod-config";
import { z } from "zod";
import { log } from "@/lib/log";
import { getStore, type Store } from "./store";

export type CacheHit<V> = { value: V; storedAt: number; ageSec: number };

export type JsonCache<V> = {
  readonly name: string;
  get(key: string, now?: number): Promise<CacheHit<V> | null>;
  set(key: string, value: V, opts?: { ttlSec?: number; now?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

const MAX_KEY_LENGTH = 200;

/**
 * Turn user-ish input into a stable cache key: trim, lower-case, collapse spaces, cap the length.
 * Long keys are cut and suffixed with a short hash so different long inputs never collide.
 */
export function normalizeKey(raw: string): string {
  const k = raw.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  if (k.length <= MAX_KEY_LENGTH) return k;
  let h = 2166136261;
  for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619) >>> 0;
  return `${k.slice(0, MAX_KEY_LENGTH - 9)}#${h.toString(16).padStart(8, "0")}`;
}

export function createJsonCache<V>(opts: {
  /** Namespace, e.g. "parks" or "parks-neg". Also the memory-store bucket. */
  name: string;
  schema: z.ZodType<V>;
  ttlSec: number;
  maxEntries?: number;
  store?: Store;
}): JsonCache<V> {
  const envelope = z.object({ v: opts.schema, at: z.number() });
  const store = () => opts.store ?? getStore(`cache:${opts.name}`, { maxEntries: opts.maxEntries });
  const fullKey = (key: string) => `c:${opts.name}:${key}`;

  return {
    name: opts.name,
    async get(key, now = Date.now()) {
      let raw: string | null;
      try {
        raw = await store().get(fullKey(key));
      } catch {
        log("cache_read_failed", { cache: opts.name }, "warn");
        return null;
      }
      if (raw === null) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return null;
      }
      const r = envelope.safeParse(parsed);
      if (!r.success) {
        log("cache_entry_invalid", { cache: opts.name }, "warn");
        return null;
      }
      return { value: r.data.v as V, storedAt: r.data.at, ageSec: Math.max(0, Math.floor((now - r.data.at) / 1000)) };
    },
    async set(key, value, o = {}) {
      try {
        await store().set(fullKey(key), JSON.stringify({ v: value, at: o.now ?? Date.now() }), o.ttlSec ?? opts.ttlSec);
      } catch {
        log("cache_write_failed", { cache: opts.name }, "warn");
      }
    },
    async delete(key) {
      try {
        await store().del(fullKey(key));
      } catch {
        log("cache_delete_failed", { cache: opts.name }, "warn");
      }
    },
  };
}

/** Default TTL for negative results (404 / empty / upstream error), SPEC §7: 15 minutes, separate store. */
export const NEGATIVE_TTL_SEC = 15 * 60;

/**
 * A positive cache plus a separate, smaller negative cache, so junk lookups
 * can't evict good results (starter kit).
 */
export function createCachePair<V, N>(opts: {
  name: string;
  schema: z.ZodType<V>;
  negativeSchema: z.ZodType<N>;
  ttlSec: number;
  negativeTtlSec?: number;
  maxEntries?: number;
  negativeMaxEntries?: number;
}) {
  return {
    positive: createJsonCache<V>({ name: opts.name, schema: opts.schema, ttlSec: opts.ttlSec, maxEntries: opts.maxEntries }),
    negative: createJsonCache<N>({
      name: `${opts.name}-neg`,
      schema: opts.negativeSchema,
      ttlSec: opts.negativeTtlSec ?? NEGATIVE_TTL_SEC,
      maxEntries: opts.negativeMaxEntries ?? 500,
    }),
  };
}
