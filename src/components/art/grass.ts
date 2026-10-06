// Header / footer lawn strip, option C "Lawn bank" (Kevin's pick, 2026-10-05; design source:
// projects/grass-pass/brand/work/grass-v2/gen.py). Soft curved blades in logo B's style (mid green body, darker
// shaded inner half, light streak on the lit half), pale mint glow blades behind, a soft rolling green ground line,
// and four tiny finds per 1031 px (two sunflower-yellow flowers, a clover, a dandelion clock).
//
// The strip is several <pattern> tiles with different widths (377, 293, 787, 1031 px) stacked, so the combined
// repeat is far wider than any screen and never visibly repeats. Every blade has its own root (never a fan from one
// point: BRAND.md "Avoid", nothing that looks like cannabis).
//
// The strip is a static SVG per theme in public/brand/ (written by scripts/render-brand.mjs, kept in sync by a unit
// test), used as a CSS background via the --grass-strip token, so the ~36 KB of path data is fetched once and cached
// instead of being inlined (twice, plus the RSC payload) into every page.

import { FRONT, MIDDLE, PALE_FRONT, PALE_TALL, TALL, type BladeRow } from "./grass-data.ts";

/** Strip height in CSS px (the bank sits on the bottom edge). */
export const DIVIDER_HEIGHT = 34;
/** Width of the static strip SVG. Wider than nearly every screen; repeat-x covers the rest. */
export const GRASS_STRIP_WIDTH = 3840;
/** Public paths of the two strips (also referenced by --grass-strip in src/styles/tokens.css). */
export const GRASS_STRIP_FILES = { light: "brand/grass-strip.svg", dark: "brand/grass-strip-dark.svg" } as const;

const RISE = 0.62; // same bend as the logo blades (scripts/brand/art.mjs RISE)
const BASE = DIVIDER_HEIGHT + 1; // blade roots sit 1 px below the bottom edge, so no blade shows a flat foot

/** Tile widths: front + its pale glow (377), darker middle (293), tall signature tufts (787), finds (1031). */
export const TILE = { front: 377, middle: 293, tall: 787, finds: 1031 } as const;

export type GrassTheme = "light" | "dark";

/** Strip colours. Greens are logo B's grass greens; the flowers use the sun / sunflower tokens. */
export const GRASS_PALETTE: Record<GrassTheme, Record<string, string>> = {
  light: {
    pale: "#D4EECC", deep: "#46884F", mid: "#69B46B", light: "#9BD293", band: "#69B46B",
    stem: "#5E9A58", leaf: "#5A9A55", petal: "#FFD96C", petalDark: "#FBBD4A", seed: "#8F5A2E",
    puff: "#FFFFFF", puffLine: "#8FAE86", clover: "#46884F", cloverLight: "#9BD293",
  },
  dark: {
    pale: "#3E6B45", deep: "#46884F", mid: "#69B46B", light: "#9BD293", band: "#69B46B",
    stem: "#7DB872", leaf: "#5A9A55", petal: "#FFD96C", petalDark: "#FBBD4A", seed: "#8F5A2E",
    puff: "#FAF3E1", puffLine: "#C1D5AD", clover: "#7DB872", cloverLight: "#B8E2AE",
  },
};

/** One decimal, no trailing ".0" (same formatting as the design generator). */
function r1(v: number): string {
  const s = v.toFixed(1).replace(/\.0$/, "");
  return s === "-0" ? "0" : s;
}
const P = (x: number, y: number) => `${r1(x)} ${r1(y)}`;

type Geo = { bx: number; by: number; tx: number; ty: number; cx: number; cy: number; hw: number; k: number };
function geo([bx, h, dx, w, lean]: BladeRow, by = BASE): Geo {
  return { bx, by, tx: bx + dx, ty: by - h, cx: bx + dx * lean, cy: by - h * RISE, hw: w / 2, k: (w / 2) * 0.85 };
}

/**
 * One soft blade: two quadratic edges from a base of width w up to a tiny round over the tip, so it never looks
 * spiky. The centreline rises upright first, then bends toward the tip (like the logo's blades).
 */
export function bladeOutline(b: BladeRow, by = BASE): string {
  const { bx, tx, ty, cx, cy, hw, k } = geo(b, by);
  const tip = Math.min(0.3, hw * 0.3);
  return (
    `M${P(bx - hw, by)}Q${P(cx - k, cy)} ${P(tx - tip, ty + tip)}` +
    `Q${P(tx, ty - tip * 0.6)} ${P(tx + tip, ty + tip)}Q${P(cx + k, cy)} ${P(bx + hw, by)}Z`
  );
}

