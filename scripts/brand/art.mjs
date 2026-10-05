// Grass Pass brand art as plain SVG strings (no DOM, no fonts at render time).
// Logo variant B (Kevin's pick, 2026-10-05): rebuilt from Kevin's banner (projects/grass-pass/brand/banner-reference.png,
// 484x162). All geometry is in banner pixels, measured at 8x zoom (see projects/grass-pass/brand/work/NOTES.md).
// Ticket, sun, dashes, grass, sunflower and limbs are drawn from numbers here; the kid's shirt, shorts, skin, shoes and
// hair are cleaned, palette-snapped traces of Kevin's drawing (scripts/brand/kid-trace.json).
// Flat colours only: no gradients, no phones, no AI sparkles.
import { readFileSync } from "node:fs";
import { f } from "./fonts.mjs";

/** UI design tokens (SPEC §8.1). Keep in sync with src/styles/tokens.css (a unit test checks this). */
export const TOKENS = {
  paper: "#FAF3E1",
  paperLight: "#FEFCF6",
  forest: "#2F5233",
  ticket: "#295031",
  ink: "#14240F",
  lawn: "#70B364",
  sage: "#84A56A",
  mint: "#C1D5AD",
  sun: "#FBBD4A",
  sunflower: "#FFD96C",
};

/**
 * Art palette, sampled from Kevin's banner (variant B). Illustration only, never UI text; a unit test keeps the
 * shared roles (ticket, wordmark, tagline, lawn, sun, paper) within a few steps of the UI tokens above.
 */
export const ART = {
  paper: "#FAF3E1", ticket: "#274D2D", word: "#25462A", ink: "#1F2B19",
  line: "#E6EFD9", dash: "#C9D8C0", sun: "#F7C04F",
  gDark: "#46884F", gMid: "#69B46B", gLight: "#9BD293", gPale: "#DAF0D2",
  hill: "#6FB264", hillShadow: "#559653", bush: "#417040",
  skin: "#F4AF8A", skinShade: "#E39577", blush: "#EE9479", hair: "#6F4025", hairDark: "#5A321C",
  shirt: "#8DBE90", shirtDark: "#5E9E62", shorts: "#2C5132", shoe: "#3E4643",
  rim: "#353D3C", lens: "#D1EAEF", glint: "#FFFFFF", eye: "#2D261A",
  petal: "#F4D46A", petalDark: "#E9BC45", seed: "#8F5A2E", seedDark: "#6E4220",
  leaf: "#5A9A55", leafLight: "#7DB872", stem: "#5E9A58",
};

/** Dark-background (reversed) palette: cream ticket and lettering for the dark theme (page background --ticket). */
export const ART_DARK = {
  ...ART,
  word: "#FAF3E1", ink: "#E9EFDC", ticket: "#FAF3E1", line: "#295031", dash: "#7C9A7E", paper: "#295031", gPale: "#3E6B45",
};

// ---------------------------------------------------------------------------------------------
// Curve helpers.
// ---------------------------------------------------------------------------------------------
const pt = (p) => `${f(p[0])},${f(p[1])}`;

/** Open Catmull-Rom spline through pts as cubic Béziers; starts with M (or L to continue a path). */
function smoothOpen(pts, start = true) {
  let s = `${start ? "M" : "L"}${pt(pts[0])}`;
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = i > 0 ? pts[i - 1] : pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = i + 2 < n ? pts[i + 2] : pts[i + 1];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    s += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return s;
}

