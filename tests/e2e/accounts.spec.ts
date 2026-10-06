import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { skipIfHonestAlert } from "./support/honest";

// Accounts (Kevin, 2026-10-06), against the real server: signed out you can search, open passes and print, but a
// NEW pass asks a grown-up to sign in; "Try as a judge" signs in with one click (no OAuth), comes back to the same
// park + age, makes the pass, and reports finds; then sign out. Live data and the open model: an outside failure
// is checked and reported as SKIPPED with its code (support/honest.ts), never as passed.
const WAIT = 95_000;
// Celebration Park: a smaller park (one model call when measured), to keep paid model calls low.
const PARK = "Celebration Park";
const QUERY = "Celebration Park Allen TX";
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

test.describe.configure({ mode: "serial" });

let passPath: string | null = null;

async function searchAndPick(page: Page) {
  await page.getByLabel("Town, ZIP or park name").fill(QUERY);
  await page.getByRole("button", { name: "Find parks" }).click();
  const list = page.getByRole("list", { name: /^Parks near/ });
  const failed = page.locator("[data-error-code]");
  await expect(list.or(failed)).toBeVisible({ timeout: WAIT });
  if (await failed.isVisible()) await skipIfHonestAlert(failed, "park search");
  await list.getByRole("button", { name: new RegExp(`^${PARK}`) }).first().click();
}

async function axeClean(browser: Browser, path: string, signedInState: Awaited<ReturnType<BrowserContext["storageState"]>> | undefined, ready: (p: Page) => Promise<void>) {
  for (const width of [360, 1280]) {
    for (const scheme of ["light", "dark"] as const) {
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width, height: 900 }, storageState: signedInState });
      const page = await context.newPage();
      await page.goto(path);
      await ready(page);
      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      expect(results.violations.map((v) => `${width}/${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} sideways scroll at ${width}px`).toBeLessThanOrEqual(0);
      await context.close();
    }
  }
}

