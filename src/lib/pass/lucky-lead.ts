/**
 * S6: "Maybe!" is printed (by code) before a Lucky Find's clue, so the kid knows it may not be there today.
 * Review 2026-10-08 NIT-3: when the model's clue already says "maybe" ("... you maybe see today?"), the code-written
 * lead is left out, so the line doesn't say it twice. The model's clue itself is never changed.
 * Kid voice (2026-10-10): a teens & adults (13+) pass prints "If you're lucky:" instead (src/lib/pass/audience.ts), and
 * none when its clue already hedges ("you might see", "with luck"): the 13+ prompt asks for that inside the sentence.
 */
import { copyFor } from "./audience";
import { AGE_BAND_INFO, type AgeBand } from "./constants";

export const LUCKY_MAYBE = "Maybe!";

const SAYS_MAYBE = /\bmaybe\b/i;
const HEDGES = /\b(?:maybe|might|may|perhaps|lucky|luck|chance)\b/i;

/** The lead printed before a find's clue: the band's Lucky Find lead when the clue doesn't already say it, else null. */
export function luckyLead(item: { section: string; clue: string }, band?: AgeBand): string | null {
  if (item.section !== "lucky") return null;
  const adult = band !== undefined && AGE_BAND_INFO[band]?.audience === "adult";
  if (adult) return HEDGES.test(item.clue) ? null : copyFor(band).luckyLead;
  return SAYS_MAYBE.test(item.clue) ? null : LUCKY_MAYBE;
}
