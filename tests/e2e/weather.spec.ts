import { readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The weather card on the pass page (Kevin, Oct 8). Keyless: the pass is a recorded real pass from tests/fixtures (the
// server runs with GP_E2E_FIXTURE_PASSES=1); the weather is LIVE (Open-Meteo, free, no key; weather.gov for alerts).
// So the card may show a real forecast or, if the weather service is slow or down, the honest "No weather data
// available: <why>" line. Both are correct; anything else (a stuck loading card, a made-up forecast) is a failure.
const FIX = join(__dirname, "..", "fixtures");
const PASS_ID = (JSON.parse(readFileSync(join(FIX, "pass-celebration-13plus-live.json"), "utf8")) as { pass: { id: string } }).pass.id;
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

async function openCard(page: Page) {
  const res = await page.goto(`/pass/${PASS_ID}`);
  expect(res?.status()).toBe(200);
  // The pass itself is on screen before the weather (the card streams in).
  await expect(page.locator("#pass-title")).toBeVisible();
  const card = page.locator('[data-testid="weather-card"]:not([data-state="loading"])');
  // The lookup's budget is 8 s; streaming adds a little.
  await expect(card).toBeVisible({ timeout: 15_000 });
  return card;
}

for (const width of [360, 1280]) {
  test(`weather card at ${width}px: a real forecast or the honest "No weather data available" line`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const card = await openCard(page);
    const state = await card.getAttribute("data-state");
    expect(["forecast", "none"]).toContain(state);
    const headline = (await card.getByTestId("weather-headline").innerText()).trim();
    if (state === "forecast") {
      expect(["great", "good", "caution", "warning", "danger"]).toContain(await card.getAttribute("data-mood"));
      expect(headline.length).toBeGreaterThan(20);
      await expect(card).toContainText(/(Today|Tomorrow) at Celebration Park/);
      await expect(card).toContainText(/Forecast updated \d{1,2}:\d{2} [AP]M C[DS]T/);
      await expect(card.getByRole("link", { name: "Weather data by Open-Meteo.com" })).toHaveAttribute("href", "https://open-meteo.com/");
      await expect(card.getByRole("list", { name: "Forecast numbers" })).toContainText("Low");
    } else {
      expect(headline).toMatch(/^No weather data available: .+/);
      await expect(card).not.toContainText("°");
    }
    // It comes before the pass card (above it; from 1280 px, in the column to its left: wide layout 2026-10-09) and never
    // makes the page scroll sideways.
    const cardBox = await card.boundingBox();
    const passBox = await page.locator("#pass-title").boundingBox();
    expect(cardBox && passBox && (cardBox.y < passBox.y || cardBox.x + cardBox.width <= passBox.x)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`axe: the pass page with the weather card (${theme}, 360 and 1280)`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("grass-pass-theme", t), theme);
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await openCard(page);
      const r = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    }
  });
}

test("the card is screen only (hidden in print) and still when motion is reduced", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const card = await openCard(page);
  const anim = await page.evaluate(() =>
    [...document.querySelectorAll(".gp-wx-rays, .gp-wx-drop, .gp-wx-cloud, .gp-wx-flake, .gp-wx-wave")].map((el) => getComputedStyle(el).animationName),
  );
  expect(anim.every((a) => a === "none")).toBe(true);
  await page.emulateMedia({ media: "print" });
  await expect(card).toBeHidden();
  await expect(page.locator("#pass-title")).toBeVisible();
});
