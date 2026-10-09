/**
 * Accounts (Kevin, 2026-10-06): sign in with GitHub or Google (OAuth, no passwords; each only when its keys are set), or the one-click
 * "Try as a judge" demo account. Pass limits (Kevin, 2026-10-08): without signing in, 1 free new pass per Chicago day
 * (counted by a signed cookie, src/lib/limits/free-pass.ts); signed in, ACCOUNT_DAILY_PASSES (default 5) per account.
 * Sign-in is needed for more new passes, item reports and pass ratings.
 *
 * Which sign-in buttons exist is decided here from the env, so a provider without its keys never shows
 * a button that can't work. Nothing here is a secret.
 */
import { capFromEnv, intFromEnv } from "@/lib/limits/config";

type Env = Record<string, string | undefined>;

export const OAUTH_PROVIDERS = ["github", "google"] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number];
export type ProviderId = OAuthProviderId | "judge";

export const PROVIDER_LABELS: Record<ProviderId, string> = { github: "GitHub", google: "Google", judge: "the judge demo" };

/** New passes per account per Chicago day: the default of ACCOUNT_DAILY_PASSES (Kevin, 2026-10-08: 5, was 2). */
export const ACCOUNT_PASSES_PER_DAY_DEFAULT = 5;
/** Free new passes per Chicago day WITHOUT signing in (Kevin, 2026-10-08), counted by a signed cookie. */
export const FREE_PASSES_PER_DAY = 1;
/**
 * Backstop for the cookie (cookies are easy to clear): new passes per Chicago day that signed-out visitors on ONE
 * connection (IP; an IPv6 /48 gets 2x) may start, ANON_PASSES_PER_IP_PER_DAY (default 3).
 */
export const ANON_PASSES_PER_IP_PER_DAY_DEFAULT = 3;
/**
 * New passes per Chicago day for ALL judge demo sign-ins together (JUDGE_DEMO_DAILY_CAP, one env value).
 * SEC-4-02: 60 (was 20), pending Kevin's confirmation; well inside AI_DAILY_CAP 400.
 */
export const JUDGE_DEMO_DAILY_CAP_DEFAULT = 60;
/**
 * SEC-4-02: inside that shared cap, one connection (IP; an IPv6 /48 gets 2x) may start at most this many
 * judge passes a day, so one person can't use up every judge's day.
 */
export const JUDGE_PASSES_PER_IP_PER_DAY = 3;
/** Sign-in attempts (judge or OAuth start/callback) per IP per 10 minutes. */
export const SIGNIN_PER_IP_PER_10MIN = 20;
/** The sign-in limiter's window (seconds): its longest possible wait (src/lib/accounts/signin-rate.ts). */
export const SIGNIN_WINDOW_SEC = 600;
/** Item reports per account per hour, and per IP per hour. */
export const REPORTS_PER_ACCOUNT_PER_HOUR = 30;
export const REPORTS_PER_IP_PER_HOUR = 60;
/** Pass ratings (Kevin, 2026-10-08) per account per hour, and per IP per hour. */
export const FEEDBACK_PER_ACCOUNT_PER_HOUR = 30;
export const FEEDBACK_PER_IP_PER_HOUR = 60;
/**
 * SEC-4-05: how long a sign-in lasts, counted from the moment of signing in (absolute, never extended by
 * use): 7 days with GitHub or Google, 1 day for the judge demo. The cookie's own expiry is the same.
 */
export const SESSION_MAX_AGE_SEC = 7 * 24 * 3600;
export const JUDGE_SESSION_MAX_AGE_SEC = 24 * 3600;

/** The absolute sign-in lifetime for a provider (SEC-4-05). */
export function sessionLifetimeSec(provider: ProviderId): number {
  return provider === "judge" ? JUDGE_SESSION_MAX_AGE_SEC : SESSION_MAX_AGE_SEC;
}

/** Auth.js session cookie names: `__Secure-` on https (production), plain on http://localhost. */
export const SESSION_COOKIES = ["__Secure-authjs.session-token", "authjs.session-token"] as const;

const has = (v: string | undefined) => (v?.trim().length ?? 0) > 0;

