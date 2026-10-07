import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { judgeAddress } from "./support/judge";

/**
 * Round 8 fixes (wizard + home). No model call and no live search:
 * - the pass request is answered by a fetch shim that REPLAYS the server's own lines (a real recorded pass,
 *   tests/fixtures/pass-celebration-complete-live.json, which is also the pinned Celebration example, so its
 *   page really opens); every request body is kept so the test can read what was sent;
 * - the park list for the "search again" case is the app's own answer shape, built from the two real OpenStreetMap
 *   parks of the pinned examples (ids, names and centres copied from src/data/pinned-examples/*.json).
 */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const RESUME_KEY = "grass-pass:resume";
const CELEBRATION = { id: "way/188145317", name: "Celebration Park", kind: "park", lat: 33.10824, lng: -96.62468, distanceM: 120 };
const oakPin = JSON.parse(readFileSync("src/data/pinned-examples/oak-point.json", "utf8")) as { pass: { park: { id: string; name: string; lat: number; lng: number } } };
const OAK_POINT = { ...oakPin.pass.park, kind: "nature_reserve", distanceM: 4210 };
const pass = (JSON.parse(readFileSync("tests/fixtures/pass-celebration-complete-live.json", "utf8")) as { pass: { id: string; model: { answered: string } } }).pass;
const STEP = { type: "step", step: "map", text: "Reading the park map (OpenStreetMap)…" };

const SHIM = `
const orig = window.fetch.bind(window);
window.__gpCs = [];
window.__gpBodies = [];
window.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.endsWith("/api/pass")) {
    window.__gpBodies.push(JSON.parse(init.body));
    const stream = new ReadableStream({ start(c) { window.__gpCs.push(c); } });
    return Promise.resolve(new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson" } }));
  }
  return orig(input, init);
};
window.__gpPush = (line, i) => {
  const cs = window.__gpCs;
  const c = cs[i === undefined ? cs.length - 1 : i];
  try { c.enqueue(new TextEncoder().encode(JSON.stringify(line) + "\\n")); return true; } catch { return false; }
};
`;

type GpWindow = { __gpPush: (x: unknown, i?: number) => boolean; __gpBodies: unknown[] };
const push = (page: Page, line: unknown, i?: number) => page.evaluate(([l, n]) => (window as unknown as GpWindow).__gpPush(l, n ?? undefined), [line, i ?? null] as const);
const bodies = (page: Page) => page.evaluate(() => (window as unknown as GpWindow).__gpBodies);

async function judgeOnStep3(page: Page) {
  await page.addInitScript(SHIM);
  await page.goto("/signin");
  await page.getByRole("button", { name: "Try as a judge" }).click();
  await expect(page.getByRole("button", { name: /Sign out/ })).toBeVisible();
  await page.goto("/");
  await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [RESUME_KEY, JSON.stringify({ park: CELEBRATION, band: "6-10" })]);
  await page.goto("/?resume=1");
  const dialog = page.getByTestId("pass-wizard");
  await expect(dialog).toHaveAccessibleName("Make your pass");
  await expect(dialog.getByRole("button", { name: "Make my pass" })).toBeFocused();
  return dialog;
}

test.describe("UX-8-01 / UX-8-06: keyboard focus on the fade-in home blocks", () => {
  for (const vp of [
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    test(`${vp.width} px, motion allowed: every Tab stop in a fade-in block is visible and on screen, not under the header`, async ({ browser }) => {
      test.setTimeout(120_000);
      const context = await browser.newContext({ viewport: vp, reducedMotion: "no-preference" });
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.locator(".gp-fade").first()).toBeAttached();
      let checked = 0;
      let sawExplore = false;
      for (let i = 0; i < 80 && checked < 4; i++) {
        await page.keyboard.press("Tab");
        const inFade = await page.evaluate(() => !!document.activeElement?.closest(".gp-fade"));
        if (!inFade) continue;
        checked++;
        // Let the reveal (0.7 s) and the scroll finish.
        await page.waitForTimeout(900);
        const r = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          const block = el.closest(".gp-fade") as HTMLElement;
          const rect = el.getBoundingClientRect();
          const header = document.querySelector("header.sticky")?.getBoundingClientRect().bottom ?? 0;
          return {
            name: el.textContent?.trim().slice(0, 40),
            explore: !!el.closest("#parks ul"),
            opacity: getComputedStyle(block).opacity,
            revealed: block.classList.contains("gp-in"),
            top: rect.top,
            header,
            inner: window.innerHeight,
          };
        });
        sawExplore ||= r.explore;
        expect(r.revealed, `${r.name} revealed`).toBe(true);
        expect(r.opacity, `${r.name} opacity`).toBe("1");
        expect(r.top, `${r.name} top below the sticky header`).toBeGreaterThanOrEqual(r.header - 1);
        expect(r.top, `${r.name} top inside the window`).toBeLessThan(r.inner);
      }
      expect(checked, "Tab reached fade-in blocks").toBeGreaterThan(0);
      // The keyless server still lists the pinned (real, recorded) example passes, so the Explore cards are reached.
      if (await page.getByRole("list", { name: "Example parks" }).isVisible()) expect(sawExplore, "an Explore card was checked").toBe(true);
      await context.close();
    });
  }
});

