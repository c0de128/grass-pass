/**
 * map-clear (2026-10-07): the Find This Spot map is framed on START and the X, its labels never overlap, the legend
 * lists only what is visible, and lines are simplified at the drawing scale. Data: the 3 pinned example passes
 * (src/data/pinned-examples, real passes), the saved OpenStreetMap answers (src/data/osm/examples.json) and the
 * recorded live passes in tests/fixtures. The only shapes made up here are labelled as such (a zig-zag, a far road).
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { legendColumns, legendKeys, SpotMap } from "@/components/pass/SpotMap";
import type { Pass } from "@/lib/pass/schema";
import { PINNED_FILES, pinnedPass } from "@/lib/pinned";
import { redrawnMap, redrawnSpot, withClearMap } from "@/lib/spot/redraw";
import { cleanLines, drawMap, findRoute, ICON_R, legendLabel, MAX_DRAWN_LANDMARKS, MAX_KEYS, rectsOverlap, reframe, type MapDrawing, type Rect } from "@/lib/spot/render-map";
import { distToSegment } from "@/lib/spot/landmarks";
import { FRAME_MARGIN_X, FRAME_MARGIN_Y, MIN_SPAN_M, simplify, type XY } from "@/lib/spot/shapes";
import { MAP_H, MAP_W, MAX_MAP_POINTS, SpotMapSchema, type SpotMap as SpotMapData, type SpotOk } from "@/lib/spot/types";

const SLUGS = ["white-rock", "oak-point", "celebration"] as const;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const pinned = (slug: string): Pass => pinnedPass(slug)!;
const spotOf = (p: Pass) => p.spot as SpotOk;

function fixturePass(name: string): Pass {
  const find = (o: unknown): Pass | null => {
    if (!o || typeof o !== "object") return null;
    const r = o as Record<string, unknown>;
    if (r.spot && r.park) return r as unknown as Pass;
    for (const v of Object.values(r)) {
      const p = find(v);
      if (p) return p;
    }
    return null;
  };
  return find(JSON.parse(readFileSync(`tests/fixtures/${name}.json`, "utf8")))!;
}
const FIXTURES = ["pass-arbor-hills-lucky-live", "pass-celebration-lucky-live", "pass-oak-point-complete-live", "pass-white-rock-complete-live"];

/** Every pass we can draw: the pinned ones as shown (redrawn when possible) and as stored (re-framed), and the fixtures. */
function allDrawings(): { name: string; spot: SpotOk; map: SpotMapData; d: MapDrawing }[] {
  const out: { name: string; spot: SpotOk; map: SpotMapData; d: MapDrawing }[] = [];
  const add = (name: string, p: Pass) => {
    const spot = spotOf(p);
    out.push({ name, spot, map: reframe(spot.map), d: drawMap(spot.map, spot.walk) });
  };
  for (const s of SLUGS) {
    add(`${s} (stored)`, pinned(s));
    add(`${s} (shown)`, withClearMap(pinned(s)));
  }
  for (const f of FIXTURES) {
    add(`${f} (stored)`, fixturePass(f));
    add(`${f} (shown)`, withClearMap(fixturePass(f)));
  }
  return out;
}

const inner = (x: number, y: number) => x >= FRAME_MARGIN_X - 1 && x <= MAP_W - FRAME_MARGIN_X + 1 && y >= FRAME_MARGIN_Y - 1 && y <= MAP_H - FRAME_MARGIN_Y + 1;

