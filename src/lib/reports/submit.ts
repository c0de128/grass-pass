/**
 * POST /api/report behind its guards. Order: same origin / resting / JSON / 2 KB body / zod (guardJsonPost)
 * -> signed in (401) -> per-IP hourly limit (429) -> the pass exists and has that item (404) -> per-account hourly
 * limit (429; the judge demo: per judge sign-in, SEC-5-01) -> one report (src/lib/reports). CSRF: same-origin check + JSON content type (no simple cross-site form
 * can send it) + the SameSite=Lax session cookie.
 *
 * Store commands (measured in tests/unit/store-cost.test.ts): 2 rate-limit EVALs, at most 1 pass GET
 * (memoized), 1 report EVAL (the judge demo: 1 dedupe INCR instead), and 1 INCR when the item gets hidden:
 * <= 5 (COSTS.apiReport).
 * SEC-4-01/03: the judge demo's reports are only logged ("logged"); they never count toward a threshold
 * or the counts. UX-4-05: they are deduped per judge sign-in (browser), not for the whole shared account.
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import { REPORTS_PER_ACCOUNT_PER_HOUR, REPORTS_PER_IP_PER_HOUR } from "@/lib/accounts/config";
import { readAccount } from "@/lib/accounts/session";
import { getStore, StoreError } from "@/lib/cache/store";
import { guardJsonPost } from "@/lib/http/guard";
import { jsonError, storeUnavailable, waitText } from "@/lib/http/respond";
import { clientIp, hitRateLimit } from "@/lib/limits";
import { loadPass } from "@/lib/pass/make";
import { PASS_ID_PATTERN } from "@/lib/pass/schema";
import { ITEM_REF_PATTERN, recordItemReport, REPORT_COPY, REPORT_STATUSES, ReportKindSchema, type ReportStatus } from "./index";
import { forgetReportStats } from "./stats";

export const ReportRequestSchema = z.object({
  passId: z.string().regex(PASS_ID_PATTERN),
  ref: z.string().regex(ITEM_REF_PATTERN),
  kind: ReportKindSchema,
});
export type ReportRequest = z.infer<typeof ReportRequestSchema>;

export const ReportResponseSchema = z.object({ status: z.enum(REPORT_STATUSES), message: z.string() });

function messageFor(status: ReportStatus, judge: boolean): string {
  if (status === "counted") return REPORT_COPY.thanks;
  if (status === "logged") return REPORT_COPY.judgeLogged;
  return judge ? REPORT_COPY.judgeDuplicate : REPORT_COPY.duplicate;
}

export async function submitReport(req: Request, now: () => number = () => Date.now()): Promise<Response> {
  const g = await guardJsonPost(req, ReportRequestSchema);
  if (!g.ok) return jsonError(g.failure.status, { code: g.failure.code, message: g.failure.message });
  const account = await readAccount(req);
  if (!account) return jsonError(401, { code: "SIGN_IN_REQUIRED", message: "Sign in to send a report (it's for grown-ups)." });

  const store = getStore("limits");
  const limited = (retryAfter: number) =>
    jsonError(429, {
      code: "RATE_LIMITED",
      message: `That's a lot of reports in an hour. Please wait ${waitText(retryAfter)} and try again.`,
      retryAfter,
    });
  try {
    // Per IP first (it guards the pass lookup below), then the pass/item check, then the per-account limit.
    const ip = await hitRateLimit(store, { name: "report-ip", key: clientIp(req), limit: REPORTS_PER_IP_PER_HOUR, windowSec: 3600, now: now() });
    if (!ip.ok) return limited(ip.retryAfter);
    const pass = await loadPass(g.data.passId, now());
    if (!pass || !pass.items.some((it) => it.ref === g.data.ref)) {
      return jsonError(404, { code: "NOT_FOUND", message: "That item isn't on a saved pass anymore, so it can't be reported." });
    }
    // SEC-5-01: every "Try as a judge" sign-in shares ONE account key, so the judge demo's per-account limit is keyed
    // on the per-sign-in (browser) id; otherwise one judge could use up every judge's hour. Made-up pass ids (404)
    // never reach it.
    const acctKey = account.judge && account.session ? `j:${account.session}` : account.key;
    const acct = await hitRateLimit(store, { name: "report-acct", key: acctKey, limit: REPORTS_PER_ACCOUNT_PER_HOUR, windowSec: 3600, now: now() });
    if (!acct.ok) return limited(acct.retryAfter);
    const r = await recordItemReport(store, {
      parkId: pass.park.id,
      ref: g.data.ref,
      kind: g.data.kind,
      account: { key: account.key, judge: account.judge, session: account.session },
      now: now(),
    });
    if (r.status === "counted") forgetReportStats(pass.park.id);
    return Response.json({ status: r.status, message: messageFor(r.status, account.judge) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof StoreError) return storeUnavailable();
    throw err;
  }
}