test.describe("wizard state (replayed answers, no model call)", () => {
  test("Q-8-02: a new age clears the old failure, and Make / Try again send the CURRENT age", async ({ browser }) => {
    const context = await browser.newContext(judgeAddress(41));
    const page = await context.newPage();
    const dialog = await judgeOnStep3(page);
    await dialog.getByRole("button", { name: "Make my pass" }).click();
    await expect(dialog).toHaveAccessibleName("Making your pass…");
    // A line the page can't read: the app's own "Something went wrong reading the answer" failure.
    await push(page, { type: "nonsense" });
    await expect(dialog.locator('[data-error-code="BAD_ANSWER"]')).toBeVisible();
    await dialog.getByRole("button", { name: "Back" }).click();
    await dialog.getByText("Ages 10–13").click();
    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog.getByTestId("chosen-age")).toHaveText("Ages 10-13");
    // The old failure (and its Try again for 6-10) is gone.
    await expect(dialog.locator("[data-error-code]")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /Try again/ })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Make my pass" }).click();
    await push(page, { type: "nonsense" });
    await expect(dialog.locator('[data-error-code="BAD_ANSWER"]')).toBeVisible();
    await dialog.getByRole("button", { name: "Try again" }).click();
    expect((await bodies(page)).map((b) => (b as { ageBand: string }).ageBand)).toEqual(["6-10", "10-13", "10-13"]);
    await context.close();
  });

  test("Q-8-03: close mid-making, search again, pick a new park: step 2 has Back/Next and the old pass never opens", async ({ browser }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext(judgeAddress(42));
    const page = await context.newPage();
    await page.route("**/api/parks", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          query: { kind: "text", text: "Allen TX", matched: "Allen, Collin County, Texas, United States" },
          center: { lat: 33.1032, lng: -96.6706 },
          radiusM: 5000,
          parks: [CELEBRATION, OAK_POINT],
          totalFound: 2,
          empty: null,
          checkedAt: new Date().toISOString(),
          cached: true,
        }),
      }),
    );
    const dialog = await judgeOnStep3(page);
    await dialog.getByRole("button", { name: "Make my pass" }).click();
    await push(page, STEP);
    await expect(dialog.getByTestId("making")).toContainText("Celebration Park");
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("wizard-pending")).toContainText("Still making your pass for Celebration Park…");

    const hero = page.getByRole("form", { name: "Find a park" });
    await hero.getByLabel("Town, ZIP or park name").fill("Allen TX");
    await hero.getByRole("button", { name: "Find parks" }).click();
    await expect(dialog).toHaveAccessibleName("Pick your park");
    // The running pass is named, with a way back to it.
    await expect(dialog.getByTestId("still-making-note")).toContainText("Your pass for Celebration Park is still being made.");
    await dialog.getByRole("button", { name: /Oak Point Park and Nature Preserve/ }).click();
    await expect(dialog).toHaveAccessibleName("Who's exploring?");
    await expect(dialog.getByRole("button", { name: "Back" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Next" })).toBeVisible();

    // The old request answers now: it must not open (its stream was dropped when the new park was picked).
    await push(page, { type: "result", pass, cached: false }, 0);
    await page.waitForTimeout(2_500);
    await expect(page).not.toHaveURL(/\/pass\//);
    await expect(dialog).toHaveAccessibleName("Who's exploring?");
    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog.getByTestId("choice-ticket")).toContainText("Oak Point Park and Nature Preserve");
    await expect(dialog.getByRole("button", { name: "Make my pass" })).toBeVisible();
    await context.close();
  });

  test("UX-8-02: 'ready' is said in the live region, then the pass opens with focus on its h1", async ({ browser }) => {
    const context = await browser.newContext(judgeAddress(43));
    const page = await context.newPage();
    const dialog = await judgeOnStep3(page);
    await dialog.getByRole("button", { name: "Make my pass" }).click();
    await push(page, { type: "result", pass, cached: false });
    await expect(page.getByTestId("wizard-announce")).toHaveText("Your pass for Celebration Park is ready. Opening it now. Press Stay here to stop.");
    await expect(page).toHaveURL(new RegExp(`/pass/${pass.id}$`), { timeout: 10_000 });
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toContainText("Celebration Park");
    await expect(h1).toBeFocused();
    await context.close();
  });

  test("UX-8-07: 'Stay here' stops the auto-open; axe is clean on the ready step (390 px)", async ({ browser }) => {
    const context = await browser.newContext({ ...judgeAddress(44), viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const dialog = await judgeOnStep3(page);
    await dialog.getByRole("button", { name: "Make my pass" }).click();
    await push(page, { type: "result", pass, cached: false });
    await dialog.getByRole("button", { name: "Stay here" }).click();
    await expect(dialog.getByTestId("ready-line")).toHaveText("Your pass for Celebration Park is ready. Open it when you like.");
    await expect(page.getByTestId("wizard-announce")).toHaveText("Your pass for Celebration Park is ready. Open it when you like.");
    const open = dialog.getByRole("link", { name: "Open my pass" });
    await expect(open).toBeFocused();
    await page.waitForTimeout(2_500);
    await expect(page).not.toHaveURL(/\/pass\//);
    const r = await new AxeBuilder({ page }).withTags(AXE_TAGS).include('[data-testid="pass-wizard"]').analyze();
    expect(r.violations.map((v) => `ready ${v.id}`)).toEqual([]);
    await open.click();
    await expect(page).toHaveURL(new RegExp(`/pass/${pass.id}$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await context.close();
  });

  test("UX-8-04: 'Make my pass' (and Back) stay on one line at 360 px; axe on the park step with the still-making note", async ({ browser }) => {
    const context = await browser.newContext({ ...judgeAddress(45), viewport: { width: 360, height: 740 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const dialog = await judgeOnStep3(page);
    for (const name of ["Make my pass", "Back"]) {
      const h = await dialog.getByRole("button", { name }).evaluate((el) => el.getBoundingClientRect().height);
      expect(h, `${name} height (one line)`).toBeLessThanOrEqual(50);
    }
    await dialog.getByRole("button", { name: "Make my pass" }).click();
    await push(page, STEP);
    await dialog.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Use my location" }).first().click();
    await expect(dialog.getByTestId("still-making-note")).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
    const r = await new AxeBuilder({ page }).withTags(AXE_TAGS).include('[data-testid="pass-wizard"]').analyze();
    expect(r.violations.map((v) => `park step ${v.id}`)).toEqual([]);
    // "Back to my pass" returns to the live progress.
    await dialog.getByRole("button", { name: "Back to my pass for Celebration Park" }).click();
    await expect(dialog.getByTestId("making")).toBeVisible();
    await context.close();
  });
});

test("UX-8-04: the hero card's 'View pass' stays on one line (360 and 1280)", async ({ browser }) => {
  for (const width of [360, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await context.newPage();
    await page.goto("/");
    const link = page.getByTestId("hero-view-pass");
    if ((await link.count()) === 0) {
      await context.close();
      test.skip(true, "No hero example pass on this server (the card says why).");
    }
    // Count the text's line boxes (the hero card may be tilted, so its bounding box says little about lines).
    const lines = await link.evaluate((el) => {
      // One rect per line box of the "View pass" text node (a wrapped text node gives one per line).
      const text = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      if (!text) return -1;
      const range = document.createRange();
      range.selectNodeContents(text);
      return [...range.getClientRects()].filter((r) => r.width > 0).length;
    });
    expect(lines, `${width}: View pass lines`).toBe(1);
    await context.close();
  }
});
