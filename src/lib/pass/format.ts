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

/** Licence of an open model, from its id (shown next to the model that actually answered). */
export function modelLicence(modelId: string): string | null {
  const l = modelId.toLowerCase();
  if (l.startsWith("gemma")) return "Apache-2.0";
  if (l.includes("llama-4") || l.includes("llama4")) return "Llama 4 Community Licence";
  if (l.startsWith("qwen")) return "Apache-2.0";
  return null;
}
