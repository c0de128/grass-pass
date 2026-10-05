// Turns brand text into outlined SVG paths so logos, favicons and print never depend on installed fonts.
// Fonts: Fredoka 700 and Nunito 700 (SIL Open Font License 1.1) from the @fontsource packages (dev-only).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import opentype from "opentype.js";

const require = createRequire(import.meta.url);

function loadFont(spec) {
  const buf = readFileSync(require.resolve(spec));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

let cache;
export function loadBrandFonts() {
  cache ??= {
    fredoka: loadFont("@fontsource/fredoka/files/fredoka-latin-700-normal.woff"),
    nunito: loadFont("@fontsource/nunito/files/nunito-latin-700-normal.woff"),
  };
  return cache;
}

/**
 * Outline `text` with its left edge at x and its baseline at y.
 * @returns {{ d: string, width: number, x1: number, x2: number, y1: number, y2: number }}
 */
export function textPath(font, text, x, y, size, letterSpacing = 0) {
  const path = layout(font, text, x, y, size, letterSpacing);
  const box = path.getBoundingBox();
  return { d: path.toPathData(2), width: box.x2 - box.x1, x1: box.x1, x2: box.x2, y1: box.y1, y2: box.y2 };
}

/** Ink width of `text` at `size` (for layout before outlining). */
export function textWidth(font, text, size, letterSpacing = 0) {
  const box = layout(font, text, 0, 0, size, letterSpacing).getBoundingBox();
  return box.x2 - box.x1;
}

// Simple left-to-right layout with pair kerning. opentype.js 2.0's shaper crashes on Nunito's
// `ccmp` lookups (type 6 format 2), and our brand text needs no ligatures, so we place glyphs ourselves.
function layout(font, text, x, y, size, letterSpacing) {
  const scale = size / font.unitsPerEm;
  const out = new opentype.Path();
  let pen = x;
  let prev = null;
  for (const ch of text) {
    const glyph = font.charToGlyph(ch);
    if (prev) pen += font.getKerningValue(prev, glyph) * scale;
    out.extend(glyph.getPath(pen, y, size));
    pen += glyph.advanceWidth * scale + letterSpacing * size;
    prev = glyph;
  }
  return out;
}

/** Cap height of the font as a fraction of the font size. */
export function capHeightRatio(font) {
  return font.tables.os2.sCapHeight / font.unitsPerEm;
}

/** x-height of the font as a fraction of the font size. */
export function xHeightRatio(font) {
  return font.tables.os2.sxHeight / font.unitsPerEm;
}
