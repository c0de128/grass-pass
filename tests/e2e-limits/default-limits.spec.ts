import { expect, test, type Page, type Response } from "@playwright/test";

/**
 * SEC-3-01: at the DEFAULT limits (playwright.limits.config.ts starts its own server with no PRELIMIT_*
 * env), a visitor who clicks through home -> each ready example pass -> its print page -> home, three
 * times over, never gets a 429. Before the fix the 6th page view (about 15 s in) was refused, because
 * Next <Link> RSC prefetches spent page tokens too.
 *
 * Every request of the walk carries its own forwarded address, so nothing else on the server shares its
 * buckets. Where no example pass is ready (PREWARM_EXAMPLES=0, a keyless server), the walk opens real
 * pass ids for the example parks for today instead: the limiter charges a possible pass id the same
 * whether a pass is saved under it or not (src/lib/limits/prelimit.ts requestCost), and the page says
 * so honestly ("No pass here"). The test reports which walk it did.
 */
const WALK_IP = "198.51.100.231";
const FLOOD_IP = "198.51.100.232";
/** The example parks (src/lib/prewarm.ts EXAMPLE_PARKS), as pass ids for today's Chicago day. */
const EXAMPLE_WAYS = ["w38113837", "w460905359", "w188145317", "w306191453"];

function chicagoDay(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).replace(/-/g, "");
}

function watch(page: Page) {
  const refused: string[] = [];
  const prefetches: string[] = [];
  let requests = 0;
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (u.pathname === "/" || u.pathname.startsWith("/pass/")) {
      requests++;
      const h = req.headers();
      if (h["next-router-prefetch"] || h["purpose"] === "prefetch") prefetches.push(`${u.pathname}${u.search}`);
    }
  });
  page.on("response", (res: Response) => {
    if (res.status() === 429) refused.push(new URL(res.url()).pathname);
  });
  return { refused, prefetches, requests: () => requests };
}

test.describe("default limits (SEC-3-01)", () => {
  test.use({ extraHTTPHeaders: { "x-forwarded-for": WALK_IP } });

  test("home -> each example pass -> its print page -> home, three times, never 429, no prefetch of limited pages", async ({ page }) => {
    test.setTimeout(240_000);
    const w = watch(page);

    await page.goto("/");
    const ready = await page
      .getByRole("list", { name: "Example parks" })
      .getByRole("link")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? "").filter((h) => h.startsWith("/pass/")));
    const day = chicagoDay();
    const passPaths = ready.length > 0 ? ready.map((h) => h.split("?")[0]) : EXAMPLE_WAYS.map((way) => `/pass/${way}-6to10-${day}-1`);
    test.info().annotations.push({
      type: "walk",
      description:
        ready.length > 0
          ? `${ready.length} ready example passes, clicked from the home page`
          : "No example pass is ready on this server (PREWARM_EXAMPLES=0 or no model key): walked the example parks' pass ids for today, which the page answers with 'No pass here' and the limiter charges the same",
    });

    let views = 1;
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < passPaths.length; i++) {
        if (ready.length > 0) {
          await page.getByRole("list", { name: "Example parks" }).getByRole("link").nth(i).click();
          await expect(page).toHaveURL(/\/pass\/[nwr]\d+-/);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await page.getByRole("link", { name: "Print pass" }).click();
          await expect(page).toHaveURL(/\/print\?print=1$/);
        } else {
          const res = await page.goto(passPaths[i]);
          expect(res?.status(), passPaths[i]).toBe(404);
          await expect(page.getByRole("heading", { level: 1, name: "No pass here" })).toBeVisible();
          const print = await page.goto(`${passPaths[i]}/print?print=1`);
          expect(print?.status(), `${passPaths[i]}/print`).toBe(404);
        }
        views += 2;
        // Home through the header link (a client-side navigation, like a person).
        await page.getByRole("link", { name: "Grass Pass home" }).click();
        await expect(page).toHaveURL(/\/$/);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        views += 1;
        await page.waitForTimeout(500);
      }
    }

    expect(w.refused, `429 answers during the walk (${views} page views, ${w.requests()} page requests)`).toEqual([]);
    expect(w.prefetches, "RSC prefetches of rate-limited pages").toEqual([]);
    expect(views).toBeGreaterThanOrEqual(25);
  });
});

test("the server runs the DEFAULT page limit (a flood of 200 requests from one address is cut at about 120)", async ({ request }) => {
  // Impossible pass ids: no store read (cost 0), so only the page request bucket is tested.
  let ok = 0;
  let refused = 0;
  for (let i = 0; i < 200; i++) {
    const res = await request.get(`/pass/not-a-pass-${i}`, { headers: { "x-forwarded-for": FLOOD_IP }, maxRedirects: 0 });
    if (res.status() === 429) refused++;
    else ok++;
  }
  expect(refused, "this server must run the default PRELIMIT_PAGE_* (120 + 2/s), not the raised e2e values").toBeGreaterThan(0);
  expect(ok).toBeGreaterThanOrEqual(120);
});
