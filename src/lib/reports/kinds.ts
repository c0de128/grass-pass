/**
 * Item report kinds, thresholds and copy (client-safe; the store side is ./index.ts). See ./index.ts.
 */
import "@/lib/zod-config";
import { z } from "zod";

export const REPORT_KINDS = ["found", "notfound", "unsafe"] as const;
export const ReportKindSchema = z.enum(REPORT_KINDS);
export type ReportKind = z.infer<typeof ReportKindSchema>;

export const WINDOW_DAYS = 30;
export const KEEP_DAYS = 90;
export const NOT_FOUND_MIN = 3;
export const NOT_FOUND_SHARE = 0.6;
export const UNSAFE_ACCOUNTS = 2;

/** Pool ids are code-made ("osm-picnic-table", "inat-48662", "lucky-dogs"); nothing else is accepted. */
export const ITEM_REF_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Copy for /about, how-it-works and the pass page (kept true to the constants above and to ./index.ts:
 * every threshold counts DIFFERENT signed-in accounts, and the shared judge demo account never counts).
 */
export const REPORT_COPY = {
  rule: `A find is left off new passes for that park when at least ${NOT_FOUND_MIN} different signed-in visitors didn't find it in the last ${WINDOW_DAYS} days and they are more than ${Math.round(NOT_FOUND_SHARE * 100)}% of those who reported on it, or at once when ${UNSAFE_ACCOUNTS} say it is not safe (we then review it). Each visitor counts once per find. Judge demo reports are only logged, never counted. Reports are deleted after ${KEEP_DAYS} days.`,
  thanks: "Thanks, counted!",
  duplicate: "You already reported this today. Thanks!",
  /** UX-4-05 / SEC-4-01: the judge demo's reports are logged, never counted. */
  judgeLogged: "Thanks! Judge demo reports are logged for review, but they don't change the counts or passes.",
  judgeDuplicate: "This browser already sent that report today. Try another find.",
} as const;

/** What POST /api/report answers: counted, a repeat, or (the judge demo) logged only. */
export const REPORT_STATUSES = ["counted", "duplicate", "logged"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
