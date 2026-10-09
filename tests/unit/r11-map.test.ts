/**
 * Round 11 (Q-11-02): a fresh Find This Spot map keeps its reference point. The two real passes the quality auditor made
 * on Oct 9 (Celebration Park 6-10 variant 2, X = the playground way/474665167; Dayspring Nature Preserve 10-13 variant 1,
 * X = the shelter way/542298504) each stored one landmark and drew none ("icon" touched the scale card or START). The
 * maps are rebuilt here exactly as the app builds them, from the saved real OSM answers (src/data/osm).
 */
import { describe, expect, it } from "vitest";
import { savedDfwFeatures, savedDfwGeometry, savedFeatures, savedGeometry } from "@/lib/sources/osm-snapshot";
import { finishSpot, planSpot } from "@/lib/spot/load";
import { drawMap, ICON_NUDGE, LABEL_ONLY_MAX_M, unitsPerMetre } from "@/lib/spot/render-map";
import type { SpotOk } from "@/lib/spot/types";

function liveSpot(parkId: string, parkName: string, variant: number): SpotOk {
  const g = savedGeometry(parkId) ?? savedDfwGeometry(parkId);
  const f = savedFeatures(parkId) ?? savedDfwFeatures(parkId);
  expect(g, parkId).not.toBeNull();
  const plan = planSpot({ status: "ok", geometry: g!.value, checkedAt: g!.fetchedAt } as Parameters<typeof planSpot>[0], { parkName, features: f?.value ?? null, variant });
  const spot = finishSpot(plan, null);
  expect(spot.status).toBe("ok");
  return spot as SpotOk;
}

describe("Q-11-02: each map keeps at least one reference point when one is stored", () => {
  it.each([
    ["way/188145317", "Celebration Park", 2, "way/474665167", "Soccer field"],
    ["way/242823844", "Dayspring Nature Preserve", 1, "way/542298504", "Bridge"],
  ] as const)("%s (%s, variant %i): the stored landmark is drawn, at its real spot", (parkId, name, variant, target, text) => {
    const spot = liveSpot(parkId, name, variant);
    expect(spot.target.osmId).toBe(target);
    const stored = spot.map.landmarks ?? [];
    expect(stored.map((l) => l.text)).toEqual([text]);
    const d = drawMap(spot.map, spot.walk);
    expect(d.landmarks.length).toBeGreaterThanOrEqual(1);
    expect(d.skipped).toEqual([]);
    const at = stored[0].at;
    const drawn = d.landmarks[0];
    expect(drawn.label.text).toBe(text);
    if (drawn.icon) {
      // A nudged icon still covers its real spot.
      expect(Math.hypot(drawn.icon[0] - at[0], drawn.icon[1] - at[1])).toBeLessThanOrEqual(ICON_NUDGE + 0.5);
    } else {
      // The name on its own is centred near its real spot.
      const reach = Math.min(40, LABEL_ONLY_MAX_M * (unitsPerMetre(spot.map) ?? 1));
      expect(Math.hypot(drawn.label.x - at[0], drawn.label.box.y0 + (drawn.label.box.y1 - drawn.label.box.y0) / 2 - at[1])).toBeLessThanOrEqual(reach + 4);
    }
    // Nothing drawn on top of anything else: the scale card, north arrow, X, START and every label stay clear.
    const boxes = [d.north.box, d.scale.box, d.start?.label.box, ...d.landmarks.map((l) => l.label.box)].filter(Boolean) as { x0: number; y0: number; x1: number; y1: number }[];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        expect(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1, `${i} vs ${j}`).toBe(false);
      }
  });
});
