/**
 * Runs before every page and API route that reads the shared store (SEC-1-02, SEC-2-01): the home page
 * (example statuses), saved pass pages and their print pages, and /api/*. Per-IP token buckets in this
 * process (src/lib/limits/prelimit.ts: a request bucket for pages or APIs, a store-cost bucket, and a
 * shared /48 bucket for IPv6) answer 429 with Retry-After before any Upstash command is spent.
 * Static assets and /about never touch the store and are not matched. /signin is matched for its sign-in
 * server action (the judge sign-in spends a rate-limit command).
 *
 * Nothing here relies on state shared with render code (Next 16: the proxy may run apart from it).
 */
import { NextResponse, type NextRequest } from "next/server";
import { jsonError, waitText } from "@/lib/http/respond";
import { clientIp, networkKey } from "@/lib/limits/ip";
import { limitsConfig } from "@/lib/limits/config";
import { preLimitRequest } from "@/lib/limits/prelimit";
import { SESSION_COOKIES } from "@/lib/accounts/config";

export function proxy(req: NextRequest): Response {
  const key = clientIp(req);
  const r = preLimitRequest({ key, net48: networkKey(key), pathname: req.nextUrl.pathname, now: Date.now(), cfg: limitsConfig(),
    // A server action (sign in / sign out) is a POST to a page with this header.
    action: req.method === "POST" && req.headers.has("next-action"),
    // A signed-in visitor's pass page also reads the item report counts (a cookie that isn't valid reads nothing).
    session: SESSION_COOKIES.some((n) => req.cookies.has(n)),
  });
  if (r.ok) return NextResponse.next();
  const message = `That's a lot of requests from your connection. Please wait ${waitText(r.retryAfter)} and try again.`;
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return jsonError(429, { code: "RATE_LIMITED", message, retryAfter: r.retryAfter });
  }
  return new Response(`${message}\n`, {
    status: 429,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": String(r.retryAfter) },
  });
}

export const config = {
  matcher: ["/", "/signin", "/pass/:path*", "/api/:path*"],
};
