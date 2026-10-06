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

/** Copy for /about, how-it-works and the pass page (kept true to the constants above). */
export const REPORT_COPY = {
  rule: `If at least ${NOT_FOUND_MIN} signed-in visitors say they didn't find an item, and that's more than ${Math.round(NOT_FOUND_SHARE * 100)}% of its reports in the last ${WINDOW_DAYS} days, new passes for that park leave it out. If ${UNSAFE_ACCOUNTS} different visitors say an item is not safe, new passes leave it out right away and we review it. Reports are deleted after ${KEEP_DAYS} days.`,
  thanks: "Thanks — counted.",
  duplicate: "You already reported this item today. Thanks!",
} as const;
