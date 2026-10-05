#!/usr/bin/env node
// Renders every Grass Pass brand asset from the SVG sources in scripts/brand/art.mjs.
//   node scripts/render-brand.mjs          -> writes brand/*.svg and public/* (SVG, PNG, ICO)
// Text is outlined with opentype.js (Fredoka 700 / Nunito 700, OFL) and PNGs are rasterised with
// @resvg/resvg-js, so no output depends on fonts installed on the machine. Both are dev-only.
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import {
  LOGO_TEXT,
  MARK,
  SCENE_BOX,
  TOKENS,
  explorerScene,
  logoHorizontal,
  svgDoc,
  ticketMark,
} from "./brand/art.mjs";
import { capHeightRatio, loadBrandFonts, textPath, textWidth, xHeightRatio } from "./brand/fonts.mjs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAME = "Grass Pass";
const TAGLINE = "your ticket to get outside";

/** Outlined wordmark + tagline in mark units, placed right of the ticket like the banner. */
export function layoutLogoText(fonts = loadBrandFonts()) {
  const size = LOGO_TEXT.capHeight / capHeightRatio(fonts.fredoka);
  const baseline = LOGO_TEXT.capTop + LOGO_TEXT.capHeight;
  const probe = textPath(fonts.fredoka, "GRASS PASS", 0, baseline, size);
  const word = textPath(fonts.fredoka, "GRASS PASS", LOGO_TEXT.x - probe.x1, baseline, size);
  const targetWidth = word.width * LOGO_TEXT.taglineToWordmarkWidth;
  // Size the tagline by the banner's x-height, then track it out to the banner's width
  // (the banner's tagline face is a little wider than Nunito).
  const tagSize = LOGO_TEXT.taglineXHeight / xHeightRatio(fonts.nunito);
  const spacing = (targetWidth - textWidth(fonts.nunito, TAGLINE, tagSize)) / (TAGLINE.length - 1) / tagSize;
  const tagProbe = textPath(fonts.nunito, TAGLINE, 0, LOGO_TEXT.taglineBaseline, tagSize, spacing);
  const tag = textPath(fonts.nunito, TAGLINE, LOGO_TEXT.x - tagProbe.x1, LOGO_TEXT.taglineBaseline, tagSize, spacing);
  return {
    wordmark: word.d,
    tagline: tag.d,
    width: Math.ceil(Math.max(word.x2, tag.x2) + 4),
    wordmarkSize: size,
    taglineSize: tagSize,
    taglineSpacing: spacing,
  };
}

function place(inner, x, y, scale) {
  return `<g transform="translate(${x} ${y}) scale(${scale})">${inner}</g>`;
}

// Banner geometry (px in the 484x162 reference): ticket top-left at (22, 62), 76 px wide; the scene
// canvas from scripts/brand/art.mjs covers the banner's right side from x = 280 at 4 canvas units per px.
const BANNER = { ticketX: 22, ticketY: 62, ticketW: 76, logoCenterY: 74, sceneX: 280, sceneUnitsPerPx: 4, height: 162 };

/**
 * Banner-style composition: logo + tagline left, explorer scene right, cream paper.
 * logoK / sceneK = output px per banner px for the logo block and the scene; the scene sits on the bottom edge.
 */
function bannerSvg(text, W, H, { logoK, sceneK, logoCenterY }) {
  const logo = logoHorizontal(text, { idPrefix: `b${W}` });
  const unitsPerPx = 112 / BANNER.ticketW; // ticket body is 112 mark units wide
  const ls = logoK / unitsPerPx;
  const logoX = BANNER.ticketX * logoK - 4 * ls;
  const logoY = logoCenterY - (BANNER.logoCenterY - BANNER.ticketY) * logoK - 28 * ls;
  const cs = sceneK / BANNER.sceneUnitsPerPx;
  const sceneX = W - (484 - BANNER.sceneX) * sceneK;
  const sceneY = H - BANNER.height * sceneK;
  return svgDoc({
    viewBox: `0 0 ${W} ${H}`,
    width: W,
    height: H,
    title: `${NAME}: ${TAGLINE}`,
    inner:
      `<rect width="${W}" height="${H}" fill="${TOKENS.paper}"/>` +
      `<svg x="0" y="0" width="${W}" height="${H}" overflow="hidden">` +
      place(explorerScene(), sceneX, sceneY, cs) +
      `</svg>` +
      place(logo.inner, logoX, logoY, ls),
  });
}

/** Square app icon: the full mark centred on cream. */
function appIconSvg(size, { simple = false, rounded = false } = {}) {
  const pad = simple ? 0.04 : 0.12;
  const s = (size * (1 - 2 * pad)) / MARK.width;
  const y = (size - MARK.height * s) / 2;
  const bg = rounded
    ? `<rect width="${size}" height="${size}" rx="${size * 0.2}" fill="${TOKENS.paper}"/>`
    : `<rect width="${size}" height="${size}" fill="${TOKENS.paper}"/>`;
  return svgDoc({
    viewBox: `0 0 ${size} ${size}`,
    width: size,
    height: size,
    title: NAME,
    inner: bg + place(ticketMark({ simple, idPrefix: `i${size}` }), size * pad, y, s),
  });
}

