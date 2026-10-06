/**
 * SEC-2-01: what happens near the end of the shared store's monthly command budget.
 *
 * The Upstash store adds its command count to a shared per-month counter (and, SEC-3-03, a per-day one)
 * every BUDGET_FLUSH_EVERY commands and reports the new totals here (`noteMonthlyCommands`,
 * `noteDailyCommands`, called from src/lib/cache/store.ts). A new instance reads both counters before its
 * first command is counted (`UpstashStore.prime`, SEC-3-04), so it never starts blind.
 *
 * Resting: once the monthly total reaches RESTING_PCT of UPSTASH_MONTHLY_COMMANDS, Grass Pass "rests"
 * until the counter's month ends (UTC):
 * - saved passes and the example passes still open (read-only; reads are memoized);
 * - new passes, park searches and example refreshes answer 503 RESTING with an honest
 *   "Grass Pass is resting until <date>" message, before any store command;
 * - the home page shows the same notice.
 * Without this, the store fails closed at 100% and every page, saved pass included, breaks.
 * SEC-3-04: RESTING_PCT is 90 (was 95) until the app's counter has been compared with the Upstash
 * console once after the deploy (README "Limits"): the counter can run a little behind the real count.
 *
 * Daily pace (SEC-3-03): many addresses, each inside its own per-IP limits, could still use the whole
 * month in a few days. So each Chicago day may use at most DAILY_PACE_PCT of the monthly budget divided
 * by the days in the month (about 14,500 commands a day in October with the free 500,000). Past that,
 * new visitor passes and uncached park searches answer the existing "paused for today" DAILY_LIMIT copy
 * until Chicago midnight; saved passes, the example passes and cached searches keep working.
 */
import type { ApiError } from "@/lib/http/respond";
import { localDay, secondsUntilLocalMidnight } from "@/lib/time";

export const RESTING_PCT = 90;
/** Share of the monthly budget spread evenly over the days of the month (SEC-3-03). */
export const DAILY_PACE_PCT = 90;

type State = { month: string; used: number; budget: number };
type DayState = { day: string; used: number };
type Holder = { state: State | null; day: DayState | null };
const HOLDER = Symbol.for("grass-pass.store-budget");

function holder(): Holder {
  const g = globalThis as unknown as Record<symbol, Holder | undefined>;
  const h = (g[HOLDER] ??= { state: null, day: null });
  if (h.day === undefined) h.day = null; // an older holder from a hot reload
  return h;
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

/** The shared daily counter (`YYYY-MM-DD`, Chicago day) now holds `used` commands (SEC-3-03). */
export function noteDailyCommands(used: number, day: string): void {
  if (!Number.isFinite(used) || used < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  const prev = holder().day;
  if (prev && prev.day === day && prev.used > used) return;
  if (prev && prev.day > day) return;
  holder().day = { day, used };
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

/** Days in the UTC month of `now` (the monthly counter's month). */
export function daysInMonth(now: number): number {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/** Commands one Chicago day may use: budget x DAILY_PACE_PCT% / days in the month (SEC-3-03). */
export function dailyPace(budget: number, now: number): number {
  return Math.floor((budget * DAILY_PACE_PCT) / 100 / daysInMonth(now));
}

export type Paced = { paced: false } | { paced: true; used: number; pace: number; retryAfter: number };

/**
 * Has today's share of the month been used (SEC-3-03)? Only known once this process has seen the shared
 * counters (Upstash); with the in-memory store (local dev, tests) there is no pace.
 */
export function dailyPaceState(now: number = Date.now()): Paced {
  const h = holder();
  if (!h.state || !h.day) return { paced: false };
  if (h.day.day !== localDay(now)) return { paced: false }; // a new Chicago day started over
  const pace = dailyPace(h.state.budget, now);
  if (h.day.used < pace) return { paced: false };
  return { paced: true, used: h.day.used, pace, retryAfter: secondsUntilLocalMidnight(now) };
}

/** Tests: forget the last seen totals. */
export function resetBudget(): void {
  holder().state = null;
  holder().day = null;
}
