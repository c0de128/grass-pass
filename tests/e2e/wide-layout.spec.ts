import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Wide layout (Kevin 2026-10-09: "so much unused space on the left and right"). Every page box uses the shared
// gp-container (globals.css): content up to 1536 px with fluid gutters. Checks: the boxes really are wider on a big
// screen, long paragraphs keep a readable measure (at most ~80 characters a line), and nothing scrolls sideways from
// 320 px to 2560 px. Keyless: the pass page is a recorded real pass from tests/fixtures (GP_E2E_FIXTURE_PASSES=1).
const FIX = join(__dirname, "..", "fixtures");
const PASS_ID = (JSON.parse(readFileSync(join(FIX, "pass-celebration-13plus-live.json"), "utf8")) as { pass: { id: string } }).pass.id;
const PAGES = ["/", "/about", "/how-it-works", "/signin", `/pass/${PASS_ID}`] as const;

// Each test walks several full pages (up to 2560 px wide): one at a time, so the shared test server is not starved and the
// time-limited client checks in other specs (e.g. the judge count on /signin) keep their budget.
test.describe.configure({ mode: "serial" });

async function open(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res?.status()).toBe(200);
  await page.evaluate(() => document.fonts.ready);
}

test("1920 px: the page boxes are wider than the old 1216 px (over 1300 px), header and footer too", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  for (const path of ["/", "/about", "/how-it-works"]) {
    await open(page, path);
    const widths = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("header .gp-container, main .gp-container, footer .gp-container")].map((el) => {
        const cs = getComputedStyle(el);
        return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      }),
    );
    expect(widths.length, `${path}: shared containers`).toBeGreaterThan(2);
    for (const w of widths) expect(w, `${path}: content box width`).toBeGreaterThan(1300);
  }
});

test("1920 px: long paragraphs keep a readable measure (at most ~80 characters a line)", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  for (const path of ["/", "/about", "/how-it-works", `/pass/${PASS_ID}`]) {
    await open(page, path);
    const wide = await page.evaluate(() => {
      const out: string[] = [];
      for (const p of document.querySelectorAll<HTMLElement>("main p")) {
        // The printed-pass replica in "What's a pass?" mirrors the paper layout; it is not running text.
        if (p.closest('[data-testid="anatomy-sheet"]')) continue;
        const text = (p.textContent ?? "").trim();
        const box = p.getBoundingClientRect();
        if (text.length < 120 || box.width === 0 || box.height === 0) continue;
        const probe = document.createElement("span");
        probe.style.cssText = "display:inline-block;width:80ch;position:absolute;visibility:hidden";
        p.appendChild(probe);
        const limit = probe.getBoundingClientRect().width;
        probe.remove();
        if (box.width > limit + 2) out.push(`${Math.round(box.width)}px > 80ch (${Math.round(limit)}px): ${text.slice(0, 60)}`);
      }
      return out;
    });
    expect(wide, `${path}: paragraphs wider than 80ch`).toEqual([]);
  }
});

for (const width of [320, 2560]) {
  test(`${width} px: no page scrolls sideways`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 740 : 1440 });
    for (const path of PAGES) {
      await open(page, path);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(sw, `${path} at ${width} px`).toBeLessThanOrEqual(width);
    }
  });
}

test("768 px: the Explore status pill stays one line (it used to wrap into a tall column)", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await open(page, "/");
  const pill = page.getByTestId("examples-live");
  const box = await pill.boundingBox();
  const line = await pill.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  expect(box && box.height).toBeLessThanOrEqual(line * 1.5 + 16);
});
