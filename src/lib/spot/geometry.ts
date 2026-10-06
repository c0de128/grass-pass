/**
 * Find This Spot geometry (SPEC F9, ADR 0002 D2c, decision 5): the real OpenStreetMap shapes of one
 * park, fetched with ONE fixed Overpass query keyed by the park's OSM id (never a free bbox from a
 * user), then projected, clipped and simplified by code into a small north-up map.
 *
 * What the query asks for: the park outline (`out geom`), and inside its area the paths and drives,
 * water and creeks, pitches and courts, and the landmark kinds a Find This Spot target can be
 * (shelter, playground, bridge, viewpoint, tower, artwork, fountain, restrooms...). Parking lots
 * within 80 m and entrances within 40 m of the outline are fetched too: they are where the walk starts.
 * Names are untrusted text: cleaned and length-capped like every other OSM name.
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import { runOverpass, OVERPASS_QUERY_TIMEOUT_SEC, type OverpassDeps } from "@/lib/sources/overpass";
import { cleanOsmText, parkIdOf, parkSelector, type ParkRef } from "@/lib/sources/overpass-features";
import { MAP_H, MAP_W, MAX_MAP_POINTS, type Line, type Point, type SpotMap } from "./types";

// ---------- query ----------

/** Parking lots this close to the park outline count as a start (many park lots sit just outside it). */
export const PARKING_AROUND_M = 80;
export const ENTRANCE_AROUND_M = 40;

const INSIDE = [
  `way(area.a)["highway"~"^(footway|path|cycleway|pedestrian|track|steps|bridleway|service|living_street|residential|unclassified|tertiary)$"]`,
  `nwr(area.a)["natural"="water"]`,
  `way(area.a)["waterway"~"^(river|stream|canal|ditch|drain)$"]`,
  `nwr(area.a)["leisure"~"^(pitch|playground|dog_park|splash_pad|water_park|bleachers|track)$"]`,
  `nwr(area.a)["amenity"~"^(shelter|toilets|fountain|parking)$"]`,
  `nwr(area.a)["tourism"~"^(viewpoint|artwork|information)$"]`,
  `nwr(area.a)["man_made"~"^(bridge|tower|observation_tower|flagpole)$"]`,
  `way(area.a)["bridge"="yes"]`,
  `nwr(area.a)["historic"]`,
  `node(area.a)["entrance"]`,
];
const AROUND = [`nwr(around.p:${PARKING_AROUND_M})["amenity"="parking"]`, `node(around.p:${ENTRANCE_AROUND_M})["entrance"]`];

/** The fixed Overpass QL for one park's map. Only the numeric id comes from the request (validated). */
export function geometryQuery(ref: ParkRef): string {
  if (ref.type === "node") throw new RangeError("a park mapped as a point has no outline");
  const head = `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_SEC}];`;
  // SEC-1-01: the same park tag filter as the features query, so a non-park id selects nothing.
  return `${head}${parkSelector(ref)}.p out geom;.p map_to_area->.a;(${[...INSIDE, ...AROUND].join(";")};);out geom qt;`;
}

// ---------- parsed geometry (cached 7 days) ----------

const LatLngSchema = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);
export type LatLng = z.infer<typeof LatLngSchema>;

/** Tags we keep (everything else is dropped before caching). */
const KEEP_TAGS = [
  "name",
  "highway",
  "natural",
  "waterway",
  "leisure",
  "sport",
  "amenity",
  "tourism",
  "information",
  "man_made",
  "bridge",
  "historic",
  "entrance",
  "playground",
] as const;

export const GeoElementSchema = z.object({
  osmId: z.string().regex(/^(node|way|relation)\/\d{1,15}$/),
  tags: z.record(z.string(), z.string().max(80)),
  /** One or more polylines/rings (a node is one line with one point). */
  lines: z.array(z.array(LatLngSchema).min(1).max(5_000)).min(1).max(200),
});
export type GeoElement = z.infer<typeof GeoElementSchema>;

export const ParkGeometrySchema = z.object({
  parkId: z.string(),
  outline: z.array(z.array(LatLngSchema).min(2).max(20_000)).min(1).max(200),
  elements: z.array(GeoElementSchema).max(3_000),
});
export type ParkGeometry = z.infer<typeof ParkGeometrySchema>;

