/**
 * Calendar helpers in America/Chicago (CDT/CST). Daily caps and the pass cache
 * key roll over at local midnight, where the app's home users (Dallas area) are.
 * Pure functions: every caller passes `ms` (no default clock), so fake timers work.
 */

export const APP_TIME_ZONE = "America/Chicago";

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function localParts(ms: number): Parts {
  const p: Record<string, number> = {};
  for (const { type, value } of partsFmt.formatToParts(new Date(ms))) {
    if (type !== "literal") p[type] = Number(value);
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}

/** Offset of local time from UTC at `ms`, in ms (e.g. CDT = -5 h). */
function offsetMs(ms: number): number {
  const p = localParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC ms of local midnight on the given local calendar date (handles DST). */
function localMidnightUtc(year: number, month: number, day: number): number {
  const guess = Date.UTC(year, month - 1, day);
  let t = guess - offsetMs(guess);
  t = guess - offsetMs(t);
  return t;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" in Chicago time. */
export function localDay(ms: number): string {
  const p = localParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "YYYY-MM" in Chicago time. */
export function localMonth(ms: number): string {
  const p = localParts(ms);
  return `${p.year}-${pad(p.month)}`;
}

/** Seconds until the next Chicago midnight (at least 1). */
export function secondsUntilLocalMidnight(ms: number): number {
  const p = localParts(ms);
  // Date.UTC normalizes day overflow (e.g. Oct 32 -> Nov 1).
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const at = localMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  return Math.max(1, Math.ceil((at - ms) / 1000));
}

/** Seconds until the 1st of next month, Chicago midnight (at least 1). */
export function secondsUntilNextLocalMonth(ms: number): number {
  const p = localParts(ms);
  const next = new Date(Date.UTC(p.year, p.month, 1));
  const at = localMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, 1);
  return Math.max(1, Math.ceil((at - ms) / 1000));
}
