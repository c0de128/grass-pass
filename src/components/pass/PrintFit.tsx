"use client";

import { useEffect, useState } from "react";

/** Printable height of US Letter with 0.4 in margins, in CSS px (10.2 in x 96), minus a rounding margin. */
export const PRINT_HEIGHT_PX = 10.2 * 96 - 8;
/** Printable width of US Letter with 0.4 in margins, in CSS px (7.7 in x 96). */
export const PRINT_WIDTH_PX = 7.7 * 96;
/** Never shrink below this (SPEC §8.4: an 11 pt clue prints >= 10 pt): a second page is more honest than unreadable text. */
export const MIN_FIT = 0.91;
/**
 * Round 8 (Q-8-01): the floor for a teens & adults (13+) sheet. A 13+ sheet is the tallest by design (the 13+ prompt asks
 * for 10-18 words a clue), and the first real full-feature one (Arbor Hills: model riddle, 2 Lucky Finds, the October
 * box) did not fit at 0.91 even with every optional line left out. A 13+ sheet is never "tight" (KidPass passDensity), so
 * its clue is 11.5 pt (snug) or 12.5 pt (roomy): at 0.87 it still prints >= 10 pt (SPEC §8.4), the checkbox stays >= 7 mm
 * (8.3 mm x 0.87 = 7.2 mm) and the map column still widens so the map prints >= 3.1 in (mapColumnFor).
 */
export const ADULT_MIN_FIT = 0.87;

/** The print floor for a sheet: kid passes keep MIN_FIT; a 13+ sheet (`data-audience="adult"` on .gp-kid) gets ADULT_MIN_FIT. */
export function minFitFor(audience: string | undefined): number {
  return audience === "adult" ? ADULT_MIN_FIT : MIN_FIT;
}

/** The map column at 100% (print.css default), in inches. */
export const MAP_COL_IN = 3.27;
/**
 * The map must PRINT at least 3.1 in wide, so its thinnest line (2.2 of 420 map units) is >= 1 pt (ADR 0004).
 * 3.12 leaves a little room for rounding.
 */
export const MAP_MIN_PRINTED_IN = 3.12;

/**
 * Width of the Find This Spot map column (inches, 2 decimals, rounded up) so the map still prints
 * >= MAP_MIN_PRINTED_IN after the print scale `fit` and the kid half's own zoom (0.86 when its density is tight).
 */
export function mapColumnFor(fit: number, kidZoom = 1): number {
  const scale = fit * kidZoom;
  if (!(scale > 0)) return MAP_COL_IN;
  return Math.max(MAP_COL_IN, Math.ceil((MAP_MIN_PRINTED_IN / scale) * 100) / 100);
}

/** The kid half's own zoom, from its server-picked density (print.css: tight = zoom 0.86). */
function kidZoomOf(root: ParentNode): number {
  return root.querySelector<HTMLElement>(".gp-kid")?.dataset.density === "tight" ? 0.86 : 1;
}

/**
 * Scale factor so content `heightPx` tall fits one printed page: 1 when it already fits, else the
 * ratio rounded DOWN to 2 decimals, never below MIN_FIT.
 */
export function fitFor(heightPx: number, pageHeightPx: number = PRINT_HEIGHT_PX, minFit: number = MIN_FIT): number {
  if (!(heightPx > 0) || heightPx <= pageHeightPx) return 1;
  return Math.max(minFit, Math.floor((pageHeightPx / heightPx) * 100) / 100);
}

/** Lays out an invisible off-screen copy of the sheet at the printed width (7.7 in) for measuring. */
function measuringCopy(sheet: HTMLElement): { height: (zoom: number, compact?: number) => number | null; done: () => void } {
  const copy = sheet.cloneNode(true) as HTMLElement;
  copy.classList.add("gp-measure");
  copy.setAttribute("aria-hidden", "true");
  copy.removeAttribute("data-fit");
  copy.style.removeProperty("--gp-fit");
  for (const el of copy.querySelectorAll("[id]")) el.removeAttribute("id");
  document.body.appendChild(copy);
  const kid = copy.querySelector(".gp-kid");
  const stub = copy.querySelector(".gp-stub");
  const kidZoom = kidZoomOf(copy);
  return {
    height: (zoom, compact = 0) => {
      if (!kid || !stub) return null;
      // UX-7-01: the optional print lines this compaction level leaves out (print.css [data-print-drop]).
      if (compact > 0) copy.dataset.compact = String(compact);
      else delete copy.dataset.compact;
      // In print the sheet is 100% of the page, so zoom leaves it the full width and the text reflows
      // into the extra room. Model that: the zoomed copy must still render exactly 7.7 in wide.
      copy.style.zoom = String(zoom);
      copy.style.width = `${PRINT_WIDTH_PX / zoom}px`;
      // A smaller print scale gets a wider map column, so the map never prints under 3.1 in (and the
      // taller map is part of what is measured).
      copy.style.setProperty("--gp-map-col", `${mapColumnFor(zoom, kidZoom)}in`);
      return stub.getBoundingClientRect().bottom - kid.getBoundingClientRect().top;
    },
    done: () => copy.remove(),
  };
}

/**
 * The largest print scale (2 decimals, >= MIN_FIT) at which the sheet fits one page. Zoom also gives
 * each line more room (fewer wraps), so the plain ratio is only a starting point; we step up from it
 * while the zoomed copy still fits.
 */
