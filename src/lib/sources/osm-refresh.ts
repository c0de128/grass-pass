/**
 * Background refresh of saved/cached OpenStreetMap answers (R1-B1): when a pass is built from a saved
 * or older cached answer, one low-priority live query is queued, at most once per REFRESH_LOCK_SEC per
 * park and kind across instances (an atomic store counter). Refreshes run ONE AT A TIME per process
 * (they never compete with each other for Overpass slots), each with a short budget. If nothing was
 * sent (our slots were busy, or every Overpass breaker was open) the lock is given back so a later
 * visit can try again. A failure only means the saved answer (with its real fetch time) keeps being
 * used. State lives on globalThis so the home page's after() (prewarmIdle) and tests can wait for it.
 */
import "server-only";
import type { Store } from "@/lib/cache/store";
import { log } from "@/lib/log";

/** At most one live refresh per park and kind in this window. */
export const REFRESH_LOCK_SEC = 6 * 3600;
/** A cached answer older than this gets a background refresh (park maps change slowly). */
export const REFRESH_AFTER_SEC = 3 * 24 * 3600;
/** Total Overpass budget of one background refresh (shorter than a visitor's 50 s). */
export const REFRESH_BUDGET_MS = 25_000;

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

/** Start `run` in the background unless switched off or another instance refreshed this recently. Never throws. */
export function refreshLater(what: { kind: "features" | "geometry"; parkId: string }, run: () => Promise<void>, deps: { store: Store; env: Env }): void {
  if (!backgroundRefreshEnabled(deps.env)) return;
  const h = holder();
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
}

/** Wait for every background refresh started so far. */
export async function osmRefreshIdle(): Promise<void> {
  const h = holder();
  while (h.running.size > 0) await Promise.allSettled([...h.running]);
}
