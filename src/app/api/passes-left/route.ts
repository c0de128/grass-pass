/**
 * GET /api/passes-left: new passes left today (signed out: the free pass, from its cookie; signed in: the account; the
 * judge demo: its shared pool). Everything lives in src/lib/accounts/pass-limits.ts.
 */
import { passesLeftResponse } from "@/lib/accounts/pass-limits";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return passesLeftResponse(req);
}
