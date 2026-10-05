// Short straight lawn-grass blades (tapered, rounded tips). Used by GrassDivider only (the logo grass is drawn in scripts/brand/art.mjs).
// Never pointed multi-leaf shapes (BRAND.md "Avoid": nothing that looks like cannabis).

const r2 = (n: number) => Math.round(n * 100) / 100;

export function bladePath(bx: number, by: number, h: number, dx: number, w = 1.6, tw = 0.7): string {
  const tipY = by - h;
  return `M${r2(bx - w)} ${by} L${r2(bx + dx - tw)} ${r2(tipY)} A${tw} ${tw} 0 0 1 ${r2(bx + dx + tw)} ${r2(tipY)} L${r2(bx + w)} ${by} Z`;
}

/** One 40 px tile: 7 blades, heights 6-14 px (SPEC §8.3). [x, height, lean] */
export const DIVIDER_TILE: ReadonlyArray<readonly [number, number, number]> = [
  [3, 9, -1],
  [8.5, 13, 0.5],
  [14, 7, 1],
  [20, 14, -0.5],
  [25.5, 10, 0],
  [31, 6, 1],
  [36.5, 12, -1],
];

export const DIVIDER_TILE_WIDTH = 40;
export const DIVIDER_HEIGHT = 16;

/** Path data for `tiles` tiles of blades standing on y = DIVIDER_HEIGHT. */
export function dividerPath(tiles: number): string {
  const parts: string[] = [];
  for (let t = 0; t < tiles; t++) {
    for (const [x, h, dx] of DIVIDER_TILE) parts.push(bladePath(t * DIVIDER_TILE_WIDTH + x, DIVIDER_HEIGHT, h, dx));
  }
  return parts.join(" ");
}
