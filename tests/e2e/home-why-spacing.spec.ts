import { expect, test } from "@playwright/test";

// Kevin 2026-10-09: "The problem section has no spacing at the top and seems too close to the section above it."
// The calm redesign gives #why the same top padding as "What's a pass?" (#pass) at every width, a clear seam with
// "How it works" above (a different background), and real room before the final call to action below.

for (const width of [360, 1440, 1920]) {
  test.describe(`${width} px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("The problem: top padding >= What's a pass?, a clear seam above, room before the final CTA", async ({ page }) => {
      await page.goto("/");
      // Lay the sections out for real (they skip layout until near the screen; see globals.css UX-4-02).
      await page.evaluate(() => document.querySelector(".gp-home")?.setAttribute("data-sections", "real"));
      const m = await page.evaluate(() => {
        const pad = (sel: string) => parseFloat(getComputedStyle(document.querySelector(sel)!).paddingTop);
        const bg = (sel: string) => getComputedStyle(document.querySelector(sel)!).backgroundColor;
        const why = document.querySelector("#why")!;
        const cta = document.querySelector("section[aria-labelledby='cta-title'] > div")!.getBoundingClientRect();
        const source = document.querySelector("[data-testid='two-parks-source']")!.getBoundingClientRect();
        const how = document.querySelector("#how")!.getBoundingClientRect();
        return {
          whyPad: pad("#why > div"),
          passPad: pad("#pass > div"),
          howBg: bg("#how"),
          whyBg: bg("#why"),
          pageBg: getComputedStyle(document.body).backgroundColor,
          // The heading's distance from the end of "How it works".
          headingGap: why.querySelector("h2")!.getBoundingClientRect().top - how.bottom,
          ctaGap: cta.top - source.bottom,
        };
      });
      expect(m.whyPad, "#why top padding vs #pass").toBeGreaterThanOrEqual(m.passPad);
      expect(m.whyPad).toBeGreaterThanOrEqual(64);
      // The seam: How it works is a sage band; The problem sits on the page's own paper colour.
      expect(m.whyBg).toBe(m.pageBg);
      expect(m.whyBg, "#why must not share How it works' sage band").not.toBe(m.howBg);
      expect(m.headingGap).toBeGreaterThanOrEqual(64);
      expect(m.ctaGap).toBeGreaterThanOrEqual(64);
    });
  });
}
