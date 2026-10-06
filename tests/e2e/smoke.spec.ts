import { expect, test } from "@playwright/test";

// The landing page loads cleanly with the security headers and the park search form.
// The main-journey e2e (example park -> pass -> print) is added with S3/S4/S8.

test("landing page loads with headers, no console errors and no CSP issues", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  // Chrome reports some CSP violations (e.g. eval) only in the Issues panel, not the console.
  const cdp = await page.context().newCDPSession(page);
  const issues: string[] = [];
  cdp.on("Audits.issueAdded", (e) => issues.push(JSON.stringify(e.issue)));
  await cdp.send("Audits.enable");

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  const headers = response!.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-powered-by"]).toBeUndefined();

  await expect(page.getByRole("heading", { level: 1, name: "Family time is back, powered by AI." })).toBeVisible();
  await expect(page.getByText(/^We turn your local park into a real-world treasure hunt/)).toBeVisible();
  await expect(page.getByRole("form", { name: "Find a park" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
  expect(issues.filter((i) => /ContentSecurityPolicy|csp/i.test(i))).toEqual([]);
});

test("fits a 360 px screen with no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
