/**
 * map-v2 (Kevin, 2026-10-08: "there are no reference points"): the named reference points on a Find This Spot map.
 *
 * Code picks them, never the model, and only from the real OpenStreetMap objects of this park's map answer:
 * a playground, restrooms, a shelter or pavilion, a bridge, a dog park, sports fields, parking, the name of a pond or
 * lake, the name of a trail. Each is drawn as a small icon with a short label (render-map.ts places the labels so they
 * never overlap; one that can't be placed is left out).
 *
 * They must never give the answer away: the X's own object is never a landmark, nor anything of the same kind as the
 * X (a "Playground" label on a map whose X is the playground), nor anything within LANDMARK_CLEAR_OF_X_M of the X,
 * nor anything that carries the X's name. The START's own parking lot or entrance is not one either (START is labelled).
 * A park with none of these mapped near the walk shows none: there are no made-up labels.
 */
import "server-only";
import { safeOsmName } from "./pick-target";
import type { GeoElement, LatLng, ParkGeometry } from "./geometry";
import type { Landmark, LandmarkKind } from "./types";
import { MAP_H, MAP_W } from "./types";

/** At most this many landmarks are stored (the drawing shows those whose labels fit, at most MAX_DRAWN_LANDMARKS). */
export const MAX_LANDMARKS = 6;
/** Nothing within this many metres of the X is a landmark (it would point at the answer). */
export const LANDMARK_CLEAR_OF_X_M = 45;
/** ... nor within this many metres of START (START is already labelled). */
export const LANDMARK_CLEAR_OF_START_M = 25;
/** Landmarks sit at least this far inside the map box (map units), so the icon and its label fit. */
const EDGE = 14;
/** A name longer than this is replaced by the kind's short label. */
export const LANDMARK_NAME_MAX = 22;

const PITCH_LABEL: Record<string, string> = {
  soccer: "Soccer field",
  football: "Football field",
  baseball: "Ball field",
  softball: "Ball field",
  basketball: "Basketball court",
  tennis: "Tennis courts",
  volleyball: "Volleyball court",
  pickleball: "Pickleball courts",
};

const KIND_LABEL: Record<Exclude<LandmarkKind, "water" | "trail" | "pitch">, string> = {
  playground: "Playground",
  toilets: "Restrooms",
  shelter: "Shelter",
  bridge: "Bridge",
  parking: "Parking",
  dog_park: "Dog park",
  splash_pad: "Splash pad",
  fountain: "Fountain",
  viewpoint: "Lookout",
  tower: "Tower",
};

/** The landmark kind of a mapped element, or null. Equipment inside a playground (a slide) is not a landmark. */
export function landmarkKindOf(tags: Record<string, string>): LandmarkKind | null {
  if (tags.amenity === "toilets") return "toilets";
  if (tags.amenity === "parking") return "parking";
  if (tags.amenity === "shelter") return "shelter";
  if (tags.amenity === "fountain") return "fountain";
  if (tags.leisure === "playground") return "playground";
  if (tags.leisure === "dog_park") return "dog_park";
  if (tags.leisure === "splash_pad") return "splash_pad";
  if (tags.leisure === "pitch") return "pitch";
  if (tags.tourism === "viewpoint") return "viewpoint";
  if (tags.man_made === "tower" || tags.man_made === "observation_tower") return "tower";
  // A footbridge (or a mapped bridge structure); a road bridge is not a place a kid walks to.
  if (tags.man_made === "bridge") return "bridge";
  if (tags.bridge && tags.bridge !== "no" && /^(footway|path|cycleway|pedestrian|track|bridleway|steps)$/.test(tags.highway ?? "")) return "bridge";
  if (tags.natural === "water") return tags.name ? "water" : null;
  if (tags.highway && /^(footway|path|cycleway|pedestrian|track|bridleway)$/.test(tags.highway)) return tags.name ? "trail" : null;
  return null;
}

/** The short label: the OSM name for water and trails (and a short named shelter), else the kind's plain word. */
export function landmarkText(kind: LandmarkKind, tags: Record<string, string>): string | null {
  const name = safeOsmName(tags.name);
  const short = name && name.length <= LANDMARK_NAME_MAX ? name : null;
  if (kind === "water" || kind === "trail") return short;
  if (kind === "pitch") return PITCH_LABEL[(tags.sport ?? "").split(";")[0].trim()] ?? "Sports field";
  if (kind === "shelter" && short && /pavilion|shelter/i.test(short)) return short;
  return KIND_LABEL[kind];
}

type Proj = (p: LatLng) => [number, number];

const inBox = ([x, y]: [number, number]) => x >= EDGE && x <= MAP_W - EDGE && y >= EDGE && y <= MAP_H - EDGE;

