/**
 * Find This Spot map drawing (SPEC F9, §8.4; ADR 0004 print rules). Pure and client-safe: turns the
 * stored map into SVG path data, marker and label positions. SpotMap.tsx renders it.
 *
 * map-clear (2026-10-07): framed on START and the X; START and the X are the boldest things; labels never overlap.
 * map-v2 (2026-10-08, Kevin: "really hard to read", "no reference points", "the lines ... look like a little kid drew
 * them"): a clean park trail map.
 *  - Clean lines: every layer is simplified again at the drawing scale (Douglas-Peucker) and drawn as gentle curves
 *    (`smoothPath`), with a clear hierarchy: soft flat fills for water, fields and parking; a faint park edge; thin
 *    creeks; medium solid paths; heavier roads with a casing. Tiny path stubs are left out.
 *  - The route: when the mapped paths (and park drives) connect START to the X, a bold dotted route runs ALONG them
 *    (shortest path on the path graph, `findRoute`); otherwise a bold dotted straight line, and the key says
 *    "straight line". A straight line that would cross a pond or lake is not drawn.
 *  - Landmarks: the named reference points stored on the map (landmarks.ts, real OSM objects, never the X) get an
 *    icon and a short label; a landmark whose label can't be placed clear of everything else is left out.
 *  - The key lists at most MAX_KEYS items.
 */
import { clipPolyline, clipRing, FRAME_MARGIN_X, FRAME_MARGIN_Y, MIN_SPAN_M, scaleBar, scaleLabelMetres, simplify, type Box, type XY } from "./shapes";
import { MAP_H, MAP_W, type Landmark, type LandmarkKind, type Line, type Point, type SpotMap } from "./types";

/** Thinnest line on the map, in map units (1.2 pt at the printed 3.2 in width, 1.03 pt at the 0.85 floor scale). */
export const STROKE_MIN = 2.2;

export type LayerStyle = "outline" | "road" | "path" | "waterway" | "water" | "pitch" | "parking";

/**
 * Line weights per layer (map units). Colours live in the palettes (SpotMap.tsx). `casing`: an outer line under the
 * main one (roads: a grey edge; paths: a light halo that keeps them crisp over fills). `fill`: an area layer.
 */
export const LAYER_STYLE: Record<LayerStyle, { width: number; dash?: string; fill: boolean; cap: "round" | "butt"; casing?: number }> = {
  water: { width: STROKE_MIN, fill: true, cap: "round" },
  pitch: { width: STROKE_MIN, fill: true, cap: "round" },
  parking: { width: STROKE_MIN, fill: true, cap: "round" },
  outline: { width: 2.6, dash: "10 6", fill: false, cap: "butt" },
  waterway: { width: 2.6, fill: false, cap: "round" },
  road: { width: 6, fill: false, cap: "round", casing: 9.6 },
  path: { width: 3.2, fill: false, cap: "round", casing: 6.4 },
};

/** Drawing order: areas, then the park edge, then creeks, roads and paths; the route, markers and labels go on top. */
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

/** Douglas-Peucker tolerance per layer at the drawing scale (map units; 1 unit ~ 0.55 pt printed). */
const CLEAN_TOLERANCE: Record<LayerStyle, number> = { water: 1.6, pitch: 1.2, parking: 1.2, outline: 3, waterway: 2.2, road: 1.6, path: 1.6 };
/** Open lines shorter than this (map units) are left out: stubs and slivers read as noise. */
const MIN_LINE_LEN: Partial<Record<LayerStyle, number>> = { path: 9, road: 9, waterway: 12, outline: 12 };
/** Areas smaller than this across (map units) are left out. */
const MIN_AREA_SPAN = 5;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** "M x y L x y ..." for a polyline; closed rings end with Z. */
export function pathData(line: Line, closed: boolean): string {
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 2) parts.push(`${i === 0 ? "M" : "L"}${r1(line[i])} ${r1(line[i + 1])}`);
  return parts.join("") + (closed ? "Z" : "");
}