/** OAuth providers whose id AND secret are set (AUTH_GITHUB_ID/SECRET, AUTH_GOOGLE_ID/SECRET). */
export function enabledOAuthProviders(env: Env = process.env): OAuthProviderId[] {
  return OAUTH_PROVIDERS.filter((p) => has(env[`AUTH_${p.toUpperCase()}_ID`]) && has(env[`AUTH_${p.toUpperCase()}_SECRET`]));
}

/**
 * The OAuth providers that really work on this server, in words: "GitHub", "GitHub or Google", or null when none is
 * set up. Every sentence that names a provider is built from this, so copy never names a button that isn't there
 * (audit R4 RULES-4-02).
 */
export function oauthProviderNames(env: Env = process.env): string | null {
  const names = enabledOAuthProviders(env).map((p) => PROVIDER_LABELS[p]);
  return names.length > 0 ? names.join(" or ") : null;
}

/** " with GitHub" / " with GitHub or Google" / "" (no OAuth provider set up), for `sign in${signInWith()}`. */
export function signInWith(env: Env = process.env): string {
  const names = oauthProviderNames(env);
  return names ? ` with ${names}` : "";
}

/** The judge demo sign-in is on unless JUDGE_DEMO=0. */
export function judgeDemoEnabled(env: Env = process.env): boolean {
  return env.JUDGE_DEMO?.trim() !== "0";
}

/** New passes per account per Chicago day (ACCOUNT_DAILY_PASSES, default 5; at least 1). */
export function accountPassesPerDay(env: Env = process.env): number {
  return intFromEnv(env.ACCOUNT_DAILY_PASSES, ACCOUNT_PASSES_PER_DAY_DEFAULT);
}

/** Signed-out new passes per connection per Chicago day (ANON_PASSES_PER_IP_PER_DAY, default 3; 0 = no free passes). */
export function anonPassesPerIpPerDay(env: Env = process.env): number {
  return capFromEnv(env.ANON_PASSES_PER_IP_PER_DAY, ANON_PASSES_PER_IP_PER_DAY_DEFAULT);
}

/** Free passes a day without signing in: FREE_PASSES_PER_DAY, or 0 when ANON_PASSES_PER_IP_PER_DAY=0 switches them off. */
export function freePassesPerDay(env: Env = process.env): number {
  return anonPassesPerIpPerDay(env) === 0 ? 0 : FREE_PASSES_PER_DAY;
}

export function judgeDailyCap(env: Env = process.env): number {
  // SEC-5-02: JUDGE_DEMO_DAILY_CAP=0 means the judge demo makes no new passes (it used to silently mean 60).
  return capFromEnv(env.JUDGE_DEMO_DAILY_CAP, JUDGE_DEMO_DAILY_CAP_DEFAULT);
}

/** Sign-in works at all only with AUTH_SECRET (it encrypts the session cookie and keys the account ids). */
export function authConfigured(env: Env = process.env): boolean {
  return (env.AUTH_SECRET?.trim().length ?? 0) >= 16;
}

/**
 * What the sign-in card may offer (sent to the browser: names only, never keys), and the real daily numbers it states
 * (`perDay`: new passes per account; `free`: free new passes a day without signing in).
 */
export type SignInOptions = { providers: OAuthProviderId[]; judge: boolean; configured: boolean; perDay: number; free: number };

export function signInOptions(env: Env = process.env): SignInOptions {
  const configured = authConfigured(env);
  return {
    configured,
    providers: configured ? enabledOAuthProviders(env) : [],
    judge: configured && judgeDemoEnabled(env),
    perDay: accountPassesPerDay(env),
    free: freePassesPerDay(env),
  };
}

/** Copy shown next to the sign-in buttons and on /about (Kevin's privacy promise). The numbers come from the functions below. */
export const ACCOUNT_COPY = {
  privacy: "We only keep a scrambled ID to count your new passes, reports and ratings. No email, no name.",
  grownUps: "Sign-in is for grown-ups, not kids.",
  judgeNote: "Try as a judge to use a shared demo account. No sign-up, nothing to type.",
  notConfigured: "Sign-in isn't set up here yet. Examples and saved passes still work.",
} as const;

/** "5 new passes a day" / "1 new pass a day". */
export function perDayWords(perDay: number): string {
  return `${perDay} new ${perDay === 1 ? "pass" : "passes"} a day`;
}

