/**
 * Review 2026-10-08 MAJOR-2 (SPEC §5.4 "All empty ... + 3 nearest parks"): when a park has not enough real data for a
 * pass, the wizard offers the nearest OTHER parks from the search the visitor already ran (real OpenStreetMap results
 * already on the page: no new request, nothing invented). We do not know a park's size or data in advance, so the copy
 * says "nearby", not "bigger". Pure: browser and server safe.
 */
import { distanceM } from "@/lib/geo";
import type { Park } from "./schema";

export const OTHER_PARKS_MAX = 3;

/** Up to `max` other parks from `parks`, nearest to `from` first, with their distance from it (metres, rounded). */
export function otherParksNear(from: Pick<Park, "id" | "name" | "lat" | "lng">, parks: readonly Park[], max: number = OTHER_PARKS_MAX): { park: Park; fromM: number }[] {
  const name = from.name.trim().toLowerCase();
  return parks
    .filter((p) => p.id !== from.id && p.name.trim().toLowerCase() !== name)
    .map((park) => ({ park, fromM: Math.round(distanceM(from, park)) }))
    .sort((a, b) => a.fromM - b.fromM || a.park.name.localeCompare(b.park.name))
    .slice(0, Math.max(0, max));
}