/**
 * A gentle curve through a polyline: straight to the first midpoint, then quadratic curves with each vertex as the
 * control point and the midpoints as ends (the line keeps its ends; corners are rounded by at most half a segment).
 */
export function smoothPath(pts: readonly XY[], closed: boolean): string {
  const n = pts.length;
  if (n < 2) return "";
  const mid = (a: XY, b: XY): XY => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const P = (p: XY) => `${r1(p[0])} ${r1(p[1])}`;
  if (closed) {
    const ring = n > 1 && pts[0][0] === pts[n - 1][0] && pts[0][1] === pts[n - 1][1] ? pts.slice(0, -1) : [...pts];
    const m = ring.length;
    if (m < 3) return "";
    let d = `M${P(mid(ring[m - 1], ring[0]))}`;
    for (let i = 0; i < m; i++) d += `Q${P(ring[i])} ${P(mid(ring[i], ring[(i + 1) % m]))}`;
    return `${d}Z`;
  }
  if (n === 2) return `M${P(pts[0])}L${P(pts[1])}`;
  let d = `M${P(pts[0])}L${P(mid(pts[0], pts[1]))}`;
  for (let i = 1; i < n - 1; i++) d += `Q${P(pts[i])} ${P(mid(pts[i], pts[i + 1]))}`;
  return `${d}L${P(pts[n - 1])}`;
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
const lengthOf = (pts: readonly XY[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

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

/** One layer's lines cleaned for drawing: simplified at the drawing scale, stubs and specks left out. */
export function cleanLines(lines: readonly Line[], style: LayerStyle): XY[][] {
  const out: XY[][] = [];
  const closed = CLOSED.has(style);
  for (const l of lines) {
    const s = simplify(pairs(l), CLEAN_TOLERANCE[style]);
    if (closed) {
      const xs = s.map((p) => p[0]);
      const ys = s.map((p) => p[1]);
      if (s.length < 4 || Math.max(...xs) - Math.min(...xs) < MIN_AREA_SPAN || Math.max(...ys) - Math.min(...ys) < MIN_AREA_SPAN) continue;
    } else if (s.length < 2 || lengthOf(s) < (MIN_LINE_LEN[style] ?? 0)) continue;
    out.push(s);
  }
  return out;
}

// ---------- the route along the paths ----------

/**
 * The shortest walk from `a` to `b` along the mapped lines (map units), or null when they don't connect.
 * Lines join where they share a point, where they cross, and where one ends on another (within SNAP units: the stored
 * lines were simplified, so a junction point can sit a hair off the line it joins). `a` and `b` join the network at
 * its nearest point when that is within `maxAttach` units. Each line's length counts `cost` times (park drives cost
 * more than paths, so the route prefers paths).
 */
export function findRoute(lines: readonly { pts: readonly XY[]; cost: number }[], a: XY, b: XY, maxAttach: number): XY[] | null {
  const SNAP = 2.5;
  type Seg = { p: XY; q: XY; cost: number; ts: number[] };
  const segs: Seg[] = [];
  for (const l of lines) for (let i = 0; i < l.pts.length - 1; i++) if (l.pts[i][0] !== l.pts[i + 1][0] || l.pts[i][1] !== l.pts[i + 1][1]) segs.push({ p: l.pts[i], q: l.pts[i + 1], cost: l.cost, ts: [0, 1] });
  if (segs.length === 0) return null;

  // Spatial grid of segments for the crossing and snapping checks.
  const CELL = 24;
  const grid = new Map<string, number[]>();
  const cellsOf = (s: Seg, pad: number) => {
    const out: string[] = [];
    const [x0, x1] = [Math.min(s.p[0], s.q[0]) - pad, Math.max(s.p[0], s.q[0]) + pad];
    const [y0, y1] = [Math.min(s.p[1], s.q[1]) - pad, Math.max(s.p[1], s.q[1]) + pad];
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) out.push(`${cx},${cy}`);
    return out;
  };
  segs.forEach((s, i) => {
    for (const c of cellsOf(s, SNAP)) {
      const list = grid.get(c) ?? [];
      list.push(i);
      grid.set(c, list);
    }
  });
  const extraEdges: [XY, XY, number][] = [];
  const project = (pt: XY, s: Seg): { t: number; d: number; at: XY } => {
    const dx = s.q[0] - s.p[0];
    const dy = s.q[1] - s.p[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((pt[0] - s.p[0]) * dx + (pt[1] - s.p[1]) * dy) / l2));
    const at: XY = [s.p[0] + t * dx, s.p[1] + t * dy];
    return { t, d: Math.hypot(pt[0] - at[0], pt[1] - at[1]), at };
  };
  const seen = new Set<string>();
  for (const ids of grid.values()) {
    for (let x = 0; x < ids.length; x++) {
      for (let y = x + 1; y < ids.length; y++) {
        const i = ids[x];
        const j = ids[y];
        const key = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const s = segs[i];
        const u = segs[j];
        // Proper crossing.
        const rx = s.q[0] - s.p[0];
        const ry = s.q[1] - s.p[1];
        const sx = u.q[0] - u.p[0];
        const sy = u.q[1] - u.p[1];
        const den = rx * sy - ry * sx;
        if (Math.abs(den) > 1e-9) {
          const t = ((u.p[0] - s.p[0]) * sy - (u.p[1] - s.p[1]) * sx) / den;
          const w = ((u.p[0] - s.p[0]) * ry - (u.p[1] - s.p[1]) * rx) / den;
          if (t > 0 && t < 1 && w > 0 && w < 1) {
            s.ts.push(t);
            u.ts.push(w);
          }
        }
        // An end of one segment on (or a hair off) the other: a T-junction.
        for (const [end, other] of [
          [s.p, u],
          [s.q, u],
          [u.p, s],
          [u.q, s],
        ] as [XY, Seg][]) {
          const pr = project(end, other);
          if (pr.d <= SNAP && pr.t > 0 && pr.t < 1) {
            other.ts.push(pr.t);
            if (pr.d > 0.05) extraEdges.push([end, pr.at, 1]);
          }
        }
      }
    }
  }

  // Nodes: points merged on a 0.5-unit grid.
  const nodeId = new Map<string, number>();
  const nodes: XY[] = [];
  const idOf = (p: XY) => {
    const k = `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
    let id = nodeId.get(k);
    if (id === undefined) {
      id = nodes.length;
      nodes.push(p);
      nodeId.set(k, id);
    }
    return id;
  };
  const adj: { to: number; w: number }[][] = [];
  const edges: [number, number, number][] = [];
  const addEdge = (p: XY, q: XY, cost: number) => {
    const i = idOf(p);
    const j = idOf(q);
    if (i === j) return;
    const w = Math.hypot(p[0] - q[0], p[1] - q[1]) * cost;
    (adj[i] ??= []).push({ to: j, w });
    (adj[j] ??= []).push({ to: i, w });
    edges.push([i, j, cost]);
  };
  // Ends that are within SNAP of each other (two lines that meet at a rounded point) are joined too.
  for (const s of segs) {
    const ts = [...new Set(s.ts)].sort((x, y) => x - y);
    for (let k = 0; k < ts.length - 1; k++) {
      const p: XY = [s.p[0] + (s.q[0] - s.p[0]) * ts[k], s.p[1] + (s.q[1] - s.p[1]) * ts[k]];
      const q: XY = [s.p[0] + (s.q[0] - s.p[0]) * ts[k + 1], s.p[1] + (s.q[1] - s.p[1]) * ts[k + 1]];
      addEdge(p, q, s.cost);
    }
  }
  for (const [p, q, c] of extraEdges) addEdge(p, q, c);
  // End-to-end joins: line ends within SNAP of another node.
  const ends = segs.flatMap((s) => [s.p, s.q]);
  for (const e of ends) {
    const ie = idOf(e);
    for (let n = 0; n < nodes.length; n++) {
      if (n === ie) continue;
      const d = Math.hypot(nodes[n][0] - e[0], nodes[n][1] - e[1]);
      if (d > 0 && d <= SNAP) addEdge(e, nodes[n], 1);
    }
  }

  // Attach a and b at their nearest point on the network.
  const attach = (pt: XY): number | null => {
    let best: { i: number; j: number; at: XY; d: number; t: number; cost: number } | null = null;
    for (const [i, j, cost] of edges) {
      const pr = project(pt, { p: nodes[i], q: nodes[j], cost, ts: [] });
      if (!best || pr.d < best.d) best = { i, j, at: pr.at, d: pr.d, t: pr.t, cost };
    }
    if (!best || best.d > maxAttach) return null;
    const id = nodes.length;
    nodes.push(best.at);
    adj[id] = [];
    for (const [k, t] of [
      [best.i, best.t],
      [best.j, 1 - best.t],
    ] as [number, number][]) {
      const w = Math.hypot(nodes[k][0] - best.at[0], nodes[k][1] - best.at[1]) * best.cost;
      adj[id].push({ to: k, w });
      (adj[k] ??= []).push({ to: id, w });
      void t;
    }
    return id;
  };
  const sa = attach(a);
  const sb = attach(b);
  if (sa === null || sb === null) return null;

  // Dijkstra (binary heap).
  const dist = new Float64Array(nodes.length).fill(Infinity);
  const prev = new Int32Array(nodes.length).fill(-1);
  dist[sa] = 0;
  const heap: [number, number][] = [[0, sa]];
  const push = (e: [number, number]) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length > 0) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    if (u === sb) break;
    for (const { to, w } of adj[u] ?? []) {
      if (d + w < dist[to]) {
        dist[to] = d + w;
        prev[to] = u;
        push([d + w, to]);
      }
    }
  }
  if (!Number.isFinite(dist[sb])) return null;
  const path: XY[] = [];
  for (let u = sb; u !== -1; u = prev[u]) path.push(nodes[u]);
  path.reverse();
  return [a, ...path, b];
}

/** Cut `len` units off the start of a polyline. */
function trimStart(pts: readonly XY[], len: number): XY[] {
  let left = len;
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (seg > left) {
      const t = left / seg;
      return [[pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t], ...pts.slice(i + 1)];
    }
    left -= seg;
  }
  return [];
}
const trim = (pts: readonly XY[], a: number, b: number): XY[] => trimStart(trimStart(pts, a).reverse(), b).reverse();

/** The point `f` (0-1) of the way along a polyline, and the direction there. */
function along(pts: readonly XY[], f: number): { at: XY; dir: XY } {
  const total = lengthOf(pts);
  let left = total * f;
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (seg >= left && seg > 0) {
      const t = left / seg;
      return {
        at: [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t],
        dir: [(pts[i + 1][0] - pts[i][0]) / seg, (pts[i + 1][1] - pts[i][1]) / seg],
      };
    }
    left -= seg;
  }
  return { at: pts[pts.length - 1], dir: [1, 0] };
}

// ---------- labels ----------

export type Rect = { x0: number; y0: number; x1: number; y1: number };

/** Font sizes in map units: 17-18 units ~ 9-9.6 pt printed and >= 11 px where the map is 276 px wide (a 360 px phone, UX-6-02). */
export const LABEL_FONT = 18;
export const SMALL_FONT = 17;

/** A safe (wide) estimate of a bold label's width in map units. */
export function textWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += ch === " " ? 0.3 : /[A-Z]/.test(ch) ? 0.74 : /[0-9]/.test(ch) ? 0.62 : ch === "-" ? 0.4 : /[il.,'’]/.test(ch) ? 0.32 : 0.6;
  return w * size;
}

export type MapLabel = {
  text: string;
  /** Text anchor point (middle, baseline). */
  x: number;
  y: number;
  size: number;
  /** The box behind the text (a white box for START and the distance; the halo area for landmark names). */
  box: Rect;
  /** The text is drawn exactly this wide (SVG textLength), so it always fits its box whatever the font. */
  textLength: number;
};

const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
export const rectsOverlap = (a: Rect, b: Rect) => overlapArea(a, b) > 0;

/** A label box of `text` centred at (cx, cy). `padX`: room left and right of the text inside the box. */
export function labelAt(text: string, size: number, cx: number, cy: number, padX = 6): MapLabel {
  const tw = textWidth(text, size);
  const w = tw + 2 * padX;
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
export function placeLabel(text: string, size: number, centres: readonly XY[], obstacles: readonly Rect[], padX = 6): MapLabel {
  let best: { l: MapLabel; score: number } | null = null;
  for (const [cx, cy] of centres) {
    const l = labelAt(text, size, cx, cy, padX);
    const out = insideMap(l.box) ? 0 : 1e6;
    const score = out + obstacles.reduce((s, o) => s + overlapArea(l.box, o), 0);
    if (score === 0) return l;
    if (!best || score < best.score) best = { l, score };
  }
  return best!.l;
}

/** True when the label is inside the map and touches no obstacle. */
const isFree = (l: MapLabel, obstacles: readonly Rect[]) => insideMap(l.box) && !obstacles.some((o) => rectsOverlap(l.box, o));

// ---------- the drawing ----------

export type MapLayer = { style: LayerStyle; d: string; count: number };

export type DrawnLandmark = {
  kind: LandmarkKind;
  /** Icon centre; null for a name drawn on its own (a lake, a trail). */
  icon: Point | null;
  label: MapLabel;
};

export type RouteMode = "paths" | "straight";

export type MapDrawing = {
  viewBox: string;
  w: number;
  h: number;
  /** Non-empty, visible layers in drawing order, one combined path each (gentle curves). */
  layers: MapLayer[];
  /** The X: two strokes crossing at the target. */
  x: { d: string; at: Point; size: number };
  /** START triangle and its boxed label. */
  start: { d: string; at: Point; label: MapLabel } | null;
  /**
   * The dotted route from START to the X: along the mapped paths ("paths") or a straight line ("straight"); null when
   * there is no START or a straight line would cross water. The code-measured walk ("290 m west") is in the key.
   */
  route: { d: string; mode: RouteMode; points: Point[] } | null;
  /** Named reference points that fit (real OSM objects, never the X). */
  landmarks: DrawnLandmark[];
  /** Stored landmarks left out, and why (their icon or label would touch something, or the map is full). */
  skipped: { text: string; why: "full" | "icon" | "label" }[];
  north: { x: number; y: number; arrow: string; box: Rect };
  scale: { x: number; y: number; units: number; label: string; d: string; box: Rect };
  /** What the key shows (at most MAX_KEYS, the X and START first). */
  legend: LegendKey[];
  /** Every label box drawn (START and the landmarks), for tests and the overlap check. */
  labelBoxes: Rect[];
};

/** X arm half-length in map units. */
export const X_SIZE = 13;
/** START triangle radius in map units. */
export const START_R = 11;
/** Landmark icon radius in map units. */
export const ICON_R = 10;
/** At most this many landmarks are drawn (fewer, bigger things). */
export const MAX_DRAWN_LANDMARKS = 5;
/** The key lists at most this many items. */
export const MAX_KEYS = 5;
/** START and the X join the path network only when it is this close (metres). Farther: the straight line. */
export const ROUTE_ATTACH_M = 70;
/** A route longer than this many times the straight line (plus a little) is not believable: the straight line is used. */
export const ROUTE_MAX_DETOUR = 3;

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

export type LegendKey = "x" | "start" | "route" | "straight" | "path" | "road" | "water" | "waterway" | "pitch";

export function drawMap(stored: SpotMap, walk: Walk | null = null): MapDrawing {
  const map = reframe(stored);
  const layers: MapLayer[] = [];
  const cleaned: Partial<Record<LayerStyle, XY[][]>> = {};
  for (const style of LAYER_ORDER) {
    const lines = cleanLines(map[LAYER_FIELD[style]].filter(visible), style);
    cleaned[style] = lines;
    if (lines.length === 0) continue;
    // Water and lines get gentle curves; fields and parking lots stay crisp polygons (they are built rectangles).
    const draw = (l: XY[]) => (style === "pitch" || style === "parking" ? pathData(flat(l), true) : smoothPath(l, CLOSED.has(style)));
    layers.push({ style, d: lines.map(draw).join(""), count: lines.length });
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

  let start: MapDrawing["start"] = null;
  let route: MapDrawing["route"] = null;
  const labelBoxes: Rect[] = [];
  const routeBoxes: Rect[] = [];
  if (map.start) {
    const a: XY = [map.start[0], map.start[1]];
    const r = START_R;
    const d = `M${a[0]} ${a[1] - r}L${r1(a[0] + r * 0.95)} ${r1(a[1] + r * 0.65)}L${r1(a[0] - r * 0.95)} ${r1(a[1] + r * 0.65)}Z`;
    const startBox = square(a, r + 4);
    fixed.push(startBox);

    // The route: along the paths (park drives allowed at a higher cost) when they connect START and the X.
    const upm = unitsPerMetre(map) ?? 1;
    const network = [...(cleaned.path ?? []).map((pts) => ({ pts, cost: 1 })), ...(cleaned.road ?? []).map((pts) => ({ pts, cost: 2.5 }))];
    const straightLen = Math.hypot(t[0] - a[0], t[1] - a[1]);
    let pts: XY[] | null = walk ? findRoute(network, a, t, ROUTE_ATTACH_M * upm) : null;
    if (pts && lengthOf(pts) > ROUTE_MAX_DETOUR * straightLen + 30) pts = null;
    let mode: RouteMode = "paths";
    if (!pts && walk && !crossesWater(a, t, map.water)) {
      pts = [a, t];
      mode = "straight";
    }
    if (pts) {
      const visiblePts = trim(simplify(pts, 0.8), START_R + 5, X_SIZE + 6);
      if (visiblePts.length >= 2 && lengthOf(visiblePts) >= 12) {
        route = { d: smoothPath(visiblePts, false), mode, points: visiblePts.map((p) => [Math.round(p[0]), Math.round(p[1])] as Point) };
        const total = lengthOf(visiblePts);
        for (let k = 0; k <= total; k += 8) routeBoxes.push(square(along(visiblePts, k / total).at, 5));
      }
    }

    // START's label: on the side away from where the route leaves, then around the triangle.
    const lead = route ? along(route.points as XY[], 0.05).at : t;
    const len = Math.hypot(lead[0] - a[0], lead[1] - a[1]) || 1;
    const away: XY = [-(lead[0] - a[0]) / len, -(lead[1] - a[1]) / len];
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
    const label = placeLabel("START", LABEL_FONT, around, [...fixed.filter((f) => f !== startBox), ...routeBoxes]);
    labelBoxes.push(label.box);
    start = { d, at: map.start, label };

  }

  // Landmarks: icon + short label, nearest the walk first; left out when the icon or the label would touch anything.
  const landmarks: DrawnLandmark[] = [];
  const skipped: MapDrawing["skipped"] = [];
  // Icons may sit on the route (it runs under them: "you pass the restrooms"); labels never touch it.
  const taken: Rect[] = [...fixed, ...labelBoxes];
  const labelAvoid = () => [...taken, ...routeBoxes];
  for (const lm of stored.frame === "spot" || !stored.start ? (map.landmarks ?? []) : []) {
    if (landmarks.length >= MAX_DRAWN_LANDMARKS) {
      skipped.push({ text: lm.text, why: "full" });
      continue;
    }
    const at: XY = [lm.at[0], lm.at[1]];
    const nameOnly = lm.kind === "water" || lm.kind === "trail";
    if (nameOnly) {
      const near: XY[] = [at];
      for (const dy of [14, 24]) near.push([at[0], at[1] - dy], [at[0], at[1] + dy]);
      for (const dx of [30, 60]) near.push([at[0] - dx, at[1]], [at[0] + dx, at[1]], [at[0] - dx, at[1] - 14], [at[0] + dx, at[1] + 14]);
      const l = placeLabel(lm.text, SMALL_FONT, near, labelAvoid(), 3);
      if (!isFree(l, labelAvoid())) {
        skipped.push({ text: lm.text, why: "label" });
        continue;
      }
      landmarks.push({ kind: lm.kind, icon: null, label: l });
      taken.push(l.box);
      labelBoxes.push(l.box);
      continue;
    }
    const iconBox = square(at, ICON_R + 2);
    if (!insideMap(iconBox) || taken.some((o) => rectsOverlap(o, iconBox))) {
      skipped.push({ text: lm.text, why: "icon" });
      continue;
    }
    const half = textWidth(lm.text, SMALL_FONT) / 2 + 3;
    const g = ICON_R + 4;
    const candidates: XY[] = [
      [at[0] + g + half, at[1]],
      [at[0] - g - half, at[1]],
      [at[0], at[1] - g - 8],
      [at[0], at[1] + g + 8],
      [at[0] + g + half - 6, at[1] - g],
      [at[0] - g - half + 6, at[1] - g],
      [at[0] + g + half - 6, at[1] + g],
      [at[0] - g - half + 6, at[1] + g],
      [at[0] + half - 4, at[1] - g - 8],
      [at[0] - half + 4, at[1] - g - 8],
      [at[0] + half - 4, at[1] + g + 8],
      [at[0] - half + 4, at[1] + g + 8],
      // A wider ring, still clearly beside the icon.
      [at[0], at[1] - g - 20],
      [at[0], at[1] + g + 20],
      [at[0] + g + half - 2, at[1] - g - 10],
      [at[0] - g - half + 2, at[1] - g - 10],
      [at[0] + g + half - 2, at[1] + g + 10],
      [at[0] - g - half + 2, at[1] + g + 10],
    ];
    const obstacles = [...labelAvoid(), iconBox];
    const l = placeLabel(lm.text, SMALL_FONT, candidates, obstacles, 3);
    if (!isFree(l, obstacles)) {
      skipped.push({ text: lm.text, why: "label" });
      continue;
    }
    landmarks.push({ kind: lm.kind, icon: [Math.round(at[0]), Math.round(at[1])], label: l });
    taken.push(iconBox, l.box);
    labelBoxes.push(l.box);
  }

  // The key: the X, START, the most useful visible layers, and the route LAST (it gets its own row: it carries the walk);
  // at most MAX_KEYS.
  const has = (st: LayerStyle) => layers.some((l) => l.style === st);
  const legend: LegendKey[] = ["x"];
  if (start) legend.push("start");
  const room = MAX_KEYS - (route ? 1 : 0);
  for (const k of ["path", "road", "water", "waterway", "pitch"] as const) if (has(k) && legend.length < room) legend.push(k);
  if (route) legend.push(route.mode === "paths" ? "route" : "straight");

  return {
    viewBox: `0 0 ${map.w} ${map.h}`,
    w: map.w,
    h: map.h,
    layers,
    x,
    start,
    route,
    landmarks,
    skipped,
    north,
    scale,
    legend,
    labelBoxes,
  };
}

/** The key's words for one item; the route's line carries the code-measured walk ("walk this way (the X is 290 m west)"). */
export function legendLabel(k: LegendKey, walk: Walk | null): string {
  const w = walk ? ` (the X is ${walk.meters} m ${walk.direction})` : "";
  if (k === "route") return `walk this way${w}`;
  if (k === "straight") return `straight line${w}`;
  return LEGEND_LABEL[k];
}

/** Plain-language key labels (legendLabel adds the walk to the route's). */
export const LEGEND_LABEL: Record<LegendKey, string> = {
  x: "the spot",
  start: "START (begin here)",
  route: "walk this way",
  straight: "straight line",
  path: "path or trail",
  road: "road",
  water: "water",
  waterway: "creek",
  pitch: "sports field",
};
