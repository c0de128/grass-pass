import { expect, test } from "@playwright/test";
import { skipIfHonestAlert } from "./support/honest";
import { judgeAddress } from "./support/judge";

/**
 * The free pass against the REAL server and its REAL cookie (Kevin, 2026-10-08). Signed out, step 3 for Celebration Park
 * (its map is saved in the repo, src/data/osm), "Make my pass" with no sign-in. On a keyless server (CI, `pnpm e2e`
 * without a model key) the build reads the live iNaturalist sightings and then stops with MODEL_NOT_CONFIGURED: no
 * model and no SerpApi call is ever made. Started upstream calls use the free pass (the same rule as an account's pass),
 * so the server's signed receipt comes back, the page posts it, and the server sets the httpOnly cookie. Then the
 * second try is the sign-in step, and a reload still knows (the server reads the cookie).
 * A park without enough data, or a busy outside service, is reported as SKIPPED with its code (support/honest.ts).
 */
const WAIT = 95_000;
const RESUME_KEY = "grass-pass:resume";
const CELEBRATION = { id: "way/188145317", name: "Celebration Park", kind: "park", lat: 33.10824, lng: -96.62468, distanceM: 120 };

test.use(judgeAddress(43));

test("signed out: the free pass sets ONE signed httpOnly cookie (date + count) only when used; the next try asks to sign in, also after a reload", async ({ page }) => {
  test.setTimeout(WAIT + 60_000);
  const resume = async () => {
    await page.goto("/");
    await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [RESUME_KEY, JSON.stringify({ park: CELEBRATION, band: "6-10" })]);
    await page.goto("/?resume=1", { waitUntil: "load" });
    const dialog = page.getByTestId("pass-wizard");
    await expect(dialog).toHaveAccessibleName("Make your pass", { timeout: 20_000 });
    return dialog;
  };

  let dialog = await resume();
  // Browsing so far set no cookie.
  expect(await page.context().cookies()).toEqual([]);
  await expect(dialog.getByTestId("passes-left")).toContainText("you have 1 free pass left today");
  await dialog.getByRole("button", { name: "Make my pass" }).click();

  const usedStep = dialog.getByTestId("sign-in-card").getByRole("heading", { name: "You used today's free pass" });
  const failed = dialog.locator("[data-error-code]");
  const empty = dialog.getByTestId("other-parks");
  await expect(usedStep.or(empty).or(failed).first()).toBeVisible({ timeout: WAIT });
  if (await empty.isVisible()) test.skip(true, "EMPTY: Celebration Park had too little live data just now (that never uses the free pass)");
  if (!(await usedStep.isVisible())) await skipIfHonestAlert(failed, "free pass");

  // The cookie: one, httpOnly, SameSite=Lax, only the Chicago date and a count (+ the signature), gone by tomorrow.
  await expect.poll(async () => (await page.context().cookies()).filter((c) => c.name.endsWith("gp-free")).length).toBe(1);
  const cookies = await page.context().cookies();
  expect(cookies.map((c) => c.name)).toEqual(["gp-free"]);
  const c = cookies[0];
  expect(c.httpOnly).toBe(true);
  expect(c.sameSite).toBe("Lax");
  expect(c.path).toBe("/");
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).replace(/-/g, "");
  expect(c.value).toMatch(new RegExp(`^v1\\.${day}\\.1\\.[A-Za-z0-9_-]{43}$`));
  const left = c.expires - Date.now() / 1000;
  expect(left).toBeGreaterThan(0);
  expect(left).toBeLessThanOrEqual(25 * 3600);
  // The page can't read it (httpOnly).
  expect(await page.evaluate(() => document.cookie.includes("gp-free"))).toBe(false);
  // The server counts it: no free pass left.
  const r = await page.request.get("/api/passes-left");
  expect(await r.json()).toEqual({ kind: "free", free: 1, left: 0, perDay: 5 });
  await expect(dialog.getByRole("button", { name: "Make my pass" })).toHaveCount(0);

  // A reload: the server reads the cookie and goes straight to the sign-in step.
  dialog = await resume();
  await expect(dialog.getByTestId("sign-in-card").getByRole("heading", { name: "You used today's free pass" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Make my pass" })).toHaveCount(0);
  await expect(dialog.getByTestId("sign-in-card").getByRole("button", { name: "Try as a judge" })).toBeVisible();
});
