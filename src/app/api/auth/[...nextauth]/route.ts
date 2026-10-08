/**
 * Auth.js endpoints (/api/auth/*). OAuth starts POSTed here (`/signin/<provider>`) and every callback
 * (`/callback/<provider>`) are rate limited per IP first (src/lib/accounts/signin-rate.ts); the judge demo sign-in is
 * limited inside its provider too. SEC-10-04 (round 10): the sign-in BUTTONS start OAuth through a server action
 * (src/app/actions/auth.ts), which never passes through this route, so those starts are not limited. On purpose: a start
 * costs no store command and no paid call (it only redirects to GitHub/Google), and the callback that follows is limited.
 * Auth.js itself checks its CSRF token on every POST here.
 */
import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { jsonError, waitText } from "@/lib/http/respond";
import { signInRate } from "@/lib/accounts/signin-rate";

export const runtime = "nodejs";

/** OAuth starts and callbacks; the judge provider counts its own attempts (not twice). */
const LIMITED = /^\/api\/auth\/(signin|callback)\/(?!judge$)[a-z]+$/;

async function limited(req: NextRequest): Promise<Response | null> {
  if (!LIMITED.test(req.nextUrl.pathname)) return null;
  const r = await signInRate(req);
  if (r.ok) return null;
  return jsonError(429, {
    code: "RATE_LIMITED",
    message: `That's a lot of sign-in attempts from your connection. Please wait ${waitText(r.retryAfter)} and try again.`,
    retryAfter: r.retryAfter,
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  return (await limited(req)) ?? handlers.GET(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return (await limited(req)) ?? handlers.POST(req);
}
