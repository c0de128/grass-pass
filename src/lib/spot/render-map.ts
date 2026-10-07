/**
 * Find This Spot map drawing (SPEC F9, §8.4; ADR 0004 print rules). Pure and client-safe: turns the
 * stored map into SVG path data, marker and label positions. SpotMap.tsx renders it.
 *
 * map-clear (2026-10-07, Kevin: "the maps are pretty bad"): the map is about getting from START to the X.
 *  - Framed on START and the X, not the whole park. New maps are stored framed (geometry.ts buildMap); an older
 *    whole-park map is re-framed here from its own stored shapes (`reframe`), never from other data.
 *  - START and the X are the boldest things on the map. Their labels never overlap each other, the arrow, the
 *    north arrow or the scale bar (`placeLabel` tries spots around each marker and keeps the first free one).
 *  - A row of chevrons points from START toward the X: a straight line, labelled with the code-measured distance
 *    and direction ("290 m west"). It is a direction, not a route: it is left out when it would cross a pond or lake.
 *  - The legend lists only what is visible inside the frame.
 *
 * Print rules: black on white only (patterns, dashes and double lines do the work colour would do), every line
 * at least STROKE_MIN map units (>= 1 pt when the map prints >= 3.1 in wide), text in white boxes or with a white
 * halo so it stays readable over lines.
 */
import { clipPolyline, clipRing, FRAME_MARGIN_X, FRAME_MARGIN_Y, MIN_SPAN_M, scaleBar, scaleLabelMetres, simplify, type Box, type XY } from "./shapes";
import { MAP_H, MAP_W, type Line, type Point, type SpotMap } from "./types";

/** Thinnest line on the map, in map units (1.2 pt at the printed 3.2 in width, 1.03 pt at the 0.85 floor scale). */
export const STROKE_MIN = 2.2;

export type LayerStyle = "outline" | "road" | "path" | "waterway" | "water" | "pitch" | "parking";

/**
 * Line weights, dashes and fills per layer (all black). A road is a double line (black casing, white core),
 * so it reads as a street and never as a path. `casing` is the road's outer width.
 */
export const LAYER_STYLE: Record<LayerStyle, { width: number; dash?: string; fill: "none" | "hatch" | "dots"; cap: "round" | "butt"; casing?: number }> = {
  water: { width: STROKE_MIN, fill: "hatch", cap: "round" },
  pitch: { width: STROKE_MIN, fill: "dots", cap: "round" },
  parking: { width: STROKE_MIN, fill: "none", cap: "round" },
  outline: { width: 2.4, dash: "14 5 3 5", fill: "none", cap: "butt" },
  waterway: { width: 3.2, dash: "0.1 5.5", fill: "none", cap: "round" },
  road: { width: 3.2, fill: "none", cap: "round", casing: 7.2 },
  path: { width: STROKE_MIN, dash: "7 4", fill: "none", cap: "butt" },
};

/** Drawing order: areas, then the park edge, then creeks, roads and paths; markers and labels go on top. */
export const LAYER_ORDER: readonly LayerStyle[] = ["water", "pitch", "parking", "outline", "waterway", "road", "path"];

const LAYER_FIELD: Record<LayerStyle, keyof Pick<SpotMap, "outline" | "roads" | "paths" | "waterways" | "water" | "pitches" | "parking">> = {
  outline: "outline",
  road: "roads",
  path: "paths",
  waterway: "waterways",
  water: "water",
  pitch: "pitches",
  parking: "parking",
};

const CLOSED: ReadonlySet<LayerStyle> = new Set(["water", "pitch", "parking"]);

const r1 = (n: number) => Math.round(n * 10) / 10;

/** "M x y L x y ..." for a polyline; closed rings end with Z. */
export function pathData(line: Line, closed: boolean): string {
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 2) parts.push(`${i === 0 ? "M" : "L"}${r1(line[i])} ${r1(line[i + 1])}`);
  return parts.join("") + (closed ? "Z" : "");
}

// ---------- framing ----------

/** The box everything is clipped to (a hair outside the frame, so lines run off the edge cleanly). */
const CLIP_BOX: Box = { x0: -2, y0: -2, x1: MAP_W + 2, y1: MAP_H + 2 };

