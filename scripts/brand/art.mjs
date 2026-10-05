// Grass Pass brand art as plain SVG strings (no DOM, no fonts at render time).
// Traced by eye from Kevin's approved banner (projects/grass-pass/brand/banner-reference.png, 484x162).
// Rules (BRAND.md "APPROVED DESIGN" + "Avoid"): flat colours, no gradients, short straight lawn-grass
// blades with rounded tips only (never pointed multi-leaf shapes), no phones, no AI sparkles.

/** Design tokens (SPEC §8.1). Keep in sync with src/styles/tokens.css (a unit test checks this). */
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

/** Illustration-only colours for the explorer scene (skin, hair, etc.). Never used for UI text. */
export const SCENE = {
  hill: "#70B364",
  hillShadow: "#559E52",
  bush: "#3F7D42",
  tuft: "#4E9A4B",
  skin: "#F5BE98",
  blush: "#F39A78",
  hair: "#6C4229",
  shirt: "#8CC584",
  sleeve: "#5E9E62",
  shorts: "#2F5233",
  shoe: "#45484A",
  ring: "#384345",
  lens: "#CDE9F0",
  lensShine: "#FFFFFF",
  eye: "#2B2B2B",
  smile: "#7A3B2A",
  seed: "#8B5A2B",
  seedDot: "#6A4220",
  petal: "#FBBD4A",
  petalLight: "#FFD96C",
  stem: "#4E9A4B",
};

/** Darker blade colour for the back row of grass (art only, never text). */
export const GRASS_DARK = "#4E9A4B";

const r2 = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------------------------
// Ticket mark: viewBox 0 0 120 90. Ticket body 112x60 (ratio from the banner), grass above it.
// ---------------------------------------------------------------------------------------------
export const MARK = { width: 120, height: 90 };
const T = { x0: 4, x1: 116, y0: 28, y1: 88, r: 8, nr: 7, tx: 81, tr: 3.5 };
const YM = (T.y0 + T.y1) / 2;

/** Ticket outline: rounded corners, half-circle notches on both sides, small notches at the tear line. */
export function ticketOutlinePath() {
  const { x0, x1, y0, y1, r, nr, tx, tr } = T;
  return [
    `M${x0 + r} ${y0}`,
    `H${tx - tr}`,
    `A${tr} ${tr} 0 0 0 ${tx + tr} ${y0}`,
    `H${x1 - r}`,
    `A${r} ${r} 0 0 1 ${x1} ${y0 + r}`,
    `V${YM - nr}`,
    `A${nr} ${nr} 0 0 0 ${x1} ${YM + nr}`,
    `V${y1 - r}`,
    `A${r} ${r} 0 0 1 ${x1 - r} ${y1}`,
    `H${tx + tr}`,
    `A${tr} ${tr} 0 0 0 ${tx - tr} ${y1}`,
    `H${x0 + r}`,
    `A${r} ${r} 0 0 1 ${x0} ${y1 - r}`,
    `V${YM + nr}`,
    `A${nr} ${nr} 0 0 0 ${x0} ${YM - nr}`,
    `V${y0 + r}`,
    `A${r} ${r} 0 0 1 ${x0 + r} ${y0}`,
    "Z",
  ].join(" ");
}

/**
 * One short straight grass blade: tapered, with a rounded (never pointed) tip.
 * bx = base centre x, by = base y, h = height, dx = lean, w = half base width, tw = tip radius.
 */
export function bladePath(bx, by, h, dx, w = 2.2, tw = 0.9) {
  const tipY = by - h;
  return `M${r2(bx - w)} ${by} L${r2(bx + dx - tw)} ${r2(tipY)} A${tw} ${tw} 0 0 1 ${r2(bx + dx + tw)} ${r2(tipY)} L${r2(bx + w)} ${by} Z`;
}

// [x, height, lean] for each blade; base sits 3 units under the ticket's top edge (the ticket covers it).
// Blades fan out in four clumps like the banner's grass, but stay straight with rounded tips.
function clump(cx, heights, spread) {
  const n = heights.length;
  return heights.map((h, i) => {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5;
    return [cx + t * 7, h, t * spread];
  });
}
const BACK_BLADES = [
  ...clump(20, [19, 26, 18], 13),
  ...clump(41, [23, 29, 20], 13),
  ...clump(62, [20, 27, 22], 13),
  ...clump(83, [17, 24, 15], 13),
];
const FRONT_BLADES = [
  ...clump(27, [15, 21, 13], 10),
  ...clump(48, [17, 23, 15], 10),
  ...clump(69, [16, 22, 14], 10),
  ...clump(89, [12, 17, 10], 10),
];
// Favicon version: fewer, thicker blades so they survive 16-32 px.
const SIMPLE_BLADES = [
  [22, 17, -2], [38, 21, 0], [54, 18, 1], [70, 21, 0], [86, 15, 2],
];

