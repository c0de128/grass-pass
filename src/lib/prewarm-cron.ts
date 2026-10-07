/**
 * The daily example warm-up for Vercel (pre-prod fixes 2026-10-07). vercel.json schedules
 * GET /api/cron/warm-examples once a day at 10:00 UTC (Vercel Hobby: daily crons only, run any time in that hour, so
 * 5:00-5:59 AM CDT, 4:00-4:59 AM CST after Nov 1). Free on every plan (docs checked 2026-10-07).
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` when the project has a CRON_SECRET env var. Without one (or one
 * shorter than 16 characters) the route refuses every call (503), so nobody can make the server spend model calls on
 * demand. A wrong or missing header is 401. The secret is compared in constant time and never logged.
 *
 * The round itself is warmExamples() with CRON_BUDGET_MS: one example after another while a whole pass still fits the
 * route's maxDuration, the same locks and caps as the home page (so a cron run and a visitor never make the same pass
 * twice). The home page's one-example-per-request warm-up picks up anything the cron run left.
 */
import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { log } from "@/lib/log";
import { CRON_BUDGET_MS, warmExamples, type WarmDeps } from "@/lib/prewarm";

type Env = Record<string, string | undefined>;

export const CRON_SECRET_MIN_LENGTH = 16;

export type CronAuth = "ok" | "not_configured" | "denied";

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** Is this request Vercel's cron call (Authorization: Bearer <CRON_SECRET>)? */
export function cronAuth(req: Request, env: Env = process.env): CronAuth {
  const secret = env.CRON_SECRET?.trim() ?? "";
  if (secret.length < CRON_SECRET_MIN_LENGTH) return "not_configured";
  const got = req.headers.get("authorization") ?? "";
  return timingSafeEqual(digest(got), digest(`Bearer ${secret}`)) ? "ok" : "denied";
}

const noStore = { "Cache-Control": "no-store" };

export async function cronWarmResponse(req: Request, deps: WarmDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;
  const auth = cronAuth(req, env);
  if (auth === "not_configured") {
    log("cron_warm_refused", { reason: "CRON_SECRET not set" }, "warn");
    return Response.json({ error: { code: "CRON_NOT_CONFIGURED", message: "This server has no CRON_SECRET, so the scheduled warm-up is off." } }, { status: 503, headers: noStore });
  }
  if (auth === "denied") {
    log("cron_warm_refused", { reason: "bad authorization" }, "warn");
    return Response.json({ error: { code: "UNAUTHORIZED", message: "Only the scheduled job may call this." } }, { status: 401, headers: noStore });
  }
  const started = Date.now();
  const summary = await warmExamples(deps, { budgetMs: CRON_BUDGET_MS });
  log("cron_warm_done", { ...summary, ms: Date.now() - started });
  return Response.json(summary, { status: 200, headers: noStore });
}
