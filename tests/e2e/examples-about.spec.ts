import { expect, test, type Page } from "@playwright/test";
import { HERO_FINDS } from "@/lib/home/showcase";

// S8b: pre-warmed example parks, /about, and 360 px smoke. Example passes are made by the server at start-up
// from LIVE data (OpenStreetMap, iNaturalist, the open model), so the first test waits for them.

const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test.describe("example parks", () => {
  test.describe.configure({ mode: "serial" });

  test("home lists the example parks; a ready one opens a real pass in under 3 s", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: "See a real pass, right now." })).toBeVisible();
    // Kevin 2026-10-07: only parks with a ready pass are listed; with none ready the section says "No data available".
    const none = page.getByTestId("examples-none");
    if (await none.isVisible()) {
      await expect(none).toContainText(/^No data available: \S.{10,}/);
      test.skip(true, `No example pass is ready; the section says: ${await none.textContent()}`);
    }
    const list = page.getByRole("list", { name: "Example parks" });
    const count = await list.locator(":scope > li").count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(4);
    // Every listed park is a ready pass: one link per card, never a card that only explains itself.
    await expect(list.getByRole("link")).toHaveCount(count);
    const link = list.getByRole("link").first();
    await expect(link).toBeVisible();
    await expect(link).toContainText(/Made [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M C[DS]T/);
    const name = (await link.getByRole("heading", { level: 3 }).textContent())?.trim() ?? "";
    await expect(link).toContainText("See the pass");

    const started = Date.now();
    await link.click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    expect(Date.now() - started).toBeLessThan(3_000);
    await expect(page).toHaveURL(/\/pass\/[nwr]\d+-6to10-\d{8}-[1-3]\?example=1$/);
    await expect(page.getByText(/^Clues written [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M C[DS]T/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Print pass" })).toBeVisible();
  });

  test("R2-m9 + R2-m4: a complete park comes first, and every ready example prints on ONE page at scale >= 0.91", async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto("/");
    const list = page.getByRole("list", { name: "Example parks" });
    // Judge R7 T1: Oak Point replaced Connemara, and parks with a complete pass come first (ready cards before the rest).
    // Kevin 2026-10-07: only ready (complete) examples are listed at all, so every card is ready.
    await expect(list).toContainText("Oak Point Park and Nature Preserve");
    const order = await list.locator(":scope > li").evaluateAll((els) => els.map((e) => e.getAttribute("data-state") ?? ""));
    expect(order.length).toBeGreaterThan(0);
    expect(order.every((s) => s === "ready"), "only ready examples are listed").toBe(true);
    // Let the warm-up finish (cards say "making" while a pass is being made), so every example that CAN be
    // made is checked, not just the first one ready.
    const states = async () => list.locator(":scope > li").evaluateAll((els) => els.map((e) => e.getAttribute("data-state") ?? ""));
    for (let i = 0; i < 40 && (await states()).includes("making"); i++) {
      await page.waitForTimeout(5_000);
      await page.reload();
    }
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
      console.log(`example print: ${id} scale ${fit}`);
      expect(fit, `${id} print scale`).toBeGreaterThanOrEqual(0.91);
      expect(pdfPages(await page.pdf({ preferCSSPageSize: true, printBackground: false })), `${id} Letter pages`).toBe(1);
    }
  });

  test("v3: the header's Explore link jumps to the examples; the hero pass card is a real example or says why", async ({ page }) => {
    await page.goto("/");
    const card = page.getByTestId("hero-pass-card");
    await expect(card).toBeVisible();
    if ((await card.getAttribute("data-state")) === "ready") {
      await expect(card.getByRole("link", { name: /View pass/ })).toHaveAttribute("href", /^\/pass\/[nwr]\d+-6to10-\d{8}-[1-3]\?example=1$/);
      // Kevin (2026-10-07): the hero card shows HERO_FINDS finds (3 since his smaller card).
      await expect(card.getByRole("listitem")).toHaveCount(HERO_FINDS);
    } else {
      await expect(card).toContainText(/Example pass not ready yet: \S/);
    }
    for (const fake of ["Spot a monarch on the milkweed", "Live park feeds", "3.2 mi"]) await expect(page.getByText(fake)).toHaveCount(0);
    const sample = page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Explore", exact: true });
    if (await sample.isVisible()) {
      await sample.click();
      await expect(page).toHaveURL(/#parks$/);
      await expect(page.getByRole("heading", { level: 2, name: "See a real pass, right now." })).toBeInViewport();
    }
  });
});

test("/about: how a pass is made, measured numbers, Find This Spot, Lucky Finds and their free-plan limit", async ({ page }) => {
  const res = await page.goto("/about");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "An open model, a real park and a pencil." })).toBeVisible();
  for (const h of ["Measured, not promised.", "Open model. Real data. Rules in code.", "Details, one click away.", "Credits and licences"]) {
    await expect(page.getByRole("heading", { level: 2, name: h })).toBeVisible();
  }
  // v3: the summary is visible at once; the fine print is one click away (closed <details>).
  await expect(page.getByText(/Find This Spot/).first()).toBeVisible();
  await expect(page.getByText(/Lucky Finds run on a free plan/)).toBeHidden();
  await page.getByText("What did not pass yet (current limitations)").click();
  await expect(page.getByText(/Lucky Finds run on a free plan/)).toBeVisible();
  await page.getByText("Data sources and their licences").click();
  await expect(page.locator("details#sources-detail").getByText(/review text is never shown or sent to the AI/)).toBeVisible();
  await page.getByText("Why open: the full measured table").click();
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
