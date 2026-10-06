/**
 * Cheap request guards for the public API. All of them run before any limit,
 * cache or upstream call (SPEC §7, starter kit).
 */
import "@/lib/zod-config";
import type { z } from "zod";
import { getStore } from "@/lib/cache/store";
import { restingError } from "@/lib/limits/budget";

export type GuardFailure = { status: number; code: string; message: string };

/** Hard cap on POST bodies (SPEC §7: 2 KB). `{"parkId":"way/123","ageBand":"6-10"}` is ~40 bytes. */
export const MAX_BODY_BYTES = 2048;

/**
 * Same-origin check. Browsers always send `Sec-Fetch-Site` and `Origin` on a
 * cross-site request, so a third-party page cannot spend our model or data quotas
 * from its visitors' browsers. Non-browser clients (curl) send neither header;
 * they are bounded by the per-IP and daily limits instead.
 */
export function checkSameOrigin(req: Request): GuardFailure | null {
  const deny: GuardFailure = {
    status: 403,
    code: "CROSS_ORIGIN",
    message: "This API only answers requests from the Grass Pass page itself.",
  };
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return deny;

  const origin = req.headers.get("origin");
  if (origin !== null) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return deny; // includes the opaque origin "null"
    }
    if (!host || originHost.toLowerCase() !== host.split(",")[0].trim().toLowerCase()) return deny;
  }
  return null;
}

/** Require `application/json` so no-preflight `text/plain` form posts are refused. */
export function checkJsonContentType(req: Request): GuardFailure | null {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type === "application/json") return null;
  return {
    status: 415,
    code: "UNSUPPORTED_MEDIA_TYPE",
    message: "Send the request body as JSON (Content-Type: application/json).",
  };
}

export type BodyResult = { ok: true; text: string } | { ok: false; reason: "too_large" | "empty" | "unreadable" };

/**
 * Read the body as a stream and stop as soon as it passes `maxBytes`.
 * Works for chunked bodies with no Content-Length (a Content-Length check
 * alone would let `request.text()` buffer an unbounded chunked body).
 */
export async function readBodyLimited(req: Request, maxBytes = MAX_BODY_BYTES): Promise<BodyResult> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) return { ok: false, reason: "too_large" };
  if (!req.body) return { ok: false, reason: "empty" };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    // Client went away mid-body, or the stream errored.
    return { ok: false, reason: "unreadable" };
  }
  if (total === 0) return { ok: false, reason: "empty" };

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/**
 * SEC-2-01: while the store's monthly command budget is nearly used up (src/lib/limits/budget.ts), the
 * POST APIs answer 503 RESTING with the date, before any store command.
 */
export function checkResting(now: number = Date.now()): GuardFailure | null {
  const err = restingError(now);
  return err ? { status: 503, code: err.code, message: err.message } : null;
}

/**
 * Every guard for a JSON POST, in order: same origin (403), resting (503), JSON content type (415),
 * streamed size cap (413), JSON parse + zod validation (400).
 */
export async function guardJsonPost<T>(
  req: Request,
  schema: z.ZodType<T>,
  maxBytes = MAX_BODY_BYTES,
): Promise<{ ok: true; data: T } | { ok: false; failure: GuardFailure }> {
  const origin = checkSameOrigin(req);
  if (origin) return { ok: false, failure: origin };
  // SEC-3-04: a new instance reads the shared command counters once (1 command) before deciding.
  await getStore("limits").prime?.();
  const resting = checkResting();
  if (resting) return { ok: false, failure: resting };
  const type = checkJsonContentType(req);
  if (type) return { ok: false, failure: type };

  const body = await readBodyLimited(req, maxBytes);
  if (!body.ok) {
    if (body.reason === "too_large") {
      return { ok: false, failure: { status: 413, code: "BODY_TOO_LARGE", message: "That request is too large." } };
    }
    return { ok: false, failure: { status: 400, code: "BAD_BODY", message: "The request body was empty or unreadable." } };
  }
  let json: unknown;
  try {
    json = JSON.parse(body.text);
  } catch {
    return { ok: false, failure: { status: 400, code: "BAD_JSON", message: "The request body is not valid JSON." } };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, failure: { status: 400, code: "BAD_INPUT", message: "Some of the request fields are missing or not valid." } };
  }
  return { ok: true, data: parsed.data };
}

/** Guards for a public GET that spends a shared quota: same origin only (403). */
export function guardGet(req: Request): GuardFailure | null {
  return checkSameOrigin(req);
}