/** The pass rule in one sentence (the wizard, /about, /how-it-works, the sign-in card). */
export function freePassRule(free: number, perDay: number): string {
  if (free <= 0) return `A new pass needs a grown-up signed in: ${perDayWords(perDay)} each.`;
  return `Without signing in you get ${free} free new ${free === 1 ? "pass" : "passes"} a day; a grown-up who signs in gets ${perDayWords(perDay)}.`;
}

/** SIGN_IN_REQUIRED: free passes are off on this server (or a caller without the free-pass check). */
export function signInToMakeCopy(env: Env = process.env): string {
  return `Sign in to make a new pass (${accountPassesPerDay(env)} a day).`;
}

/** ACCOUNT_DAILY_LIMIT: the account used its passes for today. */
export function accountLimitCopy(env: Env = process.env): string {
  const n = accountPassesPerDay(env);
  return `You used your ${n} new ${n === 1 ? "pass" : "passes"} for today. Saved passes and examples still work. You get ${n} more after midnight Dallas time.`;
}

/** What a signed-out visitor can do next: only the sign-in options this server really has (RULES-4-02). */
export function signInNextCopy(env: Env = process.env): string {
  const names = authConfigured(env) ? oauthProviderNames(env) : null;
  const judge = authConfigured(env) && judgeDemoEnabled(env);
  const more = perDayWords(accountPassesPerDay(env));
  if (names && judge) return `Sign in with ${names} for ${more}, or press Try as a judge.`;
  if (names) return `Sign in with ${names} for ${more}.`;
  if (judge) return "Press Try as a judge to keep going.";
  return "You get a new free pass after midnight Dallas time.";
}

/** FREE_PASS_USED: this browser's free pass for today is used (its signed cookie says so). */
export function freePassUsedCopy(env: Env = process.env): string {
  return `You used today's free pass. ${signInNextCopy(env)} Saved passes and examples still work.`;
}

/** ANON_IP_DAILY_LIMIT: this connection's free passes for today are used (the backstop for cleared cookies). */
export function anonIpLimitCopy(env: Env = process.env): string {
  return `This internet connection has used its free passes for today. ${signInNextCopy(env)} Saved passes and examples still work.`;
}

/** SEC-4-02: the judge demo's limits in words (the same numbers the code uses). */
export function judgeShareCopy(env: Env = process.env): string {
  return `All judges together can make ${judgeDailyCap(env)} new passes a day with it, at most ${JUDGE_PASSES_PER_IP_PER_DAY} from one internet connection.`;
}

/** SEC-4-02: the limit messages, with the honest number left. */
export function judgeLimitMessage(scope: "global" | "key", env: Env = process.env): string {
  // RULES-4-02: name only the providers set up on this server.
  const names = oauthProviderNames(env);
  const still = `Saved passes and the examples still work${names ? `, or sign in with ${names}` : ""}.`;
  const after = `${still} New demo passes again after midnight (Dallas time).`;
  // Round-6 SEC-6-04: a cap of 0 is the operator's stop and lasts until the setting changes, not until midnight.
  if (scope === "global" && judgeDailyCap(env) === 0) return `The judge demo is paused for now: it makes no new passes. ${still}`;
  if (scope === "global") return `0 of ${judgeDailyCap(env)} judge passes left today: the judge demo account has made all its new passes (shared by every judge). ${after}`;
  return `0 judge passes left today for your connection: it has made its ${JUDGE_PASSES_PER_IP_PER_DAY} judge demo passes (other judges have their own). ${after}`;
}

/** What the sign-in card says about the judge passes left (GET /api/judge-passes). */
export type JudgePassesLeft = { cap: number; perConnection: number; left: number; leftForYou: number };

export function judgeLeftCopy(j: JudgePassesLeft): string {
  // Round-6 SEC-6-04: cap 0 = paused by the operator, with no promise about midnight.
  if (j.cap === 0) return "The judge demo is paused for now. Saved passes and the examples still work.";
  if (j.left <= 0) return `0 of ${j.cap} judge passes left today. New ones after midnight (Dallas time); saved passes and the examples still work.`;
  if (j.leftForYou <= 0) return `0 judge passes left today for your connection (${j.left} of ${j.cap} left for other judges).`;
  const you = Math.min(j.left, j.leftForYou);
  return `${j.left} of ${j.cap} judge passes left today (up to ${you} from your connection).`;
}
