"use client";

import { useEffect } from "react";

/** sessionStorage flag: the wizard opened this pass, so the pass page moves focus to its h1 (UX-8-02). */
export const FOCUS_PASS_KEY = "grass-pass:focus-pass-h1";

/**
 * UX-8-02 (R8): when the wizard opens a new pass, focus used to land on <body>, so keyboard and screen-reader users
 * started again from the top of the page. The wizard leaves a one-time flag in sessionStorage; on arrival this moves
 * focus to the pass's h1 (made focusable with tabindex -1) and removes the flag. A direct visit is left alone.
 */
export function FocusPassHeading() {
  useEffect(() => {
    let flagged = false;
    try {
      flagged = window.sessionStorage.getItem(FOCUS_PASS_KEY) === "1";
      window.sessionStorage.removeItem(FOCUS_PASS_KEY);
    } catch {
      return;
    }
    if (!flagged) return;
    const h1 = document.querySelector<HTMLElement>("main h1");
    if (!h1) return;
    if (!h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1");
    h1.focus({ preventScroll: true });
  }, []);
  return null;
}
