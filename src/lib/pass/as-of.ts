/**
 * Judge R9 ("two different explanations for one missing feature"): a saved pass keeps the Lucky Finds reason that was
 * true when it was made. Read on a later day, "This server has no SerpApi key" or "the example passes used their share
 * today" are no longer true for the reader (the server now has a key; today's searches are a new day). Shown on a
 * later day, the same reason is said as of the day the pass was made, in one shape: "Lucky Finds: not on this pass.
 * On <day>, <what was true then>." Same-day passes keep their words. The stored pass is never changed.
 *
 * Pure (no imports beyond types and copy).
 */
import { LUCKY_COPY } from "@/lib/pool/lucky";
import type { SectionState } from "@/lib/pool/types";
import type { Pass } from "./schema";

const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
/** "2026-10-06" -> "Tue, Oct 6". */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return dayFmt.format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** The reasons that speak in the present ("this server", "today", "until the reset"), said again as of `on`. */
function asOf(on: string): Array<[string, string]> {
  return [
    [LUCKY_COPY.notConnected, `Lucky Finds: not on this pass. On ${on}, the server that made it had no SerpApi key, so it could not read visitor reviews.`],
    [
      LUCKY_COPY.warmupShare,
      `Lucky Finds: not on this example pass. On ${on}, the example passes had used their share of that day's free visitor-review searches (SerpApi); Grass Pass keeps at least half of each day's searches for passes people make.`,
    ],
    [LUCKY_COPY.dailyCap, `Lucky Finds: not on this pass. On ${on}, Grass Pass had used that day's free SerpApi searches for visitor reviews.`],
    [LUCKY_COPY.monthlyCap, `Lucky Finds: not on this pass. On ${on}, Grass Pass had used its monthly SerpApi searches for visitor reviews.`],
    [LUCKY_COPY.storePace, `Lucky Finds: not on this pass. On ${on}, Grass Pass had used that day's share of its free storage service, so it skipped new visitor-review lookups.`],
    [LUCKY_COPY.paused, `Lucky Finds: not on this pass. On ${on}, the visitor-review service (SerpApi) had asked us to wait.`],
    [LUCKY_COPY.auth, `Lucky Finds: not on this pass. On ${on}, the visitor-review service (SerpApi) did not accept the server's key.`],
  ];
}

/** The Lucky Finds state as a reader on `today` should see it (unchanged when the pass is from today). */
export function luckyStateAsOf(state: SectionState, passDay: string, today: string): SectionState {
  if (passDay === today || state.status === "ok") return state;
  for (const [now, then] of asOf(dayLabel(passDay))) {
    // A cut-short lookup adds what it checked after the reason (src/lib/pool/lucky.ts `partialLuckyState`).
    if (state.message === now || state.message.startsWith(`${now} `)) return { ...state, message: then + state.message.slice(now.length) };
  }
  return state;
}

/** The pass as shown on `today` (Chicago day): only present-tense section reasons change. */
export function passAsOf(pass: Pass, today: string): Pass {
  const lucky = luckyStateAsOf(pass.sections.lucky, pass.day, today);
  return lucky === pass.sections.lucky ? pass : { ...pass, sections: { ...pass.sections, lucky } };
}
