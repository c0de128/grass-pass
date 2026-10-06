/**
 * Auth.js (next-auth v5) set-up. JWT sessions only (no database adapter): the session lives in an
 * encrypted, httpOnly, SameSite=Lax cookie (Secure + `__Secure-` prefix on https). The token holds only
 * the account key (an HMAC, src/lib/accounts/key.ts), the provider id, the sign-in time and, for the header,
 * a first name when the provider gave one (the judge demo: a random per-sign-in id instead). No email, no
 * avatar, nothing stored server-side.
 *
 * Providers: GitHub (scope `read:user` only) and Google (`openid profile` only), each only when its id AND
 * secret are set (SEC-4-06: no email scope, and the GitHub profile request never asks for email addresses);
 * plus "judge", a no-input Credentials provider behind the "Try as a judge" button (a shared demo account).
 * Sign-in attempts are rate limited per IP (here for the judge, in the route for every OAuth start and callback).
 *
 * SEC-4-05: a sign-in lasts 7 days (GitHub/Google) or 1 day (the judge demo), counted from signing in. The
 * jwt callback signs a token out after that however often it is used; the token's `exp` and the cookie's
 * own expiry are set to the time left (not slid forward). Auth.js has ONE session maxAge per config, so
 * the config is built per request (the judge callback gets 1 day) and the judge server-action sign-in
 * uses its own instance (`signInJudge`).
 */
