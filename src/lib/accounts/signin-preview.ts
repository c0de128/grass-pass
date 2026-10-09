/**
 * The /signin page's "show the reward" preview (Kevin's option A, 2026-10-08): a small look at a REAL pass, read from
 * a pinned example file (src/data/pinned-examples/, src/lib/pinned.ts), never typed in by hand. When the pinned pass
 * can't be loaded (missing, short or not valid), the result is null and the page shows no preview at all.
 * Pure function, no I/O beyond the pinned import (unit tested in tests/unit/signin-preview.test.tsx).
 */
import { formatTime } from "@/lib/pass/format";
import { isCompletePass } from "@/lib/pass/complete";
import type { Pass, PassItem } from "@/lib/pass/schema";
import { pinnedPass } from "@/lib/pinned";
import { EXAMPLE_PARKS } from "@/lib/prewarm";
import { bandLabel, isCountedParkFind, placeLabel } from "@/lib/home/showcase";

/** Kevin's sketch (2026-10-08): "real White Rock pass". */
export const SIGNIN_PREVIEW_SLUG = "white-rock";

export type SignInPreview = {
  parkName: string;
  /** "Dallas, TX" (from the example's config), or null for a park that isn't an example. */
  place: string | null;
  /** "Ages 6–10". */
  band: string;
  /** "Oct 7, 10:11 AM CDT": the pass's real generatedAt. */
  madeAt: string;
  /** The whole real pass. */
  href: string;
  /** Two real finds: a Park Find (a counted one first) and a Wild Find, in that order. */
  finds: PassItem[];
  /** The model's real Find This Spot riddle, or null when the pass has none. */
  riddle: string | null;
  /** How many finds the whole pass has (the real count). */
  total: number;
};

/** The two finds shown: a Park Find (counted first) then a Wild Find; real items only, in pass order otherwise. */
export function previewFinds(pass: Pass): PassItem[] {
  const park = pass.items.find(isCountedParkFind) ?? pass.items.find((i) => i.section === "park");
  const wild = pass.items.find((i) => i.section === "wild");
  const picked = [park, wild].filter((i): i is PassItem => i !== undefined);
  // A pass with only one kind still shows two real finds when it has them.
  for (const i of pass.items) if (picked.length < 2 && !picked.includes(i)) picked.push(i);
  return picked;
}

/** The preview for a pass (null for no pass or a pass that isn't complete: never a half pass, never a fake one). */
export function signInPreview(pass: Pass | null, slug: string = SIGNIN_PREVIEW_SLUG): SignInPreview | null {
  if (!pass || !isCompletePass(pass)) return null;
  const madeAt = formatTime(pass.generatedAt);
  if (!madeAt) return null;
  const finds = previewFinds(pass);
  if (finds.length === 0) return null;
  const example = EXAMPLE_PARKS.find((e) => e.slug === slug);
  return {
    parkName: pass.park.name,
    place: example ? placeLabel(example.place) : null,
    band: bandLabel(pass),
    madeAt,
    href: `/pass/${pass.id}?example=1`,
    finds,
    riddle: pass.spot?.status === "ok" ? pass.spot.riddle : null,
    total: pass.items.length,
  };
}

/** The pinned pass for the sign-in page, or null when its file can't be loaded. */
export function signInPreviewFor(slug: string = SIGNIN_PREVIEW_SLUG): SignInPreview | null {
  return signInPreview(pinnedPass(slug), slug);
}
