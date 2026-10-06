import { expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Accounts: sign in to the shared judge demo account, the way a judge does (no OAuth needed).
 * - `judgeSignInPage`: open /signin and press "Try as a judge" (the server action), back on `/`.
 * - `judgeSignInRequest`: for API-only specs, Auth.js's own CSRF-protected form post
 *   (GET /api/auth/csrf, then POST /api/auth/callback/judge); the request context keeps the cookie.
 * SEC-4-02: one connection gets at most 3 judge passes a day, and every local test browser is one address,
 * so each spec that makes judge passes sends its own test address (`judgeAddress`, x-forwarded-for).
 */
export const judgeAddress = (n: number) => ({ extraHTTPHeaders: { "x-forwarded-for": `10.70.0.${n}` } });
export async function judgeSignInPage(page: Page): Promise<void> {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Try as a judge" }).click();
  await expect(page).toHaveURL(/\/(#find)?$/);
  await expect(page.getByRole("button", { name: /Sign out/ })).toBeVisible();
}

export async function judgeSignInRequest(request: APIRequestContext, baseURL: string): Promise<void> {
  const csrf = (await (await request.get("/api/auth/csrf")).json()) as { csrfToken: string };
  const res = await request.post("/api/auth/callback/judge", {
    form: { csrfToken: csrf.csrfToken, callbackUrl: `${new URL(baseURL).origin}/` },
    headers: { origin: new URL(baseURL).origin },
    maxRedirects: 0,
  });
  expect([200, 302, 303]).toContain(res.status());
  const me = (await (await request.get("/api/me")).json()) as { signedIn?: boolean; provider?: string };
  expect(me.provider, "judge sign-in").toBe("judge");
}