describe("framing: START and the X, not the whole park", () => {
  it("every drawn map keeps START and the X inside the inner box, far enough apart to tell apart", () => {
    for (const { name, map } of allDrawings()) {
      expect(map.frame, name).toBe("spot");
      const [tx, ty] = map.target;
      const [sx, sy] = map.start!;
      expect(inner(tx, ty), `${name}: X at ${tx},${ty}`).toBe(true);
      expect(inner(sx, sy), `${name}: START at ${sx},${sy}`).toBe(true);
      expect(Math.hypot(tx - sx, ty - sy), name).toBeGreaterThan(60);
    }
  });

  it("is never closer than MIN_SPAN_M across, and the scale bar is a round number", () => {
    for (const { name, map } of allDrawings()) {
      expect(MAP_W / map.unitsPerM!, name).toBeGreaterThanOrEqual(MIN_SPAN_M - 0.5);
      expect(map.scale.label, name).toMatch(/^(10|20|25|50|100|200|250|500) m \(/);
    }
  });

  it("White Rock and Oak Point are redrawn from the very OSM answer they were made from; Celebration (a later live answer) from the saved answer with the same X, START and walk, and then says that answer's time", () => {
    for (const s of ["white-rock", "oak-point"]) {
      const p = pinned(s);
      const r = redrawnSpot(p.park.id, spotOf(p));
      expect(r, s).not.toBeNull();
      expect(SpotMapSchema.safeParse(r!.map).success).toBe(true);
      expect(r!.map.scale.label).toMatch(/^(50|100) m/);
      expect(r!.checkedAt, s).toBe(spotOf(p).checkedAt);
    }
    const cel = pinned("celebration");
    const r = redrawnSpot(cel.park.id, spotOf(cel))!;
    expect(r).not.toBeNull();
    // The pass was made from a live answer of Oct 7; the map shown is drawn from the saved answer of Oct 6, and says so.
    expect(spotOf(cel).checkedAt).toBe("2026-10-07T16:07:06.662Z");
    expect(r.checkedAt).toBe("2026-10-06T03:15:18.323Z");
    const shown = spotOf(withClearMap(cel));
    expect(shown.checkedAt).toBe(r.checkedAt);
    expect(shown.target).toEqual(spotOf(cel).target);
    expect(shown.walk).toEqual(spotOf(cel).walk);
    expect(shown.map.landmarks).toBeDefined();
  });

  it("never edits the pinned pass: the shown pass is a copy, the pinned file is unchanged", () => {
    const before = JSON.stringify(PINNED_FILES["white-rock"]);
    const p = pinned("white-rock");
    const shown = withClearMap(p);
    expect(shown).not.toBe(p);
    expect(spotOf(p).map.frame).toBeUndefined();
    expect(spotOf(shown).map.frame).toBe("spot");
    expect(JSON.stringify(PINNED_FILES["white-rock"])).toBe(before);
    // Same X, same START, same walk on the answer key.
    expect(spotOf(shown).target).toEqual(spotOf(p).target);
    expect(spotOf(shown).walk).toEqual(spotOf(p).walk);
  });

  it("a START whose walk doesn't match the pass keeps the stored map (never a different X or START); a map already drawn by map-v2 is kept", () => {
    const p = pinned("oak-point");
    const s = spotOf(p);
    expect(redrawnMap(p.park.id, { ...s, walk: { meters: s.walk!.meters + 50, direction: s.walk!.direction } })).toBeNull();
    expect(redrawnMap(p.park.id, { ...s, start: { ...s.start!, osmId: "way/1" } })).toBeNull();
    const v2 = spotOf(withClearMap(p));
    expect(redrawnMap(p.park.id, v2)).toBeNull();
    // No saved answer for this park id: kept as stored.
    expect(redrawnMap("way/1", s)).toBeNull();
  });
});

describe("labels and markers never overlap", () => {
  it("START and landmark labels are inside the map and clear of each other, the X, the north arrow, the scale bar and the route; icons are clear of every label", () => {
    for (const { name, d } of allDrawings()) {
      const xBox: Rect = { x0: d.x.at[0] - d.x.size, y0: d.x.at[1] - d.x.size, x1: d.x.at[0] + d.x.size, y1: d.x.at[1] + d.x.size };
      const fixed = [xBox, d.north.box, d.scale.box];
      expect(d.labelBoxes.length, name).toBe(1 + d.landmarks.length);
      for (const b of d.labelBoxes) {
        expect(b.x0 >= 0 && b.y0 >= 0 && b.x1 <= MAP_W && b.y1 <= MAP_H, `${name}: label inside`).toBe(true);
        for (const f of fixed) expect(rectsOverlap(b, f), `${name}: label vs marker`).toBe(false);
        // The route's dots never run under a label.
        for (const p of d.route?.points ?? []) expect(b.x0 < p[0] && p[0] < b.x1 && b.y0 < p[1] && p[1] < b.y1, `${name}: route under a label`).toBe(false);
      }
      for (let i = 0; i < d.labelBoxes.length; i++)
        for (let j = i + 1; j < d.labelBoxes.length; j++) expect(rectsOverlap(d.labelBoxes[i], d.labelBoxes[j]), `${name}: labels`).toBe(false);
      for (const lm of d.landmarks) {
        if (!lm.icon) continue;
        const icon: Rect = { x0: lm.icon[0] - ICON_R, y0: lm.icon[1] - ICON_R, x1: lm.icon[0] + ICON_R, y1: lm.icon[1] + ICON_R };
        for (const b of [...d.labelBoxes, ...fixed]) expect(rectsOverlap(icon, b), `${name}: ${lm.label.text} icon`).toBe(false);
      }
      // START's triangle is not under the X.
      const [sx, sy] = d.start!.at;
      expect(rectsOverlap({ x0: sx - 11, y0: sy - 11, x1: sx + 11, y1: sy + 11 }, xBox), name).toBe(false);
      expect(d.landmarks.length, name).toBeLessThanOrEqual(MAX_DRAWN_LANDMARKS);
    }
  });
});

describe("the route from START to the X", () => {
  /** Distance from p to the nearest drawn path or road (the cleaned lines the route was found on). */
  const nearestLine = (p: XY, lines: XY[][]) => {
    let best = Infinity;
    for (const l of lines) for (let i = 0; i < l.length - 1; i++) best = Math.min(best, distToSegment(p, l[i], l[i + 1]));
    return best;
  };

  it("follows the mapped paths on every example (real OSM paths connect START and the X); every bend is on a path or drive", () => {
    for (const { name, map, d } of allDrawings()) {
      expect(d.route?.mode, name).toBe("paths");
      const lines = [...cleanLines(map.paths, "path"), ...cleanLines(map.roads, "road")];
      // The two ends join the network from START and the X; every point in between lies on a drawn line.
      const inner = d.route!.points.slice(1, -1);
      expect(inner.length, name).toBeGreaterThan(0);
      for (const p of inner) expect(nearestLine(p as XY, lines), `${name}: route point ${p}`).toBeLessThan(3);
    }
  });

  it("falls back to a straight dotted line (and the key says so) when the paths don't connect; none across a pond or lake; none without a walk", () => {
    const op = spotOf(withClearMap(pinned("oak-point")));
    // Test-built: the same real map with its paths and drives taken out.
    const bare = { ...op.map, paths: [], roads: [] };
    const d = drawMap(bare, op.walk);
    expect(d.route?.mode).toBe("straight");
    expect(d.legend.at(-1)).toBe("straight");
    expect(legendLabel("straight", op.walk)).toBe("straight line (the X is 170 m south-east)");
    const html = renderToStaticMarkup(<SpotMap spot={{ ...op, map: bare }} parkName="Oak Point" variant="screen" />);
    expect(text(html)).toContain("straight line (the X is 170 m south-east)");
    // White Rock: START and the dog park are on two sides of the water; without the trail bridges, no straight line.
    const wr = spotOf(withClearMap(pinned("white-rock")));
    expect(drawMap({ ...wr.map, paths: [], roads: [] }, wr.walk).route).toBeNull();
    // No walk: nothing honest to label the route with.
    expect(drawMap(op.map, null).route).toBeNull();
  });

  it("findRoute: shortest way along the lines, through crossings and T-junctions; null when the lines don't connect (made-up lines)", () => {
    // A cross (+), a bar on its right end, and a spur that ends 1.5 units off the bar (still joined).
    const lines = [
      { pts: [[0, 50], [100, 50]] as XY[], cost: 1 },
      { pts: [[50, 0], [50, 100]] as XY[], cost: 1 },
      { pts: [[100, 20], [100, 80]] as XY[], cost: 1 },
      { pts: [[101.5, 20], [140, 20]] as XY[], cost: 1 },
    ];
    const r = findRoute(lines, [0, 50], [140, 20], 5)!;
    expect(r).not.toBeNull();
    expect(r[0]).toEqual([0, 50]);
    expect(r.at(-1)).toEqual([140, 20]);
    const len = r.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - r[i][0], p[1] - r[i][1]), 0);
    expect(len).toBeCloseTo(100 + 30 + 40, 0);
    // The X far from every line, or on an island line: no route.
    expect(findRoute(lines, [0, 50], [300, 300], 5)).toBeNull();
    expect(findRoute([...lines, { pts: [[200, 200], [300, 300]] as XY[], cost: 1 }], [0, 50], [300, 300], 5)).toBeNull();
  });
});

