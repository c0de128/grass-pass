import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { judgeAddress, judgeSignInPage } from "./support/judge";

/**
 * Pass limits and pass feedback (Kevin, 2026-10-08), with no model, SerpApi or map call:
 * - the wizard signed out: "Make my pass" with the free-pass line; the free pass is used by a request whose paid call
 *   started (the server's last line carries `free: { left: 0 }`), then the friendly sign-in step (sign in for 5 a day, or
 *   Try as a judge). The making step is driven by REPLAYING the server's own step texts through a fetch shim, as in
 *   pass-wizard.spec.ts; the real cookie round trip is tests/e2e/free-pass-live.spec.ts and the unit tests.
 * - "How was this pass?" on a recorded real pass (GP_E2E_FIXTURE_PASSES=1, src/lib/pass/e2e-fixtures.ts): signed out a
 *   sign-in link; as the judge the stars + tags control, sent to the REAL POST /api/feedback (judge ratings are only
 *   logged, so this never changes any count).
 */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const RESUME_KEY = "grass-pass:resume";
const CELEBRATION = { id: "way/188145317", name: "Celebration Park", kind: "park", lat: 33.10824, lng: -96.62468, distanceM: 120 };
const recorded = (JSON.parse(readFileSync("tests/fixtures/pass-celebration-complete-live.json", "utf8")) as { pass: { model: { answered: string } } }).pass;
/** A recorded real pass the server opens by id in e2e (src/lib/pass/e2e-fixtures.ts). */
const FIXTURE_ID = (JSON.parse(readFileSync("tests/fixtures/pass-celebration-6to10-tips-live.json", "utf8")) as { pass: { id: string } }).pass.id;
// The server's own step texts (src/lib/ai/build-pass.ts stepText) and its MODEL_TIMEOUT copy (modelFailure), for the recorded model.
const STEPS = [
  { type: "step", step: "map", text: "Reading the park map (OpenStreetMap)…" },
  { type: "step", step: "wildlife", text: "Checking what people spotted nearby in the last 14 days (iNaturalist)…" },
  { type: "step", step: "clues", text: `Writing clues with ${recorded.model.answered} (open model)…` },
];
const TIMEOUT_LINE = { type: "error", status: 504, error: { code: "MODEL_TIMEOUT", message: "Gemma took too long. Try again. Your park data is below." }, free: { left: 0 } };
const SHIM = `
const orig = window.fetch.bind(window);
window.__gpPassCalls = 0;
window.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.endsWith("/api/pass")) {
    window.__gpPassCalls++;
    const stream = new ReadableStream({ start(c) { window.__gpC = c; } });
    return Promise.resolve(new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson" } }));
  }
  return orig(input, init);
};
window.__gpPush = (line) => window.__gpC.enqueue(new TextEncoder().encode(JSON.stringify(line) + "\\n"));
window.__gpEnd = () => window.__gpC.close();
`;
const UNDER_LOAD = { timeout: 20_000 };

async function resumeOnStep3(page: Page) {
  await page.goto("/");
  await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [RESUME_KEY, JSON.stringify({ park: CELEBRATION, band: "6-10" })]);
  await page.goto("/?resume=1", { waitUntil: "load" });
  const dialog = page.getByTestId("pass-wizard");
  await expect(dialog).toHaveAccessibleName("Make your pass", UNDER_LOAD);
  return dialog;
}

const push = (page: Page, line: unknown) => page.evaluate((l) => (window as unknown as { __gpPush: (x: unknown) => void }).__gpPush(l), line);

