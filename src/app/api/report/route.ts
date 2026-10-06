/**
 * POST /api/report  { passId, ref, kind: "found" | "notfound" | "unsafe" }  (signed-in grown-ups only)
 * Everything lives in src/lib/reports/submit.ts (a route file may only export handlers).
 */
import { submitReport } from "@/lib/reports/submit";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return submitReport(req);
}
