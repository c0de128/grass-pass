import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOKENS, bladePath } from "../../scripts/brand/art.mjs";
import { buildSvgs } from "../../scripts/render-brand.mjs";

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
      // text-lawn is allowed only on aria-hidden decoration (GrassDivider fills with currentColor).
      const bad = src.match(/\b(?:text|border|outline)-(?:sage|sun)\b/g) ?? [];
      expect(bad, path.relative(APP, f)).toEqual([]);
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

  it("brand text is outlined paths in Fredoka/Nunito, with the tagline next to the name", () => {
    const logo = (out.public as Record<string, string>)["logo-header.svg"];
    expect(logo).toContain("Grass Pass: your ticket to get outside");
    expect((logo.match(/<path /g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("grass blades have rounded tips (an arc at the top), never a sharp point", () => {
    const d = bladePath(10, 20, 12, 1, 2, 0.9) as string;
    expect(d).toMatch(/^M[\d.]+ 20 L[\d.]+ 8 A0\.9 0\.9 0 0 1 [\d.]+ 8 L[\d.]+ 20 Z$/);
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