test("signed out: a new pass asks a grown-up to sign in (card with Try as a judge); the API says 401", async ({ page, request, baseURL }) => {
  test.setTimeout(WAIT + 30_000);
  const api = await request.post("/api/pass", {
    headers: { "content-type": "application/json", origin: new URL(baseURL!).origin },
    data: { parkId: "way/306191453", ageBand: "10-13", fresh: true },
  });
  expect(api.status()).toBe(401);
  expect(((await api.json()) as { error: { code: string } }).error.code).toBe("SIGN_IN_REQUIRED");

  await page.goto("/");
  await expect(page.getByTestId("header-sign-in")).toBeVisible();
  await searchAndPick(page);
  const card = page.getByTestId("sign-in-card");
  await expect(card.getByRole("heading", { name: "Sign in to make this pass" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Try as a judge" })).toBeVisible();
  await expect(card.getByText("We only keep a scrambled ID")).toBeVisible();
  await expect(card.getByText("Sign-in is for parents and teachers")).toBeVisible();
  await expect(page.getByRole("button", { name: "Make my pass" })).toHaveCount(0);
});

test("the sign-in card has no axe violations and no sideways scroll (360/1280, light/dark)", async ({ browser }) => {
  test.setTimeout(120_000);
  await axeClean(browser, "/signin", undefined, async (p) => {
    await expect(p.getByTestId("sign-in-card").getByRole("button", { name: "Try as a judge" })).toBeVisible();
    await expect(p.getByTestId("header-sign-in")).toBeVisible();
  });
});

test("judge: Try as a judge -> back to the same park + age -> make the pass -> report found / didn't find -> sign out", async ({ page, browser }) => {
  test.setTimeout(2 * WAIT + 120_000);
  await page.goto("/");
  await searchAndPick(page);
  await page.getByTestId("sign-in-card").getByRole("button", { name: "Try as a judge" }).click();

  // Back on the home page with the park and age restored, signed in.
  await expect(page.getByRole("heading", { name: `Make a pass for ${PARK}` })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/#find$/);
  await expect(page.getByRole("button", { name: /Sign out/ })).toBeVisible();
  await expect(page.getByTestId("chosen-age")).toContainText("Ages 6-10");
  await page.getByRole("button", { name: "Make my pass" }).click();

  const failed = page.locator("[data-error-code]");
  await expect(page.getByRole("heading", { level: 1, name: PARK }).or(failed)).toBeVisible({ timeout: WAIT });
  if (await failed.isVisible()) await skipIfHonestAlert(failed, "judge new pass");
  await expect(page).toHaveURL(/\/pass\/w188145317-6to10-\d{8}-\d(\?reused=1)?$/);
  passPath = new URL(page.url()).pathname;

  // Report buttons on the screen pass (signed in).
  await expect(page.getByTestId("report-intro")).toBeVisible();
  const find1 = page.getByRole("group", { name: "Report find 1" });
  await find1.getByRole("button", { name: "Found it" }).click();
  await expect(find1.getByTestId("report-status")).toHaveText(/Thanks — counted\.|You already reported this item today/);
  await expect(find1.getByRole("button", { name: "Found it" })).toHaveAttribute("aria-pressed", "true");
  const find2 = page.getByRole("group", { name: "Report find 2" });
  await find2.getByRole("button", { name: "Didn't find it" }).click();
  await expect(find2.getByTestId("report-status")).toHaveText(/Thanks — counted\.|You already reported this item today/);

  // "Not safe" asks once more first; Cancel sends nothing.
  const find3 = page.getByRole("group", { name: "Report find 3" });
  await find3.getByRole("button", { name: "Not safe" }).click();
  await expect(find3.getByText(/Report find 3 as not safe\?/)).toBeVisible();
  await find3.getByRole("button", { name: "Cancel" }).click();
  await expect(find3.getByTestId("report-status")).toHaveText("");

  // The real count shows after a reload.
  await page.reload();
  await expect(page.getByTestId("report-stats").first()).toHaveText(/^Visitor reports, last 30 days: (\d+ found it|\d+ didn't)/);

  // Axe on the pass page with report buttons, signed in, at both widths and schemes.
  const state = await page.context().storageState();
  await axeClean(browser, passPath, state, async (p) => {
    await expect(p.getByRole("group", { name: "Report find 1" })).toBeVisible();
  });

  // Sign out from the header: the report buttons go away, the pass stays.
  await page.getByRole("button", { name: /Sign out/ }).click();
  await expect(page.getByTestId("header-sign-in")).toBeVisible();
  await page.goto(passPath);
  await expect(page.getByRole("heading", { level: 1, name: PARK })).toBeVisible();
  await expect(page.getByRole("group", { name: "Report find 1" })).toHaveCount(0);
  await expect(page.getByTestId("report-intro").getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("signed out: anyone can open that pass, print it, and open the examples' links", async ({ page }) => {
  test.skip(passPath === null, "no pass was made in the judge test (it was skipped with an honest reason)");
  const res = await page.goto(passPath!);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: PARK })).toBeVisible();
  await page.getByRole("link", { name: "Print pass" }).click();
  await expect(page).toHaveURL(/\/print\?print=1$/);
  await expect(page.locator(".gp-sheet")).toHaveCount(1);
  // "Make a different pass" is a new pass: the sign-in card shows instead of a request.
  await page.goto(passPath!);
  await page.getByRole("button", { name: "Make a different pass" }).click();
  await expect(page.getByTestId("sign-in-card").getByRole("heading", { name: "Sign in to make a different pass" })).toBeVisible();
});

test("the header's sign-in / sign-out control fits a 320 px phone (no sideways scroll), signed out and as the judge", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  for (const path of ["/", "/about", "/how-it-works"]) {
    await page.goto(path);
    await expect(page.getByTestId("header-sign-in")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(0);
  }
  await page.goto("/signin");
  await page.getByTestId("sign-in-card").getByRole("button", { name: "Try as a judge" }).click();
  await expect(page.getByRole("button", { name: /Sign out/ })).toBeVisible();
  for (const path of ["/", "/about", "/how-it-works"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: /Sign out/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(0);
  }
});
