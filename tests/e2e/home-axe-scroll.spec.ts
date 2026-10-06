import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * UX-5-01 (R5): the home page's skipped sections (content-visibility: auto) are taller than their placeholders on
 * phones, and a skipped section still reports its children's real boxes, so axe/Lighthouse read #pass's dark card as
 * the background of the #parks "Explore" eyebrow (a false 2.78:1 at 390-412 px, scroll 0). #parks now has its own
 * page-coloured background on a layer above #pass. Checked at every scroll position.
 */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/** Wait until the entrance animations (gp-rise, 0.7 s) are done; endless ones (the live dot) are skipped. */
async function animationsDone(page: import("@playwright/test").Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

test("#parks paints its own page-coloured background above the skipped sections (phone and desktop, light and dark)", async ({ browser }) => {
  for (const width of [390, 1280]) {
    for (const scheme of ["light", "dark"] as const) {
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width, height: 800 } });
      const page = await context.newPage();
      await page.goto("/");
      const r = await page.evaluate(() => {
        const parks = getComputedStyle(document.getElementById("parks")!);
        return { bg: parks.backgroundColor, page: getComputedStyle(document.body).backgroundColor, z: parks.zIndex, pos: parks.position };
      });
      expect(r.bg, `${width}/${scheme}`).toBe(r.page);
      expect(r.pos).toBe("relative");
      expect(Number(r.z)).toBeGreaterThan(0);
      await context.close();
    }
  }
});

test("home: axe is clean at every scroll position (target-size at the top only) (390/412 phones and 1280, light and dark)", async ({ browser }) => {
  test.setTimeout(240_000);
  for (const width of [390, 412, 1280]) {
    for (const scheme of ["light", "dark"] as const) {
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width, height: 800 } });
      const page = await context.newPage();
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await animationsDone(page);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += 800) {
        await page.evaluate((yy) => window.scrollTo(0, yy), y);
        await animationsDone(page);
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
