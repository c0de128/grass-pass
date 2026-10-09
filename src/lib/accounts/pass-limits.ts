/**
 * Pass limits for the browser (Kevin, 2026-10-08). Route files may only export handlers, so the work is here.
 *
 * - POST /api/free-pass `{ receipt }`: sets the signed free-pass cookie from the receipt the pass stream ended with
 *   (src/lib/limits/free-pass.ts). The receipt must be a valid signed value for TODAY; the cookie only ever goes up
 *   (a lower or equal count leaves it alone). 0 store commands.
 * - GET /api/passes-left: what the wizard says about the passes left today. Signed out: from the cookie only (0 store
 *   commands, never sets a cookie). Signed in: the account's counter (1 GET); the judge demo: its 2 counters (1 MGET).
 *   A store failure answers 503, never a made-up number.
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import { getStore, StoreError } from "@/lib/cache/store";
import { guardGet, guardJsonPost } from "@/lib/http/guard";
import { jsonError, storeUnavailable } from "@/lib/http/respond";
import { clientIp } from "@/lib/limits";
import { periodOf } from "@/lib/limits/quota";
import { freePassesLeft, freePassesUsed, freePassSetCookie, isHttps, verifyFreePass } from "@/lib/limits/free-pass";
import { accountPassesPerDay, freePassesPerDay, judgeDemoEnabled, type JudgePassesLeft } from "./config";
import { judgePassesLeft } from "./judge-passes";
import { readAccount } from "./session";

const PRIVATE = { "Cache-Control": "private, no-store" };

/** SEC-11-03: strict, like the feedback schema (an unknown field is a 400, never silently ignored). */
export const FreePassReceiptSchema = z.object({ receipt: z.string().min(1).max(80) }).strict();

export async function freePassReceiptResponse(req: Request, now: () => number = () => Date.now()): Promise<Response> {
  const g = await guardJsonPost(req, FreePassReceiptSchema);
  if (!g.ok) return jsonError(g.failure.status, { code: g.failure.code, message: g.failure.message });
  const t = now();
  const count = verifyFreePass(g.data.receipt, t);
  if (count === null) return jsonError(400, { code: "BAD_RECEIPT", message: "That free-pass receipt isn't valid for today." });
  const current = freePassesUsed(req.headers.get("cookie"), t);
  const body = { left: freePassesLeft(Math.max(current, count)) };
  if (count <= current) return Response.json(body, { headers: PRIVATE });
  return Response.json(body, { headers: { ...PRIVATE, "Set-Cookie": freePassSetCookie(g.data.receipt, t, isHttps(req)) } });
}

export type PassesLeft =
  | { kind: "free"; free: number; left: number; perDay: number }
  | { kind: "account"; perDay: number; left: number }
  | ({ kind: "judge" } & JudgePassesLeft);

export async function passesLeftResponse(req: Request, now: () => number = () => Date.now()): Promise<Response> {
  const bad = guardGet(req);
  if (bad) return jsonError(bad.status, { code: bad.code, message: bad.message });
  const t = now();
  const account = await readAccount(req);
  const perDay = accountPassesPerDay();
  if (!account) {
    const body: PassesLeft = { kind: "free", free: freePassesPerDay(), left: freePassesLeft(freePassesUsed(req.headers.get("cookie"), t)), perDay };
    return Response.json(body, { headers: PRIVATE });
  }
  try {
    if (account.judge) {
      if (!judgeDemoEnabled()) return jsonError(404, { code: "JUDGE_DEMO_OFF", message: "The judge demo isn't switched on on this server." });
      const body: PassesLeft = { kind: "judge", ...(await judgePassesLeft(getStore("limits"), clientIp(req), t)) };
      return Response.json(body, { headers: PRIVATE });
    }
    const { id } = periodOf({ kind: "day" }, t);
    const used = Math.max(0, Number(await getStore("limits").get(`q:{acct-new:${id}}:k:${account.key}`)) || 0);
    const body: PassesLeft = { kind: "account", perDay, left: Math.max(0, perDay - used) };
    return Response.json(body, { headers: PRIVATE });
  } catch (err) {
    if (err instanceof StoreError) return storeUnavailable();
    throw err;
  }
}
