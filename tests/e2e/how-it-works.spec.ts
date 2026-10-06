import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Kevin 2026-10-06: a "How it works" tab at the top of every page, explaining the app and the AI process in
// detail (/how-it-works; the tab is "How it works": Kevin B2, 2026-10-06). No upstream call: the page is static text built from the app's own constants.

const WIDTHS = [360, 1280] as const;
const SCHEMES = ["light", "dark"] as const;
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

for (const width of WIDTHS) {
  test(`the header tab opens the page at ${width} px (from the About page)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/about");
    const tab = page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "How it works", exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(page).toHaveURL(/\/how-it-works$/);
    await expect(page.getByRole("heading", { level: 1, name: "How a park becomes a pass." })).toBeVisible();
    // No sideways scrolling on a small phone.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const scheme of SCHEMES) {
    test(`axe finds no violations at ${width} px, ${scheme}`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width, height: 900 } });
      const page = await context.newPage();
      await page.goto("/how-it-works");
      await expect(page.getByRole("heading", { level: 1, name: "How a park becomes a pass." })).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      await context.close();
    });
  }
}

test("the page renders every step and links back to About and the footer links to it", async ({ page }) => {
  await page.goto("/how-it-works");
  const steps = page.getByRole("list", { name: "How a pass is made, step by step" }).locator(":scope > li");
  await expect(steps).toHaveCount(9);
  await expect(page.getByText("Done by the open model")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "About page" }).first()).toHaveAttribute("href", /\/about#/);
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "How Grass Pass works" })).toHaveAttribute("href", "/how-it-works");
  // The in-page index jumps to a section.
  await page.getByRole("navigation", { name: "On this page" }).getByRole("link", { name: "Honest limits" }).click();
  await expect(page).toHaveURL(/#limits$/);
});
