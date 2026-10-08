import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ART, ART_DARK, GRASS, TOKENS } from "../../scripts/brand/art.mjs";
import { GRASS_PALETTE, bladeOutline } from "../../src/components/art/grass";
import { buildSvgs, renderPng } from "../../scripts/render-brand.mjs";
import { SPROUT_PATHS, V3 } from "../../scripts/brand/v3.mjs";
import { Resvg } from "@resvg/resvg-js";

const APP = fileURLToPath(new URL("../..", import.meta.url));
const read = (p: string) => readFileSync(path.join(APP, p));

// ---- WCAG contrast helpers ----
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function cssTokens(): Record<string, string> {
  const css = read("src/styles/tokens.css").toString();
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] ??= m[2].toUpperCase();
  return out;
}

/** v3 files where text-sun sits on the dark band (or is the decorative underline under "outside."). */
// /about and /how-it-works (v3 redesign): sunflower numbers, eyebrows and icons only inside gp-band dark bands/cards
// (axe colour-contrast checks both themes in tests/e2e/about-v3.spec.ts).
const V3_SUN_ON_DARK = new Set([
  "src/components/home/TwoParks.tsx",
  "src/components/home/PassAnatomy.tsx",
  "src/components/home/HomeHero.tsx",
  "src/components/home/HowItWorks.tsx",
  "src/app/about/page.tsx",
  "src/app/how-it-works/page.tsx",
  // The /how-it-works path: the "AI" tag on a stop is sunflower on the dark band fill (axe: tests/e2e/how-it-works.spec.ts).
  "src/components/how/HowPath.tsx",
  // The pass wizard: the step trail (sunflower dots and current step) sits on the wizard header's dark band.
  "src/components/pass/WizardParts.tsx",
]);

describe("design tokens", () => {
  const css = cssTokens();

  it("tokens.css and the brand art use the same hex values (SPEC §8.1)", () => {
    const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    for (const [key, hex] of Object.entries(TOKENS as Record<string, string>)) {
      expect(css[kebab(key)], key).toBe(hex.toUpperCase());
    }
  });

  it("text and UI pairs meet WCAG AA", () => {
    const T = TOKENS as Record<string, string>;
    const pairs: Array<[string, string, number, string]> = [
      [T.ink, T.paper, 4.5, "body text on paper"],
      [T.forest, T.paper, 4.5, "headings on paper"],
      [T.forest, T.paperLight, 4.5, "headings on cards"],
      [T.paper, T.forest, 4.5, "primary button text"],
      [T.paper, css["forest-deep"], 4.5, "primary button hover"],
      [T.ink, T.mint, 4.5, "chip text"],
      [T.paper, T.ticket, 4.5, "dark mode body text"],
      [T.mint, T.ticket, 4.5, "dark mode muted text"],
      [T.paper, T.forest, 4.5, "dark mode text on cards"],
      [T.ink, T.sun, 4.5, "dark mode primary button"],
      [T.ink, T.sunflower, 4.5, "dark mode primary hover"],
      [T.forest, T.paper, 3, "borders and focus ring (light)"],
      [T.sun, T.ticket, 3, "focus ring (dark)"],
      [T.mint, T.forest, 3, "card border on dark surface"],
    ];
    for (const [fg, bg, min, what] of pairs) expect(contrast(fg, bg), what).toBeGreaterThanOrEqual(min);
  });

  it("the logo art palette (sampled from Kevin's banner) stays within a few steps of the UI tokens", () => {
    const A = ART as Record<string, string>;
    const T = TOKENS as Record<string, string>;
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const pairs: Array<[string, string]> = [
      ["paper", "paper"],
      ["ticket", "ticket"],
      ["word", "forest"],
      ["ink", "ink"],
      ["gMid", "lawn"],
      ["sun", "sun"],
    ];
    for (const [art, token] of pairs) {
      const diff = Math.max(...rgb(A[art]).map((v, i) => Math.abs(v - rgb(T[token])[i])));
      expect(diff, `${art} vs ${token}`).toBeLessThanOrEqual(16);
    }
  });

  it("logo lettering and ticket details are readable in light and dark mode", () => {
    const A = ART as Record<string, string>;
    const D = ART_DARK as Record<string, string>;
    const T = TOKENS as Record<string, string>;
    const pairs: Array<[string, string, number, string]> = [
      [A.word, T.paper, 4.5, "wordmark on paper"],
      [A.ink, T.paper, 4.5, "tagline on paper"],
      [D.word, T.ticket, 4.5, "wordmark on the dark page"],
      [D.ink, T.ticket, 4.5, "tagline on the dark page"],
      [D.ticket, T.ticket, 3, "cream ticket shape on the dark page"],
      [A.ticket, T.paper, 3, "ticket shape on paper"],
      [A.line, A.ticket, 3, "ticket stripes"],
      [A.sun, A.ticket, 3, "sun on the ticket"],
      [D.line, D.ticket, 3, "ticket stripes (dark)"],
    ];
    for (const [fg, bg, min, what] of pairs) expect(contrast(fg, bg), what).toBeGreaterThanOrEqual(min);
  });

  it("lawn, sage and sun are too light for text on cream, and no component uses them as text", () => {
    const T = TOKENS as Record<string, string>;
    expect(contrast(T.lawn, T.paper)).toBeLessThan(3);
    expect(contrast(T.sage, T.paper)).toBeLessThan(3);
    expect(contrast(T.sun, T.paper)).toBeLessThan(3);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|css)$/.test(name)) files.push(p);
      }
    };
    walk(path.join(APP, "src"));
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const rel = path.relative(APP, f).replaceAll("\\", "/");
      // v3: sunflower text only sits on the dark band (9.9:1), or is the decorative underline under "outside.".
      if (V3_SUN_ON_DARK.has(rel)) continue;
      const bad = src.match(/\b(?:text|border|outline)-(?:sage|sun)(?![\w-])/g) ?? [];
      expect(bad, rel).toEqual([]);
    }
  });
});

