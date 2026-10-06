/**
 * Background refresh of saved/cached OpenStreetMap answers (R1-B1): when a pass is built from a saved
 * or older cached answer, one low-priority live query is queued, at most once per REFRESH_LOCK_SEC per
 * park and kind across instances (an atomic store counter). Refreshes run ONE AT A TIME per process
 * (they never compete with each other for Overpass slots), each with a short budget. If nothing was
 * sent (our slots were busy, or every Overpass breaker was open) the lock is given back so a later
 * visit can try again. A failure only means the saved answer (with its real fetch time) keeps being
 * used. State lives on globalThis so the home page's after() (prewarmIdle) and tests can wait for it.
 *
 * SEC-3-06: a request waits (in after()) only for the refreshes IT queued (`withRefreshScope`), not for
 * the whole process queue, and the queue holds at most MAX_PENDING_REFRESHES: past that a refresh is
 * dropped before it takes its lock (the lock is only taken when a refresh gets its turn), so a later
 * visit can queue it again.
 */
import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Store } from "@/lib/cache/store";
import { log } from "@/lib/log";

/** At most one live refresh per park and kind in this window. */
export const REFRESH_LOCK_SEC = 6 * 3600;
/** A cached answer older than this gets a background refresh (park maps change slowly). */
export const REFRESH_AFTER_SEC = 3 * 24 * 3600;
/** Total Overpass budget of one background refresh (shorter than a visitor's 50 s). */
export const REFRESH_BUDGET_MS = 25_000;
/** SEC-3-06: refreshes waiting or running in one process at most; more are dropped (not locked). */
export const MAX_PENDING_REFRESHES = 20;

type Scope = { queued: Set<Promise<void>> };
const SCOPE_KEY = Symbol.for("grass-pass.osm-refresh-scope");
function scopeStorage(): AsyncLocalStorage<Scope> {
  const g = globalThis as unknown as Record<symbol, AsyncLocalStorage<Scope> | undefined>;
  return (g[SCOPE_KEY] ??= new AsyncLocalStorage<Scope>());
}

/**
 * Run `fn` in a refresh scope: every refresh it queues (directly or deep inside) is remembered, and
 * `idle()` waits for exactly those (SEC-3-06: a request's after() keeps its function alive for its own
 * refreshes only).
 */
export function withRefreshScope<T>(fn: () => T): { result: T; idle: () => Promise<void> } {
  const scope: Scope = { queued: new Set() };
  const result = scopeStorage().run(scope, fn);
  return {
    result,
    idle: async () => {
      while (scope.queued.size > 0) {
        const now = [...scope.queued];
        await Promise.allSettled(now);
        for (const p of now) scope.queued.delete(p);
      }
    },
  };
}

type Env = Record<string, string | undefined>;
type Holder = { running: Set<Promise<void>>; chain: Promise<void> };
const HOLDER = Symbol.for("grass-pass.osm-refresh");
function holder(): Holder {
  const g = globalThis as unknown as Record<symbol, Holder | undefined>;
  return (g[HOLDER] ??= { running: new Set(), chain: Promise.resolve() });
}

const TEST_OFF = Symbol.for("grass-pass.osm-refresh-off");

/** Tests: switch background refreshes off/on for the whole process (unit tests start with them off). */
export function setBackgroundRefreshForTests(on: boolean): void {
  (globalThis as unknown as Record<symbol, boolean | undefined>)[TEST_OFF] = !on;
}

/** OSM_BACKGROUND_REFRESH=0 (or off/false/no) switches background refreshes off. */
export function backgroundRefreshEnabled(env: Env): boolean {
  if ((globalThis as unknown as Record<symbol, boolean | undefined>)[TEST_OFF]) return false;
  const v = env.OSM_BACKGROUND_REFRESH?.trim().toLowerCase();
  return !(v === "0" || v === "off" || v === "false" || v === "no");
}

/**
 * Start `run` in the background unless switched off, the queue is full (SEC-3-06), or another instance
 * refreshed this recently. Returns the queued work (null when nothing was queued). Never throws.
 */
export function refreshLater(
  what: { kind: "features" | "geometry"; parkId: string },
  run: () => Promise<void>,
  deps: { store: Store; env: Env },
): Promise<void> | null {
  if (!backgroundRefreshEnabled(deps.env)) return null;
  const h = holder();
  if (h.running.size >= MAX_PENDING_REFRESHES) {
    log("osm_refresh_dropped", { ...what, pending: h.running.size }, "warn");
    return null;
  }
  const lockKey = `osm-refresh:${what.kind}:${what.parkId}`;
  const p = (async () => {
    const n = await deps.store.incr(lockKey, 1, REFRESH_LOCK_SEC);
    if (n !== 1) return;
    try {
      await run();
      log("osm_refresh_ok", what);
    } catch (err) {
      const e = err as { name?: string; code?: string; started?: boolean };
      log("osm_refresh_failed", { ...what, error: e?.name ?? "unknown", code: e?.code }, "warn");
      // Nothing reached Overpass: give the slot back so a later visit can try.
      if (e?.started === false) await deps.store.del(lockKey).catch(() => undefined);
    }
  });
  // One refresh at a time per process.
  const queued = h.chain.then(p).catch(() => undefined);
  h.chain = queued;
  const tracked = queued.finally(() => h.running.delete(tracked));
  h.running.add(tracked);
  scopeStorage().getStore()?.queued.add(tracked);
  return tracked;
}

/** Wait for every background refresh started so far (tests, the example warm-up). */
export async function osmRefreshIdle(): Promise<void> {
  const h = holder();
  while (h.running.size > 0) await Promise.allSettled([...h.running]);
}