function grass(blades, by, fill, w, tw) {
  return `<path fill="${fill}" d="${blades.map(([x, h, dx]) => bladePath(x, by, h, dx, w, tw)).join(" ")}"/>`;
}

function sunDots(cx, cy, dist, count, radius) {
  const dots = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    dots.push(`<circle cx="${r2(cx + Math.cos(a) * dist)}" cy="${r2(cy + Math.sin(a) * dist)}" r="${radius}"/>`);
  }
  return dots.join("");
}

/**
 * The ticket mark (group content in 120x90 units).
 * variant: "color" (light backgrounds), "reversed" (dark backgrounds), "mono" (one-colour black print).
 * simple: favicon detail level (no stripes or sun rays, thicker blades and dashes).
 */
export function ticketMark({ variant = "color", simple = false, idPrefix = "gp" } = {}) {
  const by = T.y0 + 3;
  const sunCx = 95.5;
  const blades = simple
    ? grass(SIMPLE_BLADES, by, variant === "mono" ? "#000" : TOKENS.lawn, 3.6, 1.8)
    : variant === "mono"
      ? grass(BACK_BLADES, by, "#000", 2.4, 1.1)
      : grass(BACK_BLADES, by, variant === "reversed" ? TOKENS.mint : GRASS_DARK, 2.2, 0.9) +
        grass(FRONT_BLADES, by, TOKENS.lawn, 2.2, 0.9);

  const stripes = simple
    ? ""
    : `<path d="M${T.x0 + 12} ${T.y0 + 6} H${T.tx - 9} M${T.x0 + 12} ${T.y1 - 6} H${T.tx - 9}" stroke-width="2" stroke-linecap="round" fill="none"/>`;
  const tear = simple
    ? `<path d="M${T.tx} ${T.y0 + 7} V${T.y1 - 7}" stroke-width="3.4" stroke-dasharray="7 5" fill="none"/>`
    : `<path d="M${T.tx} ${T.y0 + 6} V${T.y1 - 6}" stroke-width="2" stroke-dasharray="4 3.2" fill="none"/>`;
  const sunCore = `<circle cx="${sunCx}" cy="${YM}" r="${simple ? 9 : 7.5}"/>`;
  const rays = simple ? "" : sunDots(sunCx, YM, 11, 12, 1.1);

  if (variant === "mono") {
    // Details are cut out of the black ticket (real holes, so it also works on any paper colour).
    const id = `${idPrefix}-mono-cut`;
    return (
      `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${MARK.width}" height="${MARK.height}">` +
      `<rect width="${MARK.width}" height="${MARK.height}" fill="#fff"/>` +
      `<g stroke="#000">${stripes}${tear}</g>` +
      `<g fill="#000">${simple ? sunCore : `<circle cx="${sunCx}" cy="${YM}" r="7.5"/>${rays}`}</g>` +
      (simple ? "" : `<circle cx="${sunCx}" cy="${YM}" r="4" fill="#fff"/>`) +
      `</mask></defs>` +
      blades +
      `<path fill="#000" mask="url(#${id})" d="${ticketOutlinePath()}"/>`
    );
  }

  const body = variant === "reversed" ? TOKENS.paper : TOKENS.ticket;
  const detail = variant === "reversed" ? TOKENS.ticket : TOKENS.mint;
  return (
    blades +
    `<path fill="${body}" d="${ticketOutlinePath()}"/>` +
    `<g stroke="${detail}">${stripes}${tear}</g>` +
    `<g fill="${TOKENS.sun}">${sunCore}${rays}</g>`
  );
}

// ---------------------------------------------------------------------------------------------
// Horizontal logo: mark + "GRASS PASS" + tagline, laid out like the banner
// (wordmark cap height spans the top half of the ticket, the tagline sits on its bottom edge).
// ---------------------------------------------------------------------------------------------

/**
 * @param {{ wordmark: string, tagline: string, width: number }} text outlined paths from layoutLogoText()
 */
