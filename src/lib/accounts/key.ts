/**
 * The account key: the ONLY thing Grass Pass keeps about a signed-in person (privacy by design).
 * HMAC-SHA256 of "<provider>:<provider account id>" with a key derived from AUTH_SECRET, so the store
 * holds a scrambled id that can't be turned back into a GitHub/Google account without the server secret.
 * No email, no name, no avatar is ever stored server-side.
 *
 * Every judge demo sign-in shares ONE account key. SEC-4-01/03: the judge demo never counts toward any
 * report threshold (its reports are only logged), and each judge sign-in gets its own random session id
 * (`judgeSessionId`, inside the judge's own cookie) so two judges don't block each other's reports (UX-4-05).
 */
import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import type { ProviderId } from "./config";

type Env = Record<string, string | undefined>;

/** `a:` + 22 base64url chars (132 bits). */
export const ACCOUNT_KEY_PATTERN = /^a:[A-Za-z0-9_-]{22}$/;
export const JUDGE_ACCOUNT_ID = "shared-demo";

function hmacKey(env: Env): Buffer {
  const secret = env.AUTH_SECRET?.trim() ?? "";
  if (secret.length < 16) throw new Error("AUTH_SECRET is not set (at least 16 characters)");
  // Domain-separated from the session-cookie encryption key Auth.js derives from the same secret.
  return createHash("sha256").update(`grass-pass account key v1\n${secret}`).digest();
}

export function accountKey(provider: ProviderId, providerAccountId: string, env: Env = process.env): string {
  const id = String(providerAccountId).trim();
  if (!id) throw new Error("empty provider account id");
  return `a:${createHmac("sha256", hmacKey(env)).update(`${provider}:${id}`).digest("base64url").slice(0, 22)}`;
}

export function judgeAccountKey(env: Env = process.env): string {
  return accountKey("judge", JUDGE_ACCOUNT_ID, env);
}

/** Reporter ids and judge session ids: 12 / 16 base64url chars. */
export const REPORTER_ID_PATTERN = /^[A-Za-z0-9_-]{12}$/;
export const JUDGE_SESSION_PATTERN = /^[A-Za-z0-9_-]{16}$/;

/**
 * SEC-4-01: the id under which one account's item reports are kept for ONE park: an HMAC of the account
 * key and the park (72 bits). The same person always gets the same id in a park (so they count once), and
 * the ids of two parks can't be linked to each other or to the account without the server secret.
 */
export function reporterId(key: string, parkId: string, env: Env = process.env): string {
  return createHmac("sha256", hmacKey(env)).update(`reporter|${key}|${parkId}`).digest("base64url").slice(0, 12);
}

/** UX-4-05: a random id for one judge demo sign-in (one browser), kept only inside that judge's cookie. */
export function newJudgeSessionId(): string {
  return randomBytes(12).toString("base64url");
}
