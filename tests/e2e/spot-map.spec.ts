import { writeFileSync } from "node:fs";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { passOrSkip } from "./support/honest";
import { judgeAddress, judgeSignInRequest } from "./support/judge";

// S5 Find This Spot: a REAL Celebration Park pass from the running server (live OpenStreetMap,
// iNaturalist and the open model, or today's cached pass). Its only picnic shelter is the X.
// If an upstream is down the honest copy is checked and the tests are SKIPPED with the reason; if
// OpenStreetMap was busy for the map only, the pass carries "No Find This Spot today: ..." and the map
// tests are skipped with that copy (never passed on a missing map).
// Set PRINT_PREVIEW_DIR to save print-preview-S5.png / .pdf (Letter, print media) there.
const WAIT = 95_000;
const CELEBRATION = { id: "way/188145317", name: "Celebration Park" };

test.describe.configure({ mode: "serial" });
test.use({ launchOptions: { args: ["--disable-lcd-text"] } });
// SEC-4-02: this spec's own address for the judge demo's 3 passes per connection.
test.use(judgeAddress(3));

type Spot = { status: string; message?: string; riddle?: string };

async function realPass(request: APIRequestContext, baseURL: string): Promise<{ id: string; items: number; spot?: Spot }> {
  // Accounts: a new pass needs a sign-in (the judge demo; today's saved pass would be served anyway).
  await judgeSignInRequest(request, baseURL);
  const res = await request.post("/api/pass", {
    headers: { "content-type": "application/json", origin: new URL(baseURL).origin },
    data: { parkId: CELEBRATION.id, ageBand: "6-10" },
    timeout: WAIT,
  });
  // Skips with the server's error code when an upstream or a limit stopped it (support/honest.ts, R1-B2).
  const pass = await passOrSkip(res, "Celebration pass for the map");
  return { id: pass.id, items: pass.items.length, spot: pass.spot as Spot | undefined };
}

const pdfPages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

let pass: { id: string; items: number; spot?: Spot };

test.beforeAll(async ({ request, baseURL }) => {
  test.setTimeout(WAIT + 10_000);
  pass = await realPass(request, baseURL!);
});

function needMap() {
  if (pass.spot?.status !== "ok") {
    expect(pass.spot?.message ?? "").toMatch(/^No Find This Spot today: /);
    test.skip(true, `No map on this pass; it gave the honest copy: ${pass.spot?.message}`);
  }
}

test("on screen: the map, the riddle and the OSM credit; the answer only inside the grown-up's answer key", async ({ page }) => {
  needMap();
  await page.goto(`/pass/${pass.id}`);
  const box = page.locator('[data-testid="spot-box"][data-variant="screen"]');
  await expect(box.getByRole("heading", { name: "Find This Spot" })).toBeVisible();
  await expect(box.getByText(pass.spot!.riddle!)).toBeVisible();
  const map = box.getByRole("img", { name: /^Map of Celebration Park drawn from OpenStreetMap, north is up\./ });
  await expect(map).toBeVisible();
  expect((await map.boundingBox())!.width).toBeGreaterThan(250);
  await expect(box.getByRole("link", { name: "© OpenStreetMap contributors" })).toBeVisible();
  await expect(page.getByTestId("spot-answer")).toBeHidden(); // inside the closed answer key
  await page.getByText("Answer key (don't peek, kids!)").click();
  await expect(page.getByTestId("spot-answer")).toContainText(/Find This Spot: The picnic shelter\. .*OpenStreetMap way\/536185861/);
});

test("360 px wide: no horizontal scroll with the map, on the pass page and the print page", async ({ page }) => {
  needMap();
  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of [`/pass/${pass.id}`, `/pass/${pass.id}/print`]) {
    await page.goto(path);
    await expect(page.getByTestId("spot-map").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }
});

