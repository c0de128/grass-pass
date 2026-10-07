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
import { redrawnMap, withClearMap } from "@/lib/spot/redraw";
import { drawMap, rectsOverlap, reframe, type MapDrawing, type Rect } from "@/lib/spot/render-map";
import { FRAME_MARGIN_X, FRAME_MARGIN_Y, MIN_SPAN_M, simplify } from "@/lib/spot/shapes";
import { MAP_H, MAP_W, MAX_MAP_POINTS, SpotMapSchema, type SpotMap as SpotMapData, type SpotOk } from "@/lib/spot/types";

const SLUGS = ["white-rock", "oak-point", "celebration"] as const;
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

  it("White Rock and Oak Point are redrawn from the very OSM answer they were made from; Celebration (a later live answer) is re-framed from its stored map", () => {
    for (const s of ["white-rock", "oak-point"]) {
      const p = pinned(s);
      const m = redrawnMap(p.park.id, spotOf(p));
      expect(m, s).not.toBeNull();
      expect(SpotMapSchema.safeParse(m).success).toBe(true);
      expect(m!.scale.label).toMatch(/^(50|100) m/);
    }
    const cel = pinned("celebration");
    expect(redrawnMap(cel.park.id, spotOf(cel))).toBeNull();
    expect(withClearMap(cel)).toBe(cel);
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

  it("a START whose walk doesn't match the pass keeps the stored map (never a different X or START)", () => {
    const p = pinned("oak-point");
    const s = spotOf(p);
    expect(redrawnMap(p.park.id, { ...s, walk: { meters: s.walk!.meters + 50, direction: s.walk!.direction } })).toBeNull();
    expect(redrawnMap(p.park.id, { ...s, checkedAt: "2026-10-01T00:00:00.000Z" })).toBeNull();
  });
});

describe("labels and markers never overlap", () => {
  it("START and distance labels are inside the map and clear of each other, the X, the north arrow and the scale bar", () => {
    for (const { name, d } of allDrawings()) {
      const xBox: Rect = { x0: d.x.at[0] - d.x.size, y0: d.x.at[1] - d.x.size, x1: d.x.at[0] + d.x.size, y1: d.x.at[1] + d.x.size };
      const fixed = [xBox, d.north.box, d.scale.box];
      expect(d.labelBoxes.length, name).toBeGreaterThan(0);
      for (const b of d.labelBoxes) {
        expect(b.x0 >= 0 && b.y0 >= 0 && b.x1 <= MAP_W && b.y1 <= MAP_H, `${name}: label inside`).toBe(true);
        for (const f of fixed) expect(rectsOverlap(b, f), `${name}: label vs marker`).toBe(false);
      }
      for (let i = 0; i < d.labelBoxes.length; i++)
        for (let j = i + 1; j < d.labelBoxes.length; j++) expect(rectsOverlap(d.labelBoxes[i], d.labelBoxes[j]), `${name}: labels`).toBe(false);
      // START's triangle is not under the X.
      const [sx, sy] = d.start!.at;
      expect(rectsOverlap({ x0: sx - 11, y0: sy - 11, x1: sx + 11, y1: sy + 11 }, xBox), name).toBe(false);
    }
  });

  it("the chevrons carry the code-measured walk, and are left out when the straight line would cross a pond or lake", () => {
    const op = spotOf(withClearMap(pinned("oak-point")));
    const dOp = drawMap(op.map, op.walk);
    expect(dOp.arrow?.label?.text).toBe("170 m south-east");
    const cel = spotOf(pinned("celebration"));
    expect(drawMap(cel.map, cel.walk).arrow?.label?.text).toBe("490 m east");
    // White Rock: START (a parking lot east of the water) and the dog park are on two sides of the lake's arm.
    const wr = spotOf(withClearMap(pinned("white-rock")));
    expect(drawMap(wr.map, wr.walk).arrow).toBeNull();
    // No walk, no arrow (nothing honest to label it with).
    expect(drawMap(op.map, null).arrow).toBeNull();
  });
});

describe("legend: only what is visible", () => {
  it("lists exactly the drawn layers, plus the X, START and the arrow when drawn", () => {
    for (const { name, spot, d } of allDrawings()) {
      const html = renderToStaticMarkup(<SpotMap spot={{ ...spot, map: reframe(spot.map) }} parkName="Park" variant="print" />);
      const keys = [...html.matchAll(/data-key="([a-z]+)"/g)].map((m) => m[1]);
      expect(keys, name).toEqual(legendKeys(d));
      for (const l of d.layers) expect(html, name).toContain(`data-layer="${l.style}"`);
      expect(keys.filter((k) => !["x", "start", "arrow"].includes(k)), name).toEqual(d.layers.map((l) => l.style));
    }
  });

  it("a road entirely outside the frame is not drawn and not in the legend (made-up road)", () => {
    const s = spotOf(withClearMap(pinned("oak-point")));
    const far = { ...s.map, roads: [[-300, -300, -200, -250]], waterways: [] };
    const d = drawMap(far, s.walk);
    expect(d.legend).not.toContain("road");
    expect(d.legend).not.toContain("waterway");
  });

  it("legend rows fill evenly: no key alone on its own row from 5 to 9 keys", () => {
    for (let n = 2; n <= 9; n++) {
      const c = legendColumns(n);
      expect(n % c === 0 || n % c >= c - 1, `${n} keys in ${c} columns`).toBe(true);
    }
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
