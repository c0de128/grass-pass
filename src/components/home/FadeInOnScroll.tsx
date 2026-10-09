"use client";

import { useEffect } from "react";
import { showAllSections } from "@/components/home/HomeAnchors";

/** The blocks that fade in (Kevin 2026-10-07): each heading, diagram and card group in How it works and below. */
export const FADE_SELECTOR =
  '.gp-home > section:is(#how, #why, #pass, #parks, [aria-labelledby="cta-title"]) > div > *';

/**
 * True when a focused element is not properly on screen: its top is under the sticky header (`topInset`) or below
 * the window, or it fits the visible area but its bottom is cut off.
 */
export function outsideView(rect: { top: number; bottom: number }, innerHeight: number, topInset = 0): boolean {
  if (rect.top < topInset || rect.top >= innerHeight) return true;
  return rect.bottom > innerHeight && rect.bottom - rect.top <= innerHeight - topInset;
}

/**
 * Marks every block that starts below the fold and reveals it once as it scrolls into view (CSS in globals.css).
 * Blocks already on screen are left alone, so nothing visible ever blinks out. Does nothing for visitors who ask
 * for less motion or in browsers without IntersectionObserver.
 *
 * UX-8-01 (R8): keyboard focus can reach a marked block before it scrolls into view (on phones the browser's own
 * focus scroll fell short of the first Explore card, which then sat below the fold at opacity 0). So focus inside a
 * hidden block reveals it at once, the home sections are laid out for real (their content-visibility placeholders
 * shifted the page by ~500 px just after the browser's focus scroll, measured at 1280 px), and if the focused element
 * is then outside the window or under the sticky header it is scrolled to the middle of the screen.
 */
export function FadeInOnScroll() {
  useEffect(() => {
    if (
      !("IntersectionObserver" in window) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("gp-in");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    for (const el of document.querySelectorAll<HTMLElement>(FADE_SELECTOR)) {
      if (el.getBoundingClientRect().top < window.innerHeight) continue;
      el.classList.add("gp-fade");
      io.observe(el);
    }
    let frame = 0;
    let later: ReturnType<typeof setTimeout> | undefined;
    const keepInView = (target: HTMLElement) => {
      const header = document.querySelector<HTMLElement>("header.sticky");
      const inset = header && getComputedStyle(header).position === "sticky" ? header.getBoundingClientRect().bottom : 0;
      const top = Math.max(0, inset);
      const rect = target.getBoundingClientRect();
      if (document.activeElement !== target || !outsideView(rect, window.innerHeight, top)) return;
      // A focused element taller than the visible area starts just under the header (its scroll-margin-top).
      const fits = rect.bottom - rect.top <= window.innerHeight - top;
      target.scrollIntoView({ block: fits ? "center" : "start", behavior: "instant" });
    };
    const onFocusIn = (ev: FocusEvent) => {
      const target = ev.target;
      if (!(target instanceof HTMLElement)) return;
      const block = target.closest<HTMLElement>(".gp-fade");
      if (!block) return;
      showAllSections();
      if (!block.classList.contains("gp-in")) {
        block.classList.add("gp-in");
        io.unobserve(block);
      }
      // After the browser's own focus scroll (and the section layout it caused), make sure the focused element is
      // really on screen; checked again a moment later in case a late layout moved it.
      cancelAnimationFrame(frame);
      clearTimeout(later);
      frame = requestAnimationFrame(() => keepInView(target));
      later = setTimeout(() => keepInView(target), 250);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(later);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, []);
  return null;
}
