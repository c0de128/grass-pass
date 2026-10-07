/**
 * GET /api/cron/warm-examples: the daily example warm-up, called by Vercel Cron (vercel.json) with
 * `Authorization: Bearer <CRON_SECRET>`. Everything lives in src/lib/prewarm-cron.ts.
 */
import { connection } from "next/server";
import { cronWarmResponse } from "@/lib/prewarm-cron";

export const runtime = "nodejs";
/** The Vercel Hobby maximum (300 s); the round itself stops starting passes at CRON_BUDGET_MS (src/lib/prewarm.ts). */
export const maxDuration = 300;

export async function GET(req: Request): Promise<Response> {
  await connection();
  return cronWarmResponse(req);
}
