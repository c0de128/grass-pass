/**
 * JSON error responses with the same shape everywhere:
 * `{ error: { code, message, retryAfter? } }`, `Cache-Control: no-store`, and a
 * `Retry-After` header on 429/503 when we know the wait.
 */
export type ApiError = { code: string; message: string; retryAfter?: number };

export function jsonError(status: number, err: ApiError): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (err.retryAfter && err.retryAfter > 0) headers["Retry-After"] = String(Math.ceil(err.retryAfter));
  return Response.json({ error: err }, { status, headers });
}

/**
 * Friendly wait text, e.g. "about 1 second", "about 40 seconds", "about 3 minutes", "about 5 hours" (UX-6-01:
 * singular for 1). Minutes and hours start at 90 s and 90 min, so they always round to 2 or more.
 */
export function waitText(seconds: number): string {
  if (seconds < 90) {
    const s = Math.max(1, Math.round(seconds));
    return `about ${s} ${s === 1 ? "second" : "seconds"}`;
  }
  if (seconds < 90 * 60) return `about ${Math.round(seconds / 60)} minutes`;
  return `about ${Math.round(seconds / 3600)} hours`;
}

/** 429 for a per-IP limit: names the limit and the wait. */
export function tooManyRequests(retryAfter: number, what: string): Response {
  return jsonError(429, {
    code: "RATE_LIMITED",
    message: `Too many ${what} from your connection. Please wait ${waitText(retryAfter)} and try again.`,
    retryAfter,
  });
}

/** 429 for a global daily/monthly cap: says it's the whole site, not the user. */
export function capReached(retryAfter: number, what: string, nextStep?: string): Response {
  return jsonError(429, {
    code: "DAILY_LIMIT",
    message: `Grass Pass has reached its free limit for ${what} (for everyone). It resets in ${waitText(retryAfter)}.${nextStep ? ` ${nextStep}` : ""}`,
    retryAfter,
  });
}

/** 503 when the shared store (limits/caches) is down: refuse rather than call upstream unmetered. */
export function storeUnavailable(): Response {
  return jsonError(503, {
    code: "STORE_UNAVAILABLE",
    message: "Grass Pass can't check its usage limits right now, so it paused new requests. Try again in a minute.",
    retryAfter: 60,
  });
}
