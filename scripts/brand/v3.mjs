// v3 brand art (Kevin's v0 design, BRAND.md "v3 design"): the small green admission ticket with notched sides
// and the Lucide "sprout" icon (src/components/site/Logo.tsx), the "Grass Pass" wordmark in Bricolage Grotesque,
// the meadow paper background, pencil ink, grass green and sunflower. Used for the favicon, the app icons, the
// 1200x630 share image and the 1000x420 DEV cover. The printed pass keeps the 1-colour banner logo (art.mjs).
//
// Text is outlined with opentype.js from the @fontsource copies (Bricolage Grotesque 800, DM Sans 500/700; SIL
// OFL 1.1, dev only), so no output depends on fonts installed on the machine.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import opentype from "opentype.js";
import { f } from "./fonts.mjs";

const require = createRequire(import.meta.url);

/** v3 colours (src/styles/tokens.css, light theme). */
export const V3 = {
  background: "#EEF3E2",
  ink: "#10291A",
  primary: "#137838",
  onPrimary: "#FFFFFF",
  sun: "#FFC72C",
  muted: "#E2EAD2",
  mutedForeground: "#4A5D4F",
  card: "#FFFFFF",
  line: "#78867C",
};

/** Lucide "sprout" (ISC), 24x24, the icon inside the v3 logo ticket (lucide-react 1.52.0). */
export const SPROUT_PATHS = [
  "M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3",
  "M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4",
  "M5 21h14",
];

/**
 * The v3 ticket in Logo.tsx units: h-9 w-12 (48x36 px), rounded-md (0.7rem = 11.2 px), size-3 notches (r 6)
 * centred on the left and right edges, a size-5 sprout (20 px) in the middle at strokeWidth 2.5.
 */
export const TICKET = { w: 48, h: 36, r: 11.2, notch: 6, icon: 20, stroke: 2.5 };

let fontCache;
function loadFont(spec) {
  const buf = readFileSync(require.resolve(spec));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
export function loadV3Fonts() {
  fontCache ??= {
    heading: loadFont("@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff"),
    body: loadFont("@fontsource/dm-sans/files/dm-sans-latin-500-normal.woff"),
    bodyBold: loadFont("@fontsource/dm-sans/files/dm-sans-latin-700-normal.woff"),
  };
  return fontCache;
}

/**
 * One line of text as an outlined path: letters placed one by one (advance + kerning + tracking in em),
 * baseline at y. Returns the path data and the advance width.
 */
export function textPath(font, text, x, y, size, tracking = 0) {
  const s = size / font.unitsPerEm;
  let pen = x;
  let d = "";
  let prev = null;
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    if (prev) pen += font.getKerningValue(prev, g) * s;
    const p = g.getPath(pen, y, size);
    for (const c of p.commands) {
      if (c.type === "M") d += `M${f(c.x)},${f(c.y)}`;
      else if (c.type === "L") d += `L${f(c.x)},${f(c.y)}`;
      else if (c.type === "Q") d += `Q${f(c.x1)},${f(c.y1)} ${f(c.x)},${f(c.y)}`;
      else if (c.type === "C") d += `C${f(c.x1)},${f(c.y1)} ${f(c.x2)},${f(c.y2)} ${f(c.x)},${f(c.y)}`;
      else if (c.type === "Z") d += "Z";
    }
    pen += g.advanceWidth * s + tracking * size;
    prev = g;
  }
  return { d, width: pen - x - tracking * size };
}

/** Width of a line of text (same layout as textPath). */
export const textWidth = (font, text, size, tracking = 0) => textPath(font, text, 0, 0, size, tracking).width;

/**
 * The v3 ticket mark with its top-left at (x, y), `scale` px per Logo.tsx px. The notches are cut out with a
 * mask (they show whatever is behind). `variant` "green" = the header logo, "sun" = the footer logo.
 * `boldIcon` thickens the sprout for 16-32 px favicons.
 */
