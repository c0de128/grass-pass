/**
 * POST /api/feedback  { passId, stars: 1-5, tags: [...] }  (signed-in grown-ups only; no free text)
 * Everything lives in src/lib/feedback/submit.ts (a route file may only export handlers).
 */
import { submitFeedback } from "@/lib/feedback/submit";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return submitFeedback(req);
}
