import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// v3 redesign of /about and /how-it-works (Kevin 2026-10-06: "way too plain, a never-ending blog post"): a visual
// summary first, the fine print folded in <details>. These pages make no upstream call (static text from the
// app's own constants and the committed eval results).

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const PAGES = [
  { path: "/about", h1: "An open model, a real park and a pencil." },
  { path: "/how-it-works", h1: "How a park becomes a pass." },
] as const;

const openAll = (page: Page) => page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const { path, h1 } of PAGES) {
  for (const width of [360, 1280] as const) {
    for (const scheme of ["light", "dark"] as const) {
      test(`${path}: axe finds no violations at ${width} px, ${scheme}, disclosures closed and open`, async ({ browser }) => {
        const context = await browser.newContext({ colorScheme: scheme, viewport: { width, height: 900 } });
        const page = await context.newPage();
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1, name: h1 })).toBeVisible();
        const closed = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
        expect(closed.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
        await openAll(page);
        const open = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
        expect(open.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
        await context.close();
      });
    }
  }

  for (const width of [320, 360] as const) {
    test(`${path}: no sideways scroll at ${width} px, with every disclosure open`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(path);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await openAll(page);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  }
}

test("/about: the stat tiles are visible first, and a disclosure opens and closes from the keyboard", async ({ page }) => {
  await page.goto("/about");
  const tiles = page.getByRole("list", { name: "Measured results" }).locator(":scope > li");
  await expect(tiles).toHaveCount(8);
  await expect(tiles.filter({ hasText: "Missed" })).toHaveCount(2);
  await expect(page.getByText("99.8%", { exact: true })).toBeVisible();

  const privacy = page.locator("details#privacy-table");
  const summary = privacy.locator("summary");
  await expect(privacy).not.toHaveAttribute("open", "");
  await expect(page.getByRole("table", { name: /Everything that leaves your device/ })).toBeHidden();
  await summary.focus();
  // Visible focus: the global 3 px ring.
  expect(await summary.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("table", { name: /Everything that leaves your device/ })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("table", { name: /Everything that leaves your device/ })).toBeHidden();
});

test("/about: a link to a folded section opens it (the /how-it-works privacy link)", async ({ page }) => {
  await page.goto("/how-it-works");
  await page.locator("#privacy").getByRole("link", { name: "About page" }).click();
  await expect(page).toHaveURL(/\/about#privacy-table$/);
  await expect(page.getByRole("table", { name: /Everything that leaves your device/ })).toBeVisible();
});

test("/about: the footer credits link lands on the credits with the photo thumbnails", async ({ page }) => {
  await page.goto("/about#credits");
  await expect(page.getByRole("heading", { level: 2, name: "Credits and licences" })).toBeInViewport();
  const photos = page.getByTestId("about-photo-credits").locator(":scope > li");
  // Judge R7 T1: the 4 example parks (Oak Point now) plus Connemara, still shown in the "two parks" band.
  await expect(photos).toHaveCount(5);
  await expect(photos.first().getByRole("img")).toBeVisible();
});

test("/how-it-works: the step-by-step detail is one click away (Blueprint, 2026-10-09: folded under the hood)", async ({ page }) => {
  await page.goto("/how-it-works");
  const steps = page.locator('ol[aria-label="How a pass is made, step by step"] > li');
  await expect(steps).toHaveCount(9);
  await expect(steps.nth(4).getByRole("list", { name: "Reasons a clue is removed" })).toBeHidden();
  await page.locator("details#steps > summary").click();
  await expect(steps.nth(4).getByRole("list", { name: "Reasons a clue is removed" })).toBeVisible();
});
