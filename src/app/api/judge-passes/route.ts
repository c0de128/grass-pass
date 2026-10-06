/**
 * GET /api/judge-passes: judge demo passes left today, for everyone and for this connection (SEC-4-02).
 * Everything lives in src/lib/accounts/endpoints.ts.
 */
import { judgePassesResponse } from "@/lib/accounts/endpoints";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return judgePassesResponse(req);
}
