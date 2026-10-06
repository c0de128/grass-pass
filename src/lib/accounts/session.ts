/**
 * Read the signed-in account from a request's Auth.js session cookie (an encrypted JWT, A256CBC-HS512,
 * key derived from AUTH_SECRET). The session is trusted for ONE thing only: the account key (`k`) it
 * carries, which the server itself put there at sign-in. Display fields (a first name) never decide
 * anything. Only the cookie is read: an `Authorization: Bearer` header is ignored on purpose.
 *
 * SEC-4-05: every token carries the time of signing in (`t`, seconds). A token older than its provider's
 * lifetime (7 days; the judge demo 1 day: config.ts `sessionLifetimeSec`) is treated as signed out, however
 * often it was used or re-encoded: the limit is absolute, not an idle timeout.
 * UX-4-05: a judge demo token also carries a random per-sign-in id (`s`), used only to stop the same judge
 * browser sending the same report twice a day.
 *
 * Kept apart from src/auth.ts so the pass and report routes (and their unit tests) can read the account
 * from the Request alone, without next/headers. Reading never sets a cookie (SEC-4-04).
 */
import "server-only";
import "@/lib/zod-config";
import { decode, encode } from "next-auth/jwt";
import { z } from "zod";
import { authConfigured, SESSION_COOKIES, sessionLifetimeSec, type ProviderId } from "./config";
import { ACCOUNT_KEY_PATTERN, JUDGE_SESSION_PATTERN } from "./key";

type Env = Record<string, string | undefined>;

export { SESSION_COOKIES };

/** What our jwt callback writes into the token (src/auth.ts `sessionToken`). */
export const TokenSchema = z
  .object({
    k: z.string().regex(ACCOUNT_KEY_PATTERN),
    p: z.enum(["github", "google", "judge"]),
    /** First name for the header, only when the provider gave one. Display only. */
    n: z.string().max(40).optional(),
    /** When this sign-in happened (seconds since 1970). Required: tokens without it are signed out. */
    t: z.number().int().positive(),
    /** Judge demo only: a random id for this sign-in (one browser). */
    s: z.string().regex(JUDGE_SESSION_PATTERN).optional(),
  })
  .refine((v) => v.p !== "judge" || v.s !== undefined, { message: "a judge token needs its session id" });
export type SessionToken = z.infer<typeof TokenSchema>;

export type Account = { key: string; provider: ProviderId; judge: boolean; /** Judge demo only (UX-4-05). */ session?: string };

/** Seconds this token may still be used (<= 0: expired). Absolute: counted from the sign-in time `t`. */
export function secondsLeft(token: Pick<SessionToken, "p" | "t">, nowMs: number = Date.now()): number {
  return token.t + sessionLifetimeSec(token.p) - Math.floor(nowMs / 1000);
}

function cookieValue(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      const raw = part.slice(i + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The decoded, validated, unexpired token from a Cookie header value, or null. */
export async function readSessionCookieHeader(header: string | null | undefined, env: Env = process.env, nowMs: number = Date.now()): Promise<SessionToken | null> {
  if (!authConfigured(env) || !header) return null;
  const secret = env.AUTH_SECRET!.trim();
  for (const name of SESSION_COOKIES) {
    const token = cookieValue(header, name);
    // A huge value is never ours (our token is ~300 bytes); don't spend CPU decrypting it.
    if (!token || token.length > 4096) continue;
    try {
      const payload = await decode({ token, secret, salt: name });
      const parsed = TokenSchema.safeParse(payload);
      // SEC-4-05: the sign-in time decides, not the token's own (re-encodable) expiry; a sign-in "from the future" is not ours either.
      if (parsed.success && secondsLeft(parsed.data, nowMs) > 0 && parsed.data.t <= Math.floor(nowMs / 1000) + 60) return parsed.data;
    } catch {
      // bad or expired token: treated as signed out
    }
  }
  return null;
}

/** The decoded, validated token, or null (no cookie, wrong secret, expired, or not one of ours). */
export async function readSessionToken(req: Request, env: Env = process.env, nowMs: number = Date.now()): Promise<SessionToken | null> {
  return readSessionCookieHeader(req.headers.get("cookie"), env, nowMs);
}

export function accountOf(t: SessionToken): Account {
  return { key: t.k, provider: t.p, judge: t.p === "judge", ...(t.p === "judge" && t.s ? { session: t.s } : {}) };
}

export async function readAccount(req: Request, env: Env = process.env, nowMs: number = Date.now()): Promise<Account | null> {
  const t = await readSessionToken(req, env, nowMs);
  return t ? accountOf(t) : null;
}

/**
 * A session cookie value exactly like Auth.js writes it (tests and the e2e helper only; the app's
 * cookies are written by Auth.js itself).
 */
export async function sessionCookie(token: SessionToken, env: Env = process.env, secure = false): Promise<string> {
  const name = secure ? SESSION_COOKIES[0] : SESSION_COOKIES[1];
  const value = await encode({
    token,
    secret: env.AUTH_SECRET!.trim(),
    salt: name,
    maxAge: Math.max(1, secondsLeft(token)),
  });
  return `${name}=${value}`;
}
