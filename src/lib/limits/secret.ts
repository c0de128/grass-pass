/**
 * The HMAC key that turns client IPs into limiter keys (SEC-1-03: the shared store and the logs never
 * hold a raw IP address). Order:
 * 1. `LIMITER_KEY_SECRET` (at least 16 characters). Set it in production.
 * 2. Fallback: derived from the Upstash token (already a server secret, and the same on every instance,
 *    so per-IP limits still work across instances). Changing the token resets every per-IP counter,
 *    which only means a fresh day's allowance.
 * 3. No Upstash (local dev, tests): a random key per process. Limits live in memory in that process anyway.
 */
import { createHash, randomBytes } from "node:crypto";
import { logOnce } from "@/lib/log";

type Env = Record<string, string | undefined>;
type Holder = { key: Buffer; source: "env" | "upstash-token" | "random"; from: string };
const HOLDER = Symbol.for("grass-pass.limiter-secret");
/** Which env value the key came from, without keeping a second copy of the secret. */
const fingerprint = (v: string) => createHash("sha256").update(v).digest("hex");

export const MIN_SECRET_LENGTH = 16;

function resolve(env: Env): Holder {
  const own = env.LIMITER_KEY_SECRET?.trim() ?? "";
  if (own.length >= MIN_SECRET_LENGTH) return { key: Buffer.from(own, "utf8"), source: "env", from: fingerprint(own) };
  if (own) logOnce("limiter-secret-short", "limiter_secret_ignored", { reason: `LIMITER_KEY_SECRET must be at least ${MIN_SECRET_LENGTH} characters` }, "error");
  const token = (env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN)?.trim();
  if (token) {
    return { key: createHash("sha256").update(`grass-pass limiter key v1\n${token}`).digest(), source: "upstash-token", from: fingerprint(token) };
  }
  return { key: randomBytes(32), source: "random", from: fingerprint("") };
}

/** The current HMAC key (re-resolved when the env value it came from changes, e.g. in tests). */
export function limiterSecret(env: Env = process.env): Buffer {
  const g = globalThis as unknown as Record<symbol, Holder | undefined>;
  const own = env.LIMITER_KEY_SECRET?.trim() ?? "";
  const token = (env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN)?.trim() ?? "";
  const cur = g[HOLDER];
  const wanted = own.length >= MIN_SECRET_LENGTH ? own : token;
  if (cur && cur.from === fingerprint(wanted)) return cur.key;
  const next = resolve(env);
  g[HOLDER] = next;
  if (next.source !== "env" && env.VERCEL_ENV === "production") {
    logOnce("limiter-secret-fallback", "limiter_secret_fallback", { source: next.source, note: "Set LIMITER_KEY_SECRET." }, "warn");
  }
  return next.key;
}

/** Which key source is in use (for tests and the about page notes). */
export function limiterSecretSource(env: Env = process.env): Holder["source"] {
  limiterSecret(env);
  return (globalThis as unknown as Record<symbol, Holder | undefined>)[HOLDER]!.source;
}
