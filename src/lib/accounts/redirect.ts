/**
 * Where sign-in and sign-out may send the browser back to: an allowlist of our own paths on our own
 * origin (no open redirects). Anything else goes to the home page.
 * - `/` and `/?resume=1` (the home page restores the park + age picked before signing in);
 * - `/pass/<id>` (a saved pass, e.g. after signing in to send a report or make a different pass);
 * - `/signin`.
 */
import { PASS_ID_PATTERN } from "@/lib/pass/schema";

const PASS_PATH = new RegExp(`^/pass/${PASS_ID_PATTERN.source.slice(1, -1)}$`);

/** The allowed path + query for `target`, or null. Accepts a relative path or a same-origin absolute URL. */
export function allowedReturnPath(target: string | null | undefined, baseUrl: string): string | null {
  if (typeof target !== "string" || target.length === 0 || target.length > 200) return null;
  let base: URL;
  let u: URL;
  try {
    base = new URL(baseUrl);
    // "//evil.test" and "/\evil.test" are protocol-relative: refused before URL parsing can resolve them.
    if (target.startsWith("/") && (target.startsWith("//") || target.startsWith("/\\"))) return null;
    u = new URL(target, base);
  } catch {
    return null;
  }
  if (u.origin !== base.origin) return null;
  if (u.username || u.password) return null;
  const path = u.pathname;
  const query = u.search;
  if (path === "/" && (query === "" || query === "?resume=1")) return `${path}${query}`;
  if (path === "/signin" && query === "") return path;
  if (PASS_PATH.test(path) && query === "") return path;
  return null;
}

/** Auth.js `redirect` callback: an allowed same-origin URL, else the home page. */
export function safeRedirect(url: string, baseUrl: string): string {
  const path = allowedReturnPath(url, baseUrl);
  const origin = new URL(baseUrl).origin;
  return `${origin}${path ?? "/"}`;
}
