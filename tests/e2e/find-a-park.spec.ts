import { expect, test } from "@playwright/test";

// F1 against the real server and the LIVE OpenStreetMap services (Nominatim + Overpass).
// Overpass can take 10-30 s when busy, so result waits are long. Each test makes at most two
// searches so the whole file stays under the 10 searches/minute per-IP limit.
const RESULT_TIMEOUT = 95_000;

test.describe.configure({ mode: "serial" });

test("empty submit: field error is focused, linked, announced, and clears on typing", async ({ page }) => {
  await page.goto("/");
  const form = page.getByRole("form", { name: "Find a park" });
  const input = form.getByLabel("Town, ZIP or park name");
  await form.getByRole("button", { name: "Find parks" }).click();

  const alert = form.getByRole("alert");
  await expect(alert).toHaveText("Type a town, ZIP or park name.");
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  const errorId = await alert.getAttribute("id");
  expect((await input.getAttribute("aria-describedby"))?.split(" ")).toContain(errorId);

  // A second failed submit re-mounts the alert (re-announced), still focused.
  await input.press("Enter");
  await expect(form.getByRole("alert")).toHaveText("Type a town, ZIP or park name.");
  await expect(input).toBeFocused();

  await input.pressSequentially("A");
  await expect(form.getByRole("alert")).toHaveCount(0);
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
});

test("keyboard only: 'Allen TX' lists real parks nearest first", async ({ page }) => {
  test.setTimeout(RESULT_TIMEOUT + 20_000);
  await page.goto("/");
  const input = page.getByLabel("Town, ZIP or park name");
  await input.focus();
  await page.keyboard.type("Allen TX");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("status").filter({ hasText: "Searching OpenStreetMap" })).toBeVisible();
  const heading = page.getByRole("heading", { name: /^Parks near Allen, Collin County, Texas/ });
  await expect(heading).toBeVisible({ timeout: RESULT_TIMEOUT });
  await expect(heading).toBeFocused();

  const list = page.getByRole("list", { name: /^Parks near Allen/ });
  const items = list.getByRole("button");
  await expect(items).toHaveCount(10);
  await expect(items.first()).toContainText(/ mi \(\d+(\.\d)? km\) away/);
  await expect(page.getByRole("link", { name: "© OpenStreetMap contributors" })).toBeVisible();

  // Tab reaches the first park; Enter picks it.
  await page.keyboard.press("Tab");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(items.first()).toHaveAttribute("aria-pressed", "true");
});

test("a park name puts that park first (Celebration Park, Allen TX)", async ({ page }) => {
  test.setTimeout(RESULT_TIMEOUT + 20_000);
  await page.goto("/");
  await page.getByLabel("Town, ZIP or park name").fill("Celebration Park Allen TX");
  await page.getByRole("button", { name: "Find parks" }).click();
  const list = page.getByRole("list", { name: /^Parks near Celebration Park/ });
  await expect(list.getByRole("button").first()).toContainText("Celebration Park", { timeout: RESULT_TIMEOUT });
});

test("a place that doesn't exist shows the exact no-match copy on the field", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  const form = page.getByRole("form", { name: "Find a park" });
  const input = form.getByLabel("Town, ZIP or park name");
  await input.fill("zzqxjv nowhere plorf");
  await input.press("Enter");
  await expect(form.getByRole("alert")).toHaveText("We couldn't find that place. Try a town name or ZIP.", { timeout: 30_000 });
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-invalid", "true");
});

test.describe("Use my location", () => {
  test.use({ geolocation: { latitude: 33.0851102, longitude: -96.7020718 }, permissions: ["geolocation"] });

  test("sends only a 2-decimal location and lists parks near you", async ({ page }) => {
    test.setTimeout(RESULT_TIMEOUT + 20_000);
    await page.goto("/");
    const request = page.waitForRequest((r) => r.url().includes("/api/parks?"));
    await page.getByRole("button", { name: "Use my location" }).click();
    const url = new URL((await request).url());
    expect(url.searchParams.get("lat")).toBe("33.09");
    expect(url.searchParams.get("lng")).toBe("-96.70");
    expect(url.searchParams.get("q")).toBeNull();
    await expect(page.getByRole("heading", { name: "Parks near your location" })).toBeVisible({ timeout: RESULT_TIMEOUT });
    await expect(page.getByRole("list", { name: "Parks near your location" }).getByRole("button").first()).toBeVisible();
  });
});

test.describe("Use my location, blocked", () => {
  test.use({ permissions: [] });

  test("explains the block and offers the text search", async ({ page, context }) => {
    await context.clearPermissions();
    await page.goto("/");
    const button = page.getByRole("button", { name: "Use my location" });
    await button.click();
    const alert = page.getByRole("alert").filter({ hasText: "location" });
    await expect(alert).toContainText(/Type a town or ZIP instead|Try again, or type a town or ZIP/);
    const errorId = await alert.getAttribute("id");
    expect((await button.getAttribute("aria-describedby"))?.split(" ")).toContain(errorId);
  });
});
