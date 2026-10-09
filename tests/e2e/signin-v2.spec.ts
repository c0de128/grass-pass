import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser } from "@playwright/test";

// Sign-in v2 (Kevin's option A "show the reward", 2026-10-08): a compact sign-in card next to a preview of a REAL pinned
// pass. No upstream calls (the judge counter is this server's own /api/judge-passes). The "hidden when the pinned pass
// can't be loaded" case is covered in tests/unit/signin-preview.test.tsx (a file can't be removed from a built server).
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const pinned = JSON.parse(readFileSync("src/data/pinned-examples/white-rock.json", "utf8")) as {
  pass: { park: { name: string }; items: { clue: string }[]; spot: { riddle: string } };
};

async function open(browser: Browser, width: number, theme: "light" | "dark", reducedMotion: "reduce" | "no-preference" = "no-preference") {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion });
  await context.addInitScript((t) => localStorage.setItem("grass-pass-theme", t), theme);
  const page = await context.newPage();
  await page.goto("/signin");
  await expect(page.getByTestId("sign-in-card")).toBeVisible();
  return { context, page };
}

test("the preview is the real pinned White Rock pass, with its real date and a link to it", async ({ page }) => {
  await page.goto("/signin");
  const preview = page.getByTestId("signin-pass-preview");
  await expect(preview.getByTestId("signin-preview-park")).toHaveText(pinned.pass.park.name);
  await expect(preview.getByTestId("signin-preview-band")).toHaveText("Ages 6–10");
  const finds = preview.getByTestId("signin-preview-find");
  await expect(finds).toHaveCount(2);
  const clues = pinned.pass.items.map((i) => i.clue);
  for (const t of await finds.allInnerTexts()) expect(clues.some((c) => t.includes(c)), t).toBe(true);
  await expect(preview.getByTestId("signin-preview-spot")).toContainText(pinned.pass.spot.riddle);
  await expect(preview.getByTestId("signin-preview-caption")).toContainText(/A real pass: White Rock Lake Park, Dallas, TX, made Oct 7, \d{1,2}:\d{2} [AP]M CDT\./);
  await expect(preview.getByRole("link", { name: "See the whole pass" })).toHaveAttribute("href", /^\/pass\/w460905359-6to10-20261007-1\?example=1$/);
});

test("one h1 (Sign in); Google/GitHub first, then the quieter judge tear-off with the live count and a privacy link", async ({ page }) => {
  await page.goto("/signin");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
  const card = page.getByTestId("sign-in-card");
  await expect(card.getByTestId("signin-per-day")).toHaveText("2 free passes a day");
  await expect(card.getByRole("link", { name: "What we keep" })).toHaveAttribute("href", "/about#privacy");
  await expect(card.getByRole("heading", { level: 2, name: "Judging the contest?" })).toBeVisible();
  await expect(card.getByTestId("judge-left")).toHaveText(/judge passes left today|couldn't check|paused/);
  // The judge button is the secondary (outlined) look, not the solid primary one.
  const judge = card.getByRole("button", { name: "Try as a judge" });
  await expect(judge).toHaveClass(/ring-line/);
  // Every account button comes before the judge button in the card.
  const order = await card.locator("button").evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ""));
  const j = order.findIndex((t) => t.includes("Try as a judge"));
  for (const [i, t] of order.entries()) if (/Continue with/.test(t)) expect(i).toBeLessThan(j);
});

test("phones: the card comes first and the preview under it; wide screens: the preview on the left", async ({ browser }) => {
  for (const [width, side] of [
    [360, "below"],
    [1280, "left"],
  ] as const) {
    const { context, page } = await open(browser, width, "light");
    const card = (await page.getByTestId("sign-in-card").boundingBox())!;
    const preview = (await page.getByTestId("signin-pass-preview").boundingBox())!;
    if (side === "below") expect(preview.y).toBeGreaterThan(card.y + card.height);
    else expect(preview.x + preview.width).toBeLessThan(card.x);
    await context.close();
  }
});

test("44 px targets in the card and the preview link", async ({ browser }) => {
  const { context, page } = await open(browser, 360, "light");
  const targets = page.locator('[data-testid="sign-in-card"] button, [data-testid="sign-in-card"] a, [data-testid="signin-pass-preview"] a');
  const n = await targets.count();
  expect(n).toBeGreaterThan(1);
  for (let i = 0; i < n; i++) {
    const b = (await targets.nth(i).boundingBox())!;
    expect(b.height, await targets.nth(i).innerText()).toBeGreaterThanOrEqual(44);
  }
  await context.close();
});

test("axe clean and no sideways scroll (320/360/1280, light/dark)", async ({ browser }) => {
  test.setTimeout(120_000);
  for (const width of [320, 360, 1280]) {
    for (const theme of ["light", "dark"] as const) {
      const { context, page } = await open(browser, width, theme);
      await expect(page.getByTestId("judge-left")).not.toHaveText("");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width} ${theme}`).toBeLessThanOrEqual(0);
      if (width !== 320) {
        for (const y of [0, 600, 99_999]) {
          await page.evaluate((top) => window.scrollTo(0, top), y);
          const r = await new AxeBuilder({ page }).withTags(AXE_TAGS).include("main").analyze();
          expect(r.violations.map((v) => `${width} ${theme} @${y} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
        }
      }
      await context.close();
    }
  }
});

test("reduced motion: the preview ticket has no transition, and nothing animates", async ({ browser }) => {
  const { context, page } = await open(browser, 1280, "light", "reduce");
  const tilt = page.locator(".gp-signin-tilt");
  // The site-wide reduced-motion rule leaves at most 0.01 ms; the tilt does not move on hover/focus at all.
  expect(parseFloat(await tilt.evaluate((e) => getComputedStyle(e).transitionDuration))).toBeLessThanOrEqual(0.00001);
  const before = await tilt.evaluate((e) => getComputedStyle(e).rotate);
  await page.getByTestId("signin-pass-preview").getByRole("link", { name: "See the whole pass" }).focus();
  expect(await tilt.evaluate((e) => getComputedStyle(e).rotate)).toBe(before);
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a instanceof CSSAnimation).length)).toBe(0);
  await context.close();
});

test("keyboard: the preview link shows a visible focus ring", async ({ page }) => {
  await page.goto("/signin");
  const link = page.getByTestId("signin-pass-preview").getByRole("link", { name: "See the whole pass" });
  await link.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  const outline = await link.evaluate((e) => {
    const s = getComputedStyle(e);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
  });
  expect(outline.style).not.toBe("none");
  expect(outline.width).toBeGreaterThanOrEqual(2);
});