export function bestFit(height: (zoom: number) => number | null, pageHeightPx: number = PRINT_HEIGHT_PX, minFit: number = MIN_FIT): number | null {
  const full = height(1);
  if (full === null) return null;
  let fit = fitFor(full, pageHeightPx, minFit);
  if (fit === 1) return 1;
  // The plain ratio can be a little too big when a smaller scale also makes something taller (the
  // wider map column): step down until the copy really fits, never below the floor.
  while (fit > minFit) {
    const h = height(fit);
    if (h === null || h <= pageHeightPx) break;
    fit = Math.max(minFit, Math.round((fit - 0.01) * 100) / 100);
  }
  for (let next = Math.round((fit + 0.01) * 100) / 100; next < 1; next = Math.round((next + 0.01) * 100) / 100) {
    const h = height(next);
    if (h === null || h > pageHeightPx) break;
    fit = next;
  }
  return fit;
}

/**
 * UX-7-01 (round 7: the White Rock example printed on 2 pages at the 0.91 floor): optional print lines, left out in
 * this order only when the sheet would not fit one page even at MIN_FIT. Every one of them is still on the screen
 * pass page; nothing a kid needs to play, no safety line and no source credit is ever dropped.
 *   1: the kid's October tip line and the OpenStreetMap ids in the stub's Find This Spot answer;
 *   2: the October details paragraph on the stub (the kid's box keeps the counts);
 *   3: the Find This Spot map legend;
 *   4: the kid's October box.
 */
export const MAX_COMPACT = 4;

export type PrintPlan = { fit: number; compact: number; overflow: boolean };

/**
 * The print plan: the largest scale >= MIN_FIT with as few optional lines left out as possible. `overflow` is true
 * only when even MAX_COMPACT at MIN_FIT is taller than one page (the page then says it prints on 2 pages).
 */
export function bestPlan(
  height: (zoom: number, compact: number) => number | null,
  pageHeightPx: number = PRINT_HEIGHT_PX,
  minFit: number = MIN_FIT,
): PrintPlan | null {
  let last: PrintPlan | null = null;
  for (let compact = 0; compact <= MAX_COMPACT; compact++) {
    const fit = bestFit((z) => height(z, compact), pageHeightPx, minFit);
    if (fit === null) return null;
    const h = height(fit, compact);
    if (h !== null && h <= pageHeightPx) return { fit, compact, overflow: false };
    last = { fit, compact, overflow: true };
  }
  return last;
}

/** Shown on screen above the sheet when even the compact sheet runs onto a second page (never on paper). */
export const PRINT_TWO_PAGES = "This pass is long: it prints on 2 pages. The second page holds the end of the grown-up's answer key.";
/** Q-8-05: the same line for a teens & adults (13+) sheet, which has no grown-up (its stub is the "Answer stub"). */
export const PRINT_TWO_PAGES_ADULT = "This pass is long: it prints on 2 pages. The second page holds the end of the answer stub.";

/** The 2-page line for a sheet's audience (kid wording unless the sheet says it is a 13+ sheet). */
export function printTwoPagesText(audience: string | undefined): string {
  return audience === "adult" ? PRINT_TWO_PAGES_ADULT : PRINT_TWO_PAGES;
}

/**
 * Safety net for the one-page rule (SPEC F6). Measures an off-screen copy of the sheet at the
 * printed width (7.7 in), on any screen size, and sets `--gp-fit`, which print.css applies as a
 * print-only `zoom` when the sheet would spill onto a second page; below the floor it leaves out optional print
 * lines (`data-compact`, see MAX_COMPACT). Renders nothing unless the sheet still needs 2 pages, then one honest
 * screen-only line. Without JavaScript the server-picked density (KidPass `data-density`) still applies.
 */
export function PrintFit() {
  const [overflow, setOverflow] = useState<string | null>(null);
  useEffect(() => {
    const sheet = document.querySelector<HTMLElement>(".gp-sheet:not(.gp-measure)");
    if (!sheet) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const audience = sheet.querySelector<HTMLElement>(".gp-kid")?.dataset.audience;
      const copy = measuringCopy(sheet);
      let plan: PrintPlan | null;
      try {
        plan = bestPlan(copy.height, PRINT_HEIGHT_PX, minFitFor(audience));
      } finally {
        copy.done();
      }
      if (plan === null) return;
      if (plan.compact > 0) sheet.dataset.compact = String(plan.compact);
      else delete sheet.dataset.compact;
      sheet.dataset.pages = plan.overflow ? "2" : "1";
      sheet.dataset.fit = String(plan.fit);
      sheet.style.setProperty("--gp-fit", String(plan.fit));
      sheet.style.setProperty("--gp-map-col", `${mapColumnFor(plan.fit, kidZoomOf(sheet))}in`);
      setOverflow(plan.overflow ? printTwoPagesText(audience) : null);
    };
    void document.fonts?.ready.then(measure);
    return () => {
      cancelled = true;
    };
  }, []);
  return overflow ? (
    <p className="gp-screen-only mx-auto w-full max-w-[8.5in] text-lg font-semibold" role="status" data-testid="print-two-pages">
      {overflow}
    </p>
  ) : null;
}
