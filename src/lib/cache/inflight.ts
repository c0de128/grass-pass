/**
 * Collapse identical concurrent requests into one upstream call (per process).
 *
 * Each caller passes its own signal; the shared call is aborted only when every
 * waiting caller has gone away, unless the factory has called `pin()`. Pin right
 * before a paid call starts: aborting it would waste the spend, so it finishes and
 * later requests reuse the cached result (pattern: charge-started-paid-calls).
 *
 * Adapted from projects/_practice2/app/src/lib/result-cache.ts (same author).
 */

export class WaiterAbortedError extends Error {
  /**
   * Matched by name, not by class identity: Next bundles instrumentation.ts (the S8b example warm-up)
   * separately from pages and routes, and the globalThis singletons (queues, stores, in-flight builds)
   * throw the class of whichever bundle created them first.
   */
  static [Symbol.hasInstance](x: unknown): boolean {
    return x instanceof Error && x.name === "WaiterAbortedError";
  }

  constructor() {
    super("The client went away.");
    this.name = "WaiterAbortedError";
  }
}

type Entry<V, S> = {
  promise: Promise<V>;
  controller: AbortController;
  waiters: number;
  pinned: boolean;
  step?: S;
  listeners: Set<(step: S) => void>;
};

export type Inflight<V, S = string> = ReturnType<typeof createInflight<V, S>>;

export function createInflight<V, S = string>() {
  const entries = new Map<string, Entry<V, S>>();

  function wait(key: string, entry: Entry<V, S>, signal: AbortSignal | undefined, onStep?: (s: S) => void) {
    entry.waiters++;
    if (onStep) {
      entry.listeners.add(onStep);
      if (entry.step !== undefined) onStep(entry.step);
    }
    return new Promise<V>((resolve, reject) => {
      let done = false;
      const leave = () => {
        if (onStep) entry.listeners.delete(onStep);
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        if (done) return;
        done = true;
        leave();
        entry.waiters--;
        if (entry.waiters <= 0 && !entry.pinned && entries.get(key) === entry) {
          entries.delete(key);
          entry.controller.abort();
        }
        reject(new WaiterAbortedError());
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      entry.promise.then(
        (v) => {
          if (done) return;
          done = true;
          leave();
          resolve(v);
        },
        (e) => {
          if (done) return;
          done = true;
          leave();
          reject(e);
        },
      );
    });
  }

  return {
    has(key: string): boolean {
      return entries.has(key);
    },
    /** Join the running call for `key`, or start it with `factory` when none is running. */
    run(
      key: string,
      factory: (signal: AbortSignal, emit: (s: S) => void, pin: () => void) => Promise<V>,
      signal?: AbortSignal,
      onStep?: (s: S) => void,
    ): Promise<V> {
      const existing = entries.get(key);
      if (existing) return wait(key, existing, signal, onStep);
      const controller = new AbortController();
      const entry: Entry<V, S> = {
        promise: undefined as unknown as Promise<V>,
        controller,
        waiters: 0,
        pinned: false,
        listeners: new Set(),
      };
      const emit = (s: S) => {
        entry.step = s;
        for (const l of entry.listeners) l(s);
      };
      entry.promise = Promise.resolve()
        .then(() =>
          factory(controller.signal, emit, () => {
            entry.pinned = true;
          }),
        )
        .finally(() => {
          if (entries.get(key) === entry) entries.delete(key);
        });
      entry.promise.catch(() => undefined); // waiters handle errors; avoid unhandled rejections
      entries.set(key, entry);
      return wait(key, entry, signal, onStep);
    },
    get size() {
      return entries.size;
    },
    clear() {
      for (const e of entries.values()) e.controller.abort();
      entries.clear();
    },
  };
}
