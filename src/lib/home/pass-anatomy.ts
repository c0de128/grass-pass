/**
 * The home page's "What's a pass?" anatomy (Kevin's option A "Show a real pass", 2026-10-08): ONE real pinned example
 * pass (src/data/pinned-examples/, src/lib/pinned.ts), shown printed-style with numbered parts. Nothing here is typed
 * in by hand: every line on the preview is read from the pinned file. A part the chosen pass doesn't have is marked
 * "when the data has it" in the legend, never drawn with a made-up clue.
 *
 * Which example: the pinned pass that shows the most kinds of parts (Park Finds, Wild Finds, Lucky Finds, Find This
 * Spot, the October box), first in PINNED_FILES order on a tie. A fixed choice for a given set of pinned files.
 */
import "server-only";
import { isOctoberDay, shortDay, type OctoberBoxData } from "@/lib/october";
import { passAsOf } from "@/lib/pass/as-of";
import { isCompletePass } from "@/lib/pass/complete";
import { formatDay, formatTime, modelLicence } from "@/lib/pass/format";
import type { Pass, PassItem } from "@/lib/pass/schema";
import { stubNotes } from "@/lib/pass/stub-notes";
import { PINNED_FILES, pinnedPass } from "@/lib/pinned";
import { EXAMPLE_PARKS } from "@/lib/prewarm";
import { withClearMap } from "@/lib/spot/redraw";
import type { SpotOk } from "@/lib/spot/types";
import { localDay } from "@/lib/time";
import { bandLabel, placeLabel } from "./showcase";

/** The six numbered parts, in the order they sit on a printed pass (top to bottom). */
export const ANATOMY_PARTS = ["park", "wild", "lucky", "spot", "october", "stub"] as const;
export type AnatomyPart = (typeof ANATOMY_PARTS)[number];

/** A find with its real number on the pass (1-based, pass order). */
export type NumberedFind = PassItem & { n: number };

export type PassAnatomyData = {
  slug: string;
  parkName: string;
  /** "Plano, TX" from the example's config, or null. */
  place: string | null;
  /** "Ages 6–10". */
  band: string;
  /** "Tuesday, Oct 6": the pass's own day. */
  day: string;
  /** "Oct 6, 11:41 PM CDT": the pass's real generatedAt. */
  madeAt: string;
  href: string;
  total: number;
  park: NumberedFind[];
  wild: NumberedFind[];
  lucky: NumberedFind[];
  spot: SpotOk | null;
  october: Extract<OctoberBoxData, { status: "ok" }> | null;
  /** The stub's answers, in pass order. */
  answers: string[];
  /** The stub's "Not on this pass" lines (src/lib/pass/stub-notes.ts), said as of the pass's day. */
  notOnPass: string[];
  /** The pass's own Lucky Finds reason when it has none (as of its day), or null. */
  luckyWhy: string | null;
  /** Nearby sightings left off this pass for safety (the real count). */
  safetyFiltered: number;
  /** The stub's "Where this came from" lines, short (real dates and the model that answered). */
  sources: string[];
  /** Which numbered parts this pass really has. */
  has: Record<AnatomyPart, boolean>;
};

/** Which parts a pass really has (the stub is always printed). */
export function partsOf(pass: Pass): Record<AnatomyPart, boolean> {
  const kinds = new Set(pass.items.map((i) => i.section));
  return {
    park: kinds.has("park"),
    wild: kinds.has("wild"),
    lucky: kinds.has("lucky"),
    spot: pass.spot?.status === "ok",
    october: isOctoberDay(pass.day) && pass.october?.status === "ok",
    stub: true,
  };
}

/** How many kinds of parts a pass shows (the stub, which every pass has, is not counted). */
export function kindsShown(pass: Pass): number {
  const h = partsOf(pass);
  return ANATOMY_PARTS.filter((p) => p !== "stub" && h[p]).length;
}

/** The pinned example with the most kinds of parts (first in PINNED_FILES order on a tie), or null. */
export function anatomySlug(load: (slug: string) => Pass | null = pinnedPass): string | null {
  let best: { slug: string; n: number } | null = null;
  for (const slug of Object.keys(PINNED_FILES)) {
    const p = load(slug);
    if (!p) continue;
    const n = kindsShown(p);
    if (!best || n > best.n) best = { slug, n };
  }
  return best?.slug ?? null;
}

/** The stub's sources, short: the same facts as ParentStub's "Where this came from", with their real dates. */
export function sourcesOf(pass: Pass): string[] {
  const licence = modelLicence(pass.model.answered);
  const out = [`Map: © OpenStreetMap contributors, checked ${formatTime(pass.dataCheckedAt.osm)}.`];
  if (pass.dataCheckedAt.inat) {
    out.push(`Wildlife: iNaturalist, research grade, within 1.5 km${pass.wildSince ? `, ${shortDay(pass.wildSince)} to ${shortDay(pass.day)}` : ""}.`);
  }
  if (pass.dataCheckedAt.lucky) out.push(`Lucky Finds: Google review counts via SerpApi, checked ${formatTime(pass.dataCheckedAt.lucky)}.`);
  out.push(`Clues: ${pass.model.answered} (${licence ? `open model, ${licence}` : "open model"}), made ${formatTime(pass.generatedAt)}.`);
  return out;
}

/** The anatomy for a real pass (null for no pass or a pass that isn't complete). `today` is a Chicago day. */
export function passAnatomy(raw: Pass | null, slug: string, today: string): PassAnatomyData | null {
  if (!raw || !isCompletePass(raw)) return null;
  return anatomyOf(raw, slug, today);
}

/** The anatomy fields of any real pass (no completeness check: passAnatomy adds it; exported for the unit tests). */
export function anatomyOf(raw: Pass, slug: string, today: string): PassAnatomyData | null {
  const madeAt = formatTime(raw.generatedAt);
  if (!madeAt) return null;
  // The same pass the pass page shows: the clearer map, and Lucky Finds' reason said as of the pass's own day.
  const pass = passAsOf(withClearMap(raw), today);
  const has = partsOf(pass);
  const numbered = pass.items.map((it, i) => ({ ...it, n: i + 1 }));
  const example = EXAMPLE_PARKS.find((e) => e.slug === slug);
  const lucky = pass.sections.lucky;
  return {
    slug,
    parkName: pass.park.name,
    place: example ? placeLabel(example.place) : null,
    band: bandLabel(pass),
    day: formatDay(pass.day),
    madeAt,
    href: `/pass/${pass.id}?example=1`,
    total: pass.items.length,
    park: numbered.filter((i) => i.section === "park"),
    wild: numbered.filter((i) => i.section === "wild"),
    lucky: numbered.filter((i) => i.section === "lucky"),
    spot: pass.spot?.status === "ok" ? pass.spot : null,
    october: has.october && pass.october?.status === "ok" ? pass.october : null,
    answers: pass.items.map((i) => i.answer),
    notOnPass: stubNotes(pass),
    luckyWhy: has.lucky ? null : lucky.status === "ok" ? (lucky.note ?? null) : lucky.message,
    safetyFiltered: pass.safetyFiltered,
    sources: sourcesOf(pass),
    has,
  };
}

/** The home section's anatomy, from the pinned example with the most kinds of parts (null when none loads). */
export function passAnatomyFor(now: number = Date.now()): PassAnatomyData | null {
  const slug = anatomySlug();
  return slug ? passAnatomy(pinnedPass(slug), slug, localDay(now)) : null;
}
