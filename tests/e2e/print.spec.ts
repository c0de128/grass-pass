import { writeFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { passOrSkip } from "./support/honest";

// S4 print: a REAL pass from the running server (live OpenStreetMap + iNaturalist + the open model,
// or today's cached pass when the server already made it), printed with print media emulation.
// If an upstream is down, the honest error copy is checked and the test is SKIPPED with the reason.
// Set PRINT_PREVIEW_DIR to also save print-preview-S5-connemara.png (Letter, print media) and .pdf there.
const WAIT = 95_000;
const CONNEMARA = { id: "way/306191453", name: "Connemara Meadow Preserve" };

test.describe.configure({ mode: "serial" });
// Screenshots use LCD subpixel text antialiasing by default (blue/orange fringes on black text), which
// is a screen artefact, not ink. Grayscale antialiasing shows what a printer gets.
test.use({ launchOptions: { args: ["--disable-lcd-text"] } });

/** Ask the server for today's pass the way the page does (same origin, JSON), reading the stream to the end. */
async function realPassId(request: APIRequestContext, baseURL: string): Promise<{ id: string; items: number }> {
  const res = await request.post("/api/pass", {
    headers: { "content-type": "application/json", origin: new URL(baseURL).origin },
    data: { parkId: CONNEMARA.id, ageBand: "6-10" },
    timeout: WAIT,
  });
  // Skips with the server's error code when an upstream or a limit stopped it (support/honest.ts, R1-B2).
  const pass = await passOrSkip(res, "Connemara pass for printing");
  return { id: pass.id, items: pass.items.length };
}

test("a print link for a pass that isn't saved says so and links back", async ({ page }) => {
  const res = await page.goto("/pass/w1-6to10-20200101-1/print");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "No pass here" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Make a pass" })).toHaveAttribute("href", "/");
});

test.describe("a real pass", () => {
  let pass: { id: string; items: number };

  test.beforeAll(async ({ request, baseURL }) => {
    test.setTimeout(WAIT + 10_000);
    pass = await realPassId(request, baseURL!);
  });

  /** Number of pages in a Chromium PDF (page objects are written uncompressed). */
  const pdfPages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

  /** Open the print page the way a person does: it loads and measures itself (PrintFit), then prints. */
  async function openPrint(page: Page) {
    await page.goto(`/pass/${pass.id}/print`);
    await expect(page.locator(".gp-sheet[data-fit]")).toHaveCount(1);
    await page.emulateMedia({ media: "print", colorScheme: "light" });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
  }

  test("the pass page's Print pass button opens the print layout and the print dialog once", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __prints: number }).__prints = 0;
      window.print = () => {
        (window as unknown as { __prints: number }).__prints++;
      };
    });
    await page.goto(`/pass/${pass.id}`);
    const link = page.getByRole("link", { name: "Print pass" });
    await expect(link).toHaveAttribute("href", `/pass/${pass.id}/print?print=1`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/pass/${pass.id}/print$`));
    await expect.poll(() => page.evaluate(() => (window as unknown as { __prints: number }).__prints)).toBe(1);

    // The on-page button prints again; reloading (no ?print=1) does not auto-print.
    await page.getByRole("button", { name: "Print pass" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __prints: number }).__prints)).toBe(2);
    await page.reload();
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => (window as unknown as { __prints: number }).__prints)).toBe(0);
  });

  test("print media: kid pass, tear line and parent stub only; site header and toolbar hidden", async ({ page }) => {
    await openPrint(page);
    const sheet = page.getByRole("article", { name: `Printable Grass Pass for ${CONNEMARA.name}` });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading", { level: 1, name: `Park: ${CONNEMARA.name}` })).toBeVisible();
    await expect(sheet.locator("li.gp-find")).toHaveCount(pass.items);
    await expect(sheet.getByRole("separator", { name: /Cut or tear here/ })).toBeVisible();
    await expect(sheet.getByRole("heading", { name: "For the grown-up: answer key" })).toBeVisible();
    await expect(sheet.getByText(/^Clues: gemma-4-31B-it \(open model, Apache-2\.0\), made /)).toBeVisible();
    await expect(sheet.getByText(/^Map: © OpenStreetMap contributors \(ODbL\), checked /)).toBeVisible();
    await expect(sheet.locator('img[src="/logo-print-1c.svg"]')).toBeVisible();
    expect(await sheet.locator('img[src="/logo-print-1c.svg"]').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    // Only the sheet prints.
    await expect(page.locator("body > header")).toBeHidden();
    await expect(page.getByRole("button", { name: "Print pass" })).toBeHidden();
    await expect(page.getByRole("link", { name: "Back to the pass" })).toBeHidden();
    // S7 October box sits in its slot (every pass made in October). Connemara has no single landmark on
    // the map (S5), so there is no Find This Spot slot at all and the stub says why (SPEC 5.4 copy).
    // The map itself is tested on Celebration Park in spot-map.spec.ts.
    const october = sheet.locator('[data-slot="october"] [data-testid="october-box"][data-variant="print"]');
    await expect(october).toHaveCount(1);
    await expect(october.getByRole("heading", { name: "October special: monarch butterflies" })).toBeVisible();
    await expect(sheet.locator('[data-slot="spot"]')).toHaveCount(0);
    await expect(sheet.getByText(/^No Find This Spot today: /)).toBeVisible();
    const fit = await sheet.getAttribute("data-fit");
    test.info().annotations.push({ type: "note", description: `PrintFit print scale for this real pass: ${fit}` });
    expect(Number(fit)).toBeGreaterThanOrEqual(0.91); // SPEC §8.4, PrintFit MIN_FIT (R2-m4)

    // Checkboxes are at least 7 mm (96 px per inch -> 7 mm = 26.5 px).
    const box = await sheet.locator(".gp-box").first().boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(26.4);
    expect(box!.height).toBeGreaterThanOrEqual(26.4);
  });

  test("prints on ONE page on Letter and on A4", async ({ page }) => {
    await openPrint(page);
    const letter = await page.pdf({ preferCSSPageSize: true, printBackground: false });
    expect(pdfPages(letter)).toBe(1);
    const a4 = await page.pdf({ format: "A4", margin: { top: "0.4in", bottom: "0.4in", left: "0.4in", right: "0.4in" }, printBackground: false });
    expect(pdfPages(a4)).toBe(1);

    if (process.env.PRINT_PREVIEW_DIR) {
      writeFileSync(`${process.env.PRINT_PREVIEW_DIR}/print-preview-S5-connemara.pdf`, letter);
    }
  });

  test("print media has no colour and no light greys: every pixel is neutral, all text and lines are black", async ({ page }) => {
    await openPrint(page);
    const sheet = page.locator(".gp-sheet");

    // 1. Computed styles: text and visible borders are pure black, backgrounds white or none.
    const bad = await sheet.evaluate((root) => {
      const out: string[] = [];
      const ok = (c: string) => c === "rgb(0, 0, 0)";
      for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
        const s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden") continue;
        if (el.closest(".sr-only")) continue;
        // next/image sets color: transparent on <img> (alt-text styling only); the pixels are checked below.
        if (!ok(s.color) && el.tagName !== "IMG") out.push(`${el.tagName}.${el.className} color ${s.color}`);
        for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
          const w = parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`));
          if (w > 0 && s.getPropertyValue(`border-${side.toLowerCase()}-style`) !== "none") {
            const c = s.getPropertyValue(`border-${side.toLowerCase()}-color`);
            if (!ok(c)) out.push(`${el.tagName}.${el.className} border-${side} ${c}`);
          }
        }
        const bg = s.backgroundColor;
        if (bg !== "rgba(0, 0, 0, 0)" && bg !== "rgb(255, 255, 255)") out.push(`${el.tagName}.${el.className} background ${bg}`);
        if (Number(s.opacity) < 1) out.push(`${el.tagName}.${el.className} opacity ${s.opacity}`);
      }
      return out;
    });
    expect(bad).toEqual([]);

    // 2. Pixels: a screenshot of the sheet in print media has no coloured pixel (antialiasing of
    //    black on white is grey, so only r = g = b is allowed, with a tiny tolerance).
    const png = await sheet.screenshot();
    const coloured = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) {
        const max = Math.max(d[i], d[i + 1], d[i + 2]);
        const min = Math.min(d[i], d[i + 1], d[i + 2]);
        if (max - min > 12) n++;
        if (max < 60) dark++;
      }
      return { n, dark, total: d.length / 4 };
    }, png.toString("base64"));
    expect(coloured.n).toBe(0);
    expect(coloured.dark).toBeGreaterThan(coloured.total * 0.01); // there really is black ink on it
  });

  test.describe("preview", () => {
    test.use({ deviceScaleFactor: 2 });
    test("print preview image for Kevin (only with PRINT_PREVIEW_DIR)", async ({ page }) => {
    test.skip(!process.env.PRINT_PREVIEW_DIR, "Set PRINT_PREVIEW_DIR to save the preview PNG.");
    // Letter (816 x 1056 CSS px, drawn at 2x for a sharp image) with the 0.4 in page margin as white
    // space, in print media.
    await page.setViewportSize({ width: 816, height: 1056 });
    await openPrint(page);
    await page.addStyleTag({ content: "body{padding:0.4in !important;background:#fff !important}" });
    await page.screenshot({ path: `${process.env.PRINT_PREVIEW_DIR}/print-preview-S5-connemara.png`, fullPage: true });
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    test.info().annotations.push({ type: "note", description: `Preview height ${height}px (Letter = 1056px)` });
    expect(height).toBeLessThanOrEqual(1056);
  });
  });
});
