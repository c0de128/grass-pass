/**
 * Where sign-in and sign-out may send the browser back to: an allowlist of our own paths on our own
 * origin (no open redirects). Anything else goes to the home page.
 * - `/` and `/?resume=1` (the home page restores the park + age picked before signing in);
 * - `/pass/<id>` (a saved pass, e.g. after signing in to send a report or make a different pass);
 * - `/?signedin=1` and `/pass/<id>?signedin=1` (UX-5-05: back from /signin, the header announces the sign-in);
 * - `/signin`.
 */
import { PASS_ID_PATTERN } from "@/lib/pass/schema";

/** UX-5-05: added to the way back from /signin so the header can announce the sign-in. */
export const SIGNED_IN_QUERY = "?signedin=1";

/** `from` (an allowed path) with ?signedin=1 when it has no query yet ("/?resume=1" keeps its own announcement). */
export function withSignedInFlag(from: string): string {
  return from.includes("?") || from === "/signin" ? from : `${from}${SIGNED_IN_QUERY}`;
}

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
  if (path === "/" && (query === "" || query === "?resume=1" || query === SIGNED_IN_QUERY)) return `${path}${query}`;
  if (path === "/signin" && query === "") return path;
  if (PASS_PATH.test(path) && (query === "" || query === SIGNED_IN_QUERY)) return `${path}${query}`;
  return null;
}

/** Auth.js `redirect` callback: an allowed same-origin URL, else the home page. */
export function safeRedirect(url: string, baseUrl: string): string {
  const path = allowedReturnPath(url, baseUrl);
  const origin = new URL(baseUrl).origin;
  return `${origin}${path ?? "/"}`;
}
