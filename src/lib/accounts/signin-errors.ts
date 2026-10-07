/** What /signin says for each error code (Auth.js pages.error codes and ours). */
import { waitText } from "@/lib/http/respond";
import { limitsConfig } from "@/lib/limits/config";
import { COSTS } from "@/lib/limits/prelimit";
import { SIGNIN_WINDOW_SEC } from "./config";

/** Auth.js error codes (pages.error) and ours, as plain words. Unknown codes get the general line. */
export const ERRORS: Record<string, string> = {
  rate_limited: "Whoa, that's a lot of sign-in attempts from your connection. Please wait a few minutes and try again.",
  unavailable: "That sign-in option is not set up here. Try another one below.",
  AccessDenied: "Sign-in was cancelled. Nothing changed, but you can try again below.",
  OAuthCallbackError: "The sign-in page didn't finish. Please try again.",
  Configuration: "Sign-in isn't set up right on this server. Examples and saved passes still work.",
  Verification: "That sign-in link didn't work. Please try again.",
};
export const GENERAL_ERROR = "Sign-in didn't work this time. Give it another try.";

/**
 * SEC-6-03: the longest wait the app itself can put in /signin?wait= (seconds). Two places send a visitor there:
 * the sign-in limiter (a fixed SIGNIN_WINDOW_SEC window) and the proxy's flood check on a sign-in button press
 * (the per-connection cost bucket, refilled at PRELIMIT_COST_PER_HOUR; the costliest page a button posts to is a
 * pass page). Anything longer did not come from the app (a crafted link), so the page shows the general line.
 */
export function maxSignInWaitSec(env: Record<string, string | undefined> = process.env): number {
  const cost = Math.max(COSTS.home, COSTS.passPage + COSTS.passStats) + COSTS.action;
  const perHour = Math.max(1, limitsConfig(env).preLimitCostPerHour);
  return Math.max(SIGNIN_WINDOW_SEC, Math.ceil((cost * 3600) / perHour));
}

/** RULES-5-04: the rate-limit line with the real wait when the address carries it (?wait=<seconds>). */
export function errorText(code: string, wait: string | undefined, maxWaitSec: number = maxSignInWaitSec()): string {
  const secs = wait && /^\d{1,6}$/.test(wait) ? Number(wait) : null;
  if (code === "rate_limited" && secs !== null && secs > 0 && secs <= maxWaitSec) {
    return `Whoa, that's a lot of sign-ins from your connection (shared Wi-Fi or a phone network can do that). Please wait ${waitText(secs)}, then press the button again.`;
  }
  return ERRORS[code] ?? GENERAL_ERROR;
}

