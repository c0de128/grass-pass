/**
 * Find This Spot target picking (SPEC F9). Code, not the model, decides where the X goes.
 *
 * A target must be a real OSM object inside the park that a child can recognise when they reach it:
 *   1. a landmark kind the park has exactly ONE of (S3 feature kinds: shelter, playground, viewpoint,
 *      tower, bridge, artwork, fountain, splash pad...; plus restrooms), so "the X" is unambiguous;
 *   2. otherwise the middle of one specific pitch or court (the centre line of a soccer field), the one
 *      nearest the start, drawn among the others on the map.
 * Water, creeks, benches and trees are never targets (not a single findable thing, or not safe to aim at).
 * "Make a different pass" (variants 2 and 3) moves the X to the next candidate when the park has one.
 *
 * The start marker is the mapped entrance or parking lot nearest the target. Distance and direction
 * are measured by code and written into the target's fact sheet, which is the ONLY text the model's
 * riddle may quote.
 */
import "server-only";
import { hasUrlOrMarkup } from "@/lib/ai/validate";
import { distinctiveWords, kindLabelWords } from "@/lib/pool/types";
import { classify, FEATURE_KINDS, type FeatureKind, type ParkFeatures } from "@/lib/sources/overpass-features";
import { factsFor } from "@/lib/pool/park";
import { centerOf, compass, distanceM, type GeoElement, type LatLng, type ParkGeometry } from "./geometry";

export type TargetKind = FeatureKind | "toilets";

/** Restrooms are not a Park Find (S3), but they are a fine, findable Find This Spot target. */
const TOILETS = {
  label: "restroom building",
  plural: "restroom buildings",
  describe: "A restroom building is a small building with toilets and sinks for visitors.",
  nameWords: ["restroom", "restrooms", "toilet", "toilets", "bathroom", "bathrooms"],
};

/** Landmark kinds, most findable first. Each must be the only one of its kind in the park. */
export const LANDMARK_KINDS: readonly TargetKind[] = [
  "shelter",
  "playground",
  "viewpoint",
  "tower",
  "bridge",
  "artwork",
  "toilets",
  "fountain",
  "splash_pad",
  "dog_park",
  "flagpole",
  "historic",
  "info_board",
  "bleachers",
];

/** Pitch kinds: the X goes in the middle of one of them (the centre line). */
export const PITCH_KINDS: readonly FeatureKind[] = ["soccer", "football", "baseball", "basketball", "tennis", "volleyball", "pickleball", "sports_field"];

export type SpotStart = { osmId: string; label: string; at: LatLng };

export type SpotTarget = {
  /** Id the model must return (and the only value the strict schema allows). */
  id: string;
  osmId: string;
  kind: TargetKind;
  /** Singular label ("picnic shelter"). */
  label: string;
  name: string | null;
  center: LatLng;
  /** True when the X is the middle of one of several pitches of this kind. */
  onePitchOf: number | null;
  /** The fact sheet the riddle must quote (code-written). */
  sourceText: string;
  /** Words the riddle must not contain. */
  nameWords: string[];
  /** Code-written answer for the stub. */
  answer: string;
  start: SpotStart | null;
  walk: { meters: number; direction: string } | null;
  /** The S3 Park Finds kind this target IS (unique landmark), so the pass doesn't ask for it twice. */
  poolKind: FeatureKind | null;
};

const infoOf = (k: TargetKind) => (k === "toilets" ? TOILETS : FEATURE_KINDS[k]);

function kindOf(tags: Record<string, string>): TargetKind | null {
  if (tags.amenity === "toilets") return "toilets";
  if (tags.amenity === "parking" || tags.entrance) return null;
  const k = classify(tags);
  return k && k !== "tree" ? k : null;
}

/**
 * R1-m7 (SEC-1-04) follow-up: anyone can edit an OSM name. A name with a link, bare domain, @handle or
 * phone-like digits never reaches the riddle prompt, the fact sheet or the answer key (same filter
 * as the Park Finds names in pool/park.ts); the thing is then described by its kind only.
 */
export function safeOsmName(name: string | undefined): string | null {
  const n = name?.trim();
  return n && !hasUrlOrMarkup(n) ? n : null;
}

function startOf(el: GeoElement): SpotStart | null {
  const name = safeOsmName(el.tags.name);
  if (el.tags.entrance) return { osmId: el.osmId, label: name ? `park entrance (${name})` : "park entrance", at: centerOf(el.lines) };
  if (el.tags.amenity === "parking") return { osmId: el.osmId, label: name ? `parking lot (${name})` : "parking lot", at: centerOf(el.lines) };
  return null;
}

/** Round a walk to a friendly number (10 m steps, 50 m steps over 500 m). */
export function roundWalk(m: number): number {
  return m >= 500 ? Math.round(m / 50) * 50 : Math.max(10, Math.round(m / 10) * 10);
}

const article = (label: string) => (/^[aeiou]/i.test(label) ? "an" : "a");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Candidate = { el: GeoElement; kind: TargetKind; center: LatLng; onePitchOf: number | null };

