#!/usr/bin/env node
// Renders every Grass Pass brand asset from the SVG sources in scripts/brand/art.mjs (the banner logo, variant B,
// Kevin's pick: the printed pass logo and brand/*.svg) and scripts/brand/v3.mjs (the v3 sprout ticket: favicon,
// app icons, share image, DEV cover).
//   node scripts/render-brand.mjs          -> writes brand/*.svg and public/* (SVG, PNG, ICO)
// Text is outlined with opentype.js (M PLUS Rounded 1c ExtraBold / Varela Round, OFL) and PNGs are rasterised with
// @resvg/resvg-js, so no output depends on fonts installed on the machine. All three are dev-only.
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import {
  ART,
  ICON_VIEW,
  LOGO_VIEW,
  MARK_VIEW,
  SCENE_STANDALONE_VIEW,
  SCENE_VIEW,
  SMALL_VIEW,
  WORDMARK_VIEW,
  explorerScene,
  logoHorizontal,
  logoText,
  svgDoc,
  ticketMark,
  viewBox,
} from "./brand/art.mjs";
import { f, loadBrandFonts, taglinePath, wordmarkPath } from "./brand/fonts.mjs";
import { buildV3Rasters } from "./brand/v3.mjs";
import { GRASS_STRIP_FILES, grassStripSvg } from "../src/components/art/grass.ts";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAME = "Grass Pass";
const TAGLINE = "your ticket to get outside";
const FULL = `${NAME}: ${TAGLINE}`;

/** Outlined wordmark + tagline in banner px, on the letter boxes measured in Kevin's banner. */
export function layoutLogoText(fonts = loadBrandFonts()) {
  return { wordmark: wordmarkPath(fonts.word), tagline: taglinePath(fonts.tag) };
}

function place(inner, x, y, scale) {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(scale)})">${inner}</g>`;
}

/**
 * Banner-style composition on cream: logo left (logoScale px per banner px, its top-left at logoX/logoY),
 * explorer scene anchored to the bottom-right corner (sceneScale), like Kevin's banner.
 */
function bannerSvg(text, W, H, { logoScale, logoX, logoY, sceneScale, hillX }) {
  const sx = W - (SCENE_VIEW.x + SCENE_VIEW.width) * sceneScale;
  const sy = H - (SCENE_VIEW.y + SCENE_VIEW.height) * sceneScale;
  return svgDoc({
    viewBox: `0 0 ${W} ${H}`,
    width: W,
    height: H,
    title: FULL,
    inner:
      `<rect width="${W}" height="${H}" fill="${ART.paper}"/>` +
      place(logoHorizontal(text, { idPrefix: `b${W}` }), logoX - LOGO_VIEW.x * logoScale, logoY - LOGO_VIEW.y * logoScale, logoScale) +
      place(explorerScene({ hillX }), sx, sy, sceneScale),
  });
}

/** Square app icon on cream. Small sizes (16-48 px) use the simple mark on a rounded tile. */
function appIconSvg(size, { simple = false } = {}) {
  const v = simple ? SMALL_VIEW : ICON_VIEW;
  const bg = simple
    ? `<rect x="${f(v.x)}" y="${f(v.y)}" width="${f(v.width)}" height="${f(v.height)}" rx="${f(v.width * 0.2)}" fill="${ART.paper}"/>`
    : `<rect x="${f(v.x)}" y="${f(v.y)}" width="${f(v.width)}" height="${f(v.height)}" fill="${ART.paper}"/>`;
  return svgDoc({
    viewBox: viewBox(v),
    width: size,
    height: size,
    title: NAME,
    inner: bg + ticketMark({ simple, idPrefix: `i${size}` }),
  });
}

/** Builds every SVG output. Pure (no file writes) so tests can check committed files are up to date. */
export function buildSvgs(fonts = loadBrandFonts()) {
  const text = layoutLogoText(fonts);
  const markDoc = (variant, simple = false) =>
    svgDoc({ viewBox: viewBox(simple ? SMALL_VIEW : MARK_VIEW), title: NAME, inner: ticketMark({ variant, simple }) });
  const logoDoc = (variant) => svgDoc({ viewBox: viewBox(LOGO_VIEW), title: FULL, inner: logoHorizontal(text, { variant }) });
  const V = SCENE_STANDALONE_VIEW;
  const scene = explorerScene({ hillX: 262, standalone: true });
  const sceneDoc = svgDoc({ viewBox: viewBox(V), decorative: true, inner: scene });
  // Dark mode: the kid's dark green shorts and the bush vanish on the dark page, so the scene sits on a cream
  // picture card (Kevin's paper colour), clipped to rounded corners. The art itself is unchanged.
  const card = `x="${f(V.x)}" y="${f(V.y)}" width="${f(V.width)}" height="${f(V.height)}" rx="10"`;
  const sceneDarkDoc = svgDoc({
    viewBox: viewBox(V),
    decorative: true,
    inner:
      `<defs><clipPath id="scene-card"><rect ${card}/></clipPath></defs>` +
      `<g clip-path="url(#scene-card)"><rect ${card} fill="${ART.paper}"/>` +
      `${explorerScene({ hillX: 236, standalone: true, hill: "edge" })}</g>`,
  });
  const wordmarkDoc = svgDoc({ viewBox: viewBox(WORDMARK_VIEW), title: FULL, inner: logoText(text) });

  // DEV cover: the banner's layout at 1000x420 (logo 2.06x, scene 2.5x with a wider hill).
  const cover = bannerSvg(text, 1000, 420, { logoScale: 2.06, logoX: 40, logoY: 104, sceneScale: 2.5, hillX: 236 });
  // Share card: same layout at 1200x630.
  const og = bannerSvg(text, 1200, 630, { logoScale: 2.4, logoX: 48, logoY: 151, sceneScale: 3.6, hillX: 220 });

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
      "brand/explorer-scene-dark.svg": sceneDarkDoc,
      "brand/ticket-mark.svg": markDoc("color"),
      // Header/footer lawn strip (option C), one static file per theme, picked by --grass-strip in tokens.css.
      [GRASS_STRIP_FILES.light]: grassStripSvg("light"),
      [GRASS_STRIP_FILES.dark]: grassStripSvg("dark"),
    },
    // v3 (Kevin's v0 design, 2026-10-06): the favicon, app icons, share image and DEV cover use the v3 sprout
    // ticket (scripts/brand/v3.mjs). The banner-based versions stay available as `bannerRaster` (not written).
    ...buildV3Rasters(),
    bannerRaster: {
      "icon-32.png": { svg: appIconSvg(32, { simple: true }), size: 32 },
      "apple-touch-icon.png": { svg: appIconSvg(180), size: 180 },
      "icon-192.png": { svg: appIconSvg(192), size: 192 },
      "icon-512.png": { svg: appIconSvg(512), size: 512 },
      "og-1200x630.png": { svg: og, size: 1200 },
      "dev-cover-1000x420.png": { svg: cover, size: 1000 },
    },
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
