/**
 * Client keys for per-IP limits.
 * On Vercel the first `x-forwarded-for` entry is set by the platform. When self-hosted
 * without a proxy it can be spoofed; the global caps still bound the total spend.
 * IPv6 clients usually control a whole /64, so they are keyed by that prefix.
 */

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  const first = fwd?.split(",")[0]?.trim();
  if (first) return limiterKey(first.slice(0, 64));
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return limiterKey(real.slice(0, 64));
  return "unknown";
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

/** Rate-limit key for an address: IPv4 as is, IPv4-mapped IPv6 as IPv4, other IPv6 by /64. */
export function limiterKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const h = ipv6Hextets(ip);
  if (!h) return ip;
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    return [h[6] >> 8, h[6] & 255, h[7] >> 8, h[7] & 255].join(".");
  }
  return `${h
    .slice(0, 4)
    .map((x) => x.toString(16))
    .join(":")}::/64`;
}