/** Builds every SVG output. Pure (no file writes) so tests can check committed files are up to date. */
export function buildSvgs(fonts = loadBrandFonts()) {
  const text = layoutLogoText(fonts);
  const markDoc = (variant, simple = false) =>
    svgDoc({
      viewBox: `0 0 ${MARK.width} ${MARK.height}`,
      title: NAME,
      inner: ticketMark({ variant, simple }),
    });
  const logoDoc = (variant, title = `${NAME}: ${TAGLINE}`) => {
    const logo = logoHorizontal(text, { variant });
    return svgDoc({ viewBox: `0 0 ${logo.width} ${logo.height}`, title, inner: logo.inner });
  };
  const sceneDoc = svgDoc({
    viewBox: `${SCENE_BOX.x} ${SCENE_BOX.y} ${SCENE_BOX.width} ${SCENE_BOX.height}`,
    decorative: true,
    inner: explorerScene(),
  });
  const wordmarkDoc = svgDoc({
    viewBox: `${LOGO_TEXT.x - 2} 0 ${text.width - LOGO_TEXT.x + 2} ${MARK.height}`,
    title: `${NAME}: ${TAGLINE}`,
    inner: `<path fill="${TOKENS.forest}" d="${text.wordmark}"/><path fill="${TOKENS.ink}" d="${text.tagline}"/>`,
  });

  // DEV cover = Kevin's banner scaled to 1000 px wide; the extra height becomes sky above the scene.
  const cover = bannerSvg(text, 1000, 420, { logoK: 1000 / 484, sceneK: 1000 / 484, logoCenterY: 205 });
  const og = bannerSvg(text, 1200, 630, { logoK: 1200 / 484, sceneK: 3.2, logoCenterY: 300 });

  return {
    brand: {
      "ticket-mark.svg": markDoc("color"),
      "ticket-mark-1colour.svg": markDoc("mono"),
      "ticket-mark-reversed.svg": markDoc("reversed"),
      "ticket-mark-simple.svg": markDoc("color", true),
      "wordmark.svg": wordmarkDoc,
      "logo-horizontal.svg": logoDoc("color"),
      "logo-horizontal-1colour.svg": logoDoc("mono"),
      "logo-horizontal-reversed.svg": logoDoc("reversed"),
      "explorer-scene.svg": sceneDoc,
    },
    public: {
      "logo-header.svg": logoDoc("color"),
      "logo-header-dark.svg": logoDoc("reversed"),
      "logo-print-1c.svg": logoDoc("mono"),
      "brand/explorer-scene.svg": sceneDoc,
      "brand/ticket-mark.svg": markDoc("color"),
    },
    raster: {
      "icon-32.png": { svg: appIconSvg(32, { simple: true, rounded: true }), size: 32 },
      "apple-touch-icon.png": { svg: appIconSvg(180), size: 180 },
      "icon-192.png": { svg: appIconSvg(192), size: 192 },
      "icon-512.png": { svg: appIconSvg(512), size: 512 },
      "og-1200x630.png": { svg: og, size: 1200 },
      "dev-cover-1000x420.png": { svg: cover, size: 1000 },
    },
    favicon: [16, 32, 48].map((size) => ({ svg: appIconSvg(size, { simple: true, rounded: true }), size })),
  };
}

export function renderPng(svg, width) {
  return new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } })
    .render()
    .asPng();
}

/** ICO container holding PNG images (supported by every current browser). */
export function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

function write(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
  console.log(`wrote ${path.relative(APP_DIR, file).replaceAll("\\", "/")}`);
}

export function main() {
  const out = buildSvgs();
  for (const [name, svg] of Object.entries(out.brand)) write(path.join(APP_DIR, "brand", name), svg);
  for (const [name, svg] of Object.entries(out.public)) write(path.join(APP_DIR, "public", name), svg);
  for (const [name, { svg, size }] of Object.entries(out.raster)) {
    write(path.join(APP_DIR, "public", name), renderPng(svg, size));
  }
  const ico = buildIco(out.favicon.map(({ svg, size }) => ({ size, data: renderPng(svg, size) })));
  write(path.join(APP_DIR, "public", "favicon.ico"), ico);
}

function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  const norm = (p) => {
    const real = realpathSync(p);
    return process.platform === "win32" ? real.toLowerCase() : real;
  };
  return norm(fileURLToPath(metaUrl)) === norm(path.resolve(process.argv[1]));
}

if (isMain(import.meta.url)) main();
