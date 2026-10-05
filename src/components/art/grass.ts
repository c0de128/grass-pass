// Header / section grass strip in logo B's style: soft curved lawn blades in small tufts (at most 3 blades per root),
// two greens (front = --lawn, back = the logo's darker grass green). Used by GrassDivider only; the logo grass itself
// is drawn in scripts/brand/art.mjs with the same blade shape (quadratic centreline that starts upright and bends
// toward the tip, width tapering to a soft point).
// Never a fanned multi-leaf shape (BRAND.md "Avoid": nothing that looks like cannabis).

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Logo B's darker grass green (ART.gDark in scripts/brand/art.mjs), for the back tufts. Decorative only. */
export const GRASS_BACK = "#46884F";

const RISE = 0.62; // same bend as the logo blades (scripts/brand/art.mjs RISE)

/**
 * One soft blade standing on (bx, by), tip at (tx, by - h), base width w.
 * Centreline: quadratic from the base, rising upright first (control right above the base), then bending to the tip.
 * Outline: two quadratics (left edge up, right edge down) plus a tiny round over the tip, so it never looks spiky.
 */
export function bladePath(bx: number, by: number, h: number, dx: number, w = 2.9): string {
  const tx = bx + dx;
  const ty = by - h;
  const cy = by - h * RISE;
  const half = w / 2;
  const tip = Math.min(0.3, half * 0.3); // half-width just under the tip
  // Edge controls sit beside the centreline control, pulled in a little so the blade tapers.
  const k = half * 0.85;
  return (
    `M${r2(bx - half)} ${by} ` +
    `Q${r2(bx - k)} ${r2(cy)} ${r2(tx - tip)} ${r2(ty + tip)} ` +
    `Q${r2(tx)} ${r2(ty - tip * 0.6)} ${r2(tx + tip)} ${r2(ty + tip)} ` +
    `Q${r2(bx + k)} ${r2(cy)} ${r2(bx + half)} ${by} Z`
  );
}

/** A blade in the tile: [root x, height, tip lean (px, + = right)]. */
export type Blade = readonly [number, number, number];
/** A tuft: blades sharing one root (2-3, never more). */
export type Tuft = { readonly layer: "back" | "front"; readonly blades: ReadonlyArray<Blade> };

export const DIVIDER_TILE_WIDTH = 84;
export const DIVIDER_HEIGHT = 16;

const tuft = (layer: Tuft["layer"], x: number, blades: ReadonlyArray<readonly [number, number]>): Tuft => ({
  layer,
  blades: blades.map(([h, lean], i) => [x + (i - (blades.length - 1) / 2) * 1.7, h, lean] as const),
});

/** One 84 px tile, heights 6-14 px (SPEC §8.3). Roots spaced unevenly so the repeat is hard to spot. */
export const DIVIDER_TUFTS: ReadonlyArray<Tuft> = [
  // Back tufts (darker green), sitting between and behind the front ones.
  tuft("back", 12, [[8, -2.6], [11, 1.8]]),
  tuft("back", 31, [[7, -2.4], [10, 0.6], [8, 3]]),
  tuft("back", 51, [[9, -1.6], [7, 2.6]]),
  tuft("back", 67, [[6, -2], [9, 1.2]]),
  tuft("back", 76, [[10, -2.4], [8, 2.2]]),
  // Front tufts (--lawn).
  tuft("front", 3, [[9, -2.8], [13, 0.8], [8, 3.4]]),
  tuft("front", 21, [[10, -3], [7, 2.8]]),
  tuft("front", 41, [[8, -3.2], [14, -0.4], [10, 3.2]]),
  tuft("front", 59, [[12, -1.2], [8, 3]]),
  tuft("front", 71, [[6, -1.8], [8, 2]]),
  tuft("front", 82, [[7, -2.6], [11, 1.4]]),
];

/** Path data for one layer of one tile. Blades that poke past an edge are also drawn wrapped, so the tile repeats seamlessly. */
export function dividerPath(layer: Tuft["layer"]): string {
  const W = DIVIDER_TILE_WIDTH;
  const parts: string[] = [];
  for (const t of DIVIDER_TUFTS) {
    if (t.layer !== layer) continue;
    for (const [x, h, dx] of t.blades) {
      const lo = Math.min(x - 1.5, x + dx - 0.4);
      const hi = Math.max(x + 1.5, x + dx + 0.4);
      parts.push(bladePath(x, DIVIDER_HEIGHT, h, dx));
      if (lo < 0) parts.push(bladePath(x + W, DIVIDER_HEIGHT, h, dx));
      if (hi > W) parts.push(bladePath(x - W, DIVIDER_HEIGHT, h, dx));
    }
  }
  return parts.join(" ");
}
