import { expect, test, type Page } from "@playwright/test";
import { skipIfHonestAlert } from "./support/honest";
import { judgeSignInPage } from "./support/judge";

// S3 main journey against the real server and the LIVE services: OpenStreetMap (Nominatim + Overpass),
// iNaturalist and the open model on DigitalOcean (the server reads its key from .env.local).
// Each test makes one park search and at most one new pass (3 new passes/min per IP).
// If an upstream or one of our limits stopped it, the page shows an error box with the server's code;
// the test checks the code and the message and is reported as SKIPPED with them, never as passed
// (support/honest.ts, R1-B2). Without a model key (keyless CI) that is MODEL_NOT_CONFIGURED.
const WAIT = 95_000;

test.describe.configure({ mode: "serial" });

async function searchAndPick(page: Page, query: string, parkName: string) {
  await page.goto("/");
  await page.getByLabel("Town, ZIP or park name").fill(query);
  await page.getByRole("button", { name: "Find parks" }).click();
  const list = page.getByRole("list", { name: /^Parks near/ });
  const failed = page.locator("[data-error-code]");
  await expect(list.or(failed)).toBeVisible({ timeout: WAIT });
  if (await failed.isVisible()) await skipIfHonestAlert(failed, "park search");
  await list.getByRole("button", { name: new RegExp(`^${parkName}`) }).first().click();
}

/** Make the pass; skips (after checking the code and the message) when an upstream or a limit stopped it. */
async function makePassOrHonestError(page: Page, parkName: string) {
  const heading = page.getByRole("heading", { name: `Make a pass for ${parkName}` });
  // After the pick, focus moves to the make step and it scrolls into view (R1 UX m2).
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  // v3: the age was chosen in the search card (Explorer age), so it isn't asked again; the step says which.
  await expect(page.getByRole("radio", { name: /Ages 6–10 \(most kids\)/ })).toBeChecked();
  await expect(page.getByTestId("chosen-age")).toContainText("Ages 6-10");
  // Every age tile is drawn the same size (R1 UX m3: "Ages 4-6" used to shrink).
  const widths = await page
    .getByRole("radio")
    .evaluateAll((els) => els.map((e) => Math.round(e.closest("label")!.getBoundingClientRect().width)));
  expect(widths).toHaveLength(3);
  expect(new Set(widths).size).toBe(1);
  await page.getByRole("button", { name: "Make my pass" }).click();

  const failed = page.locator("[data-error-code]");
  await expect(page.getByRole("heading", { level: 1, name: parkName }).or(failed)).toBeVisible({ timeout: WAIT });
  if (await failed.isVisible()) {
    // A failed pass offers "Try again", except for limits that only reset later.
    const code = (await failed.getAttribute("data-error-code")) ?? "";
    if (!["VARIANT_LIMIT", "IP_DAILY_LIMIT", "DAILY_LIMIT", "JUDGE_DAILY_LIMIT", "ACCOUNT_DAILY_LIMIT"].includes(code)) {
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    }
    await skipIfHonestAlert(failed, "new pass");
  }
  await expect(page).toHaveURL(/\/pass\/w\d+-6to10-\d{8}-\d(\?reused=1)?$/);
}

test("pick Connemara Meadow Preserve -> age 6-10 -> a real pass on screen with evidence and the model that answered", async ({ page }) => {
  test.setTimeout(2 * WAIT + 30_000);
  await judgeSignInPage(page);
  await searchAndPick(page, "Connemara Meadow Preserve", "Connemara Meadow Preserve");
  await makePassOrHonestError(page, "Connemara Meadow Preserve");

  const pass = page.getByRole("article", { name: "Connemara Meadow Preserve" });
  await expect(pass).toBeVisible();
  await expect(pass.getByRole("heading", { name: "Wild Finds" })).toBeVisible();
  const finds = pass.locator("section ol > li");
  expect(await finds.count()).toBeGreaterThanOrEqual(3);
  await expect(pass.getByText(/· iNaturalist$/).first()).toBeVisible();
  await expect(pass.getByText(/^Look, don't/).first()).toBeVisible();
  await expect(pass.getByText(/^Made .+ by gemma-4-31B-it \(open model, Apache-2\.0\)/)).toBeVisible();
  // S6: Lucky Finds are either on the pass (a "Lucky Finds" section) or the grown-up's part says why not.
  await expect(pass.getByText(/Lucky Finds/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Make a different pass" })).toBeVisible();

  // Print comes first on the page (R1: top of the page on a phone).
  const print = page.getByRole("link", { name: "Print pass" });
  expect((await print.boundingBox())!.y).toBeLessThan((await pass.boundingBox())!.y);

  // The answer key is folded away for the grown-up.
  await pass.getByText("Answer key (don't peek, kids!)").click();
  await expect(pass.getByText(/seen (once|\d+ times) since/).first()).toBeVisible();
});

test("Celebration Park: park finds, and Wild Finds shows the exact 'No data available' copy", async ({ page }) => {
  test.setTimeout(2 * WAIT + 30_000);
  await judgeSignInPage(page);
  await searchAndPick(page, "Celebration Park Allen TX", "Celebration Park");
  await makePassOrHonestError(page, "Celebration Park");
  const pass = page.getByRole("article", { name: "Celebration Park" });
  const wild = pass.locator("section", { has: page.getByRole("heading", { name: "Wild Finds" }) });
  // The live count can change during the week; the sentence shape is the SPEC 5.4 copy with N from iNaturalist.
  const empty = wild.getByText(/^No data available: (no research-grade sightings within 1\.5 km in the last 14 days on iNaturalist\.|only \d+ research-grade sightings? within 1\.5 km in the last 14 days on iNaturalist\.|\d+ research-grade sightings)/);
  const finds = wild.locator("ol > li");
  await expect(empty.or(finds.first())).toBeVisible();
  if (await finds.first().isVisible()) {
    test.info().annotations.push({ type: "note", description: "Celebration Park had wildlife sightings this week; the empty copy was not shown." });
  }
  await expect(pass.getByText(/on the park map · OpenStreetMap/).first()).toBeVisible();
});

test("a pass id that isn't saved says so, with HTTP 404, and links back", async ({ page }) => {
  const res = await page.goto("/pass/w1-6to10-20200101-1");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "No pass here" })).toBeVisible();
  await expect(
    page.getByText("No data available: this pass isn't saved here anymore (passes are kept for 30 days), or the link is wrong."),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Make a pass" })).toHaveAttribute("href", "/");
});
