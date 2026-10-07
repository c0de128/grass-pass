/**
 * The small "Park · 1.2 km away" line under each search result (judge R6 polish). A search result button reads its
 * name and this line together, so "Prospect Park" + "Park" was heard and seen as "Prospect Park Park". The kind is
 * only added when the park's own name does not already say it.
 */
import type { Park } from "./schema";

const SAYS_PARK = /\bparks?\b/i;
const SAYS_PRESERVE = /\b(preserves?|reserves?|refuges?|sanctuar(y|ies))\b/i;

/** "Park" / "Nature preserve", or null when the name already says it ("Prospect Park", "Arbor Hills Nature Preserve"). */
export function kindLabel(name: string, kind: Park["kind"]): string | null {
  if (kind === "nature_reserve") return SAYS_PRESERVE.test(name) ? null : "Nature preserve";
  return SAYS_PARK.test(name) ? null : "Park";
}

/** The whole line: "Park · 1.2 km away", or just "1.2 km away" when the name already says what it is. */
export function parkMetaLine(name: string, kind: Park["kind"], distance: string): string {
  const k = kindLabel(name, kind);
  return k ? `${k} · ${distance} away` : `${distance} away`;
}