const Pt = z.object({ lat: z.number(), lon: z.number() });
const RawElement = z.object({
  type: z.enum(["node", "way", "relation"]),
  id: z.number().int().positive(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  geometry: z.array(Pt.nullable()).optional(),
  members: z
    .array(
      z.object({
        type: z.enum(["node", "way", "relation"]),
        role: z.string().optional(),
        lat: z.number().optional(),
        lon: z.number().optional(),
        geometry: z.array(Pt.nullable()).optional(),
      }),
    )
    .optional(),
  tags: z.record(z.string(), z.string()).optional(),
});
type RawElement = z.infer<typeof RawElement>;

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const toLine = (g: (z.infer<typeof Pt> | null)[]): LatLng[] =>
  g.filter((p): p is z.infer<typeof Pt> => p !== null).map((p) => [r6(p.lat), r6(p.lon)] as LatLng);

function linesOf(el: RawElement, outerOnly: boolean): LatLng[][] {
  if (el.type === "node") return el.lat !== undefined && el.lon !== undefined ? [[[r6(el.lat), r6(el.lon)]]] : [];
  if (el.type === "way") return el.geometry ? [toLine(el.geometry)].filter((l) => l.length > 0) : [];
  const out: LatLng[][] = [];
  for (const m of el.members ?? []) {
    if (m.type !== "way" || !m.geometry) continue;
    if (outerOnly && m.role && m.role !== "outer") continue;
    const l = toLine(m.geometry);
    if (l.length > 1) out.push(l);
  }
  return out;
}

function keepTags(tags: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KEEP_TAGS) {
    const v = tags[k];
    if (typeof v === "string" && v.length > 0) out[k] = k === "name" ? cleanOsmText(v) : v.slice(0, 80);
  }
  if (out.name === "") delete out.name;
  return out;
}

/**
 * The Overpass answer -> the park outline + its mapped elements. Returns null when the park itself
 * (or its outline) is missing from the answer.
 */