export function logoHorizontal(text, { variant = "color", idPrefix = "gp" } = {}) {
  const word = variant === "mono" ? "#000" : variant === "reversed" ? TOKENS.paper : TOKENS.forest;
  const tag = variant === "mono" ? "#000" : variant === "reversed" ? TOKENS.mint : TOKENS.ink;
  return {
    width: text.width,
    height: MARK.height,
    inner:
      ticketMark({ variant, idPrefix }) +
      `<path fill="${word}" d="${text.wordmark}"/>` +
      `<path fill="${tag}" d="${text.tagline}"/>`,
  };
}

/** Text geometry for the horizontal logo, in mark units. Needs fonts from scripts/brand/fonts.mjs. */
export const LOGO_TEXT = {
  x: 126, // gap after the ticket, from the banner (7 px at banner scale)
  capTop: T.y0, // wordmark cap top = ticket top
  capHeight: 32.4, // 22 px at banner scale
  taglineBaseline: T.y0 + 56,
  taglineXHeight: 10.3, // 7 px at banner scale
  taglineToWordmarkWidth: 0.978, // measured in the banner (176 px vs 180 px)
};

// ---------------------------------------------------------------------------------------------
// Explorer scene: kid with a magnifying glass, a sunflower, a rolling hill and a bush.
// Drawn on a 816x648 canvas = the banner's right side (x 280-484) at 4x. Transparent background.
// ---------------------------------------------------------------------------------------------
export const SCENE_BOX = { x: 60, y: 0, width: 756, height: 648 };

function tuft(x, y, s = 1) {
  return [
    bladePath(x - 9 * s, y, 22 * s, -6 * s, 3 * s, 1.4 * s),
    bladePath(x, y, 30 * s, 0, 3 * s, 1.4 * s),
    bladePath(x + 9 * s, y, 22 * s, 6 * s, 3 * s, 1.4 * s),
  ].join(" ");
}

function petals(cx, cy, n, dist, rx, ry, fill, offset = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const deg = (i / n) * 360 + offset;
    const a = (deg * Math.PI) / 180;
    const px = r2(cx + Math.cos(a) * dist);
    const py = r2(cy + Math.sin(a) * dist);
    out.push(`<ellipse cx="${px}" cy="${py}" rx="${rx}" ry="${ry}" transform="rotate(${r2(deg + 90)} ${px} ${py})"/>`);
  }
  return `<g fill="${fill}">${out.join("")}</g>`;
}

