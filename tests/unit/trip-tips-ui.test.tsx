/**
 * The trip tips section (src/components/pass/TripTips.tsx), rendered from the REAL recorded passes
 * (tests/fixtures/pass-celebration-6to10-tips-live.json: the model's tips; -rules.json: the rules list derived from the
 * same recorded facts) and an older real pass without tips.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TripTips } from "@/components/pass/TripTips";
import { PassSchema, type Pass } from "@/lib/pass/schema";
import { TRIP_TIPS_COPY } from "@/lib/tips/schema";

const FIX = join(process.cwd(), "tests", "fixtures");
const pass = (f: string): Pass => PassSchema.parse(JSON.parse(readFileSync(join(FIX, f), "utf8")).pass);
const LIVE = pass("pass-celebration-6to10-tips-live.json");
const RULES = pass("pass-celebration-6to10-tips-rules.json");
const OLD = pass("pass-celebration-13plus-live.json");
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

describe("trip tips section", () => {
  it("model tips: heading, the day, a real list with each tip and its fact, the Gemma 4 credit; screen only", () => {
    const h = renderToStaticMarkup(<TripTips tips={LIVE.tripTips} today="2026-10-08" />);
    const t = text(h);
    expect(t).toContain("How to make this a great trip");
    expect(t).toContain("Trip tips for Thu, Oct 8");
    expect((h.match(/<li /g) ?? []).length).toBe(LIVE.tripTips!.items.length);
    expect(h).toContain('<ul class="grid');
    for (const i of LIVE.tripTips!.items) {
      expect(t).toContain(i.tip);
      expect(t).toContain(`Based on: ${i.why}`);
    }
    expect(t).toContain("Written by Gemma 4 (open model) from the forecast for Thu, Oct 8 and the park map.");
    expect(h).toContain('aria-labelledby="trip-tips-title"');
    expect(h).toContain("print:hidden");
    // Every picture is decorative.
    const svgs = h.match(/<svg[^>]*>/g) ?? [];
    expect(svgs.length).toBeGreaterThan(0);
    for (const s of svgs) expect(s).toMatch(/aria-hidden="true"/);
    expect(t).not.toContain("These tips were made for the weather on");
  });

  it("rules list: the honest label with its reason", () => {
    const t = text(renderToStaticMarkup(<TripTips tips={RULES.tripTips} today="2026-10-08" />));
    expect(t).toContain("Basic tips from the forecast and park map (the AI didn't answer).");
    expect(t).not.toContain("Written by");
  });

  it("seen on a later day: says which day's weather the tips were for", () => {
    const t = text(renderToStaticMarkup(<TripTips tips={LIVE.tripTips} today="2026-10-10" />));
    expect(t).toContain("These tips were made for the weather on Thu, Oct 8. Today's forecast is in the weather card above.");
  });

  it("an older pass: the heading and the honest note instead of a list", () => {
    expect(OLD.tripTips).toBeUndefined();
    const h = renderToStaticMarkup(<TripTips tips={OLD.tripTips} today="2026-10-08" />);
    expect(text(h)).toContain(TRIP_TIPS_COPY.beforeTips);
    expect(h).not.toContain("<ul");
  });

  it("no forecast when made: says so, and the credit names only the park map", () => {
    const tips = { ...RULES.tripTips!, forecast: false };
    const t = text(renderToStaticMarkup(<TripTips tips={tips} today="2026-10-08" />));
    expect(t).toContain(TRIP_TIPS_COPY.noForecast);
    expect(t).toContain("Basic tips from the park map (the AI didn't answer).");
  });

  it("the icon tile colours pass 4.5:1 (ink on sunflower), in both themes (the tile is the same)", () => {
    const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
    expect(css).toMatch(/--gp-tips-icon-bg: var\(--gp-sun\);/);
    expect(css).toMatch(/--gp-tips-icon-fg: #10291a;/);
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    expect(ratio("#10291a", "#ffc72c")).toBeGreaterThanOrEqual(4.5);
  });
});
