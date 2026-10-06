/** What /signin says for each error code (Auth.js pages.error codes and ours). */
import { waitText } from "@/lib/http/respond";

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

/** RULES-5-04: the rate-limit line with the real wait when the address carries it (?wait=<seconds>). */
export function errorText(code: string, wait: string | undefined): string {
  const secs = wait && /^\d{1,6}$/.test(wait) ? Number(wait) : null;
  if (code === "rate_limited" && secs !== null && secs > 0) {
    return `Whoa, that's a lot of sign-ins from your connection (shared Wi-Fi or a phone network can do that). Please wait ${waitText(secs)}, then press the button again.`;
  }
  return ERRORS[code] ?? GENERAL_ERROR;
}

