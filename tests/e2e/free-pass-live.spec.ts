import { expect, test } from "@playwright/test";
import { FREE_PASSES_PER_DAY } from "@/lib/accounts/config";
import { skipIfHonestAlert } from "./support/honest";
import { judgeAddress } from "./support/judge";

/**
 * The free pass against the REAL server and its REAL cookie (Kevin, 2026-10-08). Signed out, step 3 for Celebration Park
 * (its map is saved in the repo, src/data/osm), "Make my pass" with no sign-in.
 *
 * What the app really does (src/components/pass/PassMaker.tsx, usePassRequest.ts, src/app/api/pass/route.ts, src/lib/pass/make.ts):
 * - the free pass is charged only when a PAID model call really starts (round 11, Q-11-01); the cookie comes on the
 *   response, or as a signed receipt on the last stream line that the page posts to POST /api/free-pass BEFORE it shows
 *   the outcome;
 * - a pass that is made shows the ready moment and then OPENS the pass page by itself (no sign-in card in between);
 * - a pass whose paid call started and then failed shows the failure AND the sign-in step (the free pass is used);
 * - a failure BEFORE any paid call (a busy map or wildlife service, or a keyless server: CI and `pnpm e2e` without a
 *   model key stop with MODEL_NOT_CONFIGURED) uses nothing: no cookie, still 1 free pass left, "Make my pass" still
 *   there. The second test checks exactly that, keyless; the first one then SKIPS honestly (its cookie part needs a
 *   paid model call that starts, so it runs only on a server with a model key).
 * - other honest SKIPS (support/honest.ts): a park with too little data (EMPTY), and a pass someone already made today
 *   (served free, nothing to count).
 * Then the NEXT try is the sign-in step: "Make a different pass" on the pass page (or the wizard itself after a charged
 * failure), and again after a full reload of the home page (the server reads the cookie).
 */
const WAIT = 95_000;
const RESUME_KEY = "grass-pass:resume";
const CELEBRATION = { id: "way/188145317", name: "Celebration Park", kind: "park", lat: 33.10824, lng: -96.62468, distanceM: 120 };
const USED = "You used today's free pass";

test.describe("the free pass is charged", () => {
  test.use(judgeAddress(53));

  test("signed out: the free pass sets ONE signed httpOnly cookie (date + count) only when used; the next try asks to sign in, also after a reload", async ({ page }) => {
    test.setTimeout(WAIT + 90_000);
    const resume = async () => {
      await page.goto("/");
      await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [RESUME_KEY, JSON.stringify({ park: CELEBRATION, band: "6-10" })]);
      await page.goto("/?resume=1", { waitUntil: "load" });
      const dialog = page.getByTestId("pass-wizard");
      await expect(dialog).toHaveAccessibleName("Make your pass", { timeout: 20_000 });
      return dialog;
    };
    const freeCookies = async () => (await page.context().cookies()).filter((c) => c.name.endsWith("gp-free"));

    let dialog = await resume();
    // Browsing so far set no cookie.
    expect(await page.context().cookies()).toEqual([]);
    await expect(dialog.getByTestId("passes-left")).toContainText(`you have ${FREE_PASSES_PER_DAY} free pass left today`);
    await dialog.getByRole("button", { name: "Make my pass" }).click();

    // Wait for the real outcome. Polled every 250 ms: the ready moment lasts READY_PAUSE_MS (1.6 s) before the pass opens.
    const ready = dialog.getByTestId("pass-ready");
    const failed = dialog.locator("[data-error-code]");
    const empty = dialog.getByTestId("other-parks");
    const onPassPage = () => new URL(page.url()).pathname.startsWith("/pass/");
    const outcome = async (): Promise<"opened" | "ready" | "failed" | "empty" | "waiting"> => {
      if (onPassPage()) return "opened";
      if (await ready.isVisible().catch(() => false)) return "ready";
      if (await failed.first().isVisible().catch(() => false)) return "failed";
      if (await empty.isVisible().catch(() => false)) return "empty";
      return "waiting";
    };
    await expect.poll(outcome, { timeout: WAIT, intervals: [250] }).not.toBe("waiting");
    const first = await outcome();
    if (first === "empty") test.skip(true, "EMPTY: Celebration Park had too little live data just now (that never uses the free pass)");

    if (first === "failed" && (await freeCookies()).length === 0) {
      // Nothing paid started (MODEL_NOT_CONFIGURED keyless, a busy map service): no free pass used, no cookie. The second
      // test below checks this path; the cookie part of this one needs a paid model call that starts.
      expect(await page.context().cookies()).toEqual([]);
      await skipIfHonestAlert(failed.first(), "free pass (nothing paid started, so nothing was charged; the cookie part needs a model key)");
    }

    if (first === "ready" || first === "opened") {
      // A made pass opens by itself (Q-8-03 auto-open); wait for the pass page.
      await expect(page).toHaveURL(/\/pass\//, { timeout: 15_000 });
      if (new URL(page.url()).searchParams.get("reused") === "1") {
        // Someone already made this pass today: it is served to anyone and costs nothing, so no free pass is counted.
        expect(await freeCookies()).toEqual([]);
        test.skip(true, "CACHED: a Celebration Park pass for this age was already made today (served free, the free pass stays unused)");
      }
    }

    // The cookie: one, httpOnly, SameSite=Lax, only the Chicago date and a count (+ the signature), gone by tomorrow.
    // usePassRequest posts the receipt before it shows the outcome, so it is already set here.
    await expect.poll(async () => (await freeCookies()).length).toBe(1);
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
    // The server counts it: no free pass left (perDay is the server's ACCOUNT_DAILY_PASSES, so only its shape is checked).
    const r = await page.request.get("/api/passes-left");
    const body = (await r.json()) as { kind: string; free: number; left: number; perDay: number };
    expect(body).toMatchObject({ kind: "free", free: FREE_PASSES_PER_DAY, left: 0 });
    expect(Number.isInteger(body.perDay) && body.perDay >= 1).toBe(true);

    // The NEXT try, without a reload: the sign-in step, and no new pass request.
    let passPosts = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && new URL(req.url()).pathname === "/api/pass") passPosts += 1;
    });
    if (onPassPage()) {
      await page.getByRole("button", { name: "Make a different pass" }).click();
      await expect(page.getByTestId("sign-in-card").getByRole("heading", { name: USED })).toBeVisible();
      expect(passPosts).toBe(0);
    } else {
      // A charged failure: the wizard already shows the sign-in step instead of "Make my pass".
      await expect(dialog.getByTestId("sign-in-card").getByRole("heading", { name: USED })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Make my pass" })).toHaveCount(0);
    }
    expect((await freeCookies()).length).toBe(1);

    // A reload: the server reads the cookie and goes straight to the sign-in step.
    dialog = await resume();
    await expect(dialog.getByTestId("sign-in-card").getByRole("heading", { name: USED })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Make my pass" })).toHaveCount(0);
    await expect(dialog.getByTestId("sign-in-card").getByRole("button", { name: "Try as a judge" })).toBeVisible();
    expect(passPosts).toBe(0);
  });
});

