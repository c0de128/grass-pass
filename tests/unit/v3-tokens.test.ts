import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// v3 (Kevin's v0 design) colour roles in src/styles/tokens.css: every text pair >= 4.5:1, controls/rings >= 3:1,
// in the light palette (v0's own) and in our dark palette (v0 had none).

const css = readFileSync(new URL("../../src/styles/tokens.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--gp-([a-z-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2];
  return out;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const contrast = (a: string, b: string) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const light = block(":root {");
const dark = block(':root[data-theme="dark"] {');

describe.each([
  ["light", light],
  ["dark", dark],
])("v3 %s palette", (_name, t) => {
  const text: Array<[string, string, string]> = [
    ["foreground", "background", "body text"],
    ["muted-foreground", "background", "muted text"],
    ["muted-foreground", "muted", "muted text on muted fills"],
    ["card-foreground", "card", "text on cards"],
    ["muted-foreground", "card", "muted text on cards"],
    ["primary", "background", "green eyebrows and links"],
    ["primary", "card", "links on cards"],
    // UX-4-01 (R4): the pass page's "Grown-ups: back from the park? Sign in" box is a link on the muted fill.
    ["link", "muted", "green links and eyebrows on muted fills (pass page report box, sign-in card, alerts)"],
    ["link", "background", "green links on the page"],
    ["link", "card", "green links on cards"],
    ["destructive", "card", "error text on cards"],
    ["foreground", "muted", "body text on muted fills"],
    ["sun-foreground", "sun", "picked age chip and park row"],
    ["primary-foreground", "primary", "primary button text"],
    ["sun-foreground", "sun", "text on sunflower chips"],
    ["sun", "band", "sunflower text on the dark band"],
    ["band-foreground", "band", "text on the dark band"],
    ["band-muted", "band", "muted text on the dark band"],
    ["footer-foreground", "footer", "footer links and closing line"],
    ["footer-muted", "footer", "footer credits"],
    ["footer-heading", "footer", "footer column headings (sunflower)"],
    ["why-foreground", "why", "text on the logo-green \"The problem\" panel"],
    ["why-muted", "why", "body text and source line on the logo-green panel"],
    ["on-ink", "ink", "text on ink pills"],
  ];
  it.each(text)("%s on %s >= 4.5:1 (%s)", (fg, bg) => {
    expect(t[fg], fg).toBeDefined();
    expect(t[bg], bg).toBeDefined();
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["line", "card", "input and control outlines"],
    ["line", "background", "outlines on the page"],
    ["ring", "background", "focus ring"],
    ["ring", "card", "focus ring on cards"],
    ["primary", "background", "primary button edge"],
  ])("%s on %s >= 3:1 (%s)", (fg, bg) => {
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(3);
  });
});

it("the system-dark block and the explicit dark block match", () => {
  expect(block(':root:not([data-theme="light"]) {')).toEqual(dark);
});

describe("UX-4-01: green text links never use the primary fill colour", () => {
  // Every underlined green link uses text-link (>= 4.5:1 on every surface, the muted fill included), never
  // text-primary, which is 4.49:1 on the muted fill in the light theme (axe, audit round 4).
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx")) files.push(p);
    }
  };
  walk(fileURLToPath(new URL("../../src/", import.meta.url)));
  const LINK_CLASSES = /className=(?:"([^"]*)"|\{?`([^`]*)`)/g;
  const PRIMARY_TEXT = /\btext-primary(?![-\w])/;

  it("finds the component files", () => expect(files.length).toBeGreaterThan(20));
  it.each(files.map((f) => [relative(process.cwd(), f), f]))("%s: no underlined text-primary", (_name, f) => {
    const src = readFileSync(f, "utf8");
    const bad = [...src.matchAll(LINK_CLASSES)]
      .map((m) => m[1] ?? m[2])
      .filter((c) => PRIMARY_TEXT.test(c) && /underline/.test(c));
    expect(bad).toEqual([]);
  });
  it("the pass page 'Grown-ups: back from the park? Sign in' link uses text-link", () => {
    const src = readFileSync(new URL("../../src/components/pass/PassPreview.tsx", import.meta.url), "utf8");
    const box = src.slice(src.indexOf("Grown-ups: back from the park?"), src.indexOf("to tell us what you found"));
    expect(box).toContain("text-link");
    expect(box).not.toMatch(PRIMARY_TEXT);
  });
});