const pairs = (l: Line): XY[] => {
  const out: XY[] = [];
  for (let i = 0; i < l.length; i += 2) out.push([l[i], l[i + 1]]);
  return out;
};
const flat = (pts: readonly XY[]): Line => pts.flatMap(([x, y]) => [r1(x), r1(y)]);

/** Map units per metre of a stored map: its own field, else read back from its scale label. Null when unknown. */
export function unitsPerMetre(map: SpotMap): number | null {
  if (map.unitsPerM) return map.unitsPerM;
  const m = scaleLabelMetres(map.scale.label);
  return m ? map.scale.units / m : null;
}

/**
 * An older whole-park map, re-framed on START and the X from its OWN stored shapes (zoom about their midpoint,
 * clip, simplify the zoomed stair-steps). Maps that are already framed, have no START or no readable scale are
 * returned as they are. Nothing is added: every line is a stored line, cut and scaled.
 */
export function reframe(map: SpotMap): SpotMap {
  if (map.frame === "spot" || !map.start) return map;
  const upm = unitsPerMetre(map);
  if (!upm) return map;
  const [sx, sy] = map.start;
  const [tx, ty] = map.target;
  const dx = Math.abs(sx - tx);
  const dy = Math.abs(sy - ty);
  const innerW = MAP_W - 2 * FRAME_MARGIN_X;
  const innerH = MAP_H - 2 * FRAME_MARGIN_Y;
  const maxK = MAP_W / MIN_SPAN_M / upm;
  const k = Math.max(1, Math.min(maxK, dx > 0 ? innerW / dx : Infinity, dy > 0 ? innerH / dy : Infinity));
  const cx = (sx + tx) / 2;
  const cy = (sy + ty) / 2;
  const to = ([x, y]: XY): XY => [MAP_W / 2 + (x - cx) * k, MAP_H / 2 + (y - cy) * k];
  // The stored shapes were rounded to whole units: zoomed k times that is k-unit stair-steps; simplify them away.
  const tol = Math.max(0.6, k * 0.55);
  const layer = (lines: Line[], closed: boolean): Line[] => {
    const out: Line[] = [];
    for (const l of lines) {
      const pts = pairs(l).map(to);
      const pieces = closed ? [clipRing(pts, CLIP_BOX)].filter((p) => p.length > 3) : clipPolyline(pts, CLIP_BOX);
      for (const p of pieces) {
        const s = simplify(p, tol);
        if (s.length >= 2) out.push(flat(s));
      }
    }
    return out;
  };
  const unitsPerM = upm * k;
  const rp = (p: XY): Point => [Math.round(p[0]), Math.round(p[1])];
  return {
    ...map,
    outline: layer(map.outline, false),
    roads: layer(map.roads, false),
    paths: layer(map.paths, false),
    waterways: layer(map.waterways, false),
    water: layer(map.water, true),
    pitches: layer(map.pitches, true),
    parking: layer(map.parking, true),
    target: rp(to(map.target)),
    start: rp(to(map.start)),
    scale: scaleBar(unitsPerM, MAP_W * 0.3),
    frame: "spot",
    unitsPerM,
  };
}

// ---------- labels ----------

export type Rect = { x0: number; y0: number; x1: number; y1: number };

/** Font sizes in map units: 17-18 units ~ 9-9.6 pt printed and >= 11 px where the map is 276 px wide (a 360 px phone, UX-6-02). */
export const LABEL_FONT = 18;
export const SMALL_FONT = 17;

/** A safe (wide) estimate of a bold label's width in map units. */
export function textWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += ch === " " ? 0.3 : /[A-Z]/.test(ch) ? 0.74 : /[0-9]/.test(ch) ? 0.62 : ch === "-" ? 0.4 : 0.6;
  return w * size;
}

export type MapLabel = {
  text: string;
  /** Text anchor point (middle, baseline). */
  x: number;
  y: number;
  size: number;
  /** The white box behind the text. */
  box: Rect;
  /** The text is drawn exactly this wide (SVG textLength), so it always fits its box whatever the font. */
  textLength: number;
};

