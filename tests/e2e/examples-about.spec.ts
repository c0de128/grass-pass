import { expect, test, type Page } from "@playwright/test";

// S8b: pre-warmed example parks, /about, and 360 px smoke. Example passes are made by the server at start-up
// from LIVE data (OpenStreetMap, iNaturalist, the open model), so the first test waits for them.

const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test.describe("example parks", () => {
  test.describe.configure({ mode: "serial" });

  test("home lists the example parks; a ready one opens a real pass in under 3 s", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: "See a real pass now" })).toBeVisible();
    const list = page.getByRole("list", { name: "Example parks" });
    await expect(list.getByRole("listitem")).toHaveCount(4);

    // Each card has a data-state (ExampleParks.tsx): ready | off | making | waiting. Decide on that, not on copy.
    const states = async () => list.getByRole("listitem").evaluateAll((els) => els.map((e) => e.getAttribute("data-state") ?? ""));
    const explainsItself = async () => {
      // Every example without a pass says why, in words (never a blank or a made-up pass).
      for (const item of await list.getByRole("listitem").all()) {
        if ((await item.getByRole("link").count()) === 0) await expect(item).toContainText(/^.+No data available yet: \S.{10,}/);
      }
    };

    // PREWARM_EXAMPLES=0 (keyless CI): every card says the examples are switched off, so SKIP with that copy.
    if ((await states()).every((s) => s === "off")) {
      await explainsItself();
      test.skip(true, `Example warm-up is switched off on this server; every card says: ${await list.getByRole("listitem").first().textContent()}`);
    }

    // Wait (reloading) while the server is making an example pass. When nothing is ready and nothing is
    // being made (the last try failed, e.g. no AI key or OpenStreetMap busy), SKIP with the cards' copy.
    let link = list.getByRole("link").first();
    for (let i = 0; i < 40 && (await list.getByRole("link").count()) === 0; i++) {
      await explainsItself();
      const now = await states();
      if (!now.includes("making")) {
        test.skip(true, `No example pass is ready and none is being made; the cards say: ${(await list.textContent())?.slice(0, 300)}`);
      }
      await page.waitForTimeout(5_000);
      await page.reload();
      link = list.getByRole("link").first();
    }
    await expect(link).toBeVisible();
    await expect(link).toContainText(/Made [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M C[DS]T/);
    const name = (await link.locator("span").first().textContent())?.trim() ?? "";

    const started = Date.now();
    await link.click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    expect(Date.now() - started).toBeLessThan(3_000);
    await expect(page).toHaveURL(/\/pass\/[nwr]\d+-6to10-\d{8}-[1-3]\?example=1$/);
    await expect(page.getByText(/^Made [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M C[DS]T/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Print pass" })).toBeVisible();
  });

  test("R2-m9 + R2-m4: a complete park comes first, and every ready example prints on ONE page at scale >= 0.91", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    const list = page.getByRole("list", { name: "Example parks" });
    await expect(list.getByRole("listitem").first()).toContainText("Arbor Hills Nature Preserve");
    await expect(list.getByRole("listitem").last()).toContainText("Connemara Meadow Preserve");
    const hrefs = await list.getByRole("link").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    if (hrefs.length === 0) test.skip(true, `No example pass is ready on this server; the cards say: ${(await list.textContent())?.slice(0, 300)}`);
    const pdfPages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    for (const href of hrefs) {
      const id = /\/pass\/([a-z0-9-]+)/.exec(href)![1];
      await page.emulateMedia({ media: "screen" });
      await page.goto(`/pass/${id}/print`);
      await expect(page.locator(".gp-sheet[data-fit]")).toHaveCount(1);
      await page.emulateMedia({ media: "print", colorScheme: "light" });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const fit = Number(await page.locator(".gp-sheet").getAttribute("data-fit"));
      test.info().annotations.push({ type: "note", description: `${id}: print scale ${fit}` });
      expect(fit, `${id} print scale`).toBeGreaterThanOrEqual(0.91);
      expect(pdfPages(await page.pdf({ preferCSSPageSize: true, printBackground: false })), `${id} Letter pages`).toBe(1);
    }
  });

  test("the examples link jumps to the examples", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "See a real example pass" }).click();
    await expect(page).toHaveURL(/#examples-title$/);
    await expect(page.getByRole("heading", { level: 2, name: "See a real pass now" })).toBeInViewport();
  });
});

test("/about: how a pass is made, measured numbers, Find This Spot, Lucky Finds not available yet", async ({ page }) => {
  const res = await page.goto("/about");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "About Grass Pass" })).toBeVisible();
  for (const h of ["How a pass is made", "Why open", "Privacy: what leaves your device", "Credits and licences"]) {
    await expect(page.getByRole("heading", { level: 2, name: h })).toBeVisible();
  }
  await expect(page.getByText(/Find This Spot/).first()).toBeVisible();
  await expect(page.getByText(/Lucky Finds .*not available yet/)).toBeVisible();
  await expect(page.getByRole("table").first()).toContainText("Gemma 4 31B");
});

test.describe("360 px phone", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  for (const path of ["/", "/about"]) {
    test(`${path} has no horizontal scroll and the header fits`, async ({ page }) => {
      await page.goto(path);
      await noHorizontalScroll(page);
      const header = page.getByRole("banner");
      const box = await header.boundingBox();
      expect(box?.width ?? 0).toBeLessThanOrEqual(360);
      await expect(page.getByRole("link", { name: "About" }).first()).toBeVisible();
    });
  }

  test("an example pass page has no horizontal scroll", async ({ page }) => {
    await page.goto("/");
    const link = page.getByRole("list", { name: "Example parks" }).getByRole("link").first();
    test.skip((await link.count()) === 0, "No example pass is ready yet (the first example test waits for one).");
    await link.click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await noHorizontalScroll(page);
  });
});
