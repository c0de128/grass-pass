/**
 * Client keys for per-IP limits (SEC-1-03, SEC-1-05).
 * On Vercel the first `x-forwarded-for` entry is set by the platform. When self-hosted
 * without a proxy it can be spoofed; the global caps still bound the total spend.
 *
 * - IPv4 is keyed by the address, IPv6 by its /64 (one home or one VPS usually controls a whole /64).
 * - IPv6 keys also carry the /48 network, so the daily shares can add a coarser bucket
 *   (one VPS with a routed /48 has 65,536 /64s; see `networkKey`).
 * - The address never reaches the shared store or the logs as is: `clientIp` returns an HMAC of it
 *   (see ./secret.ts for the key and its fallback).
 */
import { createHmac } from "node:crypto";
import { limiterSecret } from "./secret";

export function clientIp(req: Request, env: Record<string, string | undefined> = process.env): string {
  const raw = rawClientIp(req);
  return raw === null ? "unknown" : hashedKey(raw, env);
}

/** The first forwarded address (or x-real-ip), unhashed. Only for in-process use; never store or log it. */
export function rawClientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  const first = fwd?.split(",")[0]?.trim();
  if (first) return first.slice(0, 64);
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  return null;
}

/** Expand an IPv6 address to 8 hextets, or return null when it isn't one. */
function ipv6Hextets(ip: string): number[] | null {
  let addr = ip.replace(/^\[|\]$/g, "").split("%")[0];
  // Trailing embedded IPv4 (e.g. ::ffff:1.2.3.4) becomes two hextets.
  const v4 = addr.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const b = v4.slice(1).map(Number);
    if (b.some((n) => n > 255)) return null;
    addr = `${addr.slice(0, v4.index)}${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(":") : []);
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  if (!all.every((h) => /^[0-9a-f]{1,4}$/i.test(h))) return null;
  return all.map((h) => parseInt(h, 16));
}

const prefix = (h: number[], n: number, bits: number) =>
  `${h
    .slice(0, n)
    .map((x) => x.toString(16))
    .join(":")}::/${bits}`;

/** Network prefixes for an address: IPv4 (and IPv4-mapped IPv6) as is; IPv6 as /64 plus its /48. */
export function ipNetworks(ip: string): { key: string; net48?: string } {
  if (!ip.includes(":")) return { key: ip };
  const h = ipv6Hextets(ip);
  if (!h) return { key: ip };
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    return { key: [h[6] >> 8, h[6] & 255, h[7] >> 8, h[7] & 255].join(".") };
  }
  return { key: prefix(h, 4, 64), net48: prefix(h, 3, 48) };
}

/** Rate-limit prefix for an address (unhashed): IPv4 as is, IPv4-mapped IPv6 as IPv4, other IPv6 by /64. */
export function limiterKey(ip: string): string {
  return ipNetworks(ip).key;
}

function hmac(value: string, env: Record<string, string | undefined>): string {
  return createHmac("sha256", limiterSecret(env)).update(value).digest("base64url").slice(0, 22);
}

/**
 * The stored key for an address: `4:<hmac>` for IPv4 (and anything that isn't IPv6),
 * `6:<hmac of the /64>:<hmac of the /48>` for IPv6. 22 base64url chars = 132 bits.
 */
export function hashedKey(ip: string, env: Record<string, string | undefined> = process.env): string {
  const n = ipNetworks(ip);
  if (!n.net48) return `4:${hmac(n.key, env)}`;
  return `6:${hmac(n.key, env)}:${hmac(n.net48, env)}`;
}

/** The coarser /48 bucket of an IPv6 key from `hashedKey` (null for IPv4 and other keys). */
export function networkKey(key: string): string | null {
  const m = /^6:[\w-]+:([\w-]+)$/.exec(key);
  return m ? `n48:${m[1]}` : null;
}