/** Closed Catmull-Rom spline. */
function smoothClosed(pts) {
  const n = pts.length;
  let s = `M${pt(pts[0])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    s += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return `${s}Z`;
}

// ---------------------------------------------------------------------------------------------
// Ticket (banner px): body x 21..99.6, y 62..103.8, soft side notches, tear line at x 75, sun on the stub.
// ---------------------------------------------------------------------------------------------
const T = { x0: 21, x1: 99.6, y0: 62, y1: 103.8, r: 6, nr: 6, nrf: 3.8, ny: 82.6, tx: 75, tnr: 1.7 };
const SUN = { cx: 85.9, cy: 82.8, r: 4.9, ring: 6.6, dot: 0.75, n: 16 };

/** Soft notch on a vertical edge: a notch arc with small shoulder fillets. side -1 left / +1 right; going -1 up / +1 down. */
function notch(xEdge, ny, nr, rf, side, going) {
  const dy = Math.sqrt((nr + rf) ** 2 - rf ** 2);
  const k = nr / (nr + rf);
  const xi = xEdge - side * rf * k;
  const ya = ny - going * dy;
  const yb = ny + going * dy;
  const ta = ny - going * dy * k;
  const tb = ny + going * dy * k;
  return (
    `L${f(xEdge)},${f(ya)}A${f(rf)},${f(rf)} 0 0 1 ${f(xi)},${f(ta)}` +
    `A${f(nr)},${f(nr)} 0 0 0 ${f(xi)},${f(tb)}A${f(rf)},${f(rf)} 0 0 1 ${f(xEdge)},${f(yb)}`
  );
}

/** Ticket outline: rounded corners, soft side notches, small notches top and bottom of the tear line. */
export function ticketOutlinePath() {
  const { x0, x1, y0, y1, r, tx, tnr: tr } = T;
  return [
    `M${f(x0 + r)},${f(y0)}`,
    `L${f(tx - tr)},${f(y0)}`, `A${tr},${tr} 0 0 0 ${f(tx + tr)},${f(y0)}`,
    `L${f(x1 - r)},${f(y0)}`, `A${r},${r} 0 0 1 ${f(x1)},${f(y0 + r)}`,
    notch(x1, T.ny, T.nr, T.nrf, 1, 1),
    `L${f(x1)},${f(y1 - r)}`, `A${r},${r} 0 0 1 ${f(x1 - r)},${f(y1)}`,
    `L${f(tx + tr)},${f(y1)}`, `A${tr},${tr} 0 0 0 ${f(tx - tr)},${f(y1)}`,
    `L${f(x0 + r)},${f(y1)}`, `A${r},${r} 0 0 1 ${f(x0)},${f(y1 - r)}`,
    notch(x0, T.ny, T.nr, T.nrf, -1, -1),
    `L${f(x0)},${f(y0 + r)}`, `A${r},${r} 0 0 1 ${f(x0 + r)},${f(y0)}`,
    "Z",
  ].join("");
}

const STRIPES = `M33,66.2H69.6M33,99.4H69.6`;
function sunDots() {
  const out = [];
  for (let k = 0; k < SUN.n; k++) {
    const a = (k * 2 * Math.PI) / SUN.n + Math.PI / SUN.n;
    out.push(`<circle cx="${f(SUN.cx + SUN.ring * Math.cos(a))}" cy="${f(SUN.cy + SUN.ring * Math.sin(a))}" r="${SUN.dot}"/>`);
  }
  return out.join("");
}

// ---------------------------------------------------------------------------------------------
// Grass: soft curved lawn blades in V-tufts (Kevin's drawing), each blade a single tapered shape with its own base.
// ---------------------------------------------------------------------------------------------
const RISE = 0.62;
const TAPER = 1.05;

/** Blade outline: quadratic centreline from base (bx, by) to tip (tx, ty), width w tapering to the tip. */
export function blade(bx, by, tx, ty, w, lean = 0.18, n = 14) {
  const h = by - ty;
  const cx = bx + (tx - bx) * lean;
  const cy = by - h * RISE;
  const c = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    c.push([(1 - t) ** 2 * bx + 2 * (1 - t) * t * cx + t * t * tx, (1 - t) ** 2 * by + 2 * (1 - t) * t * cy + t * t * ty, t]);
  }
  const left = [];
  const right = [];
  c.forEach(([x, y, t], i) => {
    const j0 = Math.max(0, i - 1);
    const j1 = Math.min(n, i + 1);
    const dx = c[j1][0] - c[j0][0];
    const dy = c[j1][1] - c[j0][1];
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L;
    const ny = dx / L;
    const ww = (w / 2) * (1 - t) ** TAPER * (0.8 + 0.2 * Math.sin(Math.PI * Math.min(1, t * 1.6)));
    left.push([x + nx * ww, y + ny * ww]);
    right.push([x - nx * ww, y - ny * ww]);
  });
  return { left, right, mid: c.map(([x, y]) => [x, y]) };
}

const outline = (side, other) => smoothOpen(side) + smoothOpen(other.slice().reverse().slice(1), false) + "Z";

/** One blade as SVG: mid green with a shaded inner edge and a light streak (or one flat fill for mono/pale). */
function bladeSvg([bx, by, tx, ty, w, tone, lean = 0.18], P, mono, streakK) {
  const { left, right, mid } = blade(bx, by, tx, ty, w, lean);
  const d = outline(left, right);
  if (mono) return `<path d="${d}" fill="${mono}"/>`;
  if (tone === "pale") return `<path d="${d}" fill="${P.gPale}"/>`;
  const out = [`<path d="${d}" fill="${P.gMid}"/>`];
  const tip = left.at(-1);
  const [shade, lit] = tx - bx < 0 ? [left, right] : [right, left];
  const inner = mid.map((m, i) => [m[0] * 0.55 + shade[i][0] * 0.45, m[1] * 0.55 + shade[i][1] * 0.45]);
  out.push(`<path d="${smoothOpen([...inner.slice(0, -1), tip]) + smoothOpen(shade.slice().reverse().slice(1), false)}Z" fill="${P.gDark}"/>`);
  const k = streakK;
  if (k > 0) {
    const streak = mid.map((m, i) => [m[0] * (1 - k) + lit[i][0] * k, m[1] * (1 - k) + lit[i][1] * k]);
    const hi = Math.floor(mid.length * 0.8);
    out.push(`<path d="${smoothOpen(mid.slice(1, hi)) + smoothOpen(streak.slice(1, hi).reverse(), false)}Z" fill="${P.gLight}"/>`);
  }
  return out.join("");
}

// [base x, base y, tip x, tip y, width, tone, lean] measured on the 8x zoom of Kevin's banner.
export const GRASS = [
  // Pale back blades: the soft mint glow between the blades in Kevin's art.
  [45.5, 64, 45, 50.5, 5, "pale", 0], [64, 64, 64.6, 50.5, 5, "pale", 0],
  [36, 64, 33.6, 52, 4.4, "pale", 0], [79, 64, 82, 51, 4.4, "pale", 0],
  [55, 64, 55, 50, 4.4, "pale", 0], [40, 64, 38, 49, 4, "pale", 0],
  [50, 64, 49.5, 52, 4, "pale", 0], [73, 64, 75, 49, 4, "pale", 0],
  [32.5, 64, 29, 55, 3.6, "pale", 0],
  [36.8, 64.5, 35, 56.4, 3.2, "mid", 0], [47.2, 64.5, 45, 55, 3.4, "mid", 0],
  [63, 64.5, 65, 55.6, 3.4, "mid", 0], [82, 64.5, 83, 57.5, 3, "mid", 0],
  // Front blades: V-shaped tufts.
  [37.3, 64.5, 30.4, 53.8, 3.6, "mid", 0], [39, 64.5, 34.2, 50, 3.6, "mid", 0],
  [42, 64.5, 41, 46.8, 3.9, "mid", 0],
  [50.3, 64.5, 48, 51.9, 3.4, "mid", 0], [52, 64.5, 51, 48, 3.9, "mid", 0],
  [57.4, 64.5, 59.4, 48.8, 3.9, "mid", 0], [58.9, 64.5, 61.8, 52.4, 3.4, "mid", 0],
  [67.6, 64.5, 65, 53.8, 3.4, "mid", 0], [70.8, 64.5, 70.4, 48, 3.9, "mid", 0],
  [77, 65.6, 80.6, 46.8, 4.3, "mid", 0], [79.5, 64.5, 85, 52.4, 3.6, "mid", 0],
];
const GRASS_WIDTH = 1.3; // Kevin's clump is bushier than the measured tips suggest.
const GRASS_STREAK = 0.42; // light streak width, as a share of the blade's lit half

// 16-32 px icon: five bold soft blades.
export const SMALL_GRASS = [
  [33, 65, 25.5, 41, 11, "mid", 0], [47, 65, 42.5, 32, 12, "mid", 0], [60, 65, 60.5, 35, 12, "mid", 0],
  [73, 65, 78, 31, 12, "mid", 0], [86, 65, 95, 42, 11, "mid", 0],
];

function grass(P, spec = GRASS, { mono = null, wk = GRASS_WIDTH, streak = GRASS_STREAK } = {}) {
  return spec
    .filter((b) => !(mono && b[5] === "pale"))
    .map((b) => bladeSvg([b[0], b[1], b[2], b[3], b[4] * wk, b[5], b[6]], P, mono, streak))
    .join("");
}

// ---------------------------------------------------------------------------------------------
// Mark = grass + ticket. Views (banner px): MARK_VIEW tight around the art, ICON_VIEW square for app icons.
// ---------------------------------------------------------------------------------------------
export const MARK_VIEW = { x: 17, y: 42, width: 87, height: 66 };
export const ICON_VIEW = { x: 17.5, y: 32, width: 85.5, height: 85.5 };
export const SMALL_VIEW = { x: 17, y: 24.5, width: 85, height: 85 };
export const LOGO_VIEW = { x: 17, y: 42, width: 274, height: 66 };
export const WORDMARK_VIEW = { x: 102, y: 59, width: 188, height: 46 };

/**
 * The ticket mark (group content in banner px).
 * variant: "color" (light backgrounds), "reversed" (dark backgrounds), "mono" (one-colour black print).
 * simple: 16-32 px detail level (five bold blades, no stripes or sun dots, thicker dashes, bigger sun).
 */
export function ticketMark({ variant = "color", simple = false, idPrefix = "gp" } = {}) {
  const P = variant === "reversed" ? ART_DARK : ART;
  const mono = variant === "mono" ? "#000" : null;
  const blades = simple ? grass(P, SMALL_GRASS, { mono, wk: 1, streak: 0 }) : grass(P, GRASS, { mono });
  const stripes = simple ? "" : `<path d="${STRIPES}" stroke-width="2" stroke-linecap="round" fill="none"/>`;
  const tear = simple
    ? `<path d="M${T.tx},69V97" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="5.5 5" fill="none"/>`
    : `<path d="M${T.tx},67.6V97.8" stroke-width="1.55" stroke-linecap="round" stroke-dasharray="4.4 3.6" fill="none"/>`;
  const sun = simple
    ? `<circle cx="${f(SUN.cx + 0.6)}" cy="${SUN.cy}" r="7"/>`
    : `<circle cx="${SUN.cx}" cy="${SUN.cy}" r="${SUN.r}"/>${sunDots()}`;

  if (mono) {
    // Details are real holes cut out of the black ticket, so the print logo works on any paper colour.
    const id = `${idPrefix}-mono-cut`;
    return (
      blades +
      `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">` +
      `<rect width="120" height="120" fill="#fff"/>` +
      `<g stroke="#000">${stripes}${tear}</g><g fill="#000">${sun}</g>` +
      `</mask></defs>` +
      `<path fill="#000" mask="url(#${id})" d="${ticketOutlinePath()}"/>`
    );
  }
  return (
    blades +
    `<path fill="${P.ticket}" d="${ticketOutlinePath()}"/>` +
    (stripes ? `<g stroke="${P.line}">${stripes}</g>` : "") +
    `<g stroke="${P.dash}">${tear}</g>` +
    `<g fill="${P.sun}">${sun}</g>`
  );
}

