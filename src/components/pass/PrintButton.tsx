"use client";

import { useEffect, useRef } from "react";
import { buttonClassName } from "@/components/ui/Button";

/** Wait for fonts, images and the fit measurement so the print dialog never shows a half-drawn sheet. */
async function readyToPrint(): Promise<void> {
  const images = Array.from(document.images).map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined)));
  await Promise.all([document.fonts?.ready, ...images]);
  // One more frame so PrintFit has measured the sheet and set its print scale.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * "Print pass": opens the browser print dialog (ADR 0004, no PDF library). With `auto`, it opens
 * the dialog once when the print page loads (the "Print pass" link on the pass page lands here with
 * `?print=1`), then drops `?print=1` from the address so a reload doesn't print again.
 */
export function PrintButton({ auto = false }: { auto?: boolean }) {
  const started = useRef(false);

  useEffect(() => {
    if (!auto || started.current) return;
    started.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("print");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    void readyToPrint().then(() => window.print());
  }, [auto]);

  return (
    <button type="button" className={buttonClassName("primary", "self-start")} onClick={() => window.print()}>
      Print pass
    </button>
  );
}