test.describe("a failure before any paid call", () => {
  test.use(judgeAddress(54));

  test("signed out: a failure before any paid model call starts uses nothing (no cookie, still 1 free pass, Make my pass stays)", async ({ page }) => {
    test.setTimeout(WAIT + 60_000);
    await page.goto("/");
    await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [RESUME_KEY, JSON.stringify({ park: CELEBRATION, band: "4-6" })]);
    await page.goto("/?resume=1", { waitUntil: "load" });
    const dialog = page.getByTestId("pass-wizard");
    await expect(dialog).toHaveAccessibleName("Make your pass", { timeout: 20_000 });
    const freeCookies = async () => (await page.context().cookies()).filter((c) => c.name.endsWith("gp-free"));
    await expect(dialog.getByTestId("passes-left")).toContainText(`you have ${FREE_PASSES_PER_DAY} free pass left today`);
    await dialog.getByRole("button", { name: "Make my pass" }).click();

    const failed = dialog.locator("[data-error-code]");
    const outcome = async (): Promise<"opened" | "ready" | "failed" | "empty" | "waiting"> => {
      if (new URL(page.url()).pathname.startsWith("/pass/")) return "opened";
      if (await dialog.getByTestId("pass-ready").isVisible().catch(() => false)) return "ready";
      if (await failed.first().isVisible().catch(() => false)) return "failed";
      if (await dialog.getByTestId("other-parks").isVisible().catch(() => false)) return "empty";
      return "waiting";
    };
    await expect.poll(outcome, { timeout: WAIT, intervals: [250] }).not.toBe("waiting");
    const first = await outcome();
    if (first !== "failed") test.skip(true, `${first.toUpperCase()}: this server made (or served) a pass, so there was no early failure to check`);
    if ((await freeCookies()).length > 0) test.skip(true, "CHARGED: the paid model call started and then failed (the first test covers that path)");

    // The honest failure, and nothing used: no cookie at all, the server still counts 1 free pass left, and the wizard
    // offers "Make my pass" again (no sign-in step).
    const code = (await failed.first().getAttribute("data-error-code")) ?? "";
    expect(["MODEL_NOT_CONFIGURED", "OSM_UNAVAILABLE", "DATA_TOO_SLOW", "BUSY_HERE", "GEOCODER_UNAVAILABLE"], `code ${code}`).toContain(code);
    expect(((await failed.first().textContent()) ?? "").trim().length).toBeGreaterThan(10);
    expect(await page.context().cookies()).toEqual([]);
    const r = await page.request.get("/api/passes-left");
    expect(await r.json()).toMatchObject({ kind: "free", free: FREE_PASSES_PER_DAY, left: FREE_PASSES_PER_DAY });
    await expect(dialog.getByTestId("sign-in-card").getByRole("heading", { name: USED })).toHaveCount(0);
    await expect(dialog.getByTestId("passes-left")).toContainText(`you have ${FREE_PASSES_PER_DAY} free pass left today`);
    await expect(dialog.getByRole("button", { name: "Make my pass" })).toBeVisible();
  });
});
