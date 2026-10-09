import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { judgeAddress } from "./support/judge";

/**
 * The pass wizard (Kevin 2026-10-07): "Find parks" / "Use my location" open a modal that guides park -> explorer ->
 * make it, with a fun animation while the pass is made. No live search and no model call here:
 * - the dialog is opened with "Use my location" while location is blocked (no request leaves the page), or by the
 *   real sign-in resume path (the park + age saved in sessionStorage, then /?resume=1);
 * - the making step is driven by REPLAYING the server's own step texts (src/lib/ai/build-pass.ts stepText, with the
 *   recorded model id) and a real recorded pass (tests/fixtures/pass-celebration-complete-live.json) through a
 *   fetch shim, so the checklist and the picture are checked against real progress lines, never invented ones.
 * The live search inside the wizard is covered by find-a-park.spec.ts.
 */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const RESUME_KEY = "grass-pass:resume";
const CELEBRATION = { id: "way/188145317", name: "Celebration Park", kind: "park", lat: 33.10824, lng: -96.62468, distanceM: 120 };
const pass = (JSON.parse(readFileSync("tests/fixtures/pass-celebration-complete-live.json", "utf8")) as { pass: { id: string; model: { answered: string } } }).pass;
const STEPS = [
  { type: "step", step: "map", text: "Reading the park map (OpenStreetMap)…" },
  { type: "step", step: "wildlife", text: "Checking what people spotted nearby in the last 14 days (iNaturalist)…" },
  { type: "step", step: "clues", text: `Writing clues with ${pass.model.answered} (open model)…` },
  { type: "step", step: "check", text: "Fact-checking every clue against its source…" },
];
const REPLAY_SHIM = `
const orig = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.endsWith("/api/pass")) {
    const stream = new ReadableStream({ start(c) { window.__gpC = c; } });
    return Promise.resolve(new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson" } }));
  }
  return orig(input, init);
};
window.__gpPush = (line) => window.__gpC.enqueue(new TextEncoder().encode(JSON.stringify(line) + "\\n"));
`;

async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

async function axeDialog(page: Page, label: string) {
  await settle(page);
  const r = await new AxeBuilder({ page }).withTags(AXE_TAGS).include('[data-testid="pass-wizard"]').analyze();
  expect(r.violations.map((v) => `${label} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label} sideways scroll`).toBeLessThanOrEqual(0);
}

/**
 * Q-10-05 (round 10): under the full suite (every worker busy) the home page can take more than the default 5 s to
 * hydrate and reopen the wizard from sessionStorage, so these waits are longer. Alone the spec passed 3 of 3 runs.
 */
const UNDER_LOAD = { timeout: 20_000 };

/** Open the wizard on step 3 the way the sign-in round trip does. */
async function resumeOnStep3(page: Page) {
  await page.goto("/");
  await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [RESUME_KEY, JSON.stringify({ park: CELEBRATION, band: "6-10" })]);
  await page.goto("/?resume=1", { waitUntil: "load" });
  const dialog = page.getByTestId("pass-wizard");
  await expect(dialog).toBeVisible(UNDER_LOAD);
  await expect(dialog).toHaveAccessibleName("Make your pass", UNDER_LOAD);
  return dialog;
}

