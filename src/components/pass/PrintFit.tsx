"use client";

import { useEffect } from "react";

/** Printable height of US Letter with 0.4 in margins, in CSS px (10.2 in x 96), minus a rounding margin. */
export const PRINT_HEIGHT_PX = 10.2 * 96 - 8;
/** Printable width of US Letter with 0.4 in margins, in CSS px (7.7 in x 96). */
export const PRINT_WIDTH_PX = 7.7 * 96;
/** Never shrink below this: a second page is more honest than unreadable text. */
export const MIN_FIT = 0.85;

/**
 * Scale factor so content `heightPx` tall fits one printed page: 1 when it already fits, else the
 * ratio rounded DOWN to 2 decimals, never below MIN_FIT.
 */
export function fitFor(heightPx: number, pageHeightPx: number = PRINT_HEIGHT_PX): number {
  if (!(heightPx > 0) || heightPx <= pageHeightPx) return 1;
  return Math.max(MIN_FIT, Math.floor((pageHeightPx / heightPx) * 100) / 100);
}

/** Lays out an invisible off-screen copy of the sheet at the printed width (7.7 in) for measuring. */
function measuringCopy(sheet: HTMLElement): { height: (zoom: number) => number | null; done: () => void } {
  const copy = sheet.cloneNode(true) as HTMLElement;
  copy.classList.add("gp-measure");
  copy.setAttribute("aria-hidden", "true");
  copy.removeAttribute("data-fit");
  copy.style.removeProperty("--gp-fit");
  for (const el of copy.querySelectorAll("[id]")) el.removeAttribute("id");
  document.body.appendChild(copy);
  const kid = copy.querySelector(".gp-kid");
  const stub = copy.querySelector(".gp-stub");
  return {
    height: (zoom) => {
      if (!kid || !stub) return null;
      // In print the sheet is 100% of the page, so zoom leaves it the full width and the text reflows
      // into the extra room. Model that: the zoomed copy must still render exactly 7.7 in wide.
      copy.style.zoom = String(zoom);
      copy.style.width = `${PRINT_WIDTH_PX / zoom}px`;
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
export function bestFit(height: (zoom: number) => number | null, pageHeightPx: number = PRINT_HEIGHT_PX): number | null {
  const full = height(1);
  if (full === null) return null;
  let fit = fitFor(full, pageHeightPx);
  if (fit === 1) return 1;
  for (let next = Math.round((fit + 0.01) * 100) / 100; next < 1; next = Math.round((next + 0.01) * 100) / 100) {
    const h = height(next);
    if (h === null || h > pageHeightPx) break;
    fit = next;
  }
  return fit;
}

/**
 * Safety net for the one-page rule (SPEC F6). Measures an off-screen copy of the sheet at the
 * printed width (7.7 in), on any screen size, and sets `--gp-fit`, which print.css applies as a
 * print-only `zoom` when the sheet would spill onto a second page. Renders nothing. Without
 * JavaScript the server-picked density (KidPass `data-density`) still applies.
 */
export function PrintFit() {
  useEffect(() => {
    const sheet = document.querySelector<HTMLElement>(".gp-sheet:not(.gp-measure)");
    if (!sheet) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const copy = measuringCopy(sheet);
      let fit: number | null;
      try {
        fit = bestFit(copy.height);
      } finally {
        copy.done();
      }
      if (fit === null) return;
      sheet.dataset.fit = String(fit);
      sheet.style.setProperty("--gp-fit", String(fit));
    };
    void document.fonts?.ready.then(measure);
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
