import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// Pinned example passes (src/lib/pinned.ts): real passes committed in the repo. They open from the repo with no key and
// no store, so this check runs keyless. Every pinned pass must open on its pass page and print on ONE page (Letter and
// A4), the same check print.spec.ts runs on a fresh live pass. A new file in src/data/pinned-examples is covered too.
// Playwright loads specs as CommonJS here (no import.meta), so the path comes from __dirname.
const DIR = join(__dirname, "..", "..", "src", "data", "pinned-examples");
const PINNED = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => {
    const pass = (JSON.parse(readFileSync(join(DIR, f), "utf8")) as { pass: { id: string; park: { name: string }; items: { clue: string }[] } }).pass;
    return { file: f, id: pass.id, park: pass.park.name, firstClue: pass.items[0]!.clue };
  });

test.use({ launchOptions: { args: ["--disable-lcd-text"] } });

/** Number of pages in a Chromium PDF (page objects are written uncompressed). */
const pdfPages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

test("there is at least one pinned pass", () => {
  expect(PINNED.length).toBeGreaterThan(0);
});

for (const pin of PINNED) {
  test(`pinned ${pin.file}: the pass page opens it and it prints on ONE page (Letter and A4)`, async ({ page }) => {
    const res = await page.goto(`/pass/${pin.id}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(pin.park);
    await expect(page.getByText(pin.firstClue).first()).toBeVisible();

    await page.goto(`/pass/${pin.id}/print`);
    await expect(page.locator(".gp-sheet[data-fit]")).toHaveCount(1);
    // Review 2026-10-08 MAJOR-3: the lead matches PrintFit's measured page count.
    await expect(page.locator(".gp-sheet")).toHaveAttribute("data-pages", "1");
    await expect(page.locator(".gp-lead-one")).toBeVisible();
    await expect(page.locator(".gp-lead-two")).toBeHidden();
    await page.emulateMedia({ media: "print", colorScheme: "light" });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const letter = await page.pdf({ preferCSSPageSize: true, printBackground: false });
    expect(pdfPages(letter), `${pin.file}: Letter pages`).toBe(1);
    const a4 = await page.pdf({ format: "A4", margin: { top: "0.4in", bottom: "0.4in", left: "0.4in", right: "0.4in" }, printBackground: false });
    expect(pdfPages(a4), `${pin.file}: A4 pages`).toBe(1);
  });
}

// map-clear (2026-10-07): the Find This Spot map on every pinned pass, keyless. Labels readable on a 360 px phone, the
// printed map black and white only with START and the X on it, and the legend inside its column.
for (const pin of PINNED) {
  test(`pinned ${pin.file}: the Find This Spot map is readable on a phone and black and white in print`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/pass/${pin.id}`);
    const map = page.locator('[data-testid="spot-box"][data-variant="screen"] [data-testid="spot-map"]');
    await expect(map).toBeVisible();
    await expect(map.locator('[data-marker="x"]')).toHaveCount(1);
    await expect(map.locator('[data-label="start"]')).toHaveCount(1);
    const px = await map.evaluate((svg) => {
      const s = svg as SVGSVGElement;
      const scale = s.getBoundingClientRect().width / s.viewBox.baseVal.width;
      return [...s.querySelectorAll("text")].map((t) => parseFloat(getComputedStyle(t).fontSize) * scale);
    });
    for (const p of px) expect(p).toBeGreaterThanOrEqual(10.95);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    await page.setViewportSize({ width: 1000, height: 1200 });
    await page.goto(`/pass/${pin.id}/print`);
    await expect(page.locator(".gp-sheet[data-fit]")).toHaveCount(1);
    await page.emulateMedia({ media: "print", colorScheme: "light" });
    const kid = page.locator(".gp-kid");
    const legend = kid.locator(".gp-spot-legend");
    if (await legend.isVisible()) expect(await legend.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const png = await kid.getByTestId("spot-map").screenshot();
    const coloured = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 12) n++;
      return n;
    }, png.toString("base64"));
    expect(coloured).toBe(0);
  });
}

// Review 2026-10-08 MAJOR-3: when PrintFit measures 2 pages, the print page no longer says "One ... page". No pinned
// pass needs 2 pages, so this sets the measured attribute PrintFit would set and checks the CSS that follows it.
test("the print lead follows PrintFit's measure: 2 pages hides 'One black-and-white Letter page'", async ({ page }) => {
  const pin = PINNED[0]!;
  await page.goto(`/pass/${pin.id}/print`);
  await expect(page.locator(".gp-sheet[data-fit]")).toHaveCount(1);
  await page.locator(".gp-sheet").evaluate((el) => {
    (el as HTMLElement).dataset.pages = "2";
  });
  await expect(page.locator(".gp-lead-one")).toBeHidden();
  await expect(page.locator(".gp-lead-two")).toBeVisible();
  await expect(page.locator(".gp-lead-two")).toContainText("Two black-and-white Letter pages: this pass is long.");
});
