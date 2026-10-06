/**
 * Auth.js (next-auth v5) set-up. JWT sessions only (no database adapter): the session lives in an
 * encrypted, httpOnly, SameSite=Lax cookie (Secure + `__Secure-` prefix on https). The token holds only
 * the account key (an HMAC, src/lib/accounts/key.ts), the provider id and, for the header, a first name
 * when the provider gave one. No email, no avatar, nothing stored server-side.
 *
 * Providers: GitHub and Google, each only when its id AND secret are set; plus "judge", a no-input
 * Credentials provider behind the "Try as a judge" button (a shared demo account). Sign-in attempts are
 * rate limited per IP (here for the judge, in the route for every OAuth start and callback).
 */
import "server-only";
import NextAuth, { CredentialsSignin, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { encode as encodeJwt } from "next-auth/jwt";
import { enabledOAuthProviders, JUDGE_SESSION_MAX_AGE_SEC, judgeDemoEnabled, SESSION_MAX_AGE_SEC, type ProviderId } from "@/lib/accounts/config";
import { accountKey, JUDGE_ACCOUNT_ID } from "@/lib/accounts/key";
import { safeRedirect } from "@/lib/accounts/redirect";
import { checkSignInRate } from "@/lib/accounts/signin-rate";
import type { SessionToken } from "@/lib/accounts/session";
import { log } from "@/lib/log";

class SignInRateLimited extends CredentialsSignin {
  code = "rate_limited";
}

/** A first name for the header, or undefined. Never stored server-side. */
export function firstName(profile: Record<string, unknown> | undefined, provider: ProviderId): string | undefined {
  if (!profile) return undefined;
  const raw = provider === "google" ? profile.given_name : profile.name;
  if (typeof raw !== "string") return undefined;
  const first = raw.trim().split(/\s+/)[0]?.replace(/[^\p{L}\p{M}'-]/gu, "") ?? "";
  return first.length > 0 ? first.slice(0, 40) : undefined;
}

/** The token our jwt callback keeps at sign-in: account key, provider, maybe a first name. Nothing else. */
export function sessionToken(account: { provider: string; providerAccountId: string }, profile: Record<string, unknown> | undefined): SessionToken | null {
  const p = account.provider;
  if (p !== "github" && p !== "google" && p !== "judge") return null;
  const id = p === "judge" ? JUDGE_ACCOUNT_ID : account.providerAccountId;
  const n = p === "judge" ? undefined : firstName(profile, p);
  return { k: accountKey(p, id), p, ...(n ? { n } : {}) };
}

export function authConfig(env: Record<string, string | undefined> = process.env): NextAuthConfig {
  const oauth = enabledOAuthProviders(env);
  const providers: NextAuthConfig["providers"] = [];
  if (oauth.includes("github")) providers.push(GitHub({ clientId: env.AUTH_GITHUB_ID, clientSecret: env.AUTH_GITHUB_SECRET }));
  if (oauth.includes("google")) providers.push(Google({ clientId: env.AUTH_GOOGLE_ID, clientSecret: env.AUTH_GOOGLE_SECRET }));
  if (judgeDemoEnabled(env)) {
    providers.push(
      Credentials({
        id: "judge",
        name: "Judge demo",
        credentials: {},
        async authorize(_input, request) {
          const ok = await checkSignInRate(request);
          if (!ok) throw new SignInRateLimited();
          log("signin", { provider: "judge" });
          return { id: JUDGE_ACCOUNT_ID };
        },
      }),
    );
  }
  return {
    providers,
    session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SEC },
    // Vercel sets VERCEL (Auth.js trusts its host then). Locally `next start` is "production", so trust the
    // Host header here too: OAuth providers only accept their registered callback URL, and every redirect
    // goes through safeRedirect (same origin only).
    trustHost: true,
    pages: { signIn: "/signin", error: "/signin" },
    jwt: {
      // The judge demo session expires after a day (OAuth sessions after 30 days).
      encode: (params) => encodeJwt({ ...params, maxAge: (params.token as { p?: string } | undefined)?.p === "judge" ? JUDGE_SESSION_MAX_AGE_SEC : params.maxAge }),
    },
    callbacks: {
      jwt({ token, account, profile }) {
        if (account) {
          const t = sessionToken(account, profile as Record<string, unknown> | undefined);
          if (!t) return null;
          if (account.provider !== "judge") log("signin", { provider: account.provider });
          return t;
        }
        // Later requests: keep only our own fields (drop anything Auth.js adds by default).
        const { k, p, n } = token as Partial<SessionToken>;
        if (!k || !p) return null;
        return { k, p, ...(n ? { n } : {}) };
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

export const { handlers, auth, signIn, signOut } = NextAuth(() => authConfig());
