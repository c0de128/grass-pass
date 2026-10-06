/**
 * October special (SPEC F10, §5.4): the monarch box stored on a pass, and every line of its copy.
 * Client-safe (no server-only imports): the pass page, the print page and the browser all use it.
 *
 * All numbers come from iNaturalist (src/lib/sources/inat-monarch.ts); this file only words them.
 * No model ever writes any of this. A zero is printed as a zero, and a failed check says
 * "No data available" and why, never a guess.
 */
import "@/lib/zod-config";
import { z } from "zod";

/** iNaturalist taxon ids, verified live 2026-10-05 (`/v1/taxa/48662,47906`). */
export const MONARCH_TAXON_ID = 48662; // Danaus plexippus, "Monarch", species
export const MILKWEED_TAXON_ID = 47906; // Asclepias, "milkweeds", genus
export const MONARCH_RADIUS_KM = 25;
export const MILKWEED_RADIUS_KM = 1.5;

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * SPEC F10: the box is shown only for passes made Sep 15 - Nov 15 (inclusive, every year), Chicago time.
 * The pass `day` is already a Chicago day ("YYYY-MM-DD"), so this is a plain month/day compare.
 */
export const OCTOBER_WINDOW = { from: { month: 9, day: 15 }, to: { month: 11, day: 15 } } as const;
export const OCTOBER_WINDOW_LABEL = "September 15 to November 15";

/** True when a Chicago day ("2026-10-05") is inside the October-special window (Sep 15 - Nov 15). */
export function isOctoberBoxDay(day: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return false;
  const month = Number(m[2]);
  const d = Number(m[3]);
  if (month < 1 || month > 12 || d < 1 || d > 31) return false;
  const md = month * 100 + d;
  const { from, to } = OCTOBER_WINDOW;
  return md >= from.month * 100 + from.day && md <= to.month * 100 + to.day;
}

/**
 * Kept under its first name for the existing callers (pass maker, OctoberBox, print page): it now means
 * "inside the October-special window" (Sep 15 - Nov 15, SPEC F10), not "a day in October".
 */
export const isOctoberDay = isOctoberBoxDay;

export const WindowCountSchema = z.object({
  /** First and last day of the window, inclusive ("2026-09-21".."2026-10-05"). */
  d1: Day,
  d2: Day,
  /** Verifiable iNaturalist monarch observations in the window (0 is a real answer). */
  count: z.number().int().min(0),
});
export type WindowCount = z.infer<typeof WindowCountSchema>;

export const MilkweedSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    /** Verifiable milkweed observations within 1.5 km of the park, all years. */
    count: z.number().int().min(0),
    radiusKm: z.number().positive(),
    checkedAt: z.string(),
  }),
  z.object({ status: z.literal("unavailable"), reason: z.string().max(200) }),
]);
export type Milkweed = z.infer<typeof MilkweedSchema>;

export const OctoberBoxSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    radiusKm: z.number().positive(),
    thisYear: WindowCountSchema,
    lastYear: WindowCountSchema,
    /** When iNaturalist answered (a cached answer keeps its real time). */
    checkedAt: z.string(),
    milkweed: MilkweedSchema,
  }),
  /** `reason` is code-written and finishes the sentence "No data available: ...". */
  z.object({ status: z.literal("unavailable"), reason: z.string().max(200) }),
]);
export type OctoberBoxData = z.infer<typeof OctoberBoxSchema>;

// ---------- copy ----------

/** Reasons (each finishes "No data available: ..."). */
export const OCTOBER_REASONS = {
  down: "iNaturalist didn't answer when this pass was made, so there are no monarch counts to show.",
  slow: "iNaturalist was too slow when this pass was made, so there are no monarch counts to show.",
  rateLimited: "we've used our polite share of iNaturalist requests for now, so there are no monarch counts to show.",
  // R2-M1: our side couldn't read the answer; never worded as iNaturalist's fault.
  badOutput: "Grass Pass couldn't read iNaturalist's answer this time, so there are no monarch counts to show.",
  notChecked: "monarch counts weren't checked when this pass was made. Make a different pass to check them.",
  milkweedDown: "iNaturalist didn't answer",
} as const;

export const NO_DATA = "No data available";

export const OCTOBER_TIP = "Tip: look on milkweed and on fall flowers on a sunny afternoon. Look, don't touch: let it fly.";

const fmtShort = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "2026-09-21" -> "Sep 21". */
export function shortDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return fmtShort.format(new Date(Date.UTC(y, m - 1, d)));
}

const yearOf = (day: string) => day.slice(0, 4);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "9 monarchs seen Sep 21-Oct 4 vs 63 in 2025" (always the real numbers, zero included; Q-3-04: full days only). */
export function octoberHeadline(box: Extract<OctoberBoxData, { status: "ok" }>): string {
  const n = box.thisYear.count;
  return `${n} ${plural(n, "monarch", "monarchs")} seen ${shortDay(box.thisYear.d1)}-${shortDay(box.thisYear.d2)} vs ${box.lastYear.count} in ${yearOf(box.lastYear.d1)}`;
}

/** The SPEC F10 / §5.4 sentence with the source and the check time. `checked` is already formatted. */
export function octoberDetail(box: Extract<OctoberBoxData, { status: "ok" }>, checked: string): string {
  const n = box.thisYear.count;
  const m = box.lastYear.count;
  const r = box.radiusKm;
  const at = checked ? `iNaturalist, checked ${checked}` : "iNaturalist";
  const last = `Same two weeks last year (${shortDay(box.lastYear.d1)}-${shortDay(box.lastYear.d2)}, ${yearOf(box.lastYear.d1)}): ${m}.`;
  // Audit Q-3-04: the window is the 14 full days before today (inat-monarch.ts monarchWindows).
  const days = `the 14 days before today (${shortDay(box.thisYear.d1)}-${shortDay(box.thisYear.d2)})`;
  if (n === 0) return `No monarch sightings reported within ${r} km in ${days} (${at}). ${last}`;
  return `Monarch butterflies reported within ${r} km in ${days}: ${n} (${at}). ${last}`;
}

/** One honest sentence comparing the two windows. Low numbers are said plainly. */
export function octoberCompare(box: Extract<OctoberBoxData, { status: "ok" }>): string {
  const n = box.thisYear.count;
  const m = box.lastYear.count;
  if (n === 0 && m === 0) return "None were reported in these two weeks last year either, so a monarch would be a rare find.";
  if (n === 0) return "None reported nearby yet this year, so a monarch would be a lucky find.";
  if (n < m) return "That's fewer than last year, so a monarch would be a lucky find.";
  if (n === m) return "That's the same as last year, so keep your eyes open.";
  return "That's more than last year, so keep your eyes open.";
}

export function milkweedLine(m: Milkweed): string {
  if (m.status === "unavailable") return `Milkweed near this park: ${NO_DATA} (${m.reason}).`;
  if (m.count === 0) return `Milkweed seen near this park: no (no iNaturalist sightings within ${m.radiusKm} km).`;
  return `Milkweed seen near this park: yes (${m.count} iNaturalist ${plural(m.count, "sighting", "sightings")} within ${m.radiusKm} km, all years).`;
}

/** "No data available: <reason>" for a box with nothing to show. */
export function octoberUnavailable(reason: string): string {
  return `${NO_DATA}: ${reason}`;
}
