/**
 * S6: "Maybe!" is printed (by code) before a Lucky Find's clue, so the kid knows it may not be there today.
 * Review 2026-10-08 NIT-3: when the model's clue already says "maybe" ("... you maybe see today?"), the code-written
 * lead is left out, so the line doesn't say it twice. The model's clue itself is never changed.
 */
export const LUCKY_MAYBE = "Maybe!";

const SAYS_MAYBE = /\bmaybe\b/i;

/** The lead printed before a find's clue: "Maybe!" for a Lucky Find whose clue doesn't already say "maybe", else null. */
export function luckyLead(item: { section: string; clue: string }): string | null {
  return item.section === "lucky" && !SAYS_MAYBE.test(item.clue) ? LUCKY_MAYBE : null;
}