// ---------------------------------------------------------------------------------------------
// Horizontal logo: mark + "GRASS PASS" + tagline, exactly as laid out in Kevin's banner.
// ---------------------------------------------------------------------------------------------
export const TAGLINE_STROKE = 0.42; // Varela Round is a touch lighter than Kevin's tagline.

/** Wordmark + tagline paths (from layoutLogoText() in render-brand.mjs) in the variant's colours. */
export function logoText(text, variant = "color") {
  const P = variant === "reversed" ? ART_DARK : ART;
  const word = variant === "mono" ? "#000" : P.word;
  const tag = variant === "mono" ? "#000" : P.ink;
  return (
    `<path fill="${word}" d="${text.wordmark}"/>` +
    `<path fill="${tag}" stroke="${tag}" stroke-width="${TAGLINE_STROKE}" stroke-linejoin="round" d="${text.tagline}"/>`
  );
}

/** @param {{ wordmark: string, tagline: string }} text */
export function logoHorizontal(text, { variant = "color", idPrefix = "gp" } = {}) {
  return ticketMark({ variant, idPrefix }) + logoText(text, variant);
}

// ---------------------------------------------------------------------------------------------
// Explorer scene (banner px, right side): kid peering through a magnifying glass, sunflower, hill, bush.
// ---------------------------------------------------------------------------------------------
export const SCENE_VIEW = { x: 288, y: 12, width: 190, height: 146 };
/** Standalone scene (site hero): wider view so the hill's feet and the whole bush show, with no hard cut edges. */
export const SCENE_STANDALONE_VIEW = { x: 260, y: 12, width: 248, height: 146 };

