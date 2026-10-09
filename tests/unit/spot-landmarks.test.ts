/**
 * map-v2 (Kevin, 2026-10-08: "there are no reference points"): the named landmarks on a Find This Spot map are real
 * OpenStreetMap objects picked by code, never the X (nor its kind, its name or anything right next to it), and a
 * park with none mapped near the walk shows none. Data: the saved real OSM answers of the example parks
 * (src/data/osm/examples.json), the pinned example passes and the recorded live passes. Anything test-built is
 * said so where it is built.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Pass } from "@/lib/pass/schema";
import { pinnedPass } from "@/lib/pinned";
import { savedGeometry } from "@/lib/sources/osm-snapshot";
import { buildMap, type ParkGeometry } from "@/lib/spot/geometry";
import { LANDMARK_CLEAR_OF_X_M, landmarkKindOf, PARKING_CLEAR_OF_START_M, landmarkText, MAX_LANDMARKS } from "@/lib/spot/landmarks";
import { pickTarget } from "@/lib/spot/pick-target";
import { withClearMap } from "@/lib/spot/redraw";
import { drawMap } from "@/lib/spot/render-map";
import { SpotMapSchema, type SpotOk } from "@/lib/spot/types";

const fixture = (name: string): Pass => (JSON.parse(readFileSync(`tests/fixtures/${name}.json`, "utf8")) as { pass: Pass }).pass;
const SHOWN: [string, Pass][] = [
  ["white-rock", pinnedPass("white-rock")!],
  ["oak-point", pinnedPass("oak-point")!],
  ["celebration", pinnedPass("celebration")!],
  ["arbor-hills", fixture("pass-arbor-hills-lucky-live")],
  ["celebration-shelter", fixture("pass-celebration-lucky-live")],
];

describe("landmarks are real OSM objects near the walk, and never the answer", () => {
  it("every landmark on every example map is an object of that park's saved OSM answer, of the kind and with the words its tags give", () => {
    let total = 0;
    for (const [name, raw] of SHOWN) {
      const pass = withClearMap(raw);
      const spot = pass.spot as SpotOk;
      const g = savedGeometry(pass.park.id)!.value;
      const marks = spot.map.landmarks ?? [];
      expect(SpotMapSchema.safeParse(spot.map).success, name).toBe(true);
      expect(marks.length, name).toBeLessThanOrEqual(MAX_LANDMARKS);
      const target = g.elements.find((e) => e.osmId === spot.target.osmId)!;
      for (const lm of marks) {
        total++;
        const el = g.elements.find((e) => e.osmId === lm.osmId);
        expect(el, `${name}: ${lm.osmId}`).toBeDefined();
        expect(landmarkKindOf(el!.tags), `${name}: ${lm.text}`).toBe(lm.kind);
        expect(landmarkText(lm.kind, el!.tags), name).toBe(lm.text);
        // Never the X, never the X's kind, never far from the frame, never right next to the X.
        expect(lm.osmId, name).not.toBe(spot.target.osmId);
        expect(lm.kind, name).not.toBe(landmarkKindOf(target.tags));
        expect(lm.osmId, name).not.toBe(spot.start?.osmId);
        const [x, y] = lm.at;
        expect(x >= 0 && x <= spot.map.w && y >= 0 && y <= spot.map.h, name).toBe(true);
        expect(Math.hypot(x - spot.map.target[0], y - spot.map.target[1]), `${name}: ${lm.text} near the X`).toBeGreaterThanOrEqual(LANDMARK_CLEAR_OF_X_M * spot.map.unitsPerM! - 1);
        if (spot.target.name) expect(lm.text.toLowerCase(), name).not.toContain(spot.target.name.toLowerCase());
        // START is a parking lot or entrance: no second "Parking" right beside it.
        if (lm.kind === "parking" && spot.map.start)
          expect(Math.hypot(x - spot.map.start[0], y - spot.map.start[1]), name).toBeGreaterThanOrEqual(PARKING_CLEAR_OF_START_M * spot.map.unitsPerM! - 1);
      }
      // The drawn ones are a subset of the stored ones (a label that can't be placed clear is left out, never moved onto something else).
      const d = drawMap(spot.map, spot.walk);
      for (const l of d.landmarks) expect(marks.map((m) => m.text), name).toContain(l.label.text);
    }
    expect(total).toBeGreaterThan(10);
  });

  it("whatever the X is (each of Celebration's 3 picks), no landmark is of its kind or is the X itself", () => {
    const g = savedGeometry("way/188145317")!.value;
    for (const variant of [1, 2, 3]) {
      const t = pickTarget(g, { parkName: "Celebration Park", features: null, variant })!;
      const map = buildMap(g, t.center, t.start?.at ?? null, { targetId: t.osmId, startId: t.start?.osmId ?? null });
      const targetKind = landmarkKindOf(g.elements.find((e) => e.osmId === t.osmId)!.tags);
      for (const lm of map.landmarks!) {
        expect(lm.osmId, `variant ${variant}`).not.toBe(t.osmId);
        expect(lm.kind, `variant ${variant}: ${t.label}`).not.toBe(targetKind);
      }
    }
  });

  it("a park with no landmark kinds mapped near the walk shows none (test-built: Celebration's real map with only its paths, the X and START kept)", () => {
    const g = savedGeometry("way/188145317")!.value;
    const t = pickTarget(g, { parkName: "Celebration Park", features: null, variant: 1 })!;
    const bare: ParkGeometry = {
      ...g,
      elements: g.elements.filter((e) => e.osmId === t.osmId || e.osmId === t.start?.osmId || (e.tags.highway !== undefined && !e.tags.name)),
    };
    const map = buildMap(bare, t.center, t.start!.at, { targetId: t.osmId, startId: t.start!.osmId });
    expect(map.landmarks).toEqual([]);
    expect(drawMap(map, t.walk).landmarks).toEqual([]);
  });

  it("a road bridge, an unnamed pond and an unnamed path are not landmarks; a footbridge, a named lake and a named trail are (tags from the White Rock answer)", () => {
    const g = savedGeometry("way/460905359")!.value;
    const tags = (id: string) => g.elements.find((e) => e.osmId === id)!.tags;
    expect(landmarkKindOf(tags("way/831546606"))).toBeNull(); // West Lawther Drive, a road bridge
    expect(landmarkKindOf(tags("way/627899225"))).toBe("bridge"); // a footway bridge
    expect(landmarkKindOf(tags("way/28042821"))).toBeNull(); // an unnamed pond
    expect(landmarkKindOf(tags("way/27089872"))).toBe("water");
    expect(landmarkText("water", tags("way/27089872"))).toBe("White Rock Lake");
    expect(landmarkText("trail", tags("way/459188582"))).toBe("White Rock Lake Trail");
  });
});
