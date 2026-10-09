/**
 * The no-login free pass (Kevin, 2026-10-08): a signed-out visitor may start FREE_PASSES_PER_DAY (1) new pass per
 * Chicago day, counted by ONE cookie in their own browser.
 *
 * The cookie holds only the Chicago day and a count, never an id that could follow a person:
 *   `v1.<yyyymmdd>.<count>.<HMAC-SHA256 of "v1|yyyymmdd|count", base64url>`
 * - httpOnly, SameSite=Lax, Path=/, Secure (and the `__Host-` name) on https; it expires at the next Chicago midnight.
 * - Signed with a key derived from AUTH_SECRET (or, without sign-in, from the limiter key: ./secret.ts), so it can't
 *   be forged or edited. A missing, unsigned, edited, malformed or other-day cookie means 0 used today.
 * - It is set ONLY when a free pass is really charged (the same moment an account's pass is counted:
 *   src/lib/pass/make.ts). Browsing, searching, opening saved passes and printing still set no cookie.
 *
 * Because a cookie is easy to clear, it is only the friendly count. Every server-side backstop still applies: the
 * per-IP store-cost limits, ANON_PASSES_PER_IP_PER_DAY (signed-out new passes per connection per day), the per-IP
 * daily share of new passes, AI_DAILY_CAP, the Upstash pace and budget, the breakers and the SerpApi caps.
 *
 * A charge usually happens while the pass is streaming (the response headers are already sent), so the server puts
 * the new signed value in the stream's last line (`free.receipt`) and the page posts it straight back to
 * POST /api/free-pass, which checks the signature and sets the cookie. The receipt IS a valid cookie value: it can
 * only raise today's count, never lower it, and skipping it is no better than clearing cookies (the per-IP backstop).
 */
import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { authConfigured, freePassesPerDay } from "@/lib/accounts/config";
import { localDay, secondsUntilLocalMidnight } from "@/lib/time";
import { limiterSecret } from "./secret";

type Env = Record<string, string | undefined>;

/** `__Host-` on https (needs Secure, Path=/, no Domain), the plain name on http://localhost. */
export const FREE_PASS_COOKIES = ["__Host-gp-free", "gp-free"] as const;
const VERSION = "v1";
const VALUE_PATTERN = /^v1\.(\d{8})\.(\d{1,2})\.([A-Za-z0-9_-]{43})$/;
/** The highest count a cookie may carry (a day never needs more; keeps the value short). */
export const MAX_FREE_COUNT = 99;

function signingKey(env: Env): Buffer {
  // Domain-separated from the session cookie and the account keys that use the same secret.
  if (authConfigured(env)) return createHash("sha256").update(`grass-pass free-pass cookie v1\n${env.AUTH_SECRET!.trim()}`).digest();
  return createHash("sha256").update("grass-pass free-pass cookie v1 (limiter key)\n").update(limiterSecret(env)).digest();
}

const dayNum = (ms: number) => localDay(ms).replace(/-/g, "");

function mac(day: string, count: number, env: Env): string {
  return createHmac("sha256", signingKey(env)).update(`${VERSION}|${day}|${count}`).digest("base64url");
}

/** The signed value for `count` passes used on the Chicago day of `nowMs`. */
export function signFreePass(count: number, nowMs: number, env: Env = process.env): string {
  const n = Math.min(MAX_FREE_COUNT, Math.max(0, Math.trunc(count)));
  const day = dayNum(nowMs);
  return `${VERSION}.${day}.${n}.${mac(day, n, env)}`;
}

/** The count in a signed value for TODAY, or null (missing, malformed, wrong signature, another day). */
export function verifyFreePass(value: string | null | undefined, nowMs: number, env: Env = process.env): number | null {
  if (!value || value.length > 80) return null;
  const m = VALUE_PATTERN.exec(value);
  if (!m) return null;
  const [, day, countText, sig] = m;
  const count = Number(countText);
  if (day !== dayNum(nowMs) || !Number.isInteger(count)) return null;
  const want = Buffer.from(mac(day, count, env));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return count;
}

function cookieValues(header: string, names: readonly string[]): string[] {
  const out: string[] = [];
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (names.includes(part.slice(0, i).trim())) out.push(part.slice(i + 1).trim());
  }
  return out;
}

/** Free passes this browser used today, from a Cookie header (0 when there is no valid cookie for today). */
export function freePassesUsed(cookieHeader: string | null | undefined, nowMs: number, env: Env = process.env): number {
  if (!cookieHeader) return 0;
  let used = 0;
  for (const v of cookieValues(cookieHeader, FREE_PASS_COOKIES)) used = Math.max(used, verifyFreePass(v, nowMs, env) ?? 0);
  return used;
}

/** Free passes left today for this browser. */
export function freePassesLeft(used: number, env: Env = process.env): number {
  return Math.max(0, freePassesPerDay(env) - used);
}

/** Is this request on https (the cookie is then Secure, with the `__Host-` name)? */
export function isHttps(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (proto) return proto === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

/** A Set-Cookie header for a signed value; it expires at the next Chicago midnight. */
export function freePassSetCookie(value: string, nowMs: number, secure: boolean): string {
  const maxAge = secondsUntilLocalMidnight(nowMs);
  const expires = new Date(nowMs + maxAge * 1000).toUTCString();
  const name = secure ? FREE_PASS_COOKIES[0] : FREE_PASS_COOKIES[1];
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; Expires=${expires}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
