/**
 * Two tiny GET endpoints for the browser (route files may only export handlers, so the work is here):
 * - GET /api/me (SEC-4-04): who is signed in, read from the session cookie only. Unlike Auth.js's
 *   /api/auth/session it never sets a cookie (no CSRF or callback-url cookie for anonymous visitors), never
 *   re-writes the session, and touches no store: `{ signedIn: false }` or `{ signedIn: true, provider, name }`.
 * - GET /api/judge-passes (SEC-4-02): the judge passes left today, for everyone and for this connection
 *   (1 store command; the proxy charges COSTS.apiOther).
 */
import "server-only";
import { getStore, StoreError } from "@/lib/cache/store";
import { jsonError, storeUnavailable } from "@/lib/http/respond";
import { clientIp } from "@/lib/limits";
import { authConfigured, judgeDemoEnabled } from "./config";
import { judgePassesLeft } from "./judge-passes";
import { readSessionToken } from "./session";

const PRIVATE = { "Cache-Control": "private, no-store" };

export async function meResponse(req: Request): Promise<Response> {
  const t = await readSessionToken(req);
  const body = t ? { signedIn: true as const, provider: t.p, name: t.n ?? null } : { signedIn: false as const };
  return Response.json(body, { headers: PRIVATE });
}

export async function judgePassesResponse(req: Request, now: () => number = () => Date.now()): Promise<Response> {
  if (!authConfigured() || !judgeDemoEnabled()) {
    return jsonError(404, { code: "JUDGE_DEMO_OFF", message: "The judge demo isn't switched on on this server." });
  }
  try {
    return Response.json(await judgePassesLeft(getStore("limits"), clientIp(req), now()), { headers: PRIVATE });
  } catch (err) {
    if (err instanceof StoreError) return storeUnavailable();
    throw err;
  }
}
