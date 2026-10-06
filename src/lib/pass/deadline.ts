/**
 * One deadline per pass build (R1-M1 / Q-1-02). Every data stage (Overpass features and geometry,
 * iNaturalist species and taxa, the October box) gets the same signal, so the data steps can never
 * use the time the model needs: the whole pass answers inside PASS_DEADLINE_MS (85 s), under the
 * route's maxDuration (90 s).
 *
 * Built on setTimeout (not AbortSignal.timeout) so tests with fake timers can move it.
 */

export type Deadline = {
  /** Aborts at the deadline (reason: DeadlineError). */
  signal: AbortSignal;
  /** True once the deadline has passed. */
  readonly passed: boolean;
  /** Stop the timer (call when the build is over). */
  clear(): void;
};

export class DeadlineError extends Error {
  static [Symbol.hasInstance](x: unknown): boolean {
    return x instanceof Error && x.name === "DeadlineError";
  }
  constructor() {
    super("The pass deadline for loading data passed.");
    this.name = "DeadlineError";
  }
}

/** A signal that aborts after `ms` (immediately when ms <= 0). */
export function createDeadline(ms: number): Deadline {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (ms <= 0) ac.abort(new DeadlineError());
  else timer = setTimeout(() => ac.abort(new DeadlineError()), ms);
  return {
    signal: ac.signal,
    get passed() {
      return ac.signal.aborted;
    },
    clear() {
      clearTimeout(timer);
    },
  };
}

/** `a` and `b` together (either one aborts it). */
export function eitherSignal(a: AbortSignal, b?: AbortSignal): AbortSignal {
  return b ? AbortSignal.any([a, b]) : a;
}
