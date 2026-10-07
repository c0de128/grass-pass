"use client";

import { useLayoutEffect } from "react";

/** The attribute on `<main class="gp-home">` that turns off the home sections' content-visibility (globals.css). */
export const CV_OFF_ATTR = "data-sections";

/** True when a click on this link jumps to a section of the home page that is already open. */
export function isHomeSectionJump(href: string | null, current: { pathname: string; origin: string }): boolean {
  if (!href) return false;
  let url: URL;
  try {
    url = new URL(href, `${current.origin}${current.pathname}`);
  } catch {
    return false;
  }
  return url.origin === current.origin && url.pathname === "/" && current.pathname === "/" && url.hash.length > 1;
}

/** Lay out every home section for real (once; it stays that way). */
export function showAllSections(doc: Document = document): void {
  doc.querySelector(".gp-home")?.setAttribute(CV_OFF_ATTR, "real");
}

/**
 * Explore link fix (2026-10-07). The heavy home sections use content-visibility: auto with placeholder heights
 * (globals.css, UX-4-02). A section link ("/#parks", "/#why", "/#pass") scrolls smoothly to where its target sits
 * while the sections above are placeholders; they render at their real (different) heights during the scroll, and
 * a smooth scroll never re-aims, so it ended hundreds of pixels past the heading (measured: 627 px at 1280 px).
 * Before the click's default action (Next's own hash scroll, or the browser's), this lays every section out for
 * real, so the scroll aims at the real position. A page loaded with a hash is handled in CSS (`:has(:target)`);
 * back/forward to a hash goes through `hashchange`. No effect on a plain page load (Lighthouse, LCP).
 * Renders nothing.
 */
export function HomeAnchors() {
  // Layout phase: a child's layout effect runs before Next's scroll handler (layout-router, a parent) on a client-side visit.
  useLayoutEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (link && isHomeSectionJump(link.getAttribute("href"), window.location)) showAllSections();
    };
    const onHash = () => {
      if (window.location.hash.length > 1) showAllSections();
    };
    // Capture phase on the document: runs before React's root listener (next/link) and before the browser's default.
    document.addEventListener("click", onClick, true);
    window.addEventListener("hashchange", onHash);
    // A client-side visit from another page to "/#parks" (next/link) mounts the home with the hash already set.
    onHash();
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);
  return null;
}
