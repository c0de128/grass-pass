"use client";

import { useEffect } from "react";

/**
 * A link like /about#privacy-table must not land on a closed disclosure: when the URL's #id is a <details>
 * (or inside one), open it and scroll to it. Runs on load and on every hash change.
 */
export function OpenOnHash() {
  useEffect(() => {
    const reveal = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      let changed = false;
      for (let d = target.closest("details"); d; d = d.parentElement?.closest("details") ?? null) {
        if (!d.open) {
          d.open = true;
          changed = true;
        }
      }
      if (changed) target.scrollIntoView({ block: "start" });
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);
  return null;
}
