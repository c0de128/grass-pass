/**
 * Item reports (Kevin, 2026-10-06): signed-in grown-ups say "Found it", "Didn't find it" or "Not safe" about
 * one item on a pass, to learn what is really findable and to catch threats. Rules (round 4, SEC-4-01/03):
 * - every threshold counts DIFFERENT accounts, never reports: one account is one voice per item and kind,
 *   however many days it reports. "Found it" and "Didn't find it" are one opinion per account (the latest
 *   wins), so one account can neither push an item out nor keep a missing one in;
 * - one report per account per item per Chicago day (any kind);
 * - an item is left out of NEW passes for that park (the pool step, src/lib/ai/build-pass.ts) when at least
 *   NOT_FOUND_MIN different accounts said "didn't find" in the last WINDOW_DAYS days AND they are more than
 *   NOT_FOUND_SHARE of the different accounts with a found / didn't-find opinion in that window;
 * - "Not safe" from UNSAFE_ACCOUNTS different accounts hides the item from new passes for that park at once,
 *   logs `report_item_hidden` (error) and adds 1 to the `meta:not-safe-hidden` counter for Kevin to review;
 * - the shared judge demo account NEVER counts and is never shown in the counts: its reports are logged
 *   (`report_judge`, and `report_not_safe` with judge:true) for Kevin, deduped per judge sign-in (UX-4-05);
 * - every report expires after KEEP_DAYS days.
 *
 * An item is identified by its pool id (`ref`: "osm-playground", "inat-48662", ...) within its park, so
 * reports about the same thing on different passes add up. Store: ONE hash per park, field
 * `<ref>|<kind>|<reporter id>` = the Chicago day (yyyymmdd) of that account's latest report of that kind, where
 * the reporter id is a per-park HMAC of the account (src/lib/accounts/key.ts `reporterId`); plus the set of
 * reporter ids that said "not safe" per item (src/lib/cache/store.ts REPORT_SCRIPT, 1 command per report).
 */
import "server-only";
import type { Store } from "@/lib/cache/store";
import { REPORTER_ID_PATTERN, reporterId } from "@/lib/accounts/key";
import { log } from "@/lib/log";
import { localDay } from "@/lib/time";

import { ITEM_REF_PATTERN, KEEP_DAYS, NOT_FOUND_MIN, NOT_FOUND_SHARE, ReportKindSchema, UNSAFE_ACCOUNTS, WINDOW_DAYS, type ReportKind, type ReportStatus } from "./kinds";

export * from "./kinds";

const DAY_MS = 24 * 3600 * 1000;
/** Chicago day as a number, e.g. 20261006. */
export const dayNumber = (ms: number) => Number(localDay(ms).replace(/-/g, ""));

export const reportKeys = (parkId: string, ref: string) => ({
  // One hash tag per park, so the single EVAL stays valid on a clustered store.
  hash: `rep:{${parkId}}:h`,
  unsafe: `rep:{${parkId}}:ns:${ref}`,
  dedupe: (day: number, reporter: string) => `rep:{${parkId}}:d:${day}:${reporter}:${ref}`,
  /** UX-4-05: one judge sign-in (browser) per item per day; never read by the thresholds. */
  judgeDedupe: (day: number, session: string) => `rep:{${parkId}}:j:${day}:${session}:${ref}`,
});
export const NOT_SAFE_COUNTER = "meta:not-safe-hidden";

export type ReportResult = { status: ReportStatus };

/** Who is reporting: the account key, whether it is the shared judge demo, and (judge only) its sign-in id. */
export type Reporter = { key: string; judge: boolean; session?: string };

const OPPOSITE: Partial<Record<ReportKind, ReportKind>> = { found: "notfound", notfound: "found" };

