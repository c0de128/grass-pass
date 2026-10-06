/**
 * Runs before every page and API route that reads the shared store (SEC-1-02): the home page (example
 * statuses), saved pass pages and their print pages, and /api/*. A per-IP token bucket in this process
 * answers 429 with Retry-After before any Upstash command is spent. Static assets and /about never
 * touch the store and are not matched.
 */
import { NextResponse, type NextRequest } from "next/server";
import { jsonError, waitText } from "@/lib/http/respond";
import { clientIp } from "@/lib/limits/ip";
import { limitsConfig } from "@/lib/limits/config";
import { preLimit } from "@/lib/limits/prelimit";

export function proxy(req: NextRequest): Response {
  const r = preLimit(clientIp(req), Date.now(), limitsConfig());
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
  matcher: ["/", "/pass/:path*", "/api/:path*"],
};
