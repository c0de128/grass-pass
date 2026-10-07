import { expect, test, type Page } from "@playwright/test";

// Explore link fix (2026-10-07): the header's section links, a page opened at "/#parks" and a visit from another page
// must END with the section heading on screen, below the sticky header. A smooth scroll passes the heading on its way,
// so a plain toBeInViewport() could pass mid-scroll: these checks wait until the page stops scrolling first.

const SECTIONS = [
  { link: "Explore", hash: "#parks", heading: "See a real pass, right now." },
  { link: "What's a pass?", hash: "#pass" },
  { link: "Why Grass Pass", hash: "#why" },
] as const;

async function settled(page: Page) {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const y = await page.evaluate(() => window.scrollY);
    if (y === last) return;
    last = y;
    await page.waitForTimeout(150);
  }
  throw new Error("the page never stopped scrolling");
}

/** The section's h2 sits fully inside the viewport, below the sticky header. */
async function headingLanded(page: Page, hash: string) {
  await settled(page);
  const box = await page.evaluate((hash) => {
    const h = document.querySelector(`${hash} h2`)!.getBoundingClientRect();
    const header = document.querySelector("header")!.getBoundingClientRect();
    return { top: h.top, bottom: h.bottom, headerBottom: header.bottom, vh: window.innerHeight };
  }, hash);
  expect(box.top, `${hash} heading top vs header`).toBeGreaterThanOrEqual(box.headerBottom - 1);
  expect(box.bottom, `${hash} heading bottom vs viewport`).toBeLessThanOrEqual(box.vh);
}

for (const width of [1180, 1920]) {
  test.describe(`${width} px`, () => {
    test.use({ viewport: { width, height: 720 } });

    for (const s of SECTIONS) {
      test(`header "${s.link}" lands on its heading (same page, direct load, from /about)`, async ({ page }) => {
        const nav = page.getByRole("navigation", { name: "Site" });
        await page.goto("/");
        await nav.getByRole("link", { name: s.link, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`${s.hash}$`));
        await headingLanded(page, s.hash);
        if ("heading" in s) await expect(page.getByRole("heading", { level: 2, name: s.heading })).toBeInViewport();

        await page.goto(`/${s.hash}`);
        await headingLanded(page, s.hash);

        await page.goto("/about");
        await nav.getByRole("link", { name: s.link, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/${s.hash}$`));
        await headingLanded(page, s.hash);
      });
    }
  });
}

test.describe("360 px phone", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('footer "All example parks" and a direct /#parks land on the Explore heading', async ({ page }) => {
    await page.goto("/");
    await page.getByRole("contentinfo").getByRole("link", { name: "All example parks" }).click();
    await expect(page).toHaveURL(/#parks$/);
    await headingLanded(page, "#parks");
    await page.goto("/#parks");
    await headingLanded(page, "#parks");
  });
});