/** Darker inner half (the side the blade leans toward), like logo B. */
function bladeShade(b: BladeRow): string {
  const { bx, by, tx, ty, cx, cy, hw, k } = geo(b);
  const s = b[2] < 0 ? -1 : 1;
  return `M${P(bx + s * hw, by)}Q${P(cx + s * k, cy)} ${P(tx, ty)}Q${P(cx + s * 0.45 * k, cy)} ${P(bx + s * 0.45 * hw, by)}Z`;
}

/** Light streak on the lit half, from the base to 78% of the way up the centreline. */
function bladeStreak(b: BladeRow, a = 0.78): string {
  const { bx, by, tx, ty, cx, cy, hw, k } = geo(b);
  const s = b[2] < 0 ? 1 : -1; // lit side = away from the lean
  const mx = (1 - a) ** 2 * bx + 2 * (1 - a) * a * cx + a * a * tx;
  const my = (1 - a) ** 2 * by + 2 * (1 - a) * a * cy + a * a * ty;
  const c1x = bx + a * (cx - bx);
  const c1y = by + a * (cy - by);
  const [o0, o1] = [0.08, 0.5];
  return `M${P(bx + s * o0 * hw, by)}Q${P(c1x + s * o0 * k, c1y)} ${P(mx, my)}Q${P(c1x + s * o1 * k, c1y)} ${P(bx + s * o1 * hw, by)}Z`;
}

/** One path per colour: flat blades for pale/deep layers; body + shade + streak for the front (mid) layers. */
function layer(blades: ReadonlyArray<BladeRow>, tone: "pale" | "deep" | "mid", pal: Record<string, string>): string {
  const body = `<path fill="${pal[tone]}" d="${blades.map((b) => bladeOutline(b)).join("")}"/>`;
  if (tone !== "mid") return body;
  return (
    body +
    `<path fill="${pal.deep}" d="${blades.map(bladeShade).join("")}"/>` +
    `<path fill="${pal.light}" d="${blades.filter((b) => b[1] > 7).map((b) => bladeStreak(b)).join("")}"/>`
  );
}

/** The soft rolling lawn bank along the bottom: sines that divide the tile, so it repeats seamlessly. */
export function bankPath(): string {
  const W = TILE.front;
  const H = DIVIDER_HEIGHT;
  const n = 60;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const x = (W * i) / n;
    const y = H - 3.2 - 1.6 * Math.sin(((2 * Math.PI * x) / W) * 3 + 0.7) - 0.9 * Math.sin(((2 * Math.PI * x) / W) * 7 + 2.1);
    pts.push([x, y]);
  }
  let d = `M${P(-1, H + 1)}L${P(-1, pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    d += i > 1 ? `Q${P(x0, y0)} ${P((x0 + x1) / 2, (y0 + y1) / 2)}` : `L${P(x0, y0)}`;
  }
  return d + `L${P(W + 1, pts[pts.length - 1][1])}L${P(W + 1, H + 1)}Z`;
}

// ---- Finds: tiny, sparse, flat accents standing on y = base ----

/** Tiny 5-petal flower on a thin curved stem with one small leaf. */
function flower(x: number, base: number, h: number, r: number, pal: Record<string, string>, petal = "petal"): string {
  const [cx, cy] = [x + 1.2, base - h];
  const stem =
    `<path fill="none" stroke="${pal.stem}" stroke-width="1.1" stroke-linecap="round" ` +
    `d="M${P(x, base)}Q${P(x - 0.6, base - h * 0.5)} ${P(cx, cy + r * 0.6)}"/>`;
  const leaf =
    `<path fill="${pal.leaf}" d="M${P(x - 0.2, base - h * 0.35)}Q${P(x + 2.4, base - h * 0.62)} ` +
    `${P(x + 4.6, base - h * 0.5)}Q${P(x + 2.6, base - h * 0.3)} ${P(x - 0.2, base - h * 0.35)}Z"/>`;
  let petals = "";
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    petals +=
      `<ellipse cx="${r1(cx + Math.cos(a) * r * 0.62)}" cy="${r1(cy + Math.sin(a) * r * 0.62)}" ` +
      `rx="${r1(r * 0.5)}" ry="${r1(r * 0.5)}"/>`;
  }
  return (
    stem +
    leaf +
    `<g fill="${pal[petal]}">${petals}</g><circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r * 0.42)}" fill="${pal.seed}"/>`
  );
}

