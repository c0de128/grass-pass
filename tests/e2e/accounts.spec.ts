import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { skipIfHonestAlert } from "./support/honest";
import { judgeAddress } from "./support/judge";

// Accounts (Kevin, 2026-10-06), against the real server: signed out you can search, open passes and print, but a
// NEW pass asks a grown-up to sign in; "Try as a judge" signs in with one click (no OAuth), comes back to the same
// park + age, makes the pass, and reports finds; then sign out. Live data and the open model: an outside failure
// is checked and reported as SKIPPED with its code (support/honest.ts), never as passed.
// Round 4: judge demo reports are only logged (they never change a pass or the counts), so this spec is safe to run
// against a preview or production store; it checks that the counts don't move. Browsing signed out sets no cookie.
const WAIT = 95_000;
// Celebration Park: a smaller park (one model call when measured), to keep paid model calls low.
const PARK = "Celebration Park";
const QUERY = "Celebration Park Allen TX";
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

test.describe.configure({ mode: "serial" });
// SEC-4-02: this spec's own address for the judge demo's 3 passes per connection.
test.use(judgeAddress(4));

let passPath: string | null = null;

async function searchAndPick(page: Page) {
  await page.getByLabel("Town, ZIP or park name").fill(QUERY);
  await page.getByRole("button", { name: "Find parks" }).click();
  const list = page.getByRole("list", { name: /^Parks near/ });
  const failed = page.locator("[data-error-code]");
  await expect(list.or(failed)).toBeVisible({ timeout: WAIT });
  if (await failed.isVisible()) await skipIfHonestAlert(failed, "park search");
  await list.getByRole("button", { name: new RegExp(`^${PARK}`) }).first().click();
  // The wizard: "Who's exploring?" (6-10 by default), then Next to step 3.
  await page.getByRole("dialog", { name: "Who's exploring?" }).getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("dialog", { name: "Make your pass" })).toBeVisible();
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
  await expect(card.getByText("Sign-in is for grown-ups, not kids")).toBeVisible();
  await expect(page.getByRole("button", { name: "Make my pass" })).toHaveCount(0);
  // SEC-4-02: the real number of judge passes left today (from the store), never made up.
  await expect(card.getByTestId("judge-left")).toHaveText(/\d+ of \d+ judge passes left today|0 judge passes left today for your connection/);
  // SEC-4-04: browsing, searching and the sign-in card set no cookie at all.
  expect(await page.context().cookies()).toEqual([]);
  for (const path of ["/about", "/how-it-works", "/signin"]) {
    await page.goto(path);
    await expect(page.getByTestId("header-sign-in")).toBeVisible();
  }
  expect(await page.context().cookies()).toEqual([]);
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

  // SEC-4-05: the judge sign-in cookie lasts 1 day (from signing in), not 7 or 30.
  await expect.poll(async () => (await page.context().cookies()).some((c) => c.name.endsWith("authjs.session-token"))).toBe(true);
  const sessionCookie = (await page.context().cookies()).find((c) => c.name.endsWith("authjs.session-token"))!;
  expect(Math.abs(sessionCookie.expires - (Date.now() / 1000 + 24 * 3600))).toBeLessThan(300);

  // Back on the home page with the wizard reopened on step 3, the park and age restored, signed in.
  const dialog = page.getByRole("dialog", { name: "Make your pass" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByTestId("choice-ticket")).toContainText(PARK);
  await expect(page).toHaveURL(/\/#find$/);
  await expect(page.getByRole("button", { name: /Sign out/ })).toBeVisible();
  await expect(page.getByTestId("chosen-age")).toContainText("Ages 6-10");
  // UX-4-03: the sign-in is announced (polite status, also visible) and focus is on the next step.
  const note = page.getByTestId("signed-in-note");
  await expect(note).toHaveText("Signed in as a judge. You can make this pass now.");
  await expect(note).toHaveAttribute("role", "status");
  await expect(page.getByRole("button", { name: "Make my pass" })).toBeFocused();
  // Axe on the restored, signed-in pass maker (the note box sits on the muted fill).
  const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).include("#find").analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await page.getByRole("button", { name: "Make my pass" }).click();

  const failed = page.locator("[data-error-code]");
  await expect(page.getByRole("heading", { level: 1, name: PARK }).or(failed)).toBeVisible({ timeout: WAIT });
  if (await failed.isVisible()) await skipIfHonestAlert(failed, "judge new pass");
  await expect(page).toHaveURL(/\/pass\/w188145317-6to10-\d{8}-\d(\?reused=1)?$/);
  passPath = new URL(page.url()).pathname;

  // Report buttons on the screen pass (signed in). The counts as they are before the judge reports anything.
  await expect(page.getByTestId("report-intro")).toBeVisible();
  const statsBefore = await page.getByTestId("report-stats").allTextContents();
  const judgeAnswer = /Judge demo reports are logged for review, but they don't change the counts or passes\./;
  const find1 = page.getByRole("group", { name: "Report find 1" });
  // UX-7-03: the three buttons sit behind one "Report this find" disclosure per find.
  await find1.getByText("Report this find").click();
  await find1.getByRole("button", { name: "Found it" }).click();
  // UX-4-05: each judge browser has its own "already sent" check, so a judge's first click is never a dead end.
  await expect(find1.getByTestId("report-status")).toHaveText(judgeAnswer);
  await expect(find1.getByRole("button", { name: "Found it" })).toHaveAttribute("aria-pressed", "true");
  const find2 = page.getByRole("group", { name: "Report find 2" });
  await find2.getByText("Report this find").click();
  await find2.getByRole("button", { name: "Didn't find it" }).click();
  await expect(find2.getByTestId("report-status")).toHaveText(judgeAnswer);

  // "Not safe" asks once more first; Cancel sends nothing.
  const find3 = page.getByRole("group", { name: "Report find 3" });
  await find3.getByText("Report this find").click();
  await find3.getByRole("button", { name: "Not safe" }).click();
  await expect(find3.getByText(/Report find 3 as not safe\?/)).toBeVisible();
  await find3.getByRole("button", { name: "Cancel" }).click();
  await expect(find3.getByTestId("report-status")).toHaveText("");

  // SEC-4-01: the judge's reports never change the public counts (nor the pool, which uses the same data):
  // after a reload (the server forgets its 5-minute count memo when a report is counted) they are unchanged.
  await page.reload();
  await expect(page.getByTestId("report-intro")).toBeVisible();
  expect(await page.getByTestId("report-stats").allTextContents()).toEqual(statsBefore);

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
  // UX-5-05: signing in from /signin is announced (polite status), and the address is clean again.
  await expect(page.getByTestId("signin-announce")).toHaveText("Signed in as a judge. You can make a pass now.");
  await expect(page).toHaveURL(/\/$/);
  for (const path of ["/", "/about", "/how-it-works"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: /Sign out/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(0);
  }
});
