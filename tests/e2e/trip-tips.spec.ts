import { readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Trip tips ("How to make this a great trip", Kevin Oct 8). Keyless: the passes are recorded real passes from
// tests/fixtures, opened by id because the server runs with GP_E2E_FIXTURE_PASSES=1:
// - pass-celebration-6to10-tips-live.json: a real pass with the model's (gemma-4-31B-it) tips;
// - pass-celebration-6to10-tips-rules.json: the same pass with the code-written list (derived, see the file);
// - pass-celebration-13plus-live.json: made before trip tips existed.
const FIX = join(__dirname, "..", "fixtures");
const read = (f: string) => JSON.parse(readFileSync(join(FIX, f), "utf8")) as { pass: { id: string; tripTips?: { items: { tip: string; why: string }[] } } };
const LIVE = read("pass-celebration-6to10-tips-live.json").pass;
const RULES = read("pass-celebration-6to10-tips-rules.json").pass;
const OLD = read("pass-celebration-13plus-live.json").pass;
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

async function open(page: Page, id: string) {
  const res = await page.goto(`/pass/${id}`);
  expect(res?.status()).toBe(200);
  await expect(page.locator("#pass-title")).toBeVisible();
  // Let the streamed weather card settle (its lookup budget is 8 s), so the layout is final.
  await expect(page.locator('[data-testid="weather-card"]:not([data-state="loading"])')).toBeVisible({ timeout: 15_000 });
  return page.locator('[data-testid="trip-tips"]');
}

for (const width of [360, 1280]) {
  test(`model tips at ${width}px: under the weather card, a real list, each tip with its fact, the Gemma credit`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const sec = await open(page, LIVE.id);
    await expect(sec).toHaveAttribute("data-state", "model");
    await expect(sec.getByRole("heading", { level: 2, name: "How to make this a great trip" })).toBeVisible();
    const items = sec.getByRole("list").getByRole("listitem");
    await expect(items).toHaveCount(LIVE.tripTips!.items.length);
    for (const i of LIVE.tripTips!.items) {
      await expect(sec).toContainText(i.tip);
      await expect(sec).toContainText(`Based on: ${i.why}`);
    }
    await expect(sec.getByTestId("trip-tips-source")).toHaveText("Written by Gemma 4 · open model");
    await expect(sec.getByTestId("trip-tips-credit")).toContainText("Written by Gemma 4 (open model) from the forecast for Thu, Oct 8 and the park map.");
    // Seen on a later day (Chicago), the section says which day's weather the tips were for; on Oct 8 it doesn't.
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    if (today > "2026-10-08") await expect(sec.getByTestId("trip-tips-stale")).toContainText("These tips were made for the weather on Thu, Oct 8.");
    else await expect(sec.getByTestId("trip-tips-stale")).toHaveCount(0);
    // Order: weather card, then trip tips, then the pass (below them; from 1280 px, in the column to their right).
    const wx = await page.getByTestId("weather-card").boundingBox();
    const tips = await sec.boundingBox();
    const pass = await page.locator("#pass-title").boundingBox();
    expect(wx && tips && pass && wx.y < tips.y && (tips.y < pass.y || tips.x + tips.width <= pass.x)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test("rules list: the honest label, and an older pass says it has no trip tips", async ({ page }) => {
  const rules = await open(page, RULES.id);
  await expect(rules).toHaveAttribute("data-state", "rules");
  await expect(rules.getByTestId("trip-tips-credit")).toContainText("Basic tips from the forecast and park map (the AI didn't answer).");
  await expect(rules.getByTestId("trip-tips-source")).toHaveText("Basic tips: the AI didn't answer");
  await expect(rules.getByRole("listitem")).toHaveCount(RULES.tripTips!.items.length);
  const old = await open(page, OLD.id);
  await expect(old).toHaveAttribute("data-state", "before");
  await expect(old.getByTestId("trip-tips-note")).toHaveText("No trip tips for this pass: it was made before trip tips existed.");
  await expect(old.getByRole("list")).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: the pass page with trip tips (${theme}, 360 and 1280, model and rules)`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("grass-pass-theme", t), theme);
    await page.emulateMedia({ colorScheme: theme });
    for (const id of [LIVE.id, RULES.id]) {
      for (const width of [360, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await open(page, id);
        const r = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
        expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      }
    }
  });
}

test("screen only: hidden in print media, and the print sheet has no trip tips", async ({ page }) => {
  const sec = await open(page, LIVE.id);
  await expect(sec).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(sec).toBeHidden();
  await expect(page.locator("#pass-title")).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  const res = await page.goto(`/pass/${LIVE.id}/print`);
  expect(res?.status()).toBe(200);
  await expect(page.locator('[data-testid="trip-tips"]')).toHaveCount(0);
  await expect(page.getByText("How to make this a great trip")).toHaveCount(0);
});

// UX-10-01 (round 10): Lighthouse measured CLS 0.29 on a pass page, from the trip-tips section being pushed down when
// the streamed weather card replaced its smaller loading card. The forecast is cached per park, so once it is (the first
// open below warms it) the card is in the first HTML and nothing below it moves.
for (const width of [360, 1280]) {
  test(`UX-10-01: no layout shift on the pass page at ${width}px once the forecast is cached (CLS under 0.1)`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 360 ? 740 : 900 });
    for (const id of [OLD.id, LIVE.id]) await open(page, id);
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    for (const id of [OLD.id, LIVE.id]) {
      const sec = await open(page, id);
      await expect(sec).toBeVisible();
      // The first HTML already has the final card: no loading card was ever shown.
      await expect(page.locator('[data-testid="weather-card"][data-state="loading"]')).toHaveCount(0);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 750))));
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      expect(cls, `CLS on ${id}`).toBeLessThan(0.1);
    }
  });
}
