import { expect, test } from "@playwright/test";

// Kevin (2026-10-07, kept for the full-screen hero 2026-10-08): the tilted pass card over the hero picture must never
// hide the girl. Regions are fractions of the picture file (public/illustrations/hero-kid.webp, 768x1376), mapped
// through the picture's object-fit: cover box, then sampled on a 9x9 grid with elementFromPoint: no sample may land on
// the card. Also: the card stays clear of the search card and of the "AI illustration" label.

const REGIONS = {
  "face and smile": [0.2, 0.22, 0.52, 0.42],
  "paper and hands": [0.44, 0.47, 0.73, 0.67],
  butterfly: [0.62, 0.41, 0.72, 0.46],
} as const;

const SIZES = [
  [1024, 768],
  [1280, 800],
  [1366, 768],
  [1440, 900],
  [1536, 864],
  [1920, 1080],
  [1920, 720],
  [2560, 1440],
] as const;

for (const [width, height] of SIZES) {
  test(`${width}x${height}: the pass card leaves the girl's face, smile, paper and the butterfly visible`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const card = page.getByTestId("hero-pass-card");
    await expect(card).toBeVisible();

    const result = await page.evaluate((regions) => {
      const img = document.querySelector<HTMLImageElement>("#find img")!;
      const box = img.getBoundingClientRect();
      const nw = img.naturalWidth || 768;
      const nh = img.naturalHeight || 1376;
      const s = Math.max(box.width / nw, box.height / nh);
      const pos = getComputedStyle(img).objectPosition.split(" ").map((v) => parseFloat(v) / 100);
      const ox = box.left + (box.width - nw * s) * (pos[0] ?? 0.5);
      const oy = box.top + (box.height - nh * s) * (pos[1] ?? 0.5);
      const cardEl = document.querySelector('[data-testid="hero-pass-card"]')!;
      const covered: Record<string, number> = {};
      for (const [name, [x0, y0, x1, y1]] of Object.entries(regions)) {
        covered[name] = 0;
        for (let i = 0; i <= 8; i++) {
          for (let j = 0; j <= 8; j++) {
            const x = ox + (x0 + ((x1 - x0) * i) / 8) * nw * s;
            const y = oy + (y0 + ((y1 - y0) * j) / 8) * nh * s;
            const el = document.elementFromPoint(x, y);
            if (el && cardEl.contains(el)) covered[name]++;
          }
        }
      }
      // The card's real (rotated, scaled) corners.
      const corner = (css: string) => {
        const m = document.createElement("i");
        m.style.cssText = `position:absolute;width:0;height:0;${css}`;
        cardEl.parentElement!.appendChild(m);
        const r = m.getBoundingClientRect();
        m.remove();
        return { x: r.left, y: r.top };
      };
      const tl = corner("left:0;top:0");
      const bl = corner("left:0;bottom:0");
      const tr = corner("right:0;top:0");
      const br = corner("right:0;bottom:0");
      const form = document.querySelector("#find form")!.closest("div.rounded-3xl")!.getBoundingClientRect();
      const leftAt = (y: number) => tl.x + ((bl.x - tl.x) * (y - tl.y)) / (bl.y - tl.y);
      const searchClearance = Math.min(leftAt(Math.max(form.top, tl.y)), bl.x) - form.right;
      const label = [...document.querySelectorAll("#find p")].find((p) => p.textContent?.includes("AI illustration"))!.getBoundingClientRect();
      const labelOverlap = Math.max(tr.x, br.x) > label.left && Math.max(bl.y, br.y) > label.top;
      return { covered, searchClearance, labelOverlap };
    }, REGIONS);

    for (const [name, n] of Object.entries(result.covered)) expect(n, `${name}: samples under the pass card`).toBe(0);
    expect(result.searchClearance, "gap between the tilted card and the search card (px)").toBeGreaterThanOrEqual(12);
    expect(result.labelOverlap, "the card covers the AI illustration label").toBe(false);
  });
}
