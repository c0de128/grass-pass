import { readFileSync } from "node:fs";
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
    ["primary-foreground", "primary", "primary button text"],
    ["sun-foreground", "sun", "text on sunflower chips"],
    ["sun", "band", "sunflower text on the dark band"],
    ["band-foreground", "band", "text on the dark band"],
    ["band-muted", "band", "muted text on the dark band"],
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