export function ticketMark({ x = 0, y = 0, scale = 1, variant = "green", id = "t", boldIcon = false } = {}) {
  const T = TICKET;
  const fill = variant === "sun" ? V3.sun : V3.primary;
  const stroke = variant === "sun" ? V3.ink : V3.onPrimary;
  // 16-32 px favicons: a bigger, bolder sprout so it still reads as a plant.
  const icon = boldIcon ? 26 : T.icon;
  const k = icon / 24;
  const sw = boldIcon ? 3 : T.stroke;
  const ix = (T.w - icon) / 2;
  const iy = (T.h - icon) / 2;
  return (
    `<g transform="translate(${f(x)} ${f(y)}) scale(${f(scale)})">` +
    `<mask id="${id}-notch" maskUnits="userSpaceOnUse" x="-1" y="-1" width="${T.w + 2}" height="${T.h + 2}">` +
    `<rect x="-1" y="-1" width="${T.w + 2}" height="${T.h + 2}" fill="#fff"/>` +
    `<circle cx="0" cy="${f(T.h / 2)}" r="${T.notch}" fill="#000"/><circle cx="${T.w}" cy="${f(T.h / 2)}" r="${T.notch}" fill="#000"/></mask>` +
    `<rect width="${T.w}" height="${T.h}" rx="${f(T.r)}" fill="${fill}" mask="url(#${id}-notch)"/>` +
    `<g transform="translate(${f(ix)} ${f(iy)}) scale(${f(k)})" fill="none" stroke="${stroke}" stroke-width="${f(sw)}" stroke-linecap="round" stroke-linejoin="round">` +
    SPROUT_PATHS.map((d) => `<path d="${d}"/>`).join("") +
    `</g></g>`
  );
}

