"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { applyStoredTheme, currentTheme, setTheme, subscribeTheme, type Theme } from "@/components/theme";

// Apply a stored choice as soon as this module loads in the browser (before React hydrates).
applyStoredTheme();

const serverTheme = (): Theme | null => null;

/**
 * Dark mode switch (v3 header: a round icon button). Its name says what a press does ("Switch to dark mode" /
 * "Switch to light mode", R2-m10), so it is a plain button: no aria-pressed (a changing label plus a pressed
 * state would contradict each other). Hidden from print.
 */
export function themeToggleLabel(dark: boolean): string {
  return dark ? "Switch to light mode" : "Switch to dark mode";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore<Theme | null>(subscribeTheme, currentTheme, serverTheme);
  const dark = theme === "dark";
  const label = themeToggleLabel(dark);
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      title={label}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-card text-foreground ring-1 ring-line transition-colors hover:bg-muted print:hidden"
    >
      {dark ? <Sun className="size-5" aria-hidden="true" /> : <Moon className="size-5" aria-hidden="true" />}
      <span className="sr-only">{label}</span>
    </button>
  );
}