export function explorerScene() {
  const S = SCENE;
  const seeds = [];
  for (const [dx, dy] of [[-12, -10], [0, -14], [12, -9], [-15, 3], [-3, 0], [10, 4], [-8, 13], [5, 14], [16, -2]]) {
    seeds.push(`<circle cx="${200 + dx}" cy="${400 + dy}" r="3.2"/>`);
  }
  return [
    // Bush on the right edge.
    `<g fill="${S.bush}"><circle cx="790" cy="380" r="52"/><circle cx="752" cy="415" r="40"/><circle cx="816" cy="350" r="48"/><circle cx="728" cy="440" r="30"/><circle cx="790" cy="440" r="40"/></g>`,
    // Rolling hill.
    `<path fill="${S.hill}" d="M-40 640 C 160 560 420 470 816 452 V 648 H -40 Z"/>`,
    // Grass tufts on the hill.
    `<path fill="${S.tuft}" d="${tuft(112, 560)} ${tuft(318, 590, 0.9)} ${tuft(736, 512, 0.9)} ${tuft(630, 600, 0.7)}"/>`,
    // Sunflower: stem, leaves, petals, seed head.
    `<path d="M200 436 C 196 480 206 512 204 552" stroke="${S.stem}" stroke-width="9" stroke-linecap="round" fill="none"/>`,
    `<g fill="${S.stem}"><ellipse cx="172" cy="486" rx="34" ry="13" transform="rotate(28 172 486)"/><ellipse cx="234" cy="478" rx="34" ry="13" transform="rotate(-28 234 478)"/></g>`,
    petals(200, 400, 14, 36, 12, 21, S.petal),
    petals(200, 400, 14, 31, 8, 16, S.petalLight, 12.86),
    `<circle cx="200" cy="400" r="27" fill="${S.seed}"/>`,
    `<g fill="${S.seedDot}">${seeds.join("")}</g>`,
    // Ground shadow under the kid.
    `<ellipse cx="540" cy="556" rx="150" ry="22" fill="${S.hillShadow}"/>`,
    // The kid (scaled a little about the feet to match the banner's proportions).
    `<g transform="translate(540 552) scale(1.1) translate(-540 -552)">`,
    // Back leg + shoe.
    `<path d="M580 440 L 606 530" stroke="${S.skin}" stroke-width="30" stroke-linecap="round"/>`,
    `<path fill="${S.shoe}" d="M586 528 h44 c14 0 22 10 20 22 h-70 c-4 -12 -2 -22 6 -22 Z"/>`,
    // Front leg + shoe.
    `<path d="M500 448 L 462 530" stroke="${S.skin}" stroke-width="30" stroke-linecap="round"/>`,
    `<path fill="${S.shoe}" d="M444 528 h40 c8 0 10 10 6 22 h-70 c-2 -12 8 -22 24 -22 Z"/>`,
    // Back arm reaching out behind (balance).
    `<path d="M585 285 C 615 300 640 320 655 342" stroke="${S.skin}" stroke-width="26" stroke-linecap="round" fill="none"/>`,
    `<circle cx="660" cy="348" r="17" fill="${S.skin}"/>`,
    // Shorts.
    `<path fill="${S.shorts}" d="M466 392 L 612 372 L 620 444 C 596 452 572 452 552 446 L 540 428 L 512 466 C 492 466 474 460 458 450 Z"/>`,
    // Shirt (bent forward) + darker back sleeve.
    `<path fill="${S.shirt}" d="M428 262 C 470 244 540 238 584 256 C 606 282 616 340 614 384 C 568 398 510 404 468 404 C 456 360 440 300 428 262 Z"/>`,
    `<path fill="${S.sleeve}" d="M528 246 C 556 240 588 248 600 268 C 604 290 594 304 576 306 C 556 296 538 270 528 246 Z"/>`,
    // Front arm holding the magnifier.
    `<path d="M448 300 C 418 322 392 340 362 352" stroke="${S.skin}" stroke-width="26" stroke-linecap="round" fill="none"/>`,
    `<path fill="${S.sleeve}" d="M424 262 C 446 258 466 270 470 296 C 458 316 440 324 424 322 C 414 300 414 278 424 262 Z"/>`,
    // Head: ear, face, hair.
    `<circle cx="486" cy="206" r="18" fill="${S.skin}"/>`,
    `<path fill="${S.skin}" d="M342 200 C 342 150 380 120 422 120 C 466 120 492 150 492 196 C 492 252 462 292 418 296 C 374 300 342 260 342 200 Z"/>`,
    `<path fill="${S.hair}" d="M336 186 C 324 130 360 90 412 84 L 418 60 L 434 80 L 452 64 L 458 86 C 494 94 516 128 508 176 C 500 184 492 182 488 176 C 484 156 474 142 458 134 C 446 152 420 160 394 150 C 384 166 364 178 350 188 C 344 192 338 192 336 186 Z"/>`,
    // Face details.
    `<circle cx="442" cy="234" r="17" fill="${S.blush}" opacity="0.75"/>`,
    `<ellipse cx="416" cy="212" rx="6" ry="8" fill="${S.eye}"/>`,
    `<path d="M392 258 C 402 270 420 272 432 262" stroke="${S.smile}" stroke-width="5" stroke-linecap="round" fill="none"/>`,
    // Magnifying glass (in front of the eye), handle down to the hand.
    `<path d="M338 304 L 366 378" stroke="${S.ring}" stroke-width="17" stroke-linecap="round"/>`,
    `<circle cx="358" cy="352" r="19" fill="${S.skin}"/>`,
    `<ellipse cx="310" cy="252" rx="48" ry="58" transform="rotate(-18 310 252)" fill="${S.lens}" stroke="${S.ring}" stroke-width="13"/>`,
    `<path d="M282 230 C 286 212 298 202 312 200" stroke="${S.lensShine}" stroke-width="8" stroke-linecap="round" fill="none"/>`,
    `</g>`,
  ].join("");
}

// ---------------------------------------------------------------------------------------------
// Document helpers.
// ---------------------------------------------------------------------------------------------

/** Wraps SVG content in a standalone, accessible document. */
export function svgDoc({ viewBox, width, height, title, inner, decorative = false }) {
  const a11y = decorative ? `aria-hidden="true"` : `role="img" aria-labelledby="t"`;
  const titleEl = decorative ? "" : `<title id="t">${title}</title>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"` +
    (width ? ` width="${width}" height="${height}"` : "") +
    ` ${a11y}>${titleEl}${inner}</svg>\n`
  );
}