const svgOpen = (w, h, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="t"><title id="t">${title}</title>`;

/**
 * Square app icon. `tile` = "none" (transparent, the ticket as large as fits: favicons), "square" (meadow paper
 * edge to edge: Android / PWA icons, iOS home screen).
 */
export function appIconSvg(size, { tile = "square" } = {}) {
  const T = TICKET;
  const small = tile === "none";
  // Favicons: the ticket fills the width (notch cut-outs stay visible). Tiles: about 68% of the side (inside
  // the maskable safe zone, a circle of 80%).
  const scale = small ? size / T.w : (size * 0.68) / T.w;
  const w = T.w * scale;
  const h = T.h * scale;
  const bg = small ? "" : `<rect width="${size}" height="${size}" fill="${V3.background}"/>`;
  return (
    svgOpen(size, size, "Grass Pass") +
    bg +
    ticketMark({ x: (size - w) / 2, y: (size - h) / 2, scale, id: `i${size}`, boldIcon: size <= 32 }) +
    `</svg>\n`
  );
}

/** The v3 logo (ticket + "Grass Pass" wordmark) at `scale`, top-left at (x, y). Returns the markup and its width. */
export function logoV3(fonts, { x, y, scale, id }) {
  const T = TICKET;
  const size = 20 * scale; // text-xl
  const gap = 10 * scale; // gap-2.5
  const word = textPath(fonts.heading, "Grass Pass", x + T.w * scale + gap, y + T.h * scale / 2 + size * 0.36, size, -0.025);
  return {
    svg: ticketMark({ x, y, scale, id }) + `<path fill="${V3.ink}" d="${word.d}"/>`,
    width: T.w * scale + gap + word.width,
  };
}

/** The v0 hero's sunflower swoosh under "outside." (HomeHero.tsx: viewBox 0 0 300 20, stroke 7). */
function swoosh(x, y, w, h) {
  return (
    `<g transform="translate(${f(x)} ${f(y)}) scale(${f(w / 300)} ${f(h / 20)})">` +
    `<path d="M2 14 C 80 4, 200 4, 298 12" fill="none" stroke="${V3.sun}" stroke-width="7" stroke-linecap="round"/></g>`
  );
}

/** The meadow paper with v0's dotted grain (radial dots every 18 px, ink at 10%, the hero at 60%). */
function meadow(W, H) {
  return (
    `<defs><pattern id="grain" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="9" cy="9" r="1" fill="${V3.ink}" fill-opacity="0.06"/></pattern></defs>` +
    `<rect width="${W}" height="${H}" fill="${V3.background}"/><rect width="${W}" height="${H}" fill="url(#grain)"/>`
  );
}

/**
 * A tilted pass card in the v0 style: the real section names of a pass with empty tick boxes (no clue text,
 * so nothing on it pretends to be data), the perforated tear line and the grown-up's stub label.
 * (cx, cy) = centre, w = width, `deg` = tilt.
 */
function passCard(fonts, { cx, cy, w, deg }) {
  const h = w * 1.18;
  const x0 = -w / 2;
  const y0 = -h / 2;
  const r = w * 0.075;
  const pad = w * 0.08;
  const band = h * 0.17;
  const label = w * 0.062;
  let inner = "";
  // Step shadow (like the v0 buttons), then the card.
  inner += `<rect x="${f(x0 + w * 0.025)}" y="${f(y0 + w * 0.035)}" width="${f(w)}" height="${f(h)}" rx="${f(r)}" fill="${V3.ink}" fill-opacity="0.16"/>`;
  inner += `<rect x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(h)}" rx="${f(r)}" fill="${V3.card}"/>`;
  // Ink header band with the sun ticket and "Grass Pass".
  inner += `<path d="M${f(x0)},${f(y0 + r)} A${f(r)},${f(r)} 0 0 1 ${f(x0 + r)},${f(y0)} H${f(x0 + w - r)} A${f(r)},${f(r)} 0 0 1 ${f(x0 + w)},${f(y0 + r)} V${f(y0 + band)} H${f(x0)} Z" fill="${V3.ink}"/>`;
  const ts = (band * 0.5) / TICKET.h;
  inner += ticketMark({ x: x0 + pad, y: y0 + band * 0.25, scale: ts, variant: "sun", id: "card" });
  const head = textPath(fonts.heading, "Grass Pass", x0 + pad + TICKET.w * ts + pad * 0.5, y0 + band * 0.5 + label * 0.62, label * 1.25, -0.02);
  inner += `<path fill="${V3.background}" d="${head.d}"/>`;
  // Sections: the real section names, an empty tick box and a muted bar each.
  const rows = ["Park Finds", "Wild Finds", "Lucky Finds", "Find This Spot"];
  const rowH = (h * 0.56) / rows.length;
  rows.forEach((name, i) => {
    const ry = y0 + band + pad * 0.9 + i * rowH;
    const box = label * 1.15;
    inner += `<rect x="${f(x0 + pad)}" y="${f(ry)}" width="${f(box)}" height="${f(box)}" rx="${f(box * 0.22)}" fill="none" stroke="${V3.ink}" stroke-width="${f(label * 0.16)}"/>`;
    const t = textPath(fonts.bodyBold, name, x0 + pad + box * 1.5, ry + box * 0.82, label, 0);
    inner += `<path fill="${V3.ink}" d="${t.d}"/>`;
    inner += `<rect x="${f(x0 + pad + box * 1.5)}" y="${f(ry + box * 1.35)}" width="${f(w * (0.62 - i * 0.07))}" height="${f(label * 0.42)}" rx="${f(label * 0.21)}" fill="${V3.muted}"/>`;
  });
  // Perforation (tear line) with notches, then the stub.
  const py = y0 + h * 0.8;
  const dots = Math.floor((w - pad * 2) / (label * 0.55));
  for (let i = 0; i <= dots; i++) {
    inner += `<circle cx="${f(x0 + pad + (i * (w - pad * 2)) / dots)}" cy="${f(py)}" r="${f(label * 0.09)}" fill="${V3.ink}" fill-opacity="0.45"/>`;
  }
  inner += `<circle cx="${f(x0)}" cy="${f(py)}" r="${f(label * 0.55)}" fill="${V3.background}"/><circle cx="${f(x0 + w)}" cy="${f(py)}" r="${f(label * 0.55)}" fill="${V3.background}"/>`;
  inner += `<path d="M${f(x0)},${f(py)} H${f(x0 + w)} V${f(y0 + h - r)} A${f(r)},${f(r)} 0 0 1 ${f(x0 + w - r)},${f(y0 + h)} H${f(x0 + r)} A${f(r)},${f(r)} 0 0 1 ${f(x0)},${f(y0 + h - r)} Z" fill="${V3.muted}" fill-opacity="0.6"/>`;
  const stub = textPath(fonts.body, "Grown-up's stub: answers and sources", x0 + pad, py + (h * 0.2) / 2 + label * 0.3, label * 0.76, 0);
  inner += `<path fill="${V3.mutedForeground}" d="${stub.d}"/>`;
  return `<g transform="translate(${f(cx)} ${f(cy)}) rotate(${f(deg)})">${inner}</g>`;
}