test.describe("signed out: 1 free pass, then the sign-in step", () => {
  test.use(judgeAddress(51));

  test("Make my pass with no sign-in; once the free pass is used, the next try is the friendly sign-in step (5 a day or Try as a judge)", async ({ page }) => {
    await page.addInitScript(SHIM);
    const dialog = await resumeOnStep3(page);
    await expect(dialog.getByTestId("passes-left")).toHaveText("No sign-in needed: you have 1 free pass left today. A grown-up who signs in gets 5 new passes a day.");
    await expect(dialog.getByTestId("sign-in-card")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Make my pass" }).click();
    await expect(dialog).toHaveAccessibleName("Making your pass…");
    for (const l of STEPS) await push(page, l);
    await expect(dialog.getByTestId("making-live")).toHaveText(STEPS[2].text, UNDER_LOAD);
    // The paid call started, then failed: the server says the free pass was used (left 0).
    await push(page, TIMEOUT_LINE);

    // The second-attempt prompt: no more "Make my pass", the sign-in card with the friendly reason and Try as a judge.
    const card = dialog.getByTestId("sign-in-card");
    await expect(card.getByRole("heading", { name: "You used today's free pass" })).toBeVisible();
    await expect(card.getByTestId("sign-in-lead")).toHaveText(
      /^(Sign in for 5 new passes a day, or press Try as a judge\.|Press Try as a judge to keep going\.) Saved passes and examples still work, and your free pass comes back after midnight Dallas time\.$/,
    );
    await expect(card.getByRole("button", { name: "Try as a judge" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Make my pass" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Open a pass someone already made today" })).toBeVisible();
    // The real failure is still said (with its code), and there's no "Try again" that would only be refused.
    await expect(dialog.locator('[data-error-code="MODEL_TIMEOUT"]')).toContainText("took too long");
    expect(await page.evaluate(() => (window as unknown as { __gpPassCalls: number }).__gpPassCalls)).toBe(1);
    // No receipt in this replayed line, so no cookie: a browser's free-pass cookie only ever comes from the server.
    expect((await page.context().cookies()).filter((c) => c.name.includes("gp-free"))).toEqual([]);

    const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).include('[data-testid="pass-wizard"]').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });

  test("the server's FREE_PASS_USED answer (the cookie says today's free pass is used) also shows the sign-in step", async ({ page }) => {
    await page.addInitScript(SHIM.replace(
      'if (url.endsWith("/api/pass")) {',
      'if (url.endsWith("/api/pass")) { window.__gpPassCalls++; return Promise.resolve(new Response(JSON.stringify({ error: { code: "FREE_PASS_USED", message: "You used today\'s free pass. Sign in with GitHub or Google for 5 new passes a day, or press Try as a judge. Saved passes and examples still work.", retryAfter: 3600 } }), { status: 429, headers: { "Content-Type": "application/json" } }));',
    ));
    const dialog = await resumeOnStep3(page);
    await dialog.getByRole("button", { name: "Make my pass" }).click();
    await expect(dialog.getByTestId("sign-in-card").getByRole("heading", { name: "You used today's free pass" })).toBeVisible();
    await expect(dialog.locator('[data-error-code="FREE_PASS_USED"]')).toContainText("No pass for this park and age was made today yet. Sign in above to make one.");
    await expect(dialog.getByRole("button", { name: "Try again" })).toHaveCount(0);
  });
});

test.describe("How was this pass? (a recorded real pass, the real feedback API)", () => {
  test.use(judgeAddress(52));

  test("signed out: only a sign-in link, which comes back to the pass", async ({ page }) => {
    const res = await page.goto(`/pass/${FIXTURE_ID}`);
    expect(res?.status()).toBe(200);
    const box = page.getByTestId("pass-feedback");
    await expect(box.getByRole("heading", { name: "How was this pass?" })).toBeVisible();
    const link = box.getByRole("link", { name: "Sign in to rate this pass" });
    await expect(link).toHaveAttribute("href", `/signin?from=${encodeURIComponent(`/pass/${FIXTURE_ID}`)}`);
    await expect(box.getByRole("radio")).toHaveCount(0);
    // The per-find reports are unchanged (a sign-in link too).
    await expect(page.getByTestId("report-intro").getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("as the judge: stars + tags, no text box; Send asks for stars first; the server's answer is shown (judge: logged only)", async ({ page }) => {
    await judgeSignInPage(page);
    await page.goto(`/pass/${FIXTURE_ID}`);
    const box = page.getByTestId("pass-feedback");
    const form = box.getByRole("form", { name: "Rate this pass" });
    await expect(form.getByRole("radio")).toHaveCount(5);
    await expect(form.locator("textarea, input[type=text]")).toHaveCount(0);
    for (const t of ["Too easy", "Too hard", "Kids loved it", "Something was missing", "Not safe"]) {
      await expect(form.getByRole("button", { name: t })).toHaveAttribute("aria-pressed", "false");
    }
    // No stars yet: a field error, focus on the first star.
    await form.getByRole("button", { name: "Send rating" }).click();
    await expect(form.getByRole("alert")).toHaveText("Pick 1 to 5 stars first.");
    await expect(form.getByRole("radio", { name: "1 star" })).toBeFocused();

    await form.locator("label").filter({ hasText: "4 stars" }).click();
    await expect(form.getByRole("radio", { name: "4 stars" })).toBeChecked();
    await form.getByRole("button", { name: "Kids loved it" }).click();
    await expect(form.getByRole("button", { name: "Kids loved it" })).toHaveAttribute("aria-pressed", "true");
    await form.getByRole("button", { name: "Send rating" }).click();
    await expect(box.getByTestId("feedback-status")).toHaveText(/^(Thanks! Judge demo ratings are logged for review, but they aren't counted\.|This browser already rated this pass today\.)$/);

    const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).include('[data-testid="pass-feedback"]').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    // The per-find report control is still there, unchanged.
    await expect(page.getByRole("group", { name: "Report find 1" })).toBeVisible();
  });
});
