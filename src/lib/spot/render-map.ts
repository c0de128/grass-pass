/**
 * Find This Spot map drawing (SPEC F9, §8.4; ADR 0004 print rules). Pure and client-safe: turns the
 * stored map (already projected, clipped and simplified by src/lib/spot/geometry.ts) into SVG path
 * data and marker positions. SpotMap.tsx renders it.
 *
 * Print rules: black on white only (the hatch, dots and dashes do the work colour would do), every
 * line at least STROKE_MIN map units (>= 1 pt when the map prints >= 3.5 in wide), text with a white
 * halo so it stays readable over lines.
 */
import { MAP_H, MAP_W, type Line, type Point, type SpotMap } from "./types";

/** Thinnest line on the map, in map units (1.2 pt at the printed 3.2 in width, 1.03 pt at the 0.85 floor scale). */
export const STROKE_MIN = 2.2;

export type LayerStyle = "outline" | "road" | "path" | "waterway" | "water" | "pitch" | "parking";

/** Line weights and dashes per layer (all black). */
export const LAYER_STYLE: Record<LayerStyle, { width: number; dash?: string; fill: "none" | "hatch"; cap: "round" | "butt" }> = {
  water: { width: STROKE_MIN, fill: "hatch", cap: "round" },
  pitch: { width: STROKE_MIN, fill: "none", cap: "round" },
  parking: { width: STROKE_MIN, fill: "none", cap: "round" },
  waterway: { width: 3, dash: "0.1 5", fill: "none", cap: "round" },
  road: { width: 2.6, fill: "none", cap: "round" },
  path: { width: STROKE_MIN, dash: "6 3.5", fill: "none", cap: "butt" },
  outline: { width: 3.4, fill: "none", cap: "round" },
};

/** Drawing order: areas first, then lines, the park edge on top. */
export const LAYER_ORDER: readonly LayerStyle[] = ["water", "pitch", "parking", "waterway", "road", "path", "outline"];

const LAYER_FIELD: Record<LayerStyle, keyof Pick<SpotMap, "outline" | "roads" | "paths" | "waterways" | "water" | "pitches" | "parking">> = {
  outline: "outline",
  road: "roads",
  path: "paths",
  waterway: "waterways",
  water: "water",
  pitch: "pitches",
  parking: "parking",
};

/** "M x y L x y ..." for a polyline; closed rings end with Z. */
export function pathData(line: Line, closed: boolean): string {
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 2) parts.push(`${i === 0 ? "M" : "L"}${line[i]} ${line[i + 1]}`);
  return parts.join("") + (closed ? "Z" : "");
}

export type MapLayer = { style: LayerStyle; d: string; count: number };

export type MapDrawing = {
  viewBox: string;
  w: number;
  h: number;
  /** Non-empty layers in drawing order, one combined path each. */
  layers: MapLayer[];
  /** The X: two strokes crossing at the target. */
  x: { d: string; at: Point; size: number };
  /** Start triangle and its label position (label sits on the side with more room). */
  start: { d: string; at: Point; label: { x: number; y: number; anchor: "start" | "end" } } | null;
  north: { x: number; y: number; arrow: string };
  /** "P" labels at the middle of parking lots big enough to hold one (inside the map box). */
  parkingLabels: Point[];
  scale: { x: number; y: number; units: number; label: string; d: string };
  /** What the legend shows: only what is actually drawn. */
  legend: LayerStyle[];
};

/** X arm half-length in map units. */
export const X_SIZE = 11;
/** A parking lot gets a "P" when its box is at least this big (map units). */
export const PARKING_LABEL_MIN = 12;

export function drawMap(map: SpotMap): MapDrawing {
  const layers: MapLayer[] = [];
  for (const style of LAYER_ORDER) {
    const lines = map[LAYER_FIELD[style]];
    if (lines.length === 0) continue;
    const closed = style === "water" || style === "pitch" || style === "parking";
    layers.push({ style, d: lines.map((l) => pathData(l, closed)).join(""), count: lines.length });
  }

  const [tx, ty] = map.target;
  const s = X_SIZE;
  const x = { d: `M${tx - s} ${ty - s}L${tx + s} ${ty + s}M${tx + s} ${ty - s}L${tx - s} ${ty + s}`, at: map.target, size: s };

  let start: MapDrawing["start"] = null;
  if (map.start) {
    const [sx, sy] = map.start;
    const r = 8;
    // Triangle pointing up, centred on the start.
    const d = `M${sx} ${sy - r}L${sx + r * 0.9} ${sy + r * 0.6}L${sx - r * 0.9} ${sy + r * 0.6}Z`;
    const right = sx < MAP_W - 70;
    const ly = Math.min(MAP_H - 6, Math.max(14, sy + 5));
    start = { d, at: map.start, label: { x: right ? sx + 12 : sx - 12, y: ly, anchor: right ? "start" : "end" } };
  }

  // North arrow: top-right corner.
  const nx = MAP_W - 18;
  const ny = 12;
  const north = { x: nx, y: ny + 34, arrow: `M${nx} ${ny}L${nx + 7} ${ny + 18}L${nx} ${ny + 13}L${nx - 7} ${ny + 18}Z` };

  // Scale bar: bottom-left, ticks at both ends.
  const sx0 = 10;
  const sy0 = MAP_H - 10;
  const u = map.scale.units;
  const scale = {
    x: sx0,
    y: sy0,
    units: u,
    label: map.scale.label,
    d: `M${sx0} ${sy0 - 6}L${sx0} ${sy0}L${sx0 + u} ${sy0}L${sx0 + u} ${sy0 - 6}`,
  };

  const parkingLabels: Point[] = [];
  for (const ring of map.parking) {
    const xs = ring.filter((_, i) => i % 2 === 0);
    const ys = ring.filter((_, i) => i % 2 === 1);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (x1 - x0 < PARKING_LABEL_MIN || y1 - y0 < PARKING_LABEL_MIN) continue;
    const at: Point = [Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)];
    // Not on top of the START triangle (its label already says what is there).
    if (map.start && Math.hypot(at[0] - map.start[0], at[1] - map.start[1]) < 16) continue;
    if (at[0] < 6 || at[0] > MAP_W - 6 || at[1] < 10 || at[1] > MAP_H - 4) continue;
    parkingLabels.push(at);
  }

  return {
    viewBox: `0 0 ${map.w} ${map.h}`,
    w: map.w,
    h: map.h,
    layers,
    x,
    start,
    north,
    parkingLabels,
    scale,
    legend: layers.map((l) => l.style).filter((st) => st !== "outline"),
  };
}

/** Plain-language legend label per layer. */
export const LEGEND_LABEL: Record<LayerStyle, string> = {
  outline: "park edge",
  road: "road or drive",
  path: "path",
  waterway: "creek",
  water: "water",
  pitch: "sports field",
  parking: "parking (P)",
};
