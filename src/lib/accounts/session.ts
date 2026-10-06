/**
 * Read the signed-in account from a request's Auth.js session cookie (an encrypted JWT, A256CBC-HS512,
 * key derived from AUTH_SECRET). The session is trusted for ONE thing only: the account key (`k`) it
 * carries, which the server itself put there at sign-in. Display fields (a first name) never decide
 * anything. Only the cookie is read: an `Authorization: Bearer` header is ignored on purpose.
 *
 * Kept apart from src/auth.ts so the pass and report routes (and their unit tests) can read the account
 * from the Request alone, without next/headers.
 */
import "server-only";
import "@/lib/zod-config";
import { decode, encode } from "next-auth/jwt";
import { z } from "zod";
import { authConfigured, JUDGE_SESSION_MAX_AGE_SEC, SESSION_COOKIES, SESSION_MAX_AGE_SEC, type ProviderId } from "./config";
import { ACCOUNT_KEY_PATTERN } from "./key";

type Env = Record<string, string | undefined>;

export { SESSION_COOKIES };

/** What our jwt callback writes into the token (src/auth.ts `sessionToken`). */
export const TokenSchema = z.object({
  k: z.string().regex(ACCOUNT_KEY_PATTERN),
  p: z.enum(["github", "google", "judge"]),
  /** First name for the header, only when the provider gave one. Display only. */
  n: z.string().max(40).optional(),
});
export type SessionToken = z.infer<typeof TokenSchema>;

export type Account = { key: string; provider: ProviderId; judge: boolean };

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

/** The decoded, validated token, or null (no cookie, wrong secret, expired, or not one of ours). */
export async function readSessionToken(req: Request, env: Env = process.env): Promise<SessionToken | null> {
  if (!authConfigured(env)) return null;
  const header = req.headers.get("cookie");
  if (!header) return null;
  const secret = env.AUTH_SECRET!.trim();
  for (const name of SESSION_COOKIES) {
    const token = cookieValue(header, name);
    // A huge value is never ours (our token is ~300 bytes); don't spend CPU decrypting it.
    if (!token || token.length > 4096) continue;
    try {
      const payload = await decode({ token, secret, salt: name });
      const parsed = TokenSchema.safeParse(payload);
      if (parsed.success) return parsed.data;
    } catch {
      // bad or expired token: treated as signed out
    }
  }
  return null;
}

export async function readAccount(req: Request, env: Env = process.env): Promise<Account | null> {
  const t = await readSessionToken(req, env);
  return t ? { key: t.k, provider: t.p, judge: t.p === "judge" } : null;
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
    maxAge: token.p === "judge" ? JUDGE_SESSION_MAX_AGE_SEC : SESSION_MAX_AGE_SEC,
  });
  return `${name}=${value}`;
}