/** Dandelion clock: thin stem, a round seed head of fine spokes with dots on the ends. */
function puff(x: number, base: number, h: number, r: number, pal: Record<string, string>): string {
  const [cx, cy] = [x + 1.5, base - h];
  const stem =
    `<path fill="none" stroke="${pal.stem}" stroke-width="0.9" stroke-linecap="round" ` +
    `d="M${P(x, base)}Q${P(x + 0.2, base - h * 0.55)} ${P(cx, cy)}"/>`;
  let spokes = "";
  let dots = "";
  for (let i = 0; i < 12; i++) {
    const a = (i * 2 * Math.PI) / 12 + 0.2;
    const [ex, ey] = [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    spokes += `M${P(cx, cy)}L${P(ex, ey)}`;
    dots += `<circle cx="${r1(ex)}" cy="${r1(ey)}" r="0.75"/>`;
  }
  return (
    stem +
    `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r + 0.4)}" fill="${pal.puff}" opacity="0.55"/>` +
    `<path fill="none" stroke="${pal.puffLine}" stroke-width="0.5" d="${spokes}"/>` +
    `<g fill="${pal.puff}" stroke="${pal.puffLine}" stroke-width="0.35">${dots}</g>` +
    `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="0.8" fill="${pal.puffLine}"/>`
  );
}

/** Three round leaflets on a short stem: unmistakably clover (round, never pointed). */
function clover(x: number, base: number, pal: Record<string, string>, s = 1): string {
  const [cx, cy] = [x, base - 5.5 * s];
  const stem =
    `<path fill="none" stroke="${pal.clover}" stroke-width="0.9" stroke-linecap="round" ` +
    `d="M${P(x - 0.8, base)}Q${P(x - 0.6, base - 3 * s)} ${P(cx, cy)}"/>`;
  let leaves = "";
  for (const deg of [-90, 30, 150]) {
    const a = (deg * Math.PI) / 180;
    leaves += `<circle cx="${r1(cx + Math.cos(a) * 1.75 * s)}" cy="${r1(cy + Math.sin(a) * 1.75 * s)}" r="${r1(1.65 * s)}"/>`;
  }
  return (
    stem +
    `<g fill="${pal.cloverLight}" stroke="${pal.deep}" stroke-width="0.5">${leaves}</g>` +
    `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(0.5 * s)}" fill="${pal.deep}"/>`
  );
}

/** The four finds in one 1031 px tile: flower, clover, dandelion clock, small darker flower. */
function finds(pal: Record<string, string>): string {
  const b = BASE - 1;
  return flower(150, b, 21, 3.8, pal) + clover(458, b, pal, 1.3) + puff(702, b, 23, 4.0, pal) + flower(905, b, 13, 3.0, pal, "petalDark");
}

/** Paint order of the tiles (back to front). */
export const GRASS_TILES: ReadonlyArray<{ w: number; draw: (pal: Record<string, string>) => string }> = [
  { w: TILE.front, draw: (pal) => layer(PALE_FRONT, "pale", pal) },
  { w: TILE.tall, draw: (pal) => layer(PALE_TALL, "pale", pal) },
  { w: TILE.middle, draw: (pal) => layer(MIDDLE, "deep", pal) },
  { w: TILE.front, draw: (pal) => `<path fill="${pal.band}" d="${bankPath()}"/>` },
  { w: TILE.front, draw: (pal) => layer(FRONT, "mid", pal) },
  { w: TILE.tall, draw: (pal) => layer(TALL, "mid", pal) },
  { w: TILE.finds, draw: finds },
];

/** All blade rows by layer (for tests). */
export const GRASS_LAYERS = { paleFront: PALE_FRONT, paleTall: PALE_TALL, middle: MIDDLE, front: FRONT, tall: TALL } as const;

/** The complete static strip SVG for one theme (decorative: aria-hidden, no text, no scripts, no animation). */
export function grassStripSvg(theme: GrassTheme): string {
  const pal = GRASS_PALETTE[theme];
  const H = DIVIDER_HEIGHT;
  const defs = GRASS_TILES.map(
    (t, i) => `<pattern id="g${i}" width="${t.w}" height="${H}" patternUnits="userSpaceOnUse">${t.draw(pal)}</pattern>`,
  ).join("");
  const rects = GRASS_TILES.map((_, i) => `<rect width="100%" height="${H}" fill="url(#g${i})"/>`).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" ` +
    `width="${GRASS_STRIP_WIDTH}" height="${H}" viewBox="0 0 ${GRASS_STRIP_WIDTH} ${H}">` +
    `<defs>${defs}</defs>${rects}</svg>\n`
  );
}
