/**
 * The account key: the ONLY thing Grass Pass keeps about a signed-in person (privacy by design).
 * HMAC-SHA256 of "<provider>:<provider account id>" with a key derived from AUTH_SECRET, so the store
 * holds a scrambled id that can't be turned back into a GitHub/Google account without the server secret.
 * No email, no name, no avatar is ever stored server-side.
 *
 * Every judge demo sign-in shares ONE account key: the demo counts as one person for reports (one report
 * per item per day, and it can never supply both "not safe" votes that hide an item).
 */
import "server-only";
import { createHash, createHmac } from "node:crypto";
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