const KID = JSON.parse(readFileSync(new URL("./kid-trace.json", import.meta.url), "utf8"));

function tuft(x, y, s, col) {
  const spec = [
    [x - 1.6 * s, y, x - 3.6 * s, y - 4.6 * s, 1.5 * s, 0.3],
    [x, y, x + 0.2 * s, y - 6.4 * s, 1.7 * s, 0.1],
    [x + 1.6 * s, y, x + 3.8 * s, y - 4.2 * s, 1.5 * s, 0.3],
  ];
  const d = spec.map(([bx, by, tx, ty, w, lean]) => {
    const { left, right } = blade(bx, by, tx, ty, w, lean);
    return outline(left, right);
  });
  return `<path d="${d.join(" ")}" fill="${col}"/>`;
}

/** Curved two-sided shape from (x0, y0) to (x1, y1): sides bulge to +a·w and b·w along the normal (quadratic). */
function lensPath(x0, y0, x1, y1, w, a, b) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L = Math.hypot(dx, dy);
  const nx = -dy / L;
  const ny = dx / L;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  return (
    `M${f(x0)},${f(y0)} Q${f(mx + nx * w * a)},${f(my + ny * w * a)} ${f(x1)},${f(y1)} ` +
    `Q${f(mx + nx * w * b)},${f(my + ny * w * b)} ${f(x0)},${f(y0)}Z`
  );
}

