"use client";

import { useSyncExternalStore } from "react";
import { applyStoredTheme, currentTheme, setTheme, subscribeTheme, type Theme } from "@/components/theme";

// Apply a stored choice as soon as this module loads in the browser (before React hydrates).
applyStoredTheme();

const serverTheme = (): Theme | null => null;

/**
 * Dark mode switch. aria-pressed = dark mode on. Hidden from print.
 * R2-m10: the label says what a press does ("Switch to dark mode" / "Switch to light mode"), so in dark
 * mode it no longer reads like the current state.
 */
export function themeToggleLabel(dark: boolean): string {
  return dark ? "Switch to light mode" : "Switch to dark mode";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore<Theme | null>(subscribeTheme, currentTheme, serverTheme);
  const dark = theme === "dark";
  return (
    <button
      type="button"
      aria-pressed={theme === null ? undefined : dark}
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-control border-2 border-line bg-surface px-2.5 font-bold sm:px-3 text-heading hover:bg-secondary-hover print:hidden"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        {dark ? (
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        )}
      </svg>
      <span className="sr-only sm:not-sr-only">{themeToggleLabel(dark)}</span>
    </button>
  );
}
