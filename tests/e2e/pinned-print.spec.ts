import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// Pinned example passes (src/lib/pinned.ts): real passes committed in the repo. They open from the repo with no key and
// no store, so this check runs keyless. Every pinned pass must open on its pass page and print on ONE page (Letter and
// A4), the same check print.spec.ts runs on a fresh live pass. A new file in src/data/pinned-examples is covered too.
// Playwright loads specs as CommonJS here (no import.meta), so the path comes from __dirname.
const DIR = join(__dirname, "..", "..", "src", "data", "pinned-examples");
const PINNED = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => {
    const pass = (JSON.parse(readFileSync(join(DIR, f), "utf8")) as { pass: { id: string; park: { name: string }; items: { clue: string }[] } }).pass;
    return { file: f, id: pass.id, park: pass.park.name, firstClue: pass.items[0]!.clue };
  });

test.use({ launchOptions: { args: ["--disable-lcd-text"] } });

/** Number of pages in a Chromium PDF (page objects are written uncompressed). */
const pdfPages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

test("there is at least one pinned pass", () => {
  expect(PINNED.length).toBeGreaterThan(0);
});

for (const pin of PINNED) {
  test(`pinned ${pin.file}: the pass page opens it and it prints on ONE page (Letter and A4)`, async ({ page }) => {
    const res = await page.goto(`/pass/${pin.id}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(pin.park);
    await expect(page.getByText(pin.firstClue).first()).toBeVisible();

    await page.goto(`/pass/${pin.id}/print`);
    await expect(page.locator(".gp-sheet[data-fit]")).toHaveCount(1);
    await page.emulateMedia({ media: "print", colorScheme: "light" });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const letter = await page.pdf({ preferCSSPageSize: true, printBackground: false });
    expect(pdfPages(letter), `${pin.file}: Letter pages`).toBe(1);
    const a4 = await page.pdf({ format: "A4", margin: { top: "0.4in", bottom: "0.4in", left: "0.4in", right: "0.4in" }, printBackground: false });
    expect(pdfPages(a4), `${pin.file}: A4 pages`).toBe(1);
  });
}
