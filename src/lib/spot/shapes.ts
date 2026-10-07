/**
 * Plane geometry for the Find This Spot map (client-safe, pure): line simplification, clipping to a box,
 * the scale bar and the START-and-X frame. Used when a map is built (geometry.ts, server) and when an
 * older whole-park map is re-framed for drawing (render-map.ts, server or browser).
 */

export type Box = { x0: number; y0: number; x1: number; y1: number };
export type XY = [number, number];

/** Douglas-Peucker simplification of a polyline of [x, y] points. */
export function simplify(points: readonly XY[], tolerance: number): XY[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop()!;
    const [ax, ay] = points[s];
    const [bx, by] = points[e];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const [px, py] = points[i];
      const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Liang-Barsky: the part of segment p-q inside the box, or null. */
export function clipSegment(p: XY, q: XY, b: Box): [XY, XY] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const checks: [number, number][] = [
    [-dx, p[0] - b.x0],
    [dx, b.x1 - p[0]],
    [-dy, p[1] - b.y0],
    [dy, b.y1 - p[1]],
  ];
  for (const [pp, qq] of checks) {
    if (pp === 0) {
      if (qq < 0) return null;
      continue;
    }
    const r = qq / pp;
    if (pp < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [
    [p[0] + t0 * dx, p[1] + t0 * dy],
    [p[0] + t1 * dx, p[1] + t1 * dy],
  ];
}

/** Clip a polyline to a box; a line that leaves and re-enters becomes several pieces. */
export function clipPolyline(points: readonly XY[], box: Box): XY[][] {
  const out: XY[][] = [];
  let cur: XY[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const seg = clipSegment(points[i], points[i + 1], box);
    if (!seg) {
      if (cur.length > 1) out.push(cur);
      cur = [];
      continue;
    }
    const [a, b] = seg;
    const last = cur.at(-1);
    if (!last || Math.abs(last[0] - a[0]) > 1e-6 || Math.abs(last[1] - a[1]) > 1e-6) {
      if (cur.length > 1) out.push(cur);
      cur = [a];
    }
    cur.push(b);
    // The segment was cut at its end: the line leaves the box here.
    if (Math.abs(b[0] - points[i + 1][0]) > 1e-6 || Math.abs(b[1] - points[i + 1][1]) > 1e-6) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Sutherland-Hodgman: a closed ring clipped to a box (still a closed ring), or [] when it is outside. */
export function clipRing(points: readonly XY[], box: Box): XY[] {
  const edges: { inside: (p: XY) => boolean; cut: (a: XY, b: XY) => XY }[] = [
    { inside: (p) => p[0] >= box.x0, cut: (a, b) => [box.x0, a[1] + ((b[1] - a[1]) * (box.x0 - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[0] <= box.x1, cut: (a, b) => [box.x1, a[1] + ((b[1] - a[1]) * (box.x1 - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[1] >= box.y0, cut: (a, b) => [a[0] + ((b[0] - a[0]) * (box.y0 - a[1])) / (b[1] - a[1]), box.y0] },
    { inside: (p) => p[1] <= box.y1, cut: (a, b) => [a[0] + ((b[0] - a[0]) * (box.y1 - a[1])) / (b[1] - a[1]), box.y1] },
  ];
  let poly: XY[] = points.slice(0, points.length > 1 && points[0][0] === points.at(-1)![0] && points[0][1] === points.at(-1)![1] ? -1 : undefined) as XY[];
  for (const e of edges) {
    if (poly.length === 0) break;
    const next: XY[] = [];
    for (let i = 0; i < poly.length; i++) {
      const cur = poly[i];
      const prev = poly[(i + poly.length - 1) % poly.length];
      if (e.inside(cur)) {
        if (!e.inside(prev)) next.push(e.cut(prev, cur));
        next.push(cur);
      } else if (e.inside(prev)) next.push(e.cut(prev, cur));
    }
    poly = next;
  }
  if (poly.length < 3) return [];
  return [...poly, poly[0]];
}

/** Nice scale-bar lengths in metres. */
const NICE_M = [10, 20, 25, 50, 100, 200, 250, 500, 1_000, 2_000, 5_000];

/** The longest nice length that fits in `maxUnits` at `unitsPerM`, and its label ("100 m (330 ft)"). */
export function scaleBar(unitsPerM: number, maxUnits: number): { units: number; label: string } {
  let m = NICE_M[0];
  for (const n of NICE_M) if (n * unitsPerM <= maxUnits) m = n;
  const ft = Math.round((m * 3.28084) / 10) * 10;
  const metres = m >= 1_000 ? `${m / 1_000} km` : `${m} m`;
  const feet = ft >= 5_280 ? `${Math.round((ft / 5_280) * 10) / 10} mi` : `${ft.toLocaleString("en-US")} ft`;
  return { units: Math.round(m * unitsPerM * 10) / 10, label: `${metres} (${feet})` };
}

/** Metres in a scale label written by scaleBar ("250 m (820 ft)", "2 km (1.2 mi)"), or null. */
export function scaleLabelMetres(label: string): number | null {
  const m = /^(\d+(?:\.\d+)?) (m|km) \(/.exec(label);
  if (!m) return null;
  return Number(m[1]) * (m[2] === "km" ? 1_000 : 1);
}

// ---------- the START-and-X frame ----------

/**
 * How the map is framed (map units, the box is MAP_W x MAP_H = 420 x 260):
 * START and the X sit inside the inner box (FRAME_MARGIN_X / _Y from each edge), so their labels, the
 * north arrow (top right) and the scale bar (bottom left) always have room; the view is never closer
 * than MIN_SPAN_M across (a 60 m walk is not blown up to fill the page).
 */
export const FRAME_MARGIN_X = 78;
export const FRAME_MARGIN_Y = 58;
/** The narrowest view: the map box is at least this many metres wide. */
export const MIN_SPAN_M = 240;

/**
 * The scale (map units per input unit) and centre that fit START and the X into the inner box.
 * `a` and `b` are in any flat unit with y pointing UP (metres north) or DOWN (map units): only distances matter.
 * `maxScale` caps the zoom (the MIN_SPAN_M rule in the caller's units).
 */
export function fitTwoPoints(a: XY, b: XY, mapW: number, mapH: number, maxScale: number): { scale: number; center: XY } {
  const dx = Math.abs(a[0] - b[0]);
  const dy = Math.abs(a[1] - b[1]);
  const innerW = mapW - 2 * FRAME_MARGIN_X;
  const innerH = mapH - 2 * FRAME_MARGIN_Y;
  const scale = Math.min(maxScale, dx > 0 ? innerW / dx : Infinity, dy > 0 ? innerH / dy : Infinity);
  return { scale, center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
}