import "server-only";
import NextAuth, { CredentialsSignin, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { encode as encodeJwt } from "next-auth/jwt";
import { enabledOAuthProviders, judgeDemoEnabled, SESSION_MAX_AGE_SEC, sessionLifetimeSec, type ProviderId } from "@/lib/accounts/config";
import { accountKey, JUDGE_ACCOUNT_ID, newJudgeSessionId } from "@/lib/accounts/key";
import { safeRedirect } from "@/lib/accounts/redirect";
import { signInRate } from "@/lib/accounts/signin-rate";
import { readSessionToken, secondsLeft, TokenSchema, type SessionToken } from "@/lib/accounts/session";
import { log } from "@/lib/log";

/** RULES-5-04: the code carries the wait (seconds), so /signin can say how long ("rate_limited:47"). */
class SignInRateLimited extends CredentialsSignin {
  constructor(retryAfter: number) {
    super();
    this.code = `rate_limited:${Math.max(1, Math.ceil(retryAfter))}`;
  }
}

/** A first name for the header, or undefined. Never stored server-side. */
export function firstName(profile: Record<string, unknown> | undefined, provider: ProviderId): string | undefined {
  if (!profile) return undefined;
  const raw = provider === "google" ? profile.given_name : profile.name;
  if (typeof raw !== "string") return undefined;
  const first = raw.trim().split(/\s+/)[0]?.replace(/[^\p{L}\p{M}'-]/gu, "") ?? "";
  return first.length > 0 ? first.slice(0, 40) : undefined;
}

/** The token our jwt callback keeps at sign-in: account key, provider, sign-in time, maybe a first name (judge: a session id). */
export function sessionToken(
  account: { provider: string; providerAccountId: string },
  profile: Record<string, unknown> | undefined,
  nowMs: number = Date.now(),
): SessionToken | null {
  const p = account.provider;
  if (p !== "github" && p !== "google" && p !== "judge") return null;
  const t = Math.floor(nowMs / 1000);
  if (p === "judge") return { k: accountKey(p, JUDGE_ACCOUNT_ID), p, t, s: newJudgeSessionId() };
  const n = firstName(profile, p);
  return { k: accountKey(p, account.providerAccountId), p, t, ...(n ? { n } : {}) };
}

/**
 * Later requests: keep only our own fields, and sign out a token past its absolute lifetime (SEC-4-05)
 * or one without a sign-in time (made before that rule).
 */
export function keepToken(token: unknown, nowMs: number = Date.now()): SessionToken | null {
  const { k, p, n, t, s } = (token ?? {}) as Partial<SessionToken>;
  const parsed = TokenSchema.safeParse({ k, p, t, ...(n ? { n } : {}), ...(s ? { s } : {}) });
  if (!parsed.success || secondsLeft(parsed.data, nowMs) <= 0) return null;
  return parsed.data;
}

/** The GitHub profile without the email lookup Auth.js's default does (SEC-4-06: scope `read:user` only). */
async function githubProfileOnly({ tokens }: { tokens: { access_token?: string } }): Promise<Record<string, unknown>> {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokens.access_token ?? ""}`, "User-Agent": "grass-pass", Accept: "application/vnd.github+json" },
    redirect: "error",
  });
  if (!res.ok) throw new Error(`GitHub profile ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

type Env = Record<string, string | undefined>;

export function authConfig(env: Env = process.env, opts: { sessionMaxAgeSec?: number } = {}): NextAuthConfig {
  const oauth = enabledOAuthProviders(env);
  const providers: NextAuthConfig["providers"] = [];
  if (oauth.includes("github")) {
    providers.push(
      GitHub({
        clientId: env.AUTH_GITHUB_ID,
        clientSecret: env.AUTH_GITHUB_SECRET,
        authorization: { params: { scope: "read:user" } },
        userinfo: { url: "https://api.github.com/user", request: githubProfileOnly },
      }),
    );
  }
  if (oauth.includes("google")) {
    providers.push(Google({ clientId: env.AUTH_GOOGLE_ID, clientSecret: env.AUTH_GOOGLE_SECRET, authorization: { params: { scope: "openid profile" } } }));
  }
  if (judgeDemoEnabled(env)) {
    providers.push(
      Credentials({
        id: "judge",
        name: "Judge demo",
        credentials: {},
        async authorize(_input, request) {
          const rate = await signInRate(request);
          if (!rate.ok) throw new SignInRateLimited(rate.retryAfter);
          log("signin", { provider: "judge" });
          return { id: JUDGE_ACCOUNT_ID };
        },
      }),
    );
  }
  return {
    providers,
    session: { strategy: "jwt", maxAge: opts.sessionMaxAgeSec ?? SESSION_MAX_AGE_SEC },
    // Vercel sets VERCEL (Auth.js trusts its host then). Locally `next start` is "production", so trust the
    // Host header here too: OAuth providers only accept their registered callback URL, and every redirect
    // goes through safeRedirect (same origin only).
    trustHost: true,
    pages: { signIn: "/signin", error: "/signin" },
    jwt: {
      // SEC-4-05: the token expires when its sign-in does (absolute), never later.
      encode: (params) => {
        const t = params.token as Partial<SessionToken> | undefined;
        const left = t?.p && typeof t.t === "number" ? secondsLeft({ p: t.p, t: t.t }) : params.maxAge;
        return encodeJwt({ ...params, maxAge: Math.max(1, Math.min(left ?? SESSION_MAX_AGE_SEC, params.maxAge ?? SESSION_MAX_AGE_SEC)) });
      },
    },
    callbacks: {
      jwt({ token, account, profile }) {
        if (account) {
          const t = sessionToken(account, profile as Record<string, unknown> | undefined);
          if (!t) return null;
          if (account.provider !== "judge") log("signin", { provider: account.provider });
          return t;
        }
        return keepToken(token);
      },
      session({ session, token }) {
        const t = token as Partial<SessionToken>;
        // The browser sees a first name and the provider; never the account key, never an email.
        return {
          expires: session.expires,
          user: { name: t.n ?? null },
          provider: t.p,
        } as unknown as typeof session;
      },
      redirect({ url, baseUrl }) {
        return safeRedirect(url, baseUrl);
      },
    },
    logger: {
      // Auth.js errors carry no secrets in their names; keep their details out of the logs.
      error(error) {
        log("auth_error", { name: error.name, type: (error as { type?: string }).type ?? "unknown" }, "warn");
      },
      warn(code) {
        log("auth_warn", { code }, "warn");
      },
      debug() {},
    },
  };
}

/**
 * SEC-4-05: the session (and cookie) lifetime for an HTTP request to /api/auth/*: a sign-in callback gets
 * its provider's full lifetime; anything else that re-writes an existing session gets only the time it has
 * left; otherwise the OAuth default.
 */
export async function sessionMaxAgeFor(req: Request | undefined, env: Env = process.env, nowMs: number = Date.now()): Promise<number> {
  if (!req) return SESSION_MAX_AGE_SEC;
  const m = /\/api\/auth\/callback\/([a-z]+)$/.exec(new URL(req.url).pathname);
  if (m) return sessionLifetimeSec(m[1] === "judge" ? "judge" : "github");
  const t = await readSessionToken(req, env, nowMs);
  return t ? Math.max(1, secondsLeft(t, nowMs)) : SESSION_MAX_AGE_SEC;
}

export const { handlers, auth, signIn, signOut } = NextAuth(async (req) => authConfig(process.env, { sessionMaxAgeSec: await sessionMaxAgeFor(req) }));

/** The judge demo's server-action sign-in: the same config with a 1-day session and cookie (SEC-4-05). */
const judgeInstance = NextAuth(() => authConfig(process.env, { sessionMaxAgeSec: sessionLifetimeSec("judge") }));
export const signInJudge = judgeInstance.signIn;
