"use client";

import { useEffect } from "react";

/** The blocks that fade in (Kevin 2026-10-07): each heading, diagram and card group in How it works and below. */
export const FADE_SELECTOR =
  '.gp-home > section:is(#how, #why, #pass, #parks, [aria-labelledby="cta-title"]) > div > *';

/**
 * Marks every block that starts below the fold and reveals it once as it scrolls into view (CSS in globals.css).
 * Blocks already on screen are left alone, so nothing visible ever blinks out. Does nothing for visitors who ask
 * for less motion or in browsers without IntersectionObserver.
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
      if (el.getBoundingClientRect().top < window.innerHeight * 0.92) continue;
      el.classList.add("gp-fade");
      io.observe(el);
    }
    return () => io.disconnect();
  }, []);
  return null;
}
