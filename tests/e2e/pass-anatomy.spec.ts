import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * "What's a pass?" (Kevin's option A "Show a real pass", 2026-10-08): one real pinned pass with numbered parts, the
 * pass first and the numbered list after it on phones, no sideways scroll at 320 px, axe clean in both themes.
 */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

test("the section shows the real pinned pass, then the six numbered parts", async ({ page }) => {
  await page.goto("/#pass");
  const section = page.locator("#pass");
  await expect(section.getByRole("heading", { level: 2, name: "Proof in every clue." })).toBeVisible();
  await expect(section.getByTestId("anatomy-sheet")).toBeVisible();
  await expect(section.getByTestId("anatomy-find")).toHaveCount(8);
  await expect(section.getByTestId("anatomy-caption")).toContainText("A real pass: Oak Point Park and Nature Preserve");
  const parts = section.getByTestId("anatomy-legend").getByRole("heading", { level: 3 });
  await expect(parts).toHaveText(["Park Finds", "Wild Finds", "Lucky Finds", "Find This Spot", "October monarch box", "The grown-up's tear-off stub"]);
  // No pinned pass has Lucky Finds: the list says so, and no lucky row is drawn.
  await expect(section.locator('[data-legend="lucky"]')).toContainText("When the data has it");
  await expect(section.locator('[data-testid="anatomy-find"][data-section="lucky"]')).toHaveCount(0);
});

test("phones: the pass comes before the list, and nothing scrolls sideways at 320 px", async ({ browser }) => {
  for (const width of [320, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/#pass");
    const sheet = await page.getByTestId("anatomy-sheet").boundingBox();
    const list = await page.getByTestId("anatomy-legend").boundingBox();
    expect(sheet && list && sheet.y + sheet.height <= list.y, `${width}: pass above list`).toBe(true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${width}: sideways scroll`).toBeLessThanOrEqual(0);
    await context.close();
  }
});

test("axe: the section is clean at 360 and 1280, light and dark", async ({ browser }) => {
  for (const width of [360, 1280]) {
    for (const scheme of ["light", "dark"] as const) {
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width, height: 900 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      await page.goto("/#pass");
      await page.locator("#pass").scrollIntoViewIfNeeded();
      const r = await new AxeBuilder({ page }).include("#pass").withTags(AXE_TAGS).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `${width}/${scheme}`).toEqual([]);
      await context.close();
    }
  }
});
