/**
 * RULES-5-04 / UX-5-02: what the proxy answers when a page request or a sign-in button is over the per-connection
 * flood limit (src/proxy.ts). APIs keep their JSON 429; pages get a small styled page in the site's voice (with
 * the wait and a way home) instead of plain text; a server action (the "Try as a judge" button) gets a redirect
 * to /signin that says how long to wait, instead of Next's generic "This page couldn't load".
 *
 * The page is self-contained (inline styles only; the CSP allows 'unsafe-inline' styles and no script is used),
 * because the proxy answers before any React page renders. Colours are the site tokens (src/styles/tokens.css).
 */
import { waitText } from "./respond";

/** The words, shared by the page and the /signin message. */
export function busyMessage(retryAfter: number): string {
  return `That's a lot of visits from your connection (shared Wi-Fi or a phone network can do that). Please wait ${waitText(retryAfter)}, then try again.`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Same-origin path to retry (a path from the request; anything odd becomes "/"). */
function retryPath(pathname: string): string {
  return /^\/[A-Za-z0-9/_.~-]*$/.test(pathname) && !pathname.startsWith("//") ? pathname : "/";
}

export function busyPageHtml(retryAfter: number, pathname: string): string {
  const again = retryPath(pathname);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Too many visits · Grass Pass</title>
<style>
:root{color-scheme:light dark;--bg:#eef3e2;--fg:#10291a;--card:#ffffff;--primary:#137838;--on-primary:#ffffff;--link:#0f6830}
@media (prefers-color-scheme:dark){:root{--bg:#0d1a11;--fg:#e6eedb;--card:#15261a;--primary:#4cc274;--on-primary:#0b1a10;--link:#4cc274}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.25rem;background:var(--bg);color:var(--fg);font:1.0625rem/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:34rem;width:100%;background:var(--card);border-radius:1.5rem;padding:1.75rem;box-shadow:0 1px 0 rgba(16,41,26,.08)}
p.brand{margin:0 0 .75rem;font-weight:800;letter-spacing:.02em}
h1{margin:0 0 .75rem;font-size:2rem;line-height:1.15}
p{margin:0 0 1rem}
.actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1.25rem}
a{color:var(--link);font-weight:700;text-underline-offset:4px}
a.button{display:inline-flex;align-items:center;min-height:44px;padding:.6rem 1.1rem;border-radius:1rem;background:var(--primary);color:var(--on-primary);text-decoration:none}
a:focus-visible{outline:3px solid var(--fg);outline-offset:3px}
</style>
</head>
<body>
<main id="main">
<p class="brand">Grass Pass</p>
<h1>Whoa, lots of visits!</h1>
<p role="status">${esc(busyMessage(retryAfter))}</p>
<p>Saved passes and printing come back as soon as the wait is over. Nothing you made is lost.</p>
<div class="actions">
<a class="button" href="${esc(again)}">Try again</a>
<a href="/">Go to the home page</a>
</div>
</main>
</body>
</html>
`;
}

/** A styled 429 for a page request (Retry-After set; never cached). */
export function busyPageResponse(retryAfter: number, pathname: string): Response {
  return new Response(busyPageHtml(retryAfter, pathname), {
    status: 429,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Retry-After": String(Math.max(1, Math.ceil(retryAfter))) },
  });
}

/** The /signin address that explains a refused sign-in button press, with the wait (seconds) and the way back. */
export function signInBusyPath(retryAfter: number, from: string): string {
  const q = new URLSearchParams({ error: "rate_limited", wait: String(Math.max(1, Math.ceil(retryAfter))) });
  const back = retryPath(from);
  if (back !== "/" && back !== "/signin") q.set("from", back);
  return `/signin?${q.toString()}`;
}

/**
 * A refused server action (sign in / sign out button). Next's action client follows the `x-action-redirect`
 * header (path;push) with a full page load when the body is not a Flight payload, so the visitor lands on
 * /signin with the wait instead of a crash page. tests/e2e/limits checks this still works after a Next upgrade.
 */
export function busyActionResponse(retryAfter: number, from: string): Response {
  return new Response("", {
    status: 429,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": String(Math.max(1, Math.ceil(retryAfter))),
      "x-action-redirect": `${signInBusyPath(retryAfter, from)};push`,
    },
  });
}
