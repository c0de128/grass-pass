/**
 * Pinned example passes (Kevin, 2026-10-07): the home page's hero card always shows the same real example pass, and an
 * example card never says "not ready" when a pinned pass exists for that park.
 *
 * Rules:
 * - A pinned pass is a REAL pass the app made earlier (live park data + the open model), committed in
 *   src/data/pinned-examples/<example slug>.json with where it came from (`_source`). It is copied byte-for-byte
 *   from the recording and never edited. It is shown with its real "made" date and time ("from that day's data").
 * - Only a COMPLETE pass (src/lib/pass/complete.ts) may be pinned; the check below refuses anything else at load,
 *   and a unit test fails the build if a file is short, edited or not valid.
 * - Order on the example cards: today's complete pass, else the store's last complete pass, else the pinned pass.
 *   The hero card always uses HERO_PINNED_SLUG's pinned pass when it exists (a fixed choice, the same on every load).
 * - The pass page /pass/<id> (and its print page) opens a pinned pass from this file when the store doesn't have it.
 *
 * Pinned today:
 * - Oak Point Park and Nature Preserve (made Oct 6, 2026, 11:41 PM CDT: 8 of 8 finds, a counted first Park Find, and a
 *   Find This Spot riddle written by gemma-4-31B-it).
 * - White Rock Lake Park (made Oct 7, 2026, 10:11 AM CDT by the app's own example warm-up, its first try that day:
 *   8 of 8 finds and a Find This Spot riddle by gemma-4-31B-it).
 * - Celebration Park (made Oct 7, 2026, 11:07 AM CDT, after the other_feature clue check: 8 of 8 Park Finds, every clue
 *   about its own answer, and a Find This Spot riddle by gemma-4-31B-it). The morning's complete Celebration tries had a
 *   roof-and-pillars clue for "Benches" and were not pinned (factory repo: reports/pin-examples-2026-10-07.md,
 *   reports/bench-shelter-2026-10-07.md).
 * Arbor Hills has nothing pinned: on Oct 7 all 6 tries came out short (7, 7, 7, 7, 7 and 5 of 8).
 */
import "@/lib/zod-config";
import { z } from "zod";
import { PassSchema, type Pass } from "@/lib/pass/schema";
import { isCompletePass } from "@/lib/pass/complete";
import celebration from "@/data/pinned-examples/celebration.json";
import oakPoint from "@/data/pinned-examples/oak-point.json";
import whiteRock from "@/data/pinned-examples/white-rock.json";

const FileSchema = z.object({
  _source: z.object({ pinnedFrom: z.string(), pinnedOn: z.string(), rule: z.string(), recording: z.unknown() }),
  pass: PassSchema,
});

/** The example the hero card always shows (when its pinned pass exists). Kevin may change it. */
export const HERO_PINNED_SLUG = "oak-point";

/** Example slug -> the raw pinned file (exported for the tests that prove each file is real, complete and unedited). */
export const PINNED_FILES: Readonly<Record<string, unknown>> = { "oak-point": oakPoint, "white-rock": whiteRock, celebration };

function load(): ReadonlyMap<string, Pass> {
  const out = new Map<string, Pass>();
  for (const [slug, raw] of Object.entries(PINNED_FILES)) {
    const f = FileSchema.safeParse(raw);
    // A file that isn't a valid, complete pass is left out (never shown); the unit tests fail on it.
    if (f.success && isCompletePass(f.data.pass)) out.set(slug, f.data.pass);
  }
  return out;
}

let cache: ReadonlyMap<string, Pass> | null = null;
const pinned = () => (cache ??= load());

/** The pinned pass for an example park, or null. */
export function pinnedPass(slug: string): Pass | null {
  return pinned().get(slug) ?? null;
}

/** A pinned pass by its pass id (the pass page's fallback), or null. */
export function pinnedPassById(id: string): Pass | null {
  for (const p of pinned().values()) if (p.id === id) return p;
  return null;
}

/** The hero card's fixed pass (HERO_PINNED_SLUG), or null when it isn't pinned. */
export function heroPinned(): { slug: string; pass: Pass } | null {
  const pass = pinnedPass(HERO_PINNED_SLUG);
  return pass ? { slug: HERO_PINNED_SLUG, pass } : null;
}
