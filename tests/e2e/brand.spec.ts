import { expect, test } from "@playwright/test";

// S1 brand + design system: assets are served, metadata points at them, fonts load, dark mode works.

test("brand assets are served with the right types", async ({ request }) => {
  const assets: Array<[string, RegExp]> = [
    ["/favicon.ico", /image\/(x-icon|vnd\.microsoft\.icon)/],
    ["/icon-32.png", /image\/png/],
    ["/apple-touch-icon.png", /image\/png/],
    ["/icon-192.png", /image\/png/],
    ["/icon-512.png", /image\/png/],
    ["/og-1200x630.png", /image\/png/],
    ["/dev-cover-1000x420.png", /image\/png/],
    ["/logo-header.svg", /image\/svg\+xml/],
    ["/logo-header-dark.svg", /image\/svg\+xml/],
    ["/logo-print-1c.svg", /image\/svg\+xml/],
    ["/brand/explorer-scene.svg", /image\/svg\+xml/],
    ["/brand/explorer-scene-dark.svg", /image\/svg\+xml/],
    ["/manifest.webmanifest", /application\/manifest\+json/],
  ];
  for (const [path, type] of assets) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()["content-type"], path).toMatch(type);
  }
});

test("page metadata links the icons and the share image", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/apple-touch-icon.png");
  await expect(page.locator('link[rel="icon"][href^="/favicon.ico"]')).toHaveCount(1);
  const og = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(og).toMatch(/^https?:\/\/[^/]+\/og-1200x630\.png$/);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
});

test("header shows the logo, brand fonts load, and the grass strip is hidden from screen readers", async ({ page }) => {
  await page.goto("/");
  const home = page.getByRole("link", { name: "Grass Pass home" });
  await expect(home).toBeVisible();
  await expect(home.locator("img.only-light")).toBeVisible();
  await expect(home.locator("img.only-dark")).toBeHidden();
  await expect(page.getByTestId("grass-divider").first()).toHaveAttribute("aria-hidden", "true");
  const h1Font = await page.getByRole("heading", { level: 1 }).evaluate((el) => getComputedStyle(el).fontFamily);
  expect(h1Font).toMatch(/Fredoka/i);
  const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(bodyFont).toMatch(/Nunito/i);
  // The self-hosted font files really load (not just the fallback stack).
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replaceAll(/["']/g, ""));
  });
  expect(loaded).toEqual(expect.arrayContaining(["Fredoka", "Nunito"]));
});

test("dark mode follows the system and the switch remembers a choice", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();
  await page.goto("/");
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await bg()).toBe("rgb(41, 80, 49)"); // --ticket
  const toggle = page.getByRole("button", { name: "Dark mode" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: "Grass Pass home" }).locator("img.only-dark")).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(await bg()).toBe("rgb(250, 243, 225)"); // --paper
  await page.reload();
  await expect(page.getByRole("button", { name: "Dark mode" })).toHaveAttribute("aria-pressed", "false");
  expect(await bg()).toBe("rgb(250, 243, 225)");
  await context.close();
});

test("keyboard focus is visible on the header controls", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement as Element);
    return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor };
  });
  expect(outline.style).toBe("solid");
  expect(outline.width).toBe("3px");
  expect(outline.color).toBe("rgb(47, 82, 51)"); // --forest
});