function pointInRing(p: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The point of a pond or lake on the map that is deepest inside its water (farthest from its shore), on a 6-unit grid,
 * or null when less than WATER_LABEL_DEPTH units of water show (a sliver can't hold a name).
 */
export const WATER_LABEL_DEPTH = 9;
function deepestInside(ring: [number, number][]): [number, number] | null {
  let best: [number, number] | null = null;
  let bestD = WATER_LABEL_DEPTH;
  for (let x = EDGE + 30; x <= MAP_W - EDGE - 30; x += 6) {
    for (let y = EDGE + 8; y <= MAP_H - EDGE - 8; y += 6) {
      const p: [number, number] = [x, y];
      if (!pointInRing(p, ring)) continue;
      let d = Infinity;
      for (let i = 0; i < ring.length - 1 && d > bestD; i++) d = Math.min(d, distToSegment(p, ring[i], ring[i + 1]));
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

/** Distance from p to segment a-b. */
export function distToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Where a landmark's icon goes (map units): an area's centre (inside it), a line's point nearest `near`, a node. */
function anchorOf(el: GeoElement, kind: LandmarkKind, toMap: Proj, near: [number, number]): [number, number] | null {
  const longest = [...el.lines].sort((a, b) => b.length - a.length)[0];
  const pts = longest.map(toMap);
  if (pts.length === 1) return pts[0];
  const closed = longest.length >= 4 && longest[0][0] === longest.at(-1)![0] && longest[0][1] === longest.at(-1)![1];
  if (closed) {
    if (kind === "water") return deepestInside(pts);
    // An area: its centre when that is inside it and on the map, else the mean of its visible points.
    const all: [number, number] = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    if (inBox(all) && pointInRing(all, pts)) return all;
    const vis = pts.filter(inBox);
    return vis.length > 0 ? [vis.reduce((s, p) => s + p[0], 0) / vis.length, vis.reduce((s, p) => s + p[1], 0) / vis.length] : null;
  }
  // A line (a trail, a bridge): its visible point nearest the walk.
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    for (const t of [0, 0.25, 0.5, 0.75]) {
      const p: [number, number] = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
      if (!inBox(p)) continue;
      const d = Math.hypot(p[0] - near[0], p[1] - near[1]);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

/**
 * The landmarks for this map, nearest the START-to-X walk first, one per kind, at most MAX_LANDMARKS.
 * `toMap` is the map's projection; `unitsPerM` its scale; `target` and `start` are in map units.
 */
export function pickLandmarks(
  g: ParkGeometry,
  opts: { toMap: Proj; unitsPerM: number; target: [number, number]; start: [number, number] | null; targetId: string; startId: string | null },
): Landmark[] {
  const targetEl = g.elements.find((e) => e.osmId === opts.targetId);
  const targetTags = targetEl?.tags ?? {};
  const targetKind = targetEl ? landmarkKindOf(targetTags) : null;
  const targetName = safeOsmName(targetTags.name)?.toLowerCase() ?? null;
  const a = opts.start ?? opts.target;
  const mid: [number, number] = [(a[0] + opts.target[0]) / 2, (a[1] + opts.target[1]) / 2];
  const clearX = LANDMARK_CLEAR_OF_X_M * opts.unitsPerM;
  const clearStart = LANDMARK_CLEAR_OF_START_M * opts.unitsPerM;

  const found: (Landmark & { d: number })[] = [];
  for (const el of g.elements) {
    if (el.osmId === opts.targetId || el.osmId === opts.startId) continue;
    const kind = landmarkKindOf(el.tags);
    if (!kind) continue;
    // Never the answer: not the X's kind (a pitch of the X's sport, or the same landmark kind), nor its name.
    if (kind === targetKind) continue;
    const text = landmarkText(kind, el.tags);
    if (!text) continue;
    const name = safeOsmName(el.tags.name)?.toLowerCase();
    if (targetName && name && (name === targetName || name.includes(targetName) || targetName.includes(name))) continue;
    const at = anchorOf(el, kind, opts.toMap, mid);
    if (!at || !inBox(at)) continue;
    if (Math.hypot(at[0] - opts.target[0], at[1] - opts.target[1]) < clearX) continue;
    if (opts.start && Math.hypot(at[0] - opts.start[0], at[1] - opts.start[1]) < clearStart) continue;
    const d = opts.start ? distToSegment(at, opts.start, opts.target) : Math.hypot(at[0] - opts.target[0], at[1] - opts.target[1]);
    found.push({ osmId: el.osmId, kind, text, at: [Math.round(at[0]), Math.round(at[1])], d });
  }
  found.sort((x, y) => x.d - y.d || x.osmId.localeCompare(y.osmId));
  const out: Landmark[] = [];
  const kinds = new Set<string>();
  for (const f of found) {
    // One per kind (and one per label: two "Ball field" pitches are one reference point).
    const key = f.kind === "pitch" ? `pitch:${f.text}` : f.kind;
    if (kinds.has(key)) continue;
    kinds.add(key);
    out.push({ osmId: f.osmId, kind: f.kind, text: f.text, at: f.at });
    if (out.length >= MAX_LANDMARKS) break;
  }
  return out;
}