/** "Fits on 1 page" sticker (the v0 hero's sunflower pill), centre (cx, cy). */
function sticker(fonts, { cx, cy, size, deg }) {
  const t = textPath(fonts.heading, "Fits on 1 page", 0, 0, size, -0.01);
  const padX = size * 0.8;
  const w = t.width + padX * 2;
  const h = size * 2.1;
  const text = textPath(fonts.heading, "Fits on 1 page", -t.width / 2, size * 0.36, size, -0.01);
  return (
    `<g transform="translate(${f(cx)} ${f(cy)}) rotate(${f(deg)})">` +
    `<rect x="${f(-w / 2 + size * 0.12)}" y="${f(-h / 2 + size * 0.18)}" width="${f(w)}" height="${f(h)}" rx="${f(h / 2)}" fill="${V3.ink}" fill-opacity="0.16"/>` +
    `<rect x="${f(-w / 2)}" y="${f(-h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(h / 2)}" fill="${V3.sun}"/>` +
    `<path fill="${V3.ink}" d="${text.d}"/></g>`
  );
}

/**
 * Share image / DEV cover in the v3 look: meadow paper with the grain, the logo, the hero headline ("Your ticket
 * to get outside." with the sunflower swoosh), the real tagline, and a tilted pass card with the sticker.
 */
export function bannerSvgV3(fonts, W, H, o) {
  const title = "Grass Pass: your ticket to get outside. Pick a park, print a pass, put the phone away.";
  let inner = meadow(W, H);
  const logo = logoV3(fonts, { x: o.left, y: o.logoY, scale: o.logoScale, id: "logo" });
  inner += logo.svg;
  const hs = o.headSize;
  const line1 = textPath(fonts.heading, "Your ticket to get", o.left - hs * 0.04, o.headY, hs, -0.045);
  const line2 = textPath(fonts.heading, "outside.", o.left - hs * 0.04, o.headY + hs * 0.98, hs, -0.045);
  inner += `<path fill="${V3.ink}" d="${line1.d}"/>`;
  inner += swoosh(o.left, o.headY + hs * 1.1, line2.width, hs * 0.2);
  inner += `<path fill="${V3.primary}" d="${line2.d}"/>`;
  const sub = textPath(fonts.body, o.sub, o.left, o.subY, o.subSize, 0);
  inner += `<path fill="${V3.mutedForeground}" d="${sub.d}"/>`;
  inner += passCard(fonts, o.card);
  inner += sticker(fonts, o.sticker);
  return svgOpen(W, H, title) + inner + `</svg>\n`;
}

/** Every v3 raster source: { file: { svg, size } } (size = output width) plus the favicon sizes. */
export function buildV3Rasters(fonts = loadV3Fonts()) {
  const og = bannerSvgV3(fonts, 1200, 630, {
    left: 80,
    logoY: 70,
    logoScale: 1.9,
    headSize: 82,
    headY: 296,
    sub: "Pick a park. Print a pass. Phone away.",
    subY: 500,
    subSize: 34,
    card: { cx: 925, cy: 345, w: 330, deg: -6 },
    sticker: { cx: 1060, cy: 112, size: 24, deg: 6 },
  });
  const cover = bannerSvgV3(fonts, 1000, 420, {
    left: 60,
    logoY: 46,
    logoScale: 1.45,
    headSize: 70,
    headY: 196,
    sub: "Pick a park. Print a pass. Phone away.",
    subY: 352,
    subSize: 26,
    card: { cx: 790, cy: 222, w: 238, deg: -6 },
    sticker: { cx: 900, cy: 64, size: 18, deg: 6 },
  });
  return {
    raster: {
      "icon-32.png": { svg: appIconSvg(32, { tile: "none" }), size: 32 },
      "apple-touch-icon.png": { svg: appIconSvg(180), size: 180 },
      "icon-192.png": { svg: appIconSvg(192), size: 192 },
      "icon-512.png": { svg: appIconSvg(512), size: 512 },
      "og-1200x630.png": { svg: og, size: 1200 },
      "dev-cover-1000x420.png": { svg: cover, size: 1000 },
    },
    favicon: [16, 32, 48].map((size) => ({ svg: appIconSvg(size, { tile: "none" }), size })),
  };
}