export function parseGeometry(json: unknown, ref: ParkRef): ParkGeometry | null {
  const elements = z.object({ elements: z.array(z.unknown()) }).parse(json).elements;
  let outline: LatLng[][] | null = null;
  const out: GeoElement[] = [];
  const seen = new Set<string>();
  for (const raw of elements) {
    const p = RawElement.safeParse(raw);
    if (!p.success) continue;
    const el = p.data;
    const osmId = `${el.type}/${el.id}`;
    if (el.type === ref.type && el.id === ref.id) {
      const l = linesOf(el, true).filter((x) => x.length > 1);
      if (l.length > 0) outline = l;
      continue;
    }
    if (seen.has(osmId)) continue;
    seen.add(osmId);
    const lines = linesOf(el, el.type === "relation");
    if (lines.length === 0) continue;
    out.push({ osmId, tags: keepTags(el.tags ?? {}), lines: lines.slice(0, 200) });
  }
  if (!outline) return null;
  // Keep only what is near the park: long roads and creeks that run on for kilometres are cut at a
  // box 250 m around the outline (keeps the cached geometry small; the map never shows beyond it).
  const lats = outline.flat().map((p) => p[0]);
  const lngs = outline.flat().map((p) => p[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLat = NEAR_PARK_M / EARTH_M_PER_DEG_LAT;
  const dLng = NEAR_PARK_M / (EARTH_M_PER_DEG_LNG_EQ * Math.cos((midLat * Math.PI) / 180));
  const box = { x0: Math.min(...lats) - dLat, x1: Math.max(...lats) + dLat, y0: Math.min(...lngs) - dLng, y1: Math.max(...lngs) + dLng };
  const near: GeoElement[] = [];
  for (const el of out) {
    const lines: LatLng[][] = [];
    for (const l of el.lines) {
      if (l.length === 1) {
        const [la, ln] = l[0];
        if (la >= box.x0 && la <= box.x1 && ln >= box.y0 && ln <= box.y1) lines.push(l);
        continue;
      }
      const closed = l.length >= 4 && l[0][0] === l.at(-1)![0] && l[0][1] === l.at(-1)![1];
      const pieces = closed ? [clipRing(l, box)].filter((p) => p.length > 3) : clipPolyline(l, box);
      for (const p of pieces) lines.push(p.map(([a, b]) => [r6(a), r6(b)] as LatLng));
    }
    if (lines.length > 0) near.push({ ...el, lines: lines.slice(0, 200) });
  }
  return { parkId: parkIdOf(ref), outline, elements: near.slice(0, 3_000) };
}

/** How far around the park outline mapped shapes are kept. */
export const NEAR_PARK_M = 250;

/** Fetch and parse. Throws SourceError from runOverpass; null when the park's outline isn't in the answer. */
export async function parkGeometry(ref: ParkRef, deps: OverpassDeps): Promise<ParkGeometry | null> {
  const { json } = await runOverpass(geometryQuery(ref), deps);
  return parseGeometry(json, ref);
}

// ---------- measuring ----------

const EARTH_M_PER_DEG_LAT = 110_574;
const EARTH_M_PER_DEG_LNG_EQ = 111_320;

/** Local flat projection in metres around `origin` (x east, y north). Fine at park scale. */
export function projector(origin: LatLng) {
  const kx = EARTH_M_PER_DEG_LNG_EQ * Math.cos((origin[0] * Math.PI) / 180);
  return (p: LatLng): [number, number] => [(p[1] - origin[1]) * kx, (p[0] - origin[0]) * EARTH_M_PER_DEG_LAT];
}

/** Straight-line distance in metres (local projection). */
export function distanceM(a: LatLng, b: LatLng): number {
  const [x, y] = projector(a)(b);
  return Math.hypot(x, y);
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"] as const;

/** 8-point compass direction from a to b ("north-east"). */
export function compass(a: LatLng, b: LatLng): (typeof COMPASS)[number] {
  const [x, y] = projector(a)(b);
  const deg = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

/** Centre of a feature: area-weighted centroid of a closed ring, the middle point of a line, or the node. */
export function centerOf(lines: readonly LatLng[][]): LatLng {
  const longest = [...lines].sort((a, b) => b.length - a.length)[0];
  if (longest.length === 1) return longest[0];
  const closed = longest.length >= 4 && longest[0][0] === longest.at(-1)![0] && longest[0][1] === longest.at(-1)![1];
  if (closed) {
    const origin = longest[0];
    const proj = projector(origin);
    const pts = longest.map(proj);
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const f = x0 * y1 - x1 * y0;
      a += f;
      cx += (x0 + x1) * f;
      cy += (y0 + y1) * f;
    }
    if (Math.abs(a) > 1e-9) {
      cx /= 3 * a;
      cy /= 3 * a;
      const kx = EARTH_M_PER_DEG_LNG_EQ * Math.cos((origin[0] * Math.PI) / 180);
      return [r6(origin[0] + cy / EARTH_M_PER_DEG_LAT), r6(origin[1] + cx / kx)];
    }
  }
  // A line (a bridge, a path): the point halfway along it.
  const proj = projector(longest[0]);
  const pts = longest.map(proj);
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let half = seg.reduce((s, d) => s + d, 0) / 2;
  for (let i = 0; i < seg.length; i++) {
    if (half <= seg[i] && seg[i] > 0) {
      const t = half / seg[i];
      return [r6(longest[i][0] + (longest[i + 1][0] - longest[i][0]) * t), r6(longest[i][1] + (longest[i + 1][1] - longest[i][1]) * t)];
    }
    half -= seg[i];
  }
  return longest[0];
}

// ---------- drawing geometry ----------

/** Douglas-Peucker simplification of a polyline of [x, y] points. */
export function simplify(points: readonly [number, number][], tolerance: number): [number, number][] {
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

type Box = { x0: number; y0: number; x1: number; y1: number };

/** Liang-Barsky: the part of segment p-q inside the box, or null. */
function clipSegment(p: [number, number], q: [number, number], b: Box): [[number, number], [number, number]] | null {
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
export function clipPolyline(points: readonly [number, number][], box: Box): [number, number][][] {
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
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
export function clipRing(points: readonly [number, number][], box: Box): [number, number][] {
  type P = [number, number];
  const edges: { inside: (p: P) => boolean; cut: (a: P, b: P) => P }[] = [
    { inside: (p) => p[0] >= box.x0, cut: (a, b) => [box.x0, a[1] + ((b[1] - a[1]) * (box.x0 - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[0] <= box.x1, cut: (a, b) => [box.x1, a[1] + ((b[1] - a[1]) * (box.x1 - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[1] >= box.y0, cut: (a, b) => [a[0] + ((b[0] - a[0]) * (box.y0 - a[1])) / (b[1] - a[1]), box.y0] },
    { inside: (p) => p[1] <= box.y1, cut: (a, b) => [a[0] + ((b[0] - a[0]) * (box.y1 - a[1])) / (b[1] - a[1]), box.y1] },
  ];
  let poly: P[] = points.slice(0, points.length > 1 && points[0][0] === points.at(-1)![0] && points[0][1] === points.at(-1)![1] ? -1 : undefined) as P[];
  for (const e of edges) {
    if (poly.length === 0) break;
    const next: P[] = [];
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

export type MapKind = "road" | "path" | "waterway" | "water" | "pitch" | "parking";

/** Which layer a mapped element is drawn on, or null (landmarks are not drawn; only the X is). */
export function layerOf(tags: Record<string, string>): MapKind | null {
  const h = tags.highway;
  if (h) return /^(footway|path|cycleway|pedestrian|track|steps|bridleway)$/.test(h) ? "path" : "road";
  if (tags.natural === "water") return "water";
  if (tags.waterway) return "waterway";
  if (tags.leisure === "pitch") return "pitch";
  if (tags.amenity === "parking") return "parking";
  return null;
}

/** Margin inside the map box, in map units (room for the north arrow and the scale bar). */
const PAD = 14;

/**
 * Project the park into the MAP_W x MAP_H box (north up, same scale on both axes), clip everything to
 * the box, simplify, and return the stored map. `target` and `start` are drawn on top.
 * Point budget: the simplification tolerance grows until the map holds at most MAX_MAP_POINTS.
 */
export function buildMap(g: ParkGeometry, target: LatLng, start: LatLng | null): SpotMap {
  const ring = g.outline.flat();
  const lats = [...ring.map((p) => p[0]), target[0], ...(start ? [start[0]] : [])];
  const lngs = [...ring.map((p) => p[1]), target[1], ...(start ? [start[1]] : [])];
  const origin: LatLng = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2];
  const proj = projector(origin);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of [...ring, target, ...(start ? [start] : [])]) {
    const [x, y] = proj(p);
    xs.push(x);
    ys.push(y);
  }
  const spanX = Math.max(1, Math.max(...xs) - Math.min(...xs));
  const spanY = Math.max(1, Math.max(...ys) - Math.min(...ys));
  const unitsPerM = Math.min((MAP_W - 2 * PAD) / spanX, (MAP_H - 2 * PAD) / spanY);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const toMap = (p: LatLng): [number, number] => {
    const [x, y] = proj(p);
    return [MAP_W / 2 + (x - cx) * unitsPerM, MAP_H / 2 - (y - cy) * unitsPerM];
  };
  const box: Box = { x0: -2, y0: -2, x1: MAP_W + 2, y1: MAP_H + 2 };

  const layers: Record<"outline" | MapKind, [number, number][][]> = {
    outline: [],
    road: [],
    path: [],
    waterway: [],
    water: [],
    pitch: [],
    parking: [],
  };
  for (const l of g.outline) layers.outline.push(l.map(toMap));
  for (const el of g.elements) {
    const kind = layerOf(el.tags);
    if (!kind) continue;
    for (const l of el.lines) if (l.length > 1) layers[kind].push(l.map(toMap));
  }

  const closedKinds = new Set<string>(["water", "pitch", "parking"]);
  const flat = (pts: [number, number][]): Line => pts.flatMap(([x, y]) => [Math.round(x), Math.round(y)]);
  const finish = (tol: number) => {
    const out = {} as Record<keyof typeof layers, Line[]>;
    let points = 0;
    for (const [name, lines] of Object.entries(layers) as [keyof typeof layers, [number, number][][]][]) {
      const res: Line[] = [];
      for (const pts of lines) {
        // Rings (water, pitches, parking) are clipped as polygons so they stay closed and can be filled.
        const pieces = closedKinds.has(name) ? [clipRing(pts, box)].filter((p) => p.length > 3) : clipPolyline(pts, box);
        for (const piece of pieces) {
          const s = simplify(piece, tol);
          const line = flat(s);
          // Drop pieces that collapse to a dot at this scale.
          if (line.length < 4 || (line.length === 4 && line[0] === line[2] && line[1] === line[3])) continue;
          res.push(line);
          points += line.length / 2;
        }
      }
      out[name] = res;
    }
    return { out, points };
  };
  let tol = 0.6;
  let r = finish(tol);
  while (r.points > MAX_MAP_POINTS && tol < 20) {
    tol *= 2;
    r = finish(tol);
  }
  const round = (p: [number, number]): Point => [Math.round(p[0]), Math.round(p[1])];
  return {
    w: MAP_W,
    h: MAP_H,
    outline: r.out.outline.slice(0, 60),
    roads: r.out.road.slice(0, 400),
    paths: r.out.path.slice(0, 400),
    waterways: r.out.waterway.slice(0, 200),
    water: r.out.water.slice(0, 100),
    pitches: r.out.pitch.slice(0, 200),
    parking: r.out.parking.slice(0, 60),
    target: round(toMap(target)),
    start: start ? round(toMap(start)) : null,
    scale: scaleBar(unitsPerM, MAP_W * 0.3),
  };
}
