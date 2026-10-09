/**
 * Display helpers for passes (client-safe). Times are shown in Chicago time with the zone name,
 * because the pass cache day is a Chicago day (SPEC §7).
 */
import { APP_TIME_ZONE } from "@/lib/time";

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

/** "2026-10-05T23:42:00Z" -> "Oct 5, 6:42 PM CDT". Empty string for a bad date. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : timeFmt.format(d);
}

/** "2026-10-05" -> "Monday, Oct 5". */
export function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Review 2026-10-08 NIT-5: a pass made after 6 PM carries tomorrow's forecast and trip tips ("Fri, Oct 9") while its day
 * is today ("Thursday, Oct 8"). The screen says both: "Made Thursday, Oct 8 for Friday, Oct 9". Same day: just the day.
 */
export function passDayLine(pass: { day: string; tripTips?: { forecast: boolean; forDate: string } | null }): string {
  const t = pass.tripTips;
  if (t && t.forecast && t.forDate !== pass.day) return `Made ${formatDay(pass.day)} for ${formatDay(t.forDate)}`;
  return formatDay(pass.day);
}

/** Licence of an open model, from its id (shown next to the model that actually answered). */
export function modelLicence(modelId: string): string | null {
  const l = modelId.toLowerCase();
  if (l.startsWith("gemma")) return "Apache-2.0";
  if (l.includes("llama-4") || l.includes("llama4")) return "Llama 4 Community Licence";
  if (l.startsWith("qwen")) return "Apache-2.0";
  return null;
}

/**
 * True when the model that answered is a Llama model. The Llama 4 Community Licence asks that a product
 * using it shows "Built with Llama" prominently, so the pass and /about show it whenever this is true.
 */
export function isLlamaModel(modelId: string): boolean {
  return /llama/i.test(modelId);
}

/** The attribution line the Llama 4 Community Licence asks for. */
export const BUILT_WITH_LLAMA = "Built with Llama";

/** Credit for the Wikipedia text Wild Finds are written from (CC BY-SA), printed on the parent stub. */
export const WIKIPEDIA_CREDIT = "Species facts: Wikipedia (CC BY-SA), via iNaturalist.";
