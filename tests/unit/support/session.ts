/**
 * Session cookies for unit tests, made exactly like Auth.js makes them (src/lib/accounts/session.ts
 * `sessionCookie`), with the unit-test AUTH_SECRET from ./setup.ts. `primeAccountCookies(n)` makes n
 * different accounts up front so request builders can stay synchronous (`nextAccountCookie()`).
 */
import { accountKey, newJudgeSessionId } from "@/lib/accounts/key";
import { sessionCookie } from "@/lib/accounts/session";

export const TEST_AUTH_SECRET = "unit-test-auth-secret-not-a-real-one-0123456789"; // gitleaks:allow

let seq = 0;
const pool: string[] = [];

/** A cookie for a new GitHub account (a different account each call). */
export async function newAccountCookie(provider: "github" | "google" = "github"): Promise<{ cookie: string; key: string }> {
  const key = accountKey(provider, `test-${process.pid}-${++seq}`);
  return { cookie: await sessionCookie({ k: key, p: provider, t: nowSec() }), key };
}

const nowSec = () => Math.floor(Date.now() / 1000);

/** A judge demo sign-in: the shared account key, and its own random session id (one judge browser). */
export async function judgeCookie(): Promise<{ cookie: string; key: string; session: string }> {
  const key = accountKey("judge", "shared-demo");
  const session = newJudgeSessionId();
  return { cookie: await sessionCookie({ k: key, p: "judge", t: nowSec(), s: session }), key, session };
}

export async function primeAccountCookies(n: number): Promise<void> {
  while (pool.length < n) pool.push((await newAccountCookie()).cookie);
}

/** The next pre-made account cookie (call primeAccountCookies first). */
export function nextAccountCookie(): string {
  const c = pool.shift();
  if (!c) throw new Error("primeAccountCookies() first");
  return c;
}
