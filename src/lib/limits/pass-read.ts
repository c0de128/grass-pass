/**
 * SEC-2-01: cheap guards in front of the pass cache, so a saved-pass page costs as few shared-store
 * (Upstash) commands as possible.
 *
 * 1. `plausiblePassId` turns away ids that can't exist BEFORE any store read: a park id of the wrong
 *    shape, a day that is in the future or older than the 30-day pass TTL, or a variant above the
 *    3 a day a park/age band can have. A random id then costs 0 commands.
 * 2. `memoPassRead` keeps what a read found, in process, keyed by pass id: a normal pass for
 *    HIT_TTL_MS (it is never rewritten under the same id; "Make a different pass" gets a new variant
 *    id), a degraded pass (one that may be rebuilt under the same id) and a miss only briefly.
 *    Reloads, the print page, crawlers and the home page's example checks then cost nothing.
 *    `forgetPassRead` drops an id the moment this process saves a new pass under it.
 *
 * The memo is a saving, not a limit: src/proxy.ts charges every plausible id (Next 16 proxy must not rely on
 * globals shared with render code). No zod or pass schema import, so the proxy bundle stays small. tests/unit/limits-r2.test.ts checks
 * that the constants agree with PASS_ID_PATTERN, MAX_VARIANTS and PASS_TTL_SEC.
 */
import { localDay } from "@/lib/time";

/** Same as PASS_ID_PATTERN in src/lib/pass/schema.ts, with the parts captured. */
const ID_RE = /^([nwr])([1-9]\d{0,14})-(4to6|6to10|10to13)-(\d{4})(\d{2})(\d{2})-([1-9])$/;
/** MAX_VARIANTS (src/lib/pass/schema.ts). */
export const PASS_MAX_VARIANT = 3;
/** PASS_TTL_SEC (src/lib/pass/make.ts) in days. */
export const PASS_TTL_DAYS = 30;
/**
 * Largest OpenStreetMap id we accept per type. Real ids (Oct 2026) are about 1.3e10 (nodes), 1.5e9 (ways)
 * and 2e7 (relations); the limits leave years of headroom and still cut the guessable space.
 */
export const MAX_OSM_ID = { n: 1e11, w: 1e10, r: 1e8 } as const;

const DAY_MS = 24 * 3600 * 1000;

/**
 * True when `id` could be a saved pass at `now`: the right shape, a real calendar day between
 * PASS_TTL_DAYS (+1 for time zones) ago and tomorrow, and a variant of 1..PASS_MAX_VARIANT.
 */
export function plausiblePassId(id: string, now: number): boolean {
  const m = ID_RE.exec(id);
  if (!m) return false;
  const [, type, num, , y, mo, d, variant] = m;
  const osmId = Number(num);
  if (!Number.isSafeInteger(osmId) || osmId >= MAX_OSM_ID[type as keyof typeof MAX_OSM_ID]) return false;
  if (Number(variant) > PASS_MAX_VARIANT) return false;
  const day = `${y}-${mo}-${d}`;
  const t = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  // A real calendar date (rejects 20261332 and 20260231).
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== day) return false;
  // Pass days are Chicago days: compare as calendar strings against Chicago "today" +-.
  const newest = localDay(now + DAY_MS);
  const oldest = localDay(now - (PASS_TTL_DAYS + 1) * DAY_MS);
  return day >= oldest && day <= newest;
}

/** A normal (not degraded) pass is never rewritten under the same id. */
export const HIT_TTL_MS = 30 * 60 * 1000;
/** A degraded pass may be replaced by a better one under the same id (R1-m2), and a miss may be made soon. */
export const SHORT_TTL_MS = 15 * 1000;
export const PASS_READ_MAX = 500;

type Entry = { at: number; ttl: number; value: Promise<unknown>; done: boolean };
const HOLDER = Symbol.for("grass-pass.pass-reads");

/** On globalThis, so the pass page, the print page and the home page example checks share it. */
function entries(): Map<string, Entry> {
  const g = globalThis as unknown as Record<symbol, Map<string, Entry> | undefined>;
  return (g[HOLDER] ??= new Map());
}

/**
 * Read a pass through the in-process memo. Concurrent readers of one id share one store read; a
 * failed read (store down) is not kept. `stable(value)` says whether a found pass can be kept for
 * HIT_TTL_MS (false: SHORT_TTL_MS, like a miss).
 */
export function memoPassRead<T>(id: string, now: number, load: () => Promise<T | null>, stable: (value: T) => boolean): Promise<T | null> {
  const m = entries();
  const hit = m.get(id);
  if (hit && (!hit.done || now - hit.at < hit.ttl)) {
    m.delete(id);
    m.set(id, hit); // most recently used last
    return hit.value as Promise<T | null>;
  }
  const value = load();
  const entry: Entry = { at: now, ttl: SHORT_TTL_MS, value, done: false };
  m.delete(id);
  m.set(id, entry);
  while (m.size > PASS_READ_MAX) {
    const oldest = m.keys().next().value;
    if (oldest === undefined) break;
    m.delete(oldest);
  }
  value.then(
    (v) => {
      entry.done = true;
      entry.ttl = v !== null && stable(v) ? HIT_TTL_MS : SHORT_TTL_MS;
    },
    () => {
      if (m.get(id) === entry) m.delete(id);
    },
  );
  return value;
}

/** Drop an id (this process just saved a pass under it). */
export function forgetPassRead(id: string): void {
  entries().delete(id);
}

/** Tests: forget every memoized read. */
export function resetPassReads(): void {
  entries().clear();
}
