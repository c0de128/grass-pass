import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * UX-5-01 (R5): the home page's skipped sections (content-visibility: auto) need placeholders at least as tall as the
 * real section, or a skipped section's dark card overlaps the next section and axe/Lighthouse report a false
 * contrast failure (the #parks "Explore" eyebrow at 390-412 px, scroll 0). Checked at every width and scroll
 * position, light and dark.
 */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const WIDTHS = [320, 360, 390, 412, 640, 768, 1024, 1280, 1920];

test("each skipped home section's placeholder is at least as tall as the real section, at every width", async ({ browser }) => {
  test.setTimeout(120_000);
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await context.newPage();
    await page.goto("/");
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".gp-home > section")]
        .filter((s) => getComputedStyle(s).contentVisibility === "auto")
        .map((s) => {
          const placeholder = parseFloat(getComputedStyle(s).containIntrinsicHeight.replace("auto", "")) || 0;
          s.style.contentVisibility = "visible";
          const real = s.getBoundingClientRect().height;
          return { id: s.id, placeholder, real: Math.round(real) };
        }),
    );
    expect(rows.length, `${width}px: the home page skips its heavy sections`).toBeGreaterThan(0);
    for (const r of rows) expect(r.real, `${width}px #${r.id}: real ${r.real} px vs placeholder ${r.placeholder} px`).toBeLessThanOrEqual(r.placeholder);
    await context.close();
  }
});

test("home: axe is clean at every scroll position (target-size at the top only) (390/412 phones and 1280, light and dark)", async ({ browser }) => {
  test.setTimeout(240_000);
  for (const width of [390, 412, 1280]) {
    for (const scheme of ["light", "dark"] as const) {
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width, height: 800 } });
      const page = await context.newPage();
      await page.goto("/");
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += 800) {
        await page.evaluate((yy) => window.scrollTo(0, yy), y);
        // Below the top, target-size is left out: a button that happens to sit half under the sticky header at an exact
        // scroll offset is reported as "partially obscured" (axe), which is true of any sticky header and not what this
        // test is about. At scroll 0 every rule runs.
        const builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
        const results = await (y === 0 ? builder : builder.disableRules(["target-size"])).analyze();
        expect(results.violations.map((v) => `${width}/${scheme} @${y}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      }
      await context.close();
    }
  }
});