/** Sunflower leaf with its light half on top, like Kevin's. */
function leaf(x0, y0, x1, y1, w) {
  return (
    `<path d="${lensPath(x0, y0, x1, y1, w, 1.3, -1.3)}" fill="${ART.leaf}"/>` +
    `<path d="${lensPath(x0, y0, x1, y1, w, 1.3, 0.15)}" fill="${ART.leafLight}"/>`
  );
}

function sunflower(cx = 330.4, cy = 101) {
  const P = ART;
  const g = [
    `<path d="M${f(cx)},${f(cy + 6)} C${f(cx + 0.2)},${f(cy + 16)} ${f(cx + 1.4)},${f(cy + 26)} ${f(cx + 1.6)},${f(cy + 35.2)}" ` +
      `stroke="${P.stem}" stroke-width="2.3" stroke-linecap="round" fill="none"/>`,
    leaf(cx + 0.2, cy + 23, cx - 14.4, cy + 17, -4),
    leaf(cx + 0.8, cy + 23, cx + 15.8, cy + 15.6, 4),
  ];
  // Pointed petals: a darker back ring, then the front ring.
  for (const [n, r0, r1, w, col, off] of [
    [14, 4.5, 13, 2.7, P.petalDark, Math.PI / 14],
    [14, 4.5, 12.6, 2.8, P.petal, 0],
  ]) {
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n + off;
      const [x0, y0, x1, y1] = [cx + r0 * Math.cos(a), cy + r0 * Math.sin(a), cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)];
      g.push(`<path d="${lensPath(x0, y0, x1, y1, w, 1.33, -1.33)}" fill="${col}"/>`);
    }
  }
  g.push(`<circle cx="${cx}" cy="${cy}" r="6.9" fill="${P.seed}"/>`);
  for (const [dx, dy] of KID.seedDots) g.push(`<circle cx="${f(cx + dx)}" cy="${f(cy + dy)}" r="0.6" fill="${P.seedDark}"/>`);
  return g.join("");
}

