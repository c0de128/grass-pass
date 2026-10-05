// Light/dark theme choice. Default follows the system (prefers-color-scheme, handled in tokens.css);
// a click on the toggle stores an explicit choice in localStorage and sets <html data-theme>.

export type Theme = "light" | "dark";
export const THEME_KEY = "grass-pass-theme";
const CHANGE_EVENT = "grass-pass-theme-change";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // storage blocked (privacy mode): fall back to the system theme
  }
}

export function parseTheme(value: unknown): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

export function storedTheme(): Theme | null {
  return parseTheme(storage()?.getItem(THEME_KEY));
}

function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The theme on screen now: the stored choice, else the system preference. */
export function currentTheme(): Theme {
  return storedTheme() ?? systemTheme();
}

/** Put a stored choice on <html> (call once on the client before reading the theme). */
export function applyStoredTheme(): void {
  if (typeof document === "undefined") return;
  const t = storedTheme();
  if (t) document.documentElement.dataset.theme = t;
}

export function setTheme(theme: Theme): void {
  storage()?.setItem(THEME_KEY, theme);
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** useSyncExternalStore subscription: our own changes, other tabs, and system changes. */
export function subscribeTheme(onChange: () => void): () => void {
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  media?.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    media?.removeEventListener("change", onChange);
  };
}