const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
export const rectsOverlap = (a: Rect, b: Rect) => overlapArea(a, b) > 0;

/** A label box of `text` centred at (cx, cy). */
export function labelAt(text: string, size: number, cx: number, cy: number): MapLabel {
  const tw = textWidth(text, size);
  const w = tw + 12;
  const h = size * 1.3;
  return { text, size, textLength: r1(tw), x: r1(cx), y: r1(cy + size * 0.36), box: { x0: r1(cx - w / 2), y0: r1(cy - h / 2), x1: r1(cx + w / 2), y1: r1(cy + h / 2) } };
}

/** Inside the map with a small margin. */
const INSIDE: Rect = { x0: 3, y0: 3, x1: MAP_W - 3, y1: MAP_H - 3 };
const insideMap = (r: Rect) => r.x0 >= INSIDE.x0 && r.y0 >= INSIDE.y0 && r.x1 <= INSIDE.x1 && r.y1 <= INSIDE.y1;

/**
 * The first candidate centre whose label box is inside the map and clear of every obstacle; when none is
 * free, the one with the least overlap (still inside the map when any candidate is).
 */
export function placeLabel(text: string, size: number, centres: readonly XY[], obstacles: readonly Rect[]): MapLabel {
  let best: { l: MapLabel; score: number } | null = null;
  for (const [cx, cy] of centres) {
    const l = labelAt(text, size, cx, cy);
    const out = insideMap(l.box) ? 0 : 1e6;
    const score = out + obstacles.reduce((s, o) => s + overlapArea(l.box, o), 0);
    if (score === 0) return l;
    if (!best || score < best.score) best = { l, score };
  }
  return best!.l;
}

// ---------- the drawing ----------

export type MapLayer = { style: LayerStyle; d: string; count: number };

export type MapDrawing = {
  viewBox: string;
  w: number;
  h: number;
  /** Non-empty, visible layers in drawing order, one combined path each. */
  layers: MapLayer[];
  /** The X: two strokes crossing at the target. */
  x: { d: string; at: Point; size: number };
  /** START triangle and its boxed label. */
  start: { d: string; at: Point; label: MapLabel } | null;
  /** Chevrons from START toward the X (a straight line) and the distance label, or null. */
  arrow: { d: string; label: MapLabel | null } | null;
  north: { x: number; y: number; arrow: string; box: Rect };
  /** "P" labels at the middle of parking lots big enough to hold one, clear of the other labels. */
  parkingLabels: Point[];
  scale: { x: number; y: number; units: number; label: string; d: string; box: Rect };
  /** What the legend shows: only layers actually visible in the frame. */
  legend: LayerStyle[];
  /** Every label box drawn (START, arrow distance), for tests and the overlap check. */
  labelBoxes: Rect[];
};

/** X arm half-length in map units. */
export const X_SIZE = 13;
/** START triangle radius in map units. */
export const START_R = 11;
/** A parking lot gets a "P" when its box is at least this big (map units). */
export const PARKING_LABEL_MIN = 16;

/** Chevron spacing and the gaps the arrow leaves around START and the X. */
const CHEVRON_STEP = 17;
const ARROW_GAP_START = START_R + 9;
const ARROW_GAP_X = X_SIZE + 10;

const square = ([x, y]: XY, r: number): Rect => ({ x0: x - r, y0: y - r, x1: x + r, y1: y + r });

/** Do segments a-b and c-d cross? */
function segmentsCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const o = (p: XY, q: XY, r: XY) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

function pointInRing(p: XY, ring: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when the straight segment a-b touches a pond or lake (crosses its edge or starts inside it). */
export function crossesWater(a: XY, b: XY, water: readonly Line[]): boolean {
  for (const l of water) {
    const ring = pairs(l);
    if (pointInRing(a, ring) || pointInRing(b, ring)) return true;
    for (let i = 0; i < ring.length - 1; i++) if (segmentsCross(a, b, ring[i], ring[i + 1])) return true;
  }
  return false;
}

/** Does any piece of this line show inside the map box? */
function visible(l: Line): boolean {
  for (let i = 0; i < l.length; i += 2) if (l[i] >= 0 && l[i] <= MAP_W && l[i + 1] >= 0 && l[i + 1] <= MAP_H) return true;
  // A segment can cross the box with both ends outside (a long straight road).
  const pts = pairs(l);
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = clipPolyline([pts[i], pts[i + 1]], { x0: 0, y0: 0, x1: MAP_W, y1: MAP_H });
    if (seg.length > 0) return true;
  }
  return false;
}