describe("brand assets", () => {
  const out = buildSvgs();

  it("committed SVGs are up to date with scripts/render-brand.mjs", () => {
    for (const [name, svg] of Object.entries(out.brand as Record<string, string>)) {
      expect(read(`brand/${name}`).toString(), `brand/${name}`).toBe(svg);
    }
    for (const [name, svg] of Object.entries(out.public as Record<string, string>)) {
      expect(read(`public/${name}`).toString(), `public/${name}`).toBe(svg);
    }
  });

  it("every SVG is labelled or hidden, and uses no gradients, fonts or external refs", () => {
    const all = { ...out.brand, ...out.public } as Record<string, string>;
    for (const [name, svg] of Object.entries(all)) {
      expect(svg, name).toMatch(/role="img" aria-labelledby="t"><title id="t">[^<]+<\/title>|aria-hidden="true"/);
      expect(svg, name).not.toMatch(/Gradient|<text|<image|href=|@import|font-family/i);
    }
  });

  it("the one-colour print logo is pure black (white only inside the cut-out mask)", () => {
    for (const name of ["logo-print-1c.svg"]) {
      const svg = (out.public as Record<string, string>)[name];
      const colours = new Set(svg.match(/#[0-9a-fA-F]{3,6}\b/g));
      expect([...colours].sort()).toEqual(["#000", "#fff"]);
      const outsideMask = svg.replace(/<mask[\s\S]*?<\/mask>/g, "");
      expect(outsideMask).not.toContain("#fff");
    }
  });

  it("brand text is outlined paths on the banner's letter boxes, with the tagline next to the name", () => {
    const logos = out.public as Record<string, string>;
    for (const name of ["logo-header.svg", "logo-header-dark.svg", "logo-print-1c.svg"]) {
      expect(logos[name], name).toContain("Grass Pass: your ticket to get outside");
    }
    const paths = [...logos["logo-header.svg"].matchAll(/<path [^>]*d="([^"]+)"/g)].map((m) => m[1]);
    // The last two paths are the wordmark and the tagline (outlined M PLUS Rounded 1c / Varela Round).
    const xs = (d: string) => [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[1]));
    const [word, tag] = paths.slice(-2).map(xs);
    // Ink spans measured in Kevin's banner: wordmark x 105..286, tagline x 111..278 (banner px).
    expect(Math.min(...word)).toBeCloseTo(105, 0);
    expect(Math.max(...word)).toBeCloseTo(286, 0);
    expect(Math.min(...tag)).toBeCloseTo(111, 0);
    expect(Math.max(...tag)).toBeCloseTo(278, 0);
  });

  it("logo grass is separate single lawn blades (no leaf fanning out of one point)", () => {
    const bases = (GRASS as Array<[number, number, number, number]>).map(([bx, by]) => [bx, by]);
    for (const [i, [x, y]] of bases.entries()) {
      const shared = bases.filter(([x2, y2], j) => j !== i && Math.hypot(x2 - x, y2 - y) < 1);
      // A cannabis-style leaf fans 5-9 pointed leaflets out of one point; Kevin's grass grows in tufts of at most 3.
      expect(shared.length, `blade ${i}`).toBeLessThanOrEqual(2);
    }
    for (const [bx, by, tx, ty] of GRASS as Array<[number, number, number, number]>) {
      expect(by - ty).toBeGreaterThan(0); // grows up
      expect(Math.abs(tx - bx)).toBeLessThan(by - ty); // leans less than 45 degrees
    }
  });

  it("strip grass blades are soft curved single blades like the logo's (no straight comb teeth)", () => {
    const d = bladeOutline([10, 12, 2, 3, 0], 16);
    // Base on the ground line, two curved edges and a small round over the tip: only Q curves, no straight L sides.
    expect(d).toMatch(/^M8\.5 16Q[^QLA]+Q[^QLA]+Q[^QLA]+ 11\.5 16Z$/);
    const nums = d.match(/-?[\d.]+/g)!.map(Number);
    const ys = nums.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThan(16 - 12 - 0.5); // tip stays at the asked height
  });

  it("the lawn strip uses logo B's grass greens and the brand's sun colours in both themes", () => {
    const A = ART as Record<string, string>;
    const D = ART_DARK as Record<string, string>;
    const T = TOKENS as Record<string, string>;
    for (const theme of ["light", "dark"] as const) {
      const p = GRASS_PALETTE[theme];
      expect([p.deep, p.mid, p.light, p.band], theme).toEqual([A.gDark, A.gMid, A.gLight, A.gMid]);
      expect([p.petal, p.petalDark], theme).toEqual([T.sunflower.toUpperCase(), T.sun.toUpperCase()]);
    }
    // Dark mode: the glow blades use the dark logo's pale green, the dandelion is paper and mint.
    expect(GRASS_PALETTE.dark.pale).toBe(D.gPale);
    expect(GRASS_PALETTE.dark.puff).toBe(T.paper.toUpperCase());
    expect(GRASS_PALETTE.dark.puffLine).toBe(T.mint.toUpperCase());
  });

  it("PNG files have the sizes the spec asks for", () => {
    const sizes: Record<string, [number, number]> = {
      "icon-32.png": [32, 32],
      "apple-touch-icon.png": [180, 180],
      "icon-192.png": [192, 192],
      "icon-512.png": [512, 512],
      "og-1200x630.png": [1200, 630],
      "dev-cover-1000x420.png": [1000, 420],
    };
    for (const [name, [w, h]] of Object.entries(sizes)) {
      const buf = read(`public/${name}`);
      expect(buf.subarray(1, 4).toString(), name).toBe("PNG");
      expect([buf.readUInt32BE(16), buf.readUInt32BE(20)], name).toEqual([w, h]);
    }
  });

  it("v3: the icons and share images are drawn from the v3 sprout ticket in the v3 colours (no fonts, text or pictures)", () => {
    const raster = (out as { raster: Record<string, { svg: string; size: number }> }).raster;
    expect(Object.keys(raster).sort()).toEqual(
      ["apple-touch-icon.png", "dev-cover-1000x420.png", "icon-192.png", "icon-32.png", "icon-512.png", "og-1200x630.png"].sort(),
    );
    const sources = [...Object.values(raster).map((r) => r.svg), ...(out as { favicon: { svg: string }[] }).favicon.map((r) => r.svg)];
    for (const svg of sources) {
      expect(svg).toMatch(/role="img" aria-labelledby="t"><title id="t">Grass Pass[^<]*<\/title>/);
      expect(svg).not.toMatch(/Gradient|<text|<image|xlink:href|@import|font-family/i);
      // The v3 ticket: grass green with the Lucide sprout path.
      expect(svg).toContain(`fill="${V3.primary}"`);
      expect(svg).toContain(SPROUT_PATHS[0]);
      // Never the banner ticket's colours.
      expect(svg).not.toContain((ART as Record<string, string>).ticket);
    }
    // Tiles are meadow paper edge to edge; favicons are see-through around the ticket.
    for (const name of ["apple-touch-icon.png", "icon-192.png", "icon-512.png"]) expect(raster[name].svg, name).toContain(`fill="${V3.background}"/>`);
    expect(raster["icon-32.png"].svg).not.toContain(V3.background);
    // The share images carry the tagline and the real section names only.
    expect(raster["og-1200x630.png"].svg).toContain("your ticket to get outside");
  });

  it("v3: the committed icon and share PNGs are up to date with scripts/render-brand.mjs", () => {
    const raster = (out as { raster: Record<string, { svg: string; size: number }> }).raster;
    for (const [name, { svg, size }] of Object.entries(raster)) {
      expect(Buffer.compare(read(`public/${name}`), renderPng(svg, size)), name).toBe(0);
    }
  });

  it("v3: the rendered icons really show the green ticket on meadow paper (pixels)", () => {
    const raster = (out as { raster: Record<string, { svg: string; size: number }> }).raster;
    const img = new Resvg(raster["icon-512.png"].svg, { fitTo: { mode: "width", value: 512 }, font: { loadSystemFonts: false } }).render();
    const px = (x: number, y: number) => {
      const i = (y * img.width + x) * 4;
      return `#${[0, 1, 2].map((k) => img.pixels[i + k].toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    };
    expect(px(4, 4)).toBe(V3.background);
    expect(px(150, 150)).toBe(V3.primary);
    // The notch is cut out: the meadow shows through at the ticket's left edge.
    expect(px(90, 256)).toBe(V3.background);
  });

  it("favicon.ico holds 16, 32 and 48 px PNG images", () => {
    const ico = read("public/favicon.ico");
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    const dims = Array.from({ length: count }, (_, i) => ico.readUInt8(6 + i * 16));
    expect(dims).toEqual([16, 32, 48]);
    const firstOffset = ico.readUInt32LE(6 + 12);
    expect(ico.subarray(firstOffset + 1, firstOffset + 4).toString()).toBe("PNG");
  });
});
