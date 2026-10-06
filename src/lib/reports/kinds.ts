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
  rule: `If at least ${NOT_FOUND_MIN} different signed-in visitors say they didn't find an item in the last ${WINDOW_DAYS} days, and they are more than ${Math.round(NOT_FOUND_SHARE * 100)}% of the different visitors who reported on it, new passes for that park leave it out. If ${UNSAFE_ACCOUNTS} different signed-in visitors say an item is not safe, new passes leave it out right away and we review it. Each visitor counts once per item, however often they report. Reports from the shared judge demo account are logged for us to review but never change a pass or the counts. Reports are deleted after ${KEEP_DAYS} days.`,
  thanks: "Thanks — counted.",
  duplicate: "You already reported this item today. Thanks!",
  /** UX-4-05 / SEC-4-01: the judge demo's reports are logged, never counted. */
  judgeLogged: "Thanks! Judge demo reports are logged for us to review, but they don't change passes or the counts.",
  judgeDuplicate: "You already sent that one from this browser today. Try another find.",
} as const;

/** What POST /api/report answers: counted, a repeat, or (the judge demo) logged only. */
export const REPORT_STATUSES = ["counted", "duplicate", "logged"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
