/**
 * SEC-2-01: what happens near the end of the shared store's monthly command budget.
 *
 * The Upstash store adds its command count to a shared per-month counter every 50 commands and reports
 * the new total here (`noteMonthlyCommands`, called from src/lib/cache/store.ts). Once the total reaches
 * RESTING_PCT of UPSTASH_MONTHLY_COMMANDS, Grass Pass "rests" until the counter's month ends (UTC):
 * - saved passes and the example passes still open (read-only; reads are memoized);
 * - new passes, park searches and example refreshes answer 503 RESTING with an honest
 *   "Grass Pass is resting until <date>" message, before any store command;
 * - the home page shows the same notice.
 * Without this, the store fails closed at 100% and every page, saved pass included, breaks.
 * In process: each instance learns the total at its next flush (at most 50 commands later).
 */
import type { ApiError } from "@/lib/http/respond";

export const RESTING_PCT = 95;

type State = { month: string; used: number; budget: number };
const HOLDER = Symbol.for("grass-pass.store-budget");

function holder(): { state: State | null } {
  const g = globalThis as unknown as Record<symbol, { state: State | null } | undefined>;
  return (g[HOLDER] ??= { state: null });
}

/** The shared monthly counter (`YYYY-MM`, UTC) now holds `used` of `budget` commands. */
export function noteMonthlyCommands(used: number, budget: number, month: string): void {
  if (!Number.isFinite(used) || !Number.isFinite(budget) || budget <= 0 || !/^\d{4}-\d{2}$/.test(month)) return;
  const prev = holder().state;
  // Several flushes can finish out of order: keep the highest total of the newest month.
  if (prev && prev.month === month && prev.used > used) return;
  if (prev && prev.month > month) return;
  holder().state = { month, used, budget };
}

export type Resting = { resting: false } | { resting: true; untilIso: string; untilText: string; used: number; budget: number };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function restingState(now: number = Date.now()): Resting {
  const s = holder().state;
  if (!s) return { resting: false };
  const month = new Date(now).toISOString().slice(0, 7);
  if (s.month !== month) return { resting: false }; // a new month: the counter started over
  if (s.used < Math.ceil((s.budget * RESTING_PCT) / 100)) return { resting: false };
  const [y, m] = month.split("-").map(Number);
  const until = new Date(Date.UTC(y, m, 1)); // the 1st of next month, 00:00 UTC
  return { resting: true, untilIso: until.toISOString(), untilText: `${MONTHS[until.getUTCMonth()]} ${until.getUTCDate()}`, used: s.used, budget: s.budget };
}

/** One sentence for the notice and the 503 answers. */
export function restingMessage(r: Extract<Resting, { resting: true }>): string {
  return (
    `Grass Pass is resting until ${r.untilText}. It has used this month's free allowance on the service that keeps its ` +
    "limits and saved passes, so it can't make new passes or search for parks until then. Saved passes and the example passes still open."
  );
}

/** The 503 error body while resting, or null. */
export function restingError(now: number = Date.now()): ApiError | null {
  const r = restingState(now);
  if (!r.resting) return null;
  return { code: "RESTING", message: restingMessage(r), retryAfter: Math.max(60, Math.ceil((Date.parse(r.untilIso) - now) / 1000)) };
}

/** Tests: forget the last seen total. */
export function resetBudget(): void {
  holder().state = null;
}
