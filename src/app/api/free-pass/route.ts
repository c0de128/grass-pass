/**
 * POST /api/free-pass  { receipt }: sets the signed free-pass cookie after a charged signed-out pass (Kevin, 2026-10-08).
 * Everything lives in src/lib/accounts/pass-limits.ts (a route file may only export handlers).
 */
import { freePassReceiptResponse } from "@/lib/accounts/pass-limits";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return freePassReceiptResponse(req);
}