test.describe("dialog basics (location blocked: nothing leaves the page)", () => {
  test.use({ permissions: [] });

  test("opens from Use my location, focus moves in and is kept in, Esc closes, focus goes back, page doesn't scroll behind", async ({ page, context }) => {
    await context.clearPermissions();
    await page.goto("/");
    const opener = page.getByRole("button", { name: "Use my location" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Pick your park" });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("wizard-announce")).toHaveText("Step 1 of 3: Pick your park");
    // Focus moved into the dialog: onto its "Use my location", which carries the location problem.
    await expect(dialog.getByRole("button", { name: "Use my location" })).toBeFocused();
    // The location problem is said inside the wizard, linked to its button, with the search field right there.
    const alert = dialog.getByRole("alert").filter({ hasText: "location" });
    await expect(alert).toContainText(/Type a town or ZIP instead|Type a town or ZIP, or allow location|Try again or type a town or ZIP/);
    const errorId = await alert.getAttribute("id");
    expect((await dialog.getByRole("button", { name: "Use my location" }).getAttribute("aria-describedby"))?.split(" ")).toContain(errorId);
    await expect(dialog.getByLabel("Search somewhere else")).toBeVisible();
    // The page behind can't scroll and can't be reached with Tab.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe("hidden");
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => !!document.activeElement?.closest("dialog[open]") || document.activeElement === document.body);
      expect(inside, `Tab ${i + 1} stayed in the dialog`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe("hidden");
  });

  test("the close button closes it; an empty hero search shows its error on the hero field (no dialog)", async ({ page, context }) => {
    await context.clearPermissions();
    await page.goto("/");
    const form = page.getByRole("form", { name: "Find a park" });
    await form.getByRole("button", { name: "Find parks" }).click();
    await expect(form.getByRole("alert")).toHaveText("Type a town, ZIP or park name.");
    await expect(form.getByLabel("Town, ZIP or park name")).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const opener = page.getByRole("button", { name: "Use my location" });
    await opener.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("axe: step 1 with the location message (360/1280, light/dark)", async ({ browser }) => {
    test.setTimeout(120_000);
    await eachSize(browser, async (page, label) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Use my location" }).click();
      await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
      await axeDialog(page, `${label} step 1`);
    }, { permissions: [] });
  });
});

async function eachSize(browser: Browser, fn: (page: Page, label: string) => Promise<void>, extra: Parameters<Browser["newContext"]>[0] = {}) {
  for (const width of [360, 1280]) {
    for (const scheme of ["light", "dark"] as const) {
      const context = await browser.newContext({ ...extra, colorScheme: scheme, viewport: { width, height: 800 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      await fn(page, `${width}/${scheme}`);
      await context.close();
    }
  }
}

test("sign-in resume: the park + age come back on step 3; Back walks to Explorer then Park; the choices stay", async ({ page }) => {
  const dialog = await resumeOnStep3(page);
  await expect(page).toHaveURL(/\/#find$/);
  await expect(dialog.getByTestId("choice-ticket")).toContainText("Celebration Park");
  await expect(dialog.getByTestId("chosen-age")).toHaveText("Ages 6-10");
  // Kevin 2026-10-08: the park name was squeezed to one letter wide by the age column; both get room.
  const cols = dialog.getByTestId("choice-ticket").locator("dl > div");
  for (const i of [0, 1]) expect((await cols.nth(i).boundingBox())?.width ?? 0, `ticket column ${i} width`).toBeGreaterThan(150);
  // Signed out with today's free pass left (Kevin 2026-10-08): "Make my pass" and the count; the sign-in card is one click away.
  await expect(dialog.getByTestId("passes-left")).toHaveText(/^No sign-in needed: you have 1 free pass left today\./);
  await expect(dialog.getByRole("button", { name: "Make my pass" })).toBeVisible();
  await expect(dialog.getByTestId("sign-in-card")).toHaveCount(0);

  await expect(dialog.getByRole("heading", { level: 2, name: "Make your pass" })).toBeFocused();
  await dialog.getByRole("button", { name: "Back" }).click();
  await expect(dialog).toHaveAccessibleName("Who's exploring?");
  await expect(page.getByTestId("wizard-announce")).toHaveText("Step 2 of 3: Who's exploring?");
  await expect(dialog.getByRole("heading", { level: 2 })).toBeFocused();
  const sixTen = dialog.getByRole("radio", { name: /Ages 6–10 \(most kids\)/ });
  await expect(sixTen).toBeChecked();
  // Choosing an age never moves on by itself; Next does.
  await dialog.getByText("Ages 10–13").click();
  await expect(dialog.getByRole("radio", { name: /Ages 10–13/ })).toBeChecked();
  await expect(dialog).toHaveAccessibleName("Who's exploring?");
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByTestId("chosen-age")).toHaveText("Ages 10-13");
  await dialog.getByRole("button", { name: "Back" }).click();
  await dialog.getByRole("button", { name: "Back" }).click();
  await expect(dialog).toHaveAccessibleName("Pick your park");
  // The step trail: step 1 is current again.
  await expect(dialog.getByTestId("wizard-steps").locator('[aria-current="step"]')).toContainText("Park");
});

test.describe("making the pass (replayed real progress, no model call)", () => {
  test.use(judgeAddress(21));

  test("the checklist ticks only the steps the server reported; the picture follows; then 'Your pass is ready!'", async ({ page }) => {
    await page.addInitScript(REPLAY_SHIM);
    await page.goto("/signin");
    await page.getByRole("button", { name: "Try as a judge" }).click();
    await expect(page.getByRole("button", { name: /Sign out/ })).toBeVisible();
    const dialog = await resumeOnStep3(page);
    // UX-4-03 kept: signed in, so the note is said and focus is on "Make my pass".
    await expect(dialog.getByTestId("signed-in-note")).toHaveText("Signed in as a judge. You can make this pass now.");
    await expect(dialog.getByRole("button", { name: "Make my pass" })).toBeFocused();
    await dialog.getByRole("button", { name: "Make my pass" }).click();

    await expect(dialog).toHaveAccessibleName("Making your pass…");
    const rows = dialog.getByTestId("making-checklist").getByRole("listitem");
    const scene = dialog.getByTestId("making-scene");
    await expect(rows).toHaveCount(4);
    await expect(rows.and(page.locator('[data-state="todo"]'))).toHaveCount(4);
    await expect(scene).toHaveAttribute("data-stage", "-1");
    await expect(dialog.getByText(/%/)).toHaveCount(0);

    for (const [i, line] of STEPS.entries()) {
      await page.evaluate((l) => (window as unknown as { __gpPush: (x: unknown) => void }).__gpPush(l), line);
      await expect(dialog.getByTestId("making-live")).toHaveText(line.text, UNDER_LOAD);
      await expect(rows.nth(i)).toHaveAttribute("data-state", "active");
      await expect(rows.nth(i)).toContainText(line.text);
      for (let j = 0; j < i; j++) await expect(rows.nth(j)).toHaveAttribute("data-state", "done");
      for (let j = i + 1; j < 4; j++) await expect(rows.nth(j)).toHaveAttribute("data-state", "todo");
      await expect(scene).toHaveAttribute("data-stage", String(i));
    }
    // Kevin 2026-10-08: no seconds counter, only the usual-time line.
    await expect(dialog.getByTestId("pass-elapsed")).toHaveText(/^A new pass usually takes 10-30 seconds/);
    await expect(dialog.getByText(/s so far/)).toHaveCount(0);
    // No Back while the pass is being made (the close button still works).
    await expect(dialog.getByRole("button", { name: "Back" })).toHaveCount(0);

    await page.evaluate((p) => (window as unknown as { __gpPush: (x: unknown) => void }).__gpPush({ type: "result", pass: p, cached: false }), pass);
    await expect(dialog).toHaveAccessibleName("Your pass is ready!");
    await expect(dialog.getByTestId("pass-ready").getByRole("link", { name: "Open my pass" })).toHaveAttribute("href", `/pass/${pass.id}`);
    // Then the pass opens by itself (as before the wizard). The recorded pass isn't in this server's store: its page says so.
    await expect(page).toHaveURL(new RegExp(`/pass/${pass.id}$`), { timeout: 10_000 });
  });

  test("axe on step 2, step 3 (signed in), making and ready (360/1280, light/dark)", async ({ browser }) => {
    test.setTimeout(240_000);
    await eachSize(
      browser,
      async (page, label) => {
        await page.addInitScript(REPLAY_SHIM);
        await page.goto("/signin");
        await page.getByRole("button", { name: "Try as a judge" }).click();
        await expect(page.getByRole("button", { name: /Sign out/ })).toBeVisible();
        const dialog = await resumeOnStep3(page);
        await expect(dialog.getByRole("button", { name: "Make my pass" })).toBeVisible();
        await axeDialog(page, `${label} step 3`);
        await dialog.getByRole("button", { name: "Back" }).click();
        await expect(dialog.getByRole("radio").first()).toBeAttached();
        await axeDialog(page, `${label} step 2`);
        await dialog.getByRole("button", { name: "Next" }).click();
        await dialog.getByRole("button", { name: "Make my pass" }).click();
        for (const line of STEPS.slice(0, 3)) await page.evaluate((l) => (window as unknown as { __gpPush: (x: unknown) => void }).__gpPush(l), line);
        await expect(dialog.getByTestId("making-live")).toHaveText(STEPS[2].text, UNDER_LOAD);
        await axeDialog(page, `${label} making`);
        // Ready: checked right away (it opens the pass after 1.6 s).
        await page.evaluate((p) => (window as unknown as { __gpPush: (x: unknown) => void }).__gpPush({ type: "result", pass: p, cached: false }), pass);
        await expect(dialog.getByTestId("pass-ready")).toBeVisible(UNDER_LOAD);
        const r = await new AxeBuilder({ page }).withTags(AXE_TAGS).include('[data-testid="pass-wizard"]').analyze();
        expect(r.violations.map((v) => `${label} ready ${v.id}`)).toEqual([]);
      },
      judgeAddress(22),
    );
  });

  test("signed out on step 3: axe is clean with the free-pass line and with the sign-in card (360/1280, light/dark)", async ({ browser }) => {
    test.setTimeout(120_000);
    await eachSize(browser, async (page, label) => {
      const dialog = await resumeOnStep3(page);
      await expect(dialog.getByTestId("passes-left")).not.toHaveText("", UNDER_LOAD);
      await axeDialog(page, `${label} step 3 signed out, free pass`);
      await dialog.getByTestId("sign-in-instead").click();
      await expect(dialog.getByTestId("judge-left")).not.toHaveText("", UNDER_LOAD);
      await axeDialog(page, `${label} step 3 signed out, sign-in card`);
    });
  });
});

test("reduced motion: the making picture is drawn still (no running animations in the dialog)", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce", ...judgeAddress(23) });
  const page = await context.newPage();
  await page.addInitScript(REPLAY_SHIM);
  await page.goto("/signin");
  await page.getByRole("button", { name: "Try as a judge" }).click();
  await expect(page.getByRole("button", { name: /Sign out/ })).toBeVisible();
  const dialog = await resumeOnStep3(page);
  await dialog.getByRole("button", { name: "Make my pass" }).click();
  for (const line of STEPS.slice(0, 3)) await page.evaluate((l) => (window as unknown as { __gpPush: (x: unknown) => void }).__gpPush(l), line);
  await expect(dialog.getByTestId("making-scene")).toHaveAttribute("data-stage", "2");
  // CSS keyframe animations only (a colour transition on a ticked row is not motion).
  const running = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a instanceof CSSAnimation && (a.effect as KeyframeEffect | null)?.target?.closest?.("dialog"))
      .map((a) => (a as CSSAnimation).animationName),
  );
  expect(running).toEqual([]);
  // The same real checklist is there.
  await expect(dialog.getByTestId("making-checklist").getByRole("listitem").nth(2)).toHaveAttribute("data-state", "active");
  await context.close();
});