export type Walk = { meters: number; direction: string };

export function drawMap(stored: SpotMap, walk: Walk | null = null): MapDrawing {
  const map = reframe(stored);
  const layers: MapLayer[] = [];
  for (const style of LAYER_ORDER) {
    const lines = map[LAYER_FIELD[style]].filter(visible);
    if (lines.length === 0) continue;
    layers.push({ style, d: lines.map((l) => pathData(l, CLOSED.has(style))).join(""), count: lines.length });
  }

  const t: XY = [map.target[0], map.target[1]];
  const s = X_SIZE;
  const x = { d: `M${t[0] - s} ${t[1] - s}L${t[0] + s} ${t[1] + s}M${t[0] + s} ${t[1] - s}L${t[0] - s} ${t[1] + s}`, at: map.target, size: s };

  // North arrow: small, top-right corner, on a white card.
  const nx = MAP_W - 17;
  const ny = 9;
  const north = {
    x: nx,
    y: ny + 31,
    arrow: `M${nx} ${ny}L${nx + 6} ${ny + 16}L${nx} ${ny + 12}L${nx - 6} ${ny + 16}Z`,
    box: { x0: nx - 12, y0: 3, x1: nx + 12, y1: ny + 36 },
  };

  // Scale bar: bottom-left, ticks at both ends, its label above it, on a white card.
  const sx0 = 12;
  const sy0 = MAP_H - 10;
  const u = map.scale.units;
  const scaleText = map.scale.label;
  const scale = {
    x: sx0,
    y: sy0,
    units: u,
    label: scaleText,
    d: `M${sx0} ${sy0 - 6}L${sx0} ${sy0}L${r1(sx0 + u)} ${sy0}L${r1(sx0 + u)} ${sy0 - 6}`,
    box: { x0: 3, y0: sy0 - 11 - SMALL_FONT * 1.2, x1: r1(Math.max(sx0 + u, sx0 + textWidth(scaleText, SMALL_FONT)) + 6), y1: MAP_H - 3 },
  };

  const xBox = square(t, s + 5);
  const fixed: Rect[] = [north.box, scale.box, xBox];

  // START, and the chevrons from START toward the X.
  let start: MapDrawing["start"] = null;
  let arrow: MapDrawing["arrow"] = null;
  const labelBoxes: Rect[] = [];
  const chevronBoxes: Rect[] = [];
  if (map.start) {
    const a: XY = [map.start[0], map.start[1]];
    const r = START_R;
    const d = `M${a[0]} ${a[1] - r}L${r1(a[0] + r * 0.95)} ${r1(a[1] + r * 0.65)}L${r1(a[0] - r * 0.95)} ${r1(a[1] + r * 0.65)}Z`;
    const startBox = square(a, r + 4);
    fixed.push(startBox);

    const len = Math.hypot(t[0] - a[0], t[1] - a[1]);
    const ux = len > 0 ? (t[0] - a[0]) / len : 1;
    const uy = len > 0 ? (t[1] - a[1]) / len : 0;
    const arrowObstacles: Rect[] = chevronBoxes;
    const from: XY = [a[0] + ux * ARROW_GAP_START, a[1] + uy * ARROW_GAP_START];
    const to: XY = [t[0] - ux * ARROW_GAP_X, t[1] - uy * ARROW_GAP_X];
    const arrowLen = len - ARROW_GAP_START - ARROW_GAP_X;
    if (walk && arrowLen >= CHEVRON_STEP && !crossesWater(from, to, map.water)) {
      const parts: string[] = [];
      for (let k = CHEVRON_STEP / 2; k <= arrowLen; k += CHEVRON_STEP) {
        const tip: XY = [from[0] + ux * k, from[1] + uy * k];
        const back: XY = [tip[0] - ux * 5.5, tip[1] - uy * 5.5];
        parts.push(`M${r1(back[0] - uy * 5)} ${r1(back[1] + ux * 5)}L${r1(tip[0])} ${r1(tip[1])}L${r1(back[0] + uy * 5)} ${r1(back[1] - ux * 5)}`);
        arrowObstacles.push(square(tip, 6));
      }
      arrow = { d: parts.join(""), label: null };
    }

    // START's label: on the side away from the X first, then around the triangle.
    const away: XY = [-ux, -uy];
    const gap = r + 6;
    const w2 = (textWidth("START", LABEL_FONT) + 12) / 2;
    const h2 = (LABEL_FONT * 1.3) / 2;
    const around: XY[] = [
      [a[0] + away[0] * (gap + w2), a[1] + away[1] * (gap + h2)],
      [a[0] + gap + w2, a[1]],
      [a[0] - gap - w2, a[1]],
      [a[0], a[1] + gap + h2],
      [a[0], a[1] - gap - h2],
      [a[0] + gap + w2 * 0.8, a[1] + gap + h2 * 0.6],
      [a[0] - gap - w2 * 0.8, a[1] + gap + h2 * 0.6],
      [a[0] + gap + w2 * 0.8, a[1] - gap - h2 * 0.6],
      [a[0] - gap - w2 * 0.8, a[1] - gap - h2 * 0.6],
    ];
    const label = placeLabel("START", LABEL_FONT, around, [...fixed.filter((f) => f !== startBox), ...arrowObstacles]);
    labelBoxes.push(label.box);
    start = { d, at: map.start, label };

    // The distance label beside the chevrons ("290 m west"), on whichever side is free.
    if (arrow && walk) {
      const text = `${walk.meters} m ${walk.direction}`;
      const nxv = -uy;
      const nyv = ux;
      const lw = textWidth(text, LABEL_FONT) + 12;
      const lh = LABEL_FONT * 1.3;
      // How far from the line the box centre must be so the box clears it (depends on the line's angle).
      const off = Math.abs(nxv) * (lw / 2) + Math.abs(nyv) * (lh / 2) + 7;
      const centres: XY[] = [];
      for (const f of [0.5, 0.38, 0.62, 0.28, 0.72]) {
        const m: XY = [from[0] + ux * arrowLen * f, from[1] + uy * arrowLen * f];
        centres.push([m[0] + nxv * off, m[1] + nyv * off], [m[0] - nxv * off, m[1] - nyv * off]);
      }
      const l = placeLabel(text, LABEL_FONT, centres, [...fixed, ...arrowObstacles, label.box]);
      if (insideMap(l.box)) {
        arrow.label = l;
        labelBoxes.push(l.box);
      }
    }
  }

  const taken: Rect[] = [...fixed, ...labelBoxes, ...chevronBoxes];
  const parkingLabels: Point[] = [];
  const parkingVisible = map.parking.filter(visible);
  for (const ring of parkingVisible) {
    const xs = ring.filter((_, i) => i % 2 === 0);
    const ys = ring.filter((_, i) => i % 2 === 1);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (x1 - x0 < PARKING_LABEL_MIN || y1 - y0 < PARKING_LABEL_MIN) continue;
    const at: Point = [Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)];
    const box = square([at[0], at[1]], 8);
    if (!insideMap(box) || taken.some((r) => rectsOverlap(r, box))) continue;
    taken.push(box);
    parkingLabels.push(at);
  }

  return {
    viewBox: `0 0 ${map.w} ${map.h}`,
    w: map.w,
    h: map.h,
    layers,
    x,
    start,
    arrow,
    north,
    parkingLabels,
    scale,
    legend: layers.map((l) => l.style),
    labelBoxes,
  };
}

/** Plain-language legend label per layer. */
export const LEGEND_LABEL: Record<LayerStyle, string> = {
  outline: "park edge",
  road: "road",
  path: "path or trail",
  waterway: "creek",
  water: "water",
  pitch: "sports field",
  parking: "parking (P)",
};
