/**
 * Politeness controls for free public APIs (ADR 0002):
 * - `createSemaphore(2)`: at most N concurrent calls per process (Overpass: max 2).
 * - `createSpacedQueue(1000)`: one call at a time, at least N ms apart, per process (Nominatim: 1 req/s).
 * - `takeSecondSlot`: a cross-instance per-second budget on the shared Store, so several
 *   serverless instances together still stay at or under the limit.
 */
import type { Store } from "@/lib/cache/store";

export class QueueAbortedError extends Error {
  constructor() {
    super("Gave up waiting for a free slot.");
    this.name = "QueueAbortedError";
  }
}

export function createSemaphore(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];

  async function acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new QueueAbortedError();
    if (active < max) {
      active++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const go = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        const i = waiting.indexOf(go);
        if (i >= 0) waiting.splice(i, 1);
        reject(new QueueAbortedError());
      };
      waiting.push(go);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    active++;
  }

  function release() {
    active--;
    const next = waiting.shift();
    if (next) next();
  }

  return {
    async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      await acquire(signal);
      try {
        return await fn();
      } finally {
        release();
      }
    },
    get active() {
      return active;
    },
    get waiting() {
      return waiting.length;
    },
  };
}

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Serial queue: one call at a time, starts spaced at least `minIntervalMs` apart. */
export function createSpacedQueue(minIntervalMs: number, deps: { now?: () => number; sleep?: Sleep } = {}) {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? realSleep;
  let tail: Promise<unknown> = Promise.resolve();
  let lastStart = -Infinity;

  return {
    run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      const job = tail.then(async () => {
        if (signal?.aborted) throw new QueueAbortedError();
        const wait = lastStart + minIntervalMs - now();
        if (wait > 0) await sleep(wait);
        if (signal?.aborted) throw new QueueAbortedError();
        lastStart = now();
        return fn();
      });
      tail = job.catch(() => undefined);
      return job;
    },
  };
}

/**
 * Take one of `perSecond` slots for the current second across all instances.
 * Waits for the next second when the current one is full, up to `maxWaitMs`.
 * Returns false when no slot was found in time (callers show the "busy" copy).
 */
export async function takeSecondSlot(
  store: Store,
  opts: { name: string; perSecond: number; maxWaitMs: number; now?: () => number; sleep?: Sleep },
): Promise<boolean> {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? realSleep;
  const giveUpAt = now() + opts.maxWaitMs;
  for (;;) {
    const t = now();
    const second = Math.floor(t / 1000);
    const n = await store.incr(`sec:${opts.name}:${second}`, 1, 2);
    if (n <= opts.perSecond) return true;
    const nextSecond = (second + 1) * 1000;
    if (nextSecond > giveUpAt) return false;
    await sleep(nextSecond - t);
  }
}