/** Every candidate, best first. */
export function candidates(g: ParkGeometry, features: ParkFeatures | null): { list: Candidate[]; starts: SpotStart[] } {
  const byKind = new Map<TargetKind, GeoElement[]>();
  const starts: SpotStart[] = [];
  for (const el of g.elements) {
    const s = startOf(el);
    if (s) {
      starts.push(s);
      continue;
    }
    const k = kindOf(el.tags);
    if (!k) continue;
    const list = byKind.get(k) ?? [];
    list.push(el);
    byKind.set(k, list);
  }

  const list: Candidate[] = [];
  for (const k of LANDMARK_KINDS) {
    const els = byKind.get(k) ?? [];
    // Unique on the map AND in the S3 feature counts (when the park has that pool).
    const poolCount = k === "toilets" ? undefined : features?.features[k]?.count;
    if (els.length !== 1 || (poolCount !== undefined && poolCount !== 1)) continue;
    list.push({ el: els[0], kind: k, center: centerOf(els[0].lines), onePitchOf: null });
  }

  // Pitches: one per sport (only real areas, not a single point standing for a whole complex).
  const anchor = (c: LatLng) => (starts.length > 0 ? Math.min(...starts.map((s) => distanceM(s.at, c))) : 0);
  for (const k of PITCH_KINDS) {
    const els = (byKind.get(k) ?? []).filter((e) => e.lines.some((l) => l.length >= 4));
    if (els.length === 0) continue;
    const ranked = els
      .map((el) => ({ el, center: centerOf(el.lines) }))
      .sort((a, b) => anchor(a.center) - anchor(b.center) || a.el.osmId.localeCompare(b.el.osmId));
    // Say the same count as the Park Finds pool (S3 counts every mapped pitch, points included).
    const total = Math.max(els.length, features?.features[k]?.count ?? 0);
    list.push({ el: ranked[0].el, kind: k, center: ranked[0].center, onePitchOf: total });
  }
  return { list, starts };
}

/** Judge R7 T2: the START and the X are at least this far apart (a treasure map whose X is at START is no hunt). */
export const MIN_WALK_M = 60;
/** ... and at least this share of the park's size (its outline's diagonal), up to MAX_MIN_WALK_M. */
export const MIN_WALK_SHARE = 0.1;
export const MAX_MIN_WALK_M = 120;

/** The shortest START-to-X walk for this park: 10% of its outline's diagonal, between 60 and 120 m. */
export function minWalkM(g: Pick<ParkGeometry, "outline">): number {
  const pts = g.outline.flat();
  if (pts.length === 0) return MIN_WALK_M;
  const lats = pts.map((p) => p[0]);
  const lngs = pts.map((p) => p[1]);
  const diag = distanceM([Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]);
  return Math.round(Math.min(MAX_MIN_WALK_M, Math.max(MIN_WALK_M, diag * MIN_WALK_SHARE)));
}

/**
 * Pick the target for this pass (variant 1 = the best candidate; "Make a different pass" moves to the
 * next one). Returns null when the park has no single findable landmark (SPEC §5.4 copy).
 *
 * Judge R7 T2: the START is the mapped entrance or parking lot nearest the X that is at least minWalkM away. When the
 * chosen candidate has none that far, the next candidate (in order) that does is used; when no candidate has one,
 * the chosen candidate keeps no START (the map then says "Use the map to find the X"), never a START next to the X.
 */
export function pickTarget(
  g: ParkGeometry,
  opts: { parkName: string; features: ParkFeatures | null; variant: number },
): SpotTarget | null {
  const { list, starts } = candidates(g, opts.features);
  if (list.length === 0) return null;
  const first = (Math.max(1, opts.variant) - 1) % Math.min(list.length, 3);
  const minWalk = minWalkM(g);
  const startFor = (c: Candidate): SpotStart | null =>
    [...starts]
      .filter((s) => distanceM(s.at, c.center) >= minWalk)
      .sort((a, b) => distanceM(a.at, c.center) - distanceM(b.at, c.center) || a.osmId.localeCompare(b.osmId))[0] ?? null;
  let c = list[first];
  let start: SpotStart | null = null;
  if (starts.length > 0) {
    for (let k = 0; k < list.length; k++) {
      const cand = list[(first + k) % list.length];
      const s = startFor(cand);
      if (s) {
        c = cand;
        start = s;
        break;
      }
    }
  }
  const info = infoOf(c.kind);
  const name = safeOsmName(c.el.tags.name);

  const walk = start ? { meters: roundWalk(distanceM(start.at, c.center)), direction: compass(start.at, c.center) } : null;

  const what = c.onePitchOf
    ? c.onePitchOf > 1
      ? `the middle of one of the ${c.onePitchOf} ${FEATURE_KINDS[c.kind as FeatureKind].plural}, where the centre line is`
      : `the middle of the ${info.label}, where the centre line is`
    : `${article(info.label)} ${info.label}${name ? ` named ${name}` : ""}`;
  const sourceText = [
    `On the map of ${opts.parkName} (OpenStreetMap), the X marks ${what}.`,
    // R2-M5 follow-up: the same rotating, park-seeded facts as the Park Finds (pool/park.ts factsFor), not
    // one fixed description copied into every riddle ("a roof on posts with tables underneath").
    ...(c.kind === "toilets" ? [TOILETS.describe] : factsFor(c.kind, g.parkId, 1)),
    walk && start ? `It is about ${walk.meters} m ${walk.direction} of the START (${start.label}).` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const answer = c.onePitchOf
    ? `The middle of ${c.onePitchOf > 1 ? `one ${info.label}` : `the ${info.label}`} (centre line)${name ? `: ${name}` : ""}`
    : `The ${info.label}${name ? ` (${name})` : ""}`;

  return {
    id: `spot-${c.el.osmId.replace("/", "-")}`,
    osmId: c.el.osmId,
    kind: c.kind,
    label: info.label,
    name,
    center: c.center,
    onePitchOf: c.onePitchOf,
    sourceText,
    nameWords: [
      ...new Set([...info.nameWords.map((w) => w.toLowerCase()), ...(name ? distinctiveWords(name, { place: true, allowed: kindLabelWords(info) }) : [])]),
    ],
    answer: cap(answer),
    start,
    walk,
    poolKind: c.onePitchOf === null && c.kind !== "toilets" ? c.kind : null,
  };
}