export async function recordItemReport(store: Store, r: { parkId: string; ref: string; kind: ReportKind; account: Reporter; now: number }): Promise<ReportResult> {
  const day = dayNumber(r.now);
  const keys = reportKeys(r.parkId, r.ref);

  if (r.account.judge) {
    // SEC-4-01/03: logged for Kevin, never counted. One per judge sign-in per item per day (1 command).
    const session = r.account.session ?? "none";
    const n = await store.incr(keys.judgeDedupe(day, session), 1, 2 * 24 * 3600);
    if (n > 1) return { status: "duplicate" };
    log(r.kind === "unsafe" ? "report_not_safe" : "report_judge", { park: r.parkId, item: r.ref, kind: r.kind, judge: true, counted: false }, r.kind === "unsafe" ? "warn" : "info");
    return { status: "logged" };
  }

  if (!store.recordReport) throw new Error("this store can't keep reports");
  const reporter = reporterId(r.account.key, r.parkId);
  const opposite = OPPOSITE[r.kind];
  const out = await store.recordReport({
    dedupeKey: keys.dedupe(day, reporter),
    dedupeTtlSec: 2 * 24 * 3600,
    hashKey: keys.hash,
    field: `${r.ref}|${r.kind}|${reporter}`,
    otherField: opposite ? `${r.ref}|${opposite}|${reporter}` : "",
    unsafeKey: keys.unsafe,
    unsafe: r.kind === "unsafe",
    member: reporter,
    hideAt: UNSAFE_ACCOUNTS,
    hideField: `${r.ref}|hide`,
    day,
    cutoff: dayNumber(r.now - (KEEP_DAYS - 1) * DAY_MS),
    ttlSec: KEEP_DAYS * 24 * 3600,
  });
  if (!out.counted) return { status: "duplicate" };
  if (r.kind === "unsafe") {
    // Never the account key or anything about the person: the park, the item and the distinct count.
    log("report_not_safe", { park: r.parkId, item: r.ref, accounts: out.unsafeAccounts }, "warn");
  }
  if (out.newlyHidden) {
    log("report_item_hidden", { park: r.parkId, item: r.ref, accounts: out.unsafeAccounts, review: "Kevin: see README 'Reports'" }, "error");
    await store.incr(NOT_SAFE_COUNTER, 1, 400 * 24 * 3600).catch(() => undefined);
  }
  return { status: "counted" };
}

/** Per item of a park: DIFFERENT accounts per kind in the last WINDOW_DAYS days, and whether "not safe" hid it (within KEEP_DAYS). */
export type ItemStats = { found: number; notFound: number; unsafe: number; hidden: boolean };

export function statsFromHash(fields: Record<string, string>, now: number): Map<string, ItemStats> {
  const since = dayNumber(now - (WINDOW_DAYS - 1) * DAY_MS);
  const keepSince = dayNumber(now - (KEEP_DAYS - 1) * DAY_MS);
  const out = new Map<string, ItemStats>();
  const get = (ref: string) => {
    let s = out.get(ref);
    if (!s) out.set(ref, (s = { found: 0, notFound: 0, unsafe: 0, hidden: false }));
    return s;
  };
  for (const [field, value] of Object.entries(fields)) {
    const parts = field.split("|");
    const ref = parts[0];
    if (!ITEM_REF_PATTERN.test(ref)) continue;
    if (parts.length === 2 && parts[1] === "hide") {
      if (Number(value) >= keepSince) get(ref).hidden = true;
      continue;
    }
    // `<ref>|<kind>|<reporter id>` = yyyymmdd. Anything else (e.g. the old per-day count fields) is ignored.
    if (parts.length !== 3 || !REPORTER_ID_PATTERN.test(parts[2])) continue;
    const kind = ReportKindSchema.safeParse(parts[1]);
    const day = Number(value);
    if (!kind.success || !Number.isInteger(day) || day < since) continue;
    const s = get(ref);
    if (kind.data === "found") s.found += 1;
    else if (kind.data === "notfound") s.notFound += 1;
    else s.unsafe += 1;
  }
  return out;
}

export async function parkReportStats(store: Store, parkId: string, now: number): Promise<Map<string, ItemStats>> {
  if (!store.hashGetAll) return new Map();
  return statsFromHash(await store.hashGetAll(reportKeys(parkId, "x").hash), now);
}

/** Why an item is left out of new passes, or null. Every number here is a count of different accounts. */
export function exclusionReason(s: ItemStats): "not_safe" | "not_found" | null {
  if (s.hidden) return "not_safe";
  const total = s.found + s.notFound;
  if (s.notFound >= NOT_FOUND_MIN && total > 0 && s.notFound / total > NOT_FOUND_SHARE) return "not_found";
  return null;
}

/** The pool ids to leave out of a new pass for this park. */
export function excludedRefs(stats: Map<string, ItemStats>): Map<string, "not_safe" | "not_found"> {
  const out = new Map<string, "not_safe" | "not_found">();
  for (const [ref, s] of stats) {
    const why = exclusionReason(s);
    if (why) out.set(ref, why);
  }
  return out;
}
