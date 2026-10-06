import { expect, test } from "@playwright/test";

// Audit round 1 checks that need no live data: the skip link, 404s, the 360 px example row, the
// in-process pre-limiter, and park search as a POST.

test("the first Tab stop is a skip link that moves focus to the main content", async ({ page }) => {
  for (const path of ["/", "/about"]) {
    await page.goto(path);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible(); // visible while focused
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  }
});

test("unknown addresses and unknown pass ids answer HTTP 404 with a page that explains it", async ({ page }) => {
  const nowhere = await page.goto("/no-such-page");
  expect(nowhere?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();

  for (const path of ["/pass/bogus-id", "/pass/w1-6to10-20200101-1/print"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "No pass here" })).toBeVisible();
  }
});

test("park search is a POST with a JSON body; the old GET with ?q= is gone", async ({ request, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const get = await request.get("/api/parks?q=Allen%20TX", { headers: { origin } });
  expect(get.status()).toBe(405);
  // Bad input is refused before any upstream call (no OpenStreetMap request is made for this).
  const bad = await request.post("/api/parks", { headers: { origin, "content-type": "application/json" }, data: { q: "a" } });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error.field).toBe("q");
  const form = await request.post("/api/parks", { headers: { origin, "content-type": "text/plain" }, data: "q=Allen" });
  expect(form.status()).toBe(415);
});

test("the pre-limiter answers 429 with Retry-After before the store is touched", async ({ request }) => {
  // Its own forwarded address, so the other tests' shared bucket is not used up. The e2e server runs
  // with PRELIMIT_BURST=300 and PRELIMIT_PER_SEC=2 (playwright.config.ts); the defaults are 40 and 4.
  const headers = { "x-forwarded-for": "192.0.2.250" };
  const burst = Number(process.env.PRELIMIT_BURST ?? 300);
  const answers = await Promise.all(Array.from({ length: burst + 40 }, () => request.get("/api/nothing-here", { headers })));
  const limited = answers.filter((r) => r.status() === 429);
  expect(limited.length).toBeGreaterThan(0);
  const r = limited[0];
  expect(Number(r.headers()["retry-after"])).toBeGreaterThan(0);
  expect((await r.json()).error.code).toBe("RATE_LIMITED");
  // SEC-2-01: pages have their own bucket (e2e: PRELIMIT_PAGE_BURST=300). Pass ids that can't exist
  // cost no store read, so flooding them is cheap here; past the burst a page is refused as plain text
  // without being rendered.
  const pageBurst = Number(process.env.PRELIMIT_PAGE_BURST ?? 300);
  const pages = await Promise.all(Array.from({ length: pageBurst + 40 }, (_, i) => request.get(`/pass/not-a-pass-${i}`, { headers })));
  const limitedPage = pages.find((p) => p.status() === 429);
  expect(limitedPage).toBeDefined();
  if (!limitedPage) return;
  // UX-5-02: a styled page in the site's voice (with the wait and a way home), not plain text.
  expect(limitedPage.headers()["content-type"]).toMatch(/text\/html/);
  expect(await limitedPage.text()).toMatch(/Please wait about \d+ seconds?, then try again/);
});

test.describe("360 px phone", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("ready example passes are one tap away above the fold (or the row is absent when none is ready)", async ({ page }) => {
    await page.goto("/");
    const row = page.getByRole("navigation", { name: "Open an example pass" });
    const ready = await page.getByRole("list", { name: "Example parks" }).getByRole("link").count();
    if (ready === 0) {
      await expect(row).toHaveCount(0);
      return;
    }
    await expect(row).toBeVisible();
    const box = await row.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(740);
    await expect(row.getByRole("link")).toHaveCount(ready);
  });
});
