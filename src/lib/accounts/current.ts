/**
 * The signed-in session for a server component (pages), read from the request's cookies only: no Auth.js
 * session action, no store command, and never a Set-Cookie (SEC-4-04). Same checks as the API routes
 * (./session.ts: our token, our secret, not past its absolute lifetime).
 */
import "server-only";
import { cookies } from "next/headers";
import { readSessionCookieHeader, SESSION_COOKIES, type SessionToken } from "./session";
import { FREE_PASS_COOKIES, freePassesLeft, freePassesUsed } from "@/lib/limits/free-pass";

export async function currentSession(): Promise<SessionToken | null> {
  const jar = await cookies();
  const parts: string[] = [];
  for (const name of SESSION_COOKIES) {
    const c = jar.get(name);
    if (c) parts.push(`${name}=${encodeURIComponent(c.value)}`);
  }
  return parts.length > 0 ? readSessionCookieHeader(parts.join("; ")) : null;
}

/**
 * Kevin 2026-10-08: the free new passes this browser has left today, from its signed free-pass cookie (read only, never
 * set here; no store command). A missing or invalid cookie means none used.
 */
export async function currentFreePassesLeft(nowMs: number = Date.now()): Promise<number> {
  const jar = await cookies();
  const parts: string[] = [];
  for (const name of FREE_PASS_COOKIES) {
    const c = jar.get(name);
    if (c) parts.push(`${name}=${c.value}`);
  }
  return freePassesLeft(freePassesUsed(parts.join("; "), nowMs));
}