test("print: map + riddle on the kid pass, answer on the stub, ONE page (Letter and A4), scale >= 0.91 (SPEC §8.4), black and white", async ({ page }) => {
  needMap();
  await page.goto(`/pass/${pass.id}/print`);
  await expect(page.locator(".gp-sheet[data-fit]")).toHaveCount(1);
  await page.emulateMedia({ media: "print", colorScheme: "light" });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const sheet = page.getByRole("article", { name: `Printable Grass Pass for ${CELEBRATION.name}` });
  const kid = sheet.locator(".gp-kid");
  await expect(kid.getByRole("heading", { name: "Find This Spot" })).toBeVisible();
  await expect(kid.getByText(pass.spot!.riddle!)).toBeVisible();
  await expect(kid.getByRole("img", { name: /^Map of Celebration Park/ })).toBeVisible();
  await expect(kid.getByText("Map: © OpenStreetMap contributors")).toBeVisible();
  await expect(kid).not.toContainText("picnic shelter");
  await expect(sheet.locator(".gp-stub").getByTestId("spot-answer")).toContainText("Find This Spot: The picnic shelter.");
  // PM decision (c): no evidence in the stub answers; the October details are on the stub, the kid box is short.
  await expect(sheet.locator(".gp-answers")).not.toContainText("OpenStreetMap)");
  await expect(sheet.locator('.gp-stub [data-slot="october-source"]')).toContainText(/^October box: /);
  await expect(kid.locator('[data-testid="october-box"] p')).toHaveCount(2);

  // The map prints >= 3.1 in wide, so its thinnest line (2.2 of 420 units) is >= 1 pt.
  expect((await kid.getByTestId("spot-map").boundingBox())!.width).toBeGreaterThanOrEqual(3.1 * 96);

  const fit = Number(await sheet.getAttribute("data-fit"));
  const bodyPt = await sheet.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) * 0.75);
  test.info().annotations.push({
    type: "note",
    description: `Celebration print scale ${fit}; body ${bodyPt} pt at 100% = ${(bodyPt * fit).toFixed(2)} pt printed; ${pass.items} finds`,
  });
  expect(fit).toBeGreaterThanOrEqual(0.91);

  const letter = await page.pdf({ preferCSSPageSize: true, printBackground: false });
  expect(pdfPages(letter)).toBe(1);
  const a4 = await page.pdf({ format: "A4", margin: { top: "0.4in", bottom: "0.4in", left: "0.4in", right: "0.4in" }, printBackground: false });
  expect(pdfPages(a4)).toBe(1);
  if (process.env.PRINT_PREVIEW_DIR) writeFileSync(`${process.env.PRINT_PREVIEW_DIR}/print-preview-S5.pdf`, letter);

  // No coloured pixel on the printed map, and real black ink on it.
  const png = await kid.getByTestId("spot-map").screenshot();
  const px = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let coloured = 0;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      const max = Math.max(d[i], d[i + 1], d[i + 2]);
      if (max - Math.min(d[i], d[i + 1], d[i + 2]) > 12) coloured++;
      if (max < 60) dark++;
    }
    return { coloured, dark, total: d.length / 4 };
  }, png.toString("base64"));
  expect(px.coloured).toBe(0);
  expect(px.dark).toBeGreaterThan(px.total * 0.03);
});

test.describe("preview", () => {
  test.use({ deviceScaleFactor: 2 });
  test("print preview image with the map for Kevin (only with PRINT_PREVIEW_DIR)", async ({ page }) => {
    test.skip(!process.env.PRINT_PREVIEW_DIR, "Set PRINT_PREVIEW_DIR to save the preview PNG.");
    needMap();
    await page.setViewportSize({ width: 816, height: 1056 });
    await page.goto(`/pass/${pass.id}/print`);
    await expect(page.locator(".gp-sheet[data-fit]")).toHaveCount(1);
    await page.emulateMedia({ media: "print", colorScheme: "light" });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.addStyleTag({ content: "body{padding:0.4in !important;background:#fff !important}" });
    await page.screenshot({ path: `${process.env.PRINT_PREVIEW_DIR}/print-preview-S5.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(1056);
  });
});
