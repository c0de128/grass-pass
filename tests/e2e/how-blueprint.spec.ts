import { readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// /how-it-works "Blueprint" (Kevin 2026-10-09: "a page that shows the services the app uses and how it implements AI").
// Keyless and static: the diagram, the examples and the numbers come from the app's own files. Checks: the diagram names
// every service and flows the right way at each width, each model example matches its recording on disk, axe is clean
// at every scroll position, nothing scrolls sideways (320-2560 px), and the visible copy stays short.

const ROOT = join(__dirname, "..", "..");
const EXAMPLES = JSON.parse(readFileSync(join(ROOT, "src/data/how/ai-examples.json"), "utf8")) as {
  clue: { fixture: string; factId: string; inExcerpt: string; out: { clue: string; sourceQuote: string } };
  riddle: { fixture: string; out: { riddle: string; sourceQuote: string } };
  tips: { fixture: string; factId: string; inExcerpt: string; out: { tip: string } };
};
const fixture = (f: string) => JSON.parse(readFileSync(join(ROOT, f), "utf8"));
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const SERVICES = ["OpenStreetMap", "iNaturalist", "Wikipedia", "SerpApi", "Open-Meteo", "weather.gov", "Gemma 4 31B", "Vercel", "Upstash Redis", "Auth.js"];

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("the blueprint names every service, with the open model in the middle stage", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/how-it-works");
  const bp = page.getByTestId("blueprint");
  await expect(bp).toBeVisible();
  for (const name of SERVICES) await expect(bp.getByText(name, { exact: true }).first(), name).toBeVisible();
  const stages = page.getByRole("list", { name: "How data flows into a pass, in 5 stages" }).locator(":scope > li");
  await expect(stages).toHaveCount(5);
  await expect(stages.nth(2)).toContainText("gemma-4-31B-it");
  await expect(stages.nth(2)).toContainText("only AI step");
  // The services table lists the same ten.
  const table = page.getByRole("table", { name: /Every outside service/ });
  for (const name of SERVICES) await expect(table.getByRole("rowheader", { name: new RegExp(name.replace(".", "\\.")) })).toBeVisible();
});

test("the flow is left-to-right from 1280 px and top-to-bottom on a phone", async ({ page }) => {
  const boxes = async () => {
    const stages = page.getByRole("list", { name: "How data flows into a pass, in 5 stages" }).locator(":scope > li");
    return Promise.all([0, 1, 2, 3, 4].map(async (i) => (await stages.nth(i).boundingBox())!));
  };
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/how-it-works");
  const wide = await boxes();
  for (let i = 1; i < 5; i++) expect(wide[i].x, `stage ${i + 1} right of ${i}`).toBeGreaterThan(wide[i - 1].x + wide[i - 1].width - 1);
  await page.setViewportSize({ width: 360, height: 800 });
  const narrow = await boxes();
  for (let i = 1; i < 5; i++) expect(narrow[i].y, `stage ${i + 1} below ${i}`).toBeGreaterThan(narrow[i - 1].y + narrow[i - 1].height - 1);
});

test("each model example on the page matches its real recording on disk", async ({ page }) => {
  await page.goto("/how-it-works");
  // Job 1: the fact sentence, the clue and the proof quote, read from the recorded request and answer.
  const c = fixture(EXAMPLES.clue.fixture);
  const answer = JSON.parse(c.response.choices[0].message.content) as { items: { itemId: string; clue: string; sourceQuote: string }[] };
  const item = answer.items.find((i) => i.itemId === EXAMPLES.clue.factId)!;
  expect(c.request.messages[1].content).toContain(EXAMPLES.clue.inExcerpt);
  const job1 = page.locator("#ai-job-1");
  await expect(job1).toContainText(item.clue);
  await expect(job1.locator("mark")).toHaveText(item.sourceQuote);
  await expect(job1).toContainText(EXAMPLES.clue.inExcerpt);
  await expect(job1.getByRole("link", { name: "Raw answer" })).toHaveAttribute("href", new RegExp(`${EXAMPLES.clue.fixture}$`));
  // Job 2: the riddle.
  const r = fixture(EXAMPLES.riddle.fixture);
  const spot = JSON.parse(r.response.choices[0].message.content).spot as { riddle: string; sourceQuote: string };
  await expect(page.locator("#ai-job-2")).toContainText(spot.riddle);
  await expect(page.locator("#ai-job-2 mark")).toHaveText(spot.sourceQuote);
  // Job 3: the trip tip and its fact.
  const t = fixture(EXAMPLES.tips.fixture);
  const tip = t.response.tips.find((x: { factId: string }) => x.factId === EXAMPLES.tips.factId);
  await expect(page.locator("#ai-job-3")).toContainText(tip.tip);
  await expect(page.locator("#ai-job-3")).toContainText(EXAMPLES.tips.inExcerpt);
});

for (const width of [360, 1280] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`axe is clean at every scroll position, ${width} px, ${scheme}`, async ({ browser }) => {
      // About 15 axe runs on a phone-length page, while the rest of the suite runs in parallel.
      test.setTimeout(150_000);
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width, height: 900 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      await page.goto("/how-it-works");
      await expect(page.getByRole("heading", { level: 1, name: "How a park becomes a pass." })).toBeVisible();
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += 800) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        // As on the home page (home-axe-scroll.spec.ts): below the top, target-size is left out, because a link that sits
        // half under the sticky header at one exact scroll position is not a real small target.
        const builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
        const r = await (y === 0 ? builder : builder.disableRules(["target-size"])).analyze();
        expect(r.violations.map((v) => `${y}px ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      }
      await context.close();
    });
  }
}

test("no sideways scroll from 320 to 2560 px", async ({ page }) => {
  for (const width of [320, 360, 768, 1024, 1280, 1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/how-it-works");
    expect(await overflow(page), `${width} px`).toBeLessThanOrEqual(0);
  }
});

test("reduced motion: the flow arrows do not animate", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/how-it-works");
  const names = await page.locator("[data-testid=blueprint] .gp-how-flow").evaluateAll((els) => els.map((e) => getComputedStyle(e).animationName));
  expect(names.length).toBeGreaterThan(0);
  for (const n of names) expect(n).toBe("none");
  await context.close();
});

test("the visible copy stays short (folded detail not counted)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/how-it-works");
  const words = await page.evaluate(() => {
    const root = document.querySelector("main")!;
    let n = 0;
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = tw.nextNode(); t; t = tw.nextNode()) {
      const el = t.parentElement!;
      const hidden = (() => {
        for (let e: Element | null = el; e && e !== root.parentElement; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (cs.display === "none" || e.classList.contains("sr-only") || e.getAttribute("aria-hidden") === "true") return true;
          if (e.tagName === "DETAILS" && !(e as HTMLDetailsElement).open && !el.closest("summary")) return true;
        }
        return false;
      })();
      if (!hidden) n += (t.textContent?.match(/[A-Za-z0-9$][^\s]*/g) ?? []).length;
    }
    return n;
  });
  // The old page showed 1,046 with this count (measured on the live site, 2026-10-09). Kevin's target is about 400; the
  // real examples and the services table are the rest (see the designer's report).
  expect(words).toBeLessThanOrEqual(820);
});
