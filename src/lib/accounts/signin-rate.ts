/**
 * Sign-in attempts per IP (judge demo sign-ins, OAuth starts and OAuth callbacks): SIGNIN_PER_IP_PER_10MIN
 * per 10 minutes. One store command per allowed attempt, none while a refusal is remembered
 * (src/lib/limits/rate.ts). A store failure refuses the attempt (sign-in only matters for new passes,
 * which need the store anyway).
 */
import "server-only";
import { getStore } from "@/lib/cache/store";
import { clientIp, hitRateLimit } from "@/lib/limits";
import { log } from "@/lib/log";
import { SIGNIN_PER_IP_PER_10MIN, SIGNIN_WINDOW_SEC } from "./config";

export type SignInRate = { ok: true } | { ok: false; retryAfter: number };

export async function signInRate(req: Request, now: number = Date.now()): Promise<SignInRate> {
  try {
    const r = await hitRateLimit(getStore("limits"), { name: "signin", key: clientIp(req), limit: SIGNIN_PER_IP_PER_10MIN, windowSec: SIGNIN_WINDOW_SEC, now });
    if (!r.ok) log("signin_rate_limited", { retryAfter: r.retryAfter }, "warn");
    return r;
  } catch {
    return { ok: false, retryAfter: 60 };
  }
}

export async function checkSignInRate(req: Request): Promise<boolean> {
  return (await signInRate(req)).ok;
}
