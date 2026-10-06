/**
 * GET /api/me: who is signed in (the header's account control). Cookie read only: no Set-Cookie, no store
 * command (SEC-4-04). Everything lives in src/lib/accounts/endpoints.ts.
 */
import { meResponse } from "@/lib/accounts/endpoints";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return meResponse(req);
}