describe("key: at most 5 things", () => {
  it("lists the X, START, visible layers that help most, and the route last; every layer key is drawn", () => {
    for (const { name, spot, d } of allDrawings()) {
      const html = renderToStaticMarkup(<SpotMap spot={{ ...spot, map: reframe(spot.map) }} parkName="Park" variant="print" />);
      const keys = [...html.matchAll(/data-key="([a-z]+)"/g)].map((m) => m[1]);
      expect(keys, name).toEqual(legendKeys(d));
      expect(keys.length, name).toBeLessThanOrEqual(MAX_KEYS);
      for (const l of d.layers) expect(html, name).toContain(`data-layer="${l.style}"`);
      for (const k of keys.filter((k) => !["x", "start", "route", "straight"].includes(k))) expect(d.layers.map((l) => l.style), name).toContain(k);
      if (d.route) expect(keys.at(-1), name).toBe(d.route.mode === "paths" ? "route" : "straight");
    }
  });

  it("a road entirely outside the frame is not drawn and not in the key (made-up road)", () => {
    const s = spotOf(withClearMap(pinned("oak-point")));
    const far = { ...s.map, roads: [[-300, -300, -200, -250]], waterways: [] };
    const d = drawMap(far, s.walk);
    expect(d.legend).not.toContain("road");
    expect(d.legend).not.toContain("waterway");
  });

  it("the keys before the route share at most 4 columns (so the key is 2 rows on paper)", () => {
    for (let n = 1; n <= 6; n++) expect(legendColumns(n)).toBe(Math.min(4, n));
  });
});

describe("simplification at the drawing scale", () => {
  it("Douglas-Peucker drops the wiggles under the tolerance (made-up zig-zag of 1-unit steps)", () => {
    const zig: [number, number][] = Array.from({ length: 401 }, (_, i) => [i, i % 2 === 0 ? 0 : 0.5]);
    expect(simplify(zig, 0.6)).toHaveLength(2);
    expect(simplify(zig, 0.2).length).toBe(401);
  });

  it("stored and re-framed maps stay under the point budget; re-framing at most doubles them (clipping cuts lines)", () => {
    const count = (m: SpotMapData) => [m.outline, m.roads, m.paths, m.waterways, m.water, m.pitches, m.parking].flat().reduce((n, l) => n + l.length / 2, 0);
    for (const s of SLUGS) {
      const stored = spotOf(pinned(s)).map;
      expect(count(reframe(stored))).toBeLessThanOrEqual(count(stored) * 2);
      const shown = spotOf(withClearMap(pinned(s))).map;
      expect(count(shown)).toBeLessThanOrEqual(MAX_MAP_POINTS);
    }
  });
});
