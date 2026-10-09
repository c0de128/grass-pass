/**
 * POST /api/feedback behind its guards (Kevin, 2026-10-08). Order: same origin / resting / JSON / 2 KB body / strict zod
 * (guardJsonPost: 1-5 stars, known tags only, no other field, so no free text) -> signed in (401) -> per-IP hourly
 * limit (429) -> the pass exists (404) -> per-account hourly limit (429; the judge demo: per judge sign-in) -> one
 * rating (src/lib/feedback). CSRF: same-origin check + JSON content type + the SameSite=Lax session cookie.
 *
 * Store commands (tests/unit/store-cost.test.ts): 2 rate-limit EVALs, at most 1 pass GET (memoized), 1 feedback EVAL
 * (the judge demo: 1 dedupe INCR instead): <= 4 (COSTS.apiFeedback).
 */
import "server-only";
import { FEEDBACK_PER_ACCOUNT_PER_HOUR, FEEDBACK_PER_IP_PER_HOUR } from "@/lib/accounts/config";
import { readAccount } from "@/lib/accounts/session";
import { getStore, StoreError } from "@/lib/cache/store";
import { guardJsonPost } from "@/lib/http/guard";
import { jsonError, storeUnavailable, waitText } from "@/lib/http/respond";
import { clientIp, hitRateLimit } from "@/lib/limits";
import { loadPass } from "@/lib/pass/make";
import { FEEDBACK_COPY, FeedbackRequestSchema, recordFeedback, type FeedbackStatus } from "./index";

function messageFor(status: FeedbackStatus): string {
  if (status === "saved") return FEEDBACK_COPY.saved;
  if (status === "updated") return FEEDBACK_COPY.updated;
  if (status === "logged") return FEEDBACK_COPY.judgeLogged;
  return FEEDBACK_COPY.judgeDuplicate;
}

export async function submitFeedback(req: Request, now: () => number = () => Date.now()): Promise<Response> {
  const g = await guardJsonPost(req, FeedbackRequestSchema);
  if (!g.ok) return jsonError(g.failure.status, { code: g.failure.code, message: g.failure.message });
  const account = await readAccount(req);
  if (!account) return jsonError(401, { code: "SIGN_IN_REQUIRED", message: "Sign in to rate this pass (it's for grown-ups)." });

  const store = getStore("limits");
  const limited = (retryAfter: number) =>
    jsonError(429, { code: "RATE_LIMITED", message: `That's a lot of ratings in an hour. Please wait ${waitText(retryAfter)} and try again.`, retryAfter });
  try {
    const ip = await hitRateLimit(store, { name: "feedback-ip", key: clientIp(req), limit: FEEDBACK_PER_IP_PER_HOUR, windowSec: 3600, now: now() });
    if (!ip.ok) return limited(ip.retryAfter);
    const pass = await loadPass(g.data.passId, now());
    if (!pass) return jsonError(404, { code: "NOT_FOUND", message: "That pass isn't saved anymore, so it can't be rated." });
    // Every "Try as a judge" sign-in shares ONE account key: its hourly limit is per judge sign-in (browser), like reports.
    const acctKey = account.judge && account.session ? `j:${account.session}` : account.key;
    const acct = await hitRateLimit(store, { name: "feedback-acct", key: acctKey, limit: FEEDBACK_PER_ACCOUNT_PER_HOUR, windowSec: 3600, now: now() });
    if (!acct.ok) return limited(acct.retryAfter);
    const r = await recordFeedback(store, {
      passId: pass.id,
      parkId: pass.park.id,
      stars: g.data.stars,
      tags: g.data.tags,
      account: { key: account.key, judge: account.judge, session: account.session },
      now: now(),
    });
    return Response.json({ status: r.status, message: messageFor(r.status) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof StoreError) return storeUnavailable();
    throw err;
  }
}
