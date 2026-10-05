// Turns brand text into outlined SVG paths so logos, favicons and print never depend on installed fonts.
// Fonts (SIL Open Font License 1.1, dev-only @fontsource copies; outlines are identical to the Google Fonts TTFs):
//   wordmark "GRASS PASS"          -> M PLUS Rounded 1c ExtraBold (800)
//   tagline "your ticket to get outside" -> Varela Round (400, thickened with a 0.42 px same-colour stroke in art.mjs)
// Letters are placed one by one on the boxes measured in Kevin's banner (brand/work/NOTES.md), so no shaping is needed
// (opentype.js 2.0's shaper also crashes on some fonts' `ccmp` lookups).
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
    word: loadFont("@fontsource/m-plus-rounded-1c/files/m-plus-rounded-1c-latin-800-normal.woff"),
    tag: loadFont("@fontsource/varela-round/files/varela-round-latin-400-normal.woff"),
  };
  return cache;
}

/** Number format shared with art.mjs: 2 decimals, trailing zeros dropped. */
export function f(v) {
  let s = v.toFixed(2);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

const glyph = (font, ch) => font.charToGlyph(ch);

/** Glyph ink box in font units (y up): [xMin, yMin, xMax, yMax]. */
export function glyphBounds(font, ch) {
  const b = glyph(font, ch).getBoundingBox();
  return [b.x1, b.y1, b.x2, b.y2];
}

/** Advance width in font units. */
export function glyphAdvance(font, ch) {
  return glyph(font, ch).advanceWidth;
}

/** Glyph outline with its origin at (x, y = baseline), s px per font unit (sx for the horizontal axis). */
export function glyphPath(font, ch, x, y, s, sx = s) {
  const X = (v) => f(x + v * sx);
  const Y = (v) => f(y - v * s);
  let d = "";
  for (const c of glyph(font, ch).path.commands) {
    if (c.type === "M") d += `M${X(c.x)},${Y(c.y)}`;
    else if (c.type === "L") d += `L${X(c.x)},${Y(c.y)}`;
    else if (c.type === "Q") d += `Q${X(c.x1)},${Y(c.y1)} ${X(c.x)},${Y(c.y)}`;
    else if (c.type === "C") d += `C${X(c.x1)},${Y(c.y1)} ${X(c.x2)},${Y(c.y2)} ${X(c.x)},${Y(c.y)}`;
    else if (c.type === "Z") d += "Z";
  }
  return d;
}

// Wordmark letter boxes (ink, banner px) measured from Kevin's banner; P and A touch, so they are placed as a pair.
const WORD_BOXES = [
  ["G", 105, 124], ["R", 127, 144], ["A", 146, 168], ["S", 169, 185], ["S", 187, 203],
  ["P", 213, null], ["A", null, 251], ["S", 253, 268], ["S", 270, 286],
];
export const WORD = { top: 62.3, base: 84.2 };
const clampK = (k) => Math.min(1.14, Math.max(0.9, k));

/** "GRASS PASS" outlined on the banner's letter boxes (cap height = R height, width fitted per letter within ±10-14%). */
export function wordmarkPath(font) {
  const rb = glyphBounds(font, "R");
  const s = (WORD.base - WORD.top) / (rb[3] - rb[1]);
  const ds = [];
  for (let i = 0; i < WORD_BOXES.length; i++) {
    const [ch, l, r] = WORD_BOXES[i];
    if (ch === "P" && r === null) {
      const r2 = WORD_BOXES[i + 1][2];
      const pb = glyphBounds(font, "P");
      const ab = glyphBounds(font, "A");
      const k = clampK((r2 - l - 2) / ((pb[2] - pb[0] + ab[2] - ab[0]) * s));
      const pw = (pb[2] - pb[0]) * s * k;
      const aw = (ab[2] - ab[0]) * s * k;
      const gap = r2 - l - pw - aw;
      ds.push(glyphPath(font, "P", l - pb[0] * s * k, WORD.base, s, s * k));
      ds.push(glyphPath(font, "A", l + pw + gap - ab[0] * s * k, WORD.base, s, s * k));
      i++;
      continue;
    }
    const b = glyphBounds(font, ch);
    const sx = s * clampK((r - l) / ((b[2] - b[0]) * s));
    ds.push(glyphPath(font, ch, (l + r) / 2 - ((b[0] + b[2]) / 2) * sx, WORD.base, s, sx));
  }
  return ds.join(" ");
}

export const TAGLINE = "your ticket to get outside";
export const TAG = { x0: 111, x1: 278, asc: 91, base: 100.8 };

/** Tagline outlined at the banner's ascender height, tracked out evenly to the banner's width. */
export function taglinePath(font) {
  const s = (TAG.base - TAG.asc) / glyphBounds(font, "k")[3];
  const adv = [...TAGLINE].map((c) => glyphAdvance(font, c) * s);
  const first = glyphBounds(font, TAGLINE[0])[0] * s;
  const last = glyphBounds(font, TAGLINE.at(-1));
  const natural = adv.slice(0, -1).reduce((a, b) => a + b, 0) + last[2] * s - first;
  const track = (TAG.x1 - TAG.x0 - natural) / (TAGLINE.length - 1);
  let x = TAG.x0 - first;
  const ds = [];
  [...TAGLINE].forEach((c, i) => {
    if (c !== " ") ds.push(glyphPath(font, c, x, TAG.base, s));
    x += adv[i] + track;
  });
  return ds.join(" ");
}