/** Tapered limb through pts with a width per point and rounded ends. */
function limb(pts, widths) {
  const left = [];
  const right = [];
  const n = pts.length;
  pts.forEach(([x, y], i) => {
    const j0 = Math.max(0, i - 1);
    const j1 = Math.min(n - 1, i + 1);
    const dx = pts[j1][0] - pts[j0][0];
    const dy = pts[j1][1] - pts[j0][1];
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L;
    const ny = dx / L;
    left.push([x + (nx * widths[i]) / 2, y + (ny * widths[i]) / 2]);
    right.push([x - (nx * widths[i]) / 2, y - (ny * widths[i]) / 2]);
  });
  const cap = (p, q, w) => {
    const dx = p[0] - q[0];
    const dy = p[1] - q[1];
    const L = Math.hypot(dx, dy) || 1;
    return [p[0] + (dx / L) * w * 0.42, p[1] + (dy / L) * w * 0.42];
  };
  return smoothClosed([...left, cap(pts[n - 1], pts[n - 2], widths[n - 1]), ...right.reverse(), cap(pts[0], pts[1], widths[0])]);
}

function kid() {
  const P = ART;
  const fingers = [[446.8, 84.2], [446.4, 86.8], [444.8, 89], [442, 90]]
    .map(([tx, ty]) => limb([[441, 84], [(441 + tx) / 2, (84 + ty) / 2], [tx, ty]], [2.3, 2, 1.7]))
    .join(" ");
  const arm = limb([[420.4, 69.8], [429.6, 74.8], [438.6, 81.4]], [6.6, 5.4, 4.6]);
  const thumb = limb([[439.2, 84.8], [437.8, 86.6], [437, 88.4]], [2.3, 2, 1.7]);
  const legs =
    limb([[400.4, 108], [397.6, 121], [394.2, 134]], [6.6, 5.6, 4.9]) + " " +
    limb([[426.8, 110.5], [430, 122], [433.2, 133]], [6.6, 5.6, 4.9]);
  return [
    // Magnifier handle (under the hand).
    `<path d="M361.4,80.2 L365.2,86.6" stroke="${P.rim}" stroke-width="2.2" stroke-linecap="round"/>`,
    `<path d="M365,86.4 L371,95.6" stroke="${P.rim}" stroke-width="3.6" stroke-linecap="round"/>`,
    // Back arm swinging with an open hand.
    `<path d="${arm} ${fingers} ${thumb}" fill="${P.skin}"/>`,
    `<ellipse cx="440.8" cy="84.2" rx="3.7" ry="3.1" transform="rotate(40 440.8 84.2)" fill="${P.skin}"/>`,
    `<path d="${KID.shirt}" fill="${P.shirt}"/>`,
    `<path d="${KID.shirtDarkA}" fill="${P.shirtDark}"/>`,
    `<path d="${KID.shirtDarkB}" fill="${P.shirtDark}"/>`,
    `<path d="${legs}" fill="${P.skin}"/>`,
    `<path d="${KID.shorts}" fill="${P.shorts}"/>`,
    `<ellipse cx="376.5" cy="56.5" rx="15.5" ry="15" fill="${P.skin}"/>`,
    `<path d="${KID.skin}" fill="${P.skin}"/>`,
    `<path d="${KID.shoes}" fill="${P.shoe}"/>`,
    `<path d="${KID.hair}" fill="${P.hair}"/>`,
    // Ear.
    `<ellipse cx="403.6" cy="49.6" rx="3.3" ry="4.3" transform="rotate(12 403.6 49.6)" fill="${P.skin}"/>`,
    `<path d="M403,47.4 Q405.4,48.4 404.2,51.4" stroke="${P.skinShade}" stroke-width="0.9" stroke-linecap="round" fill="none"/>`,
    // Face: blush, open eye, eyebrow, the wink next to the glass, smile.
    `<circle cx="390.2" cy="57.8" r="3.7" fill="${P.blush}" opacity="0.85"/>`,
    `<ellipse cx="383.4" cy="53.6" rx="1.15" ry="1.5" fill="${P.eye}"/>`,
    `<path d="M380.4,48.2 Q382.6,46.4 385,47.6" stroke="${P.hair}" stroke-width="1" stroke-linecap="round" fill="none"/>`,
    `<path d="M373,55 C374.4,56.9 374.3,60 375.3,62 C375.9,63.1 377,63 377.6,62.2" stroke="${P.hair}" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    `<path d="M377.6,65.6 Q381,68.9 385.2,64" stroke="${P.hairDark}" stroke-width="1.1" stroke-linecap="round" fill="none"/>`,
    // Magnifier rim + lens over the face, and the glint.
    `<g transform="rotate(-20 356 65.6)"><ellipse cx="356" cy="65.6" rx="11.5" ry="17" fill="${P.rim}"/>` +
      `<ellipse cx="356" cy="65.6" rx="8.8" ry="14.2" fill="${P.lens}"/></g>`,
    `<path d="M350.2,58.4 C348.4,61.6 348.6,65.4 350.6,68.4" stroke="${P.glint}" stroke-width="1.7" stroke-linecap="round" fill="none" opacity="0.95"/>`,
  ].join("");
}

/**
 * The scene in banner px. hillX moves the hill's left foot (the cover uses a wider hill).
 * standalone: the bush is whole and the hill either becomes a mound that also comes down on the right ("mound", for the
 * site hero, which floats on the page) or runs flat off the right edge ("edge", for the dark-mode picture card).
 */
export function explorerScene({ hillX = 264, standalone = false, hill = "mound" } = {}) {
  const P = ART;
  const bush = [
    [461.6, 106, 6.6], [462.6, 97.4, 6.4], [466.6, 89.6, 6.6], [473, 84.6, 6.8], [479, 82, 7],
    [472, 100, 10], [480, 98, 12], [470, 108, 8],
  ]
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`)
    .join("");
  return [
    `<g fill="${P.bush}">${bush}${standalone ? `<circle cx="486" cy="108" r="7"/><circle cx="487" cy="90" r="6"/>` : ""}</g>`,
    standalone && hill === "edge"
      ? `<path d="M${f(hillX)},158 C300,139 350,124.5 400,117.6 C430,114.2 455,113.1 480,112.8 L520,112.6 L520,158Z" fill="${P.hill}"/>`
      : standalone
      ? `<path d="M${f(hillX)},158 C300,139 350,124.5 400,117.6 C430,114.2 455,113.1 472,113.2 C488,113.4 502,128 506,158Z" fill="${P.hill}"/>`
      : `<path d="M${f(hillX)},158 C300,139 350,124.5 400,117.6 C430,114.2 455,113.1 480,112.8 L480,158Z" fill="${P.hill}"/>`,
    `<ellipse cx="414.4" cy="140.4" rx="34.2" ry="6.6" fill="${P.hillShadow}"/>`,
    sunflower(),
    tuft(303.6, 139.4, 1.15, P.hillShadow),
    tuft(359.2, 146, 1, P.hillShadow),
    tuft(464, 130, 1.05, P.hillShadow),
    kid(),
  ].join("");
}

// ---------------------------------------------------------------------------------------------
// Document helpers.
// ---------------------------------------------------------------------------------------------
export const viewBox = (v) => `${f(v.x)} ${f(v.y)} ${f(v.width)} ${f(v.height)}`;

/** Wraps SVG content in a standalone, accessible document. */
export function svgDoc({ viewBox: vb, width, height, title, inner, decorative = false }) {
  const a11y = decorative ? `aria-hidden="true"` : `role="img" aria-labelledby="t"`;
  const titleEl = decorative ? "" : `<title id="t">${title}</title>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"` +
    (width ? ` width="${width}" height="${height}"` : "") +
    ` ${a11y}>${titleEl}${inner}</svg>\n`
  );
}
