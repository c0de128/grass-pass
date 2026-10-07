import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// Round 8 (Q-8-01): the LONGEST real sheets must print on ONE page with room to spare, keyless. The first real
// full-feature teens & adults (13+) pass (Arbor Hills, Oct 7: model riddle, 2 Lucky Finds, the October box) was put on 2
// pages by the print planner at the 0.91 floor. These are recorded real passes from tests/fixtures, opened on the real
// print route because playwright.config.ts starts the server with GP_E2E_FIXTURE_PASSES=1 (src/lib/pass/e2e-fixtures.ts).
// Playwright loads specs as CommonJS here (no import.meta), so the path comes from __dirname.
const FIX = join(__dirname, "..", "fixtures");
type Fixture = { file: string; id: string; band: string; park: string; riddleBy: string | null; lucky: number; october: boolean };
const load = (file: string): Fixture => {
  const p = (JSON.parse(readFileSync(join(FIX, file), "utf8")) as {
    pass: { id: string; ageBand: string; park: { name: string }; spot?: { status: string; riddleBy?: string }; items: { section: string }[]; october?: unknown };
  }).pass;
  return {
    file,
    id: p.id,
    band: p.ageBand,
    park: p.park.name,
    riddleBy: p.spot?.status === "ok" ? (p.spot.riddleBy ?? null) : null,
    lucky: p.items.filter((i) => i.section === "lucky").length,
    october: p.october !== undefined,
  };
};
const ARBOR_13 = load("pass-arbor-hills-13plus-full-live.json");
const FIXTURES = [
  ARBOR_13,
  load("pass-celebration-13plus-live.json"),
  load("pass-oak-point-13plus-live.json"),
  load("pass-white-rock-13plus-live.json"),
  load("pass-arbor-hills-lucky-live.json"),
  load("pass-white-rock-13plus-r8-live.json"),
];

/** PrintFit's numbers (src/components/pass/PrintFit.tsx): the page budget, the floors and the last compaction level. */
const PRINT_HEIGHT_PX = 10.2 * 96 - 8;
const PRINT_WIDTH_PX = 7.7 * 96;
const MAX_COMPACT = 4;
/** Room left at the floor with every optional line left out: the sheet is nowhere near a second page. */
const MIN_HEADROOM_PX = 30;

test.use({ launchOptions: { args: ["--disable-lcd-text"] } });

/** Number of pages in a Chromium PDF (page objects are written uncompressed). */
const pdfPages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

test("the full-feature 13+ fixture really is full-feature (model riddle, Lucky Finds, October box)", () => {
  expect(ARBOR_13.band).toBe("13+");
  expect(ARBOR_13.riddleBy).toBe("model");
  expect(ARBOR_13.lucky).toBe(2);
  expect(ARBOR_13.october).toBe(true);
});

for (const fx of FIXTURES) {
  test(`${fx.file}: prints on ONE page (Letter and A4) with room to spare`, async ({ page }) => {
    const res = await page.goto(`/pass/${fx.id}/print`);
    expect(res?.status(), "the server must run with GP_E2E_FIXTURE_PASSES=1 (playwright.config.ts sets it)").toBe(200);
    await expect(page.locator(".gp-sheet[data-fit]")).toHaveCount(1);
    const sheet = page.locator(".gp-sheet");
    await expect(sheet).toHaveAttribute("data-pages", "1");
    await expect(page.getByTestId("print-two-pages")).toHaveCount(0);
    await page.emulateMedia({ media: "print", colorScheme: "light" });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    // Headroom: an off-screen copy at the floor with every optional line left out (the planner's worst case).
    const m = await page.evaluate(
      ({ PRINT_HEIGHT_PX, PRINT_WIDTH_PX, MAX_COMPACT }) => {
        const s = document.querySelector<HTMLElement>(".gp-sheet:not(.gp-measure)")!;
        const kidEl = s.querySelector<HTMLElement>(".gp-kid")!;
        const adult = kidEl.dataset.audience === "adult";
        const floor = adult ? 0.87 : 0.91;
        const kidZoom = kidEl.dataset.density === "tight" ? 0.86 : 1;
        const copy = s.cloneNode(true) as HTMLElement;
        copy.classList.add("gp-measure");
        copy.removeAttribute("data-fit");
        copy.style.removeProperty("--gp-fit");
        copy.dataset.compact = String(MAX_COMPACT);
        for (const el of copy.querySelectorAll("[id]")) el.removeAttribute("id");
        copy.style.zoom = String(floor);
        copy.style.width = `${PRINT_WIDTH_PX / floor}px`;
        copy.style.setProperty("--gp-map-col", `${Math.max(3.27, Math.ceil((3.12 / (floor * kidZoom)) * 100) / 100)}in`);
        document.body.appendChild(copy);
        const h = copy.querySelector(".gp-stub")!.getBoundingClientRect().bottom - copy.querySelector(".gp-kid")!.getBoundingClientRect().top;
        copy.remove();
        const fit = Number(s.dataset.fit);
        const cluePt = (parseFloat(getComputedStyle(s.querySelector(".gp-clue")!).fontSize) * 72) / 96;
        return { headroom: PRINT_HEIGHT_PX - h, fit, floor, adult, density: kidEl.dataset.density, printedCluePt: cluePt * fit * kidZoom };
      },
      { PRINT_HEIGHT_PX, PRINT_WIDTH_PX, MAX_COMPACT },
    );
    expect(m.adult, `${fx.file}: audience`).toBe(fx.band === "13+");
    expect(m.fit).toBeGreaterThanOrEqual(m.floor);
    expect(m.headroom, `${fx.file}: px left at the floor with every optional line out`).toBeGreaterThanOrEqual(MIN_HEADROOM_PX);
    // SPEC §8.4: the clue prints at 10 pt or more on every band.
    expect(m.printedCluePt, `${fx.file}: printed clue size`).toBeGreaterThanOrEqual(9.99);
    if (m.adult) expect(m.density).not.toBe("tight");

    const letter = await page.pdf({ preferCSSPageSize: true, printBackground: false });
    expect(pdfPages(letter), `${fx.file}: Letter pages`).toBe(1);
    const a4 = await page.pdf({ format: "A4", margin: { top: "0.4in", bottom: "0.4in", left: "0.4in", right: "0.4in" }, printBackground: false });
    expect(pdfPages(a4), `${fx.file}: A4 pages`).toBe(1);
  });
}

test("13+ pages carry no kid wording; the fixed Find This Spot line is not said twice", async ({ page }) => {
  for (const fx of FIXTURES.filter((f) => f.band === "13+")) {
    await page.goto(`/pass/${fx.id}/print`);
    await expect(page.locator(".gp-sheet[data-fit]")).toHaveCount(1);
    expect(await page.locator("main").innerText(), `${fx.file}: print page`).not.toMatch(/grown-up|\bkids?\b|next family/i);
    await page.goto(`/pass/${fx.id}`);
    const main = await page.locator("main").innerText();
    expect(main, `${fx.file}: pass page`).not.toMatch(/grown-up|next family/i);
    const spot = page.locator('[data-testid="spot-box"][data-variant="screen"]');
    if (fx.riddleBy === "code") {
      // UX-8-05: the fixed riddle says "Follow the map from START to the X"; the second line would repeat it.
      await expect(spot.getByText(/follow the map/i)).toHaveCount(1);
    } else if (fx.riddleBy === "model") {
      await expect(spot.getByText(/follow the map to the X/i)).toHaveCount(1);
    }
  }
});
