import { describe, expect, it } from "vitest";
import { formatLogLine, log, logOnce, setLogSink } from "@/lib/log";
import { buildCsp, securityHeaders } from "@/lib/security-headers";
import { localDay, localMonth, secondsUntilLocalMidnight, secondsUntilNextLocalMonth } from "@/lib/time";
import { capReached, jsonError, storeUnavailable, tooManyRequests, waitText } from "@/lib/http/respond";

describe("time (America/Chicago)", () => {
  it("gives the Chicago day, which differs from the UTC day in the evening", () => {
    const t = Date.UTC(2026, 9, 6, 2, 0); // Oct 6 02:00 UTC = Oct 5 9:00 PM CDT
    expect(localDay(t)).toBe("2026-10-05");
    expect(localMonth(t)).toBe("2026-10");
  });

  it("counts seconds to the next Chicago midnight (CDT and CST)", () => {
    expect(secondsUntilLocalMidnight(Date.UTC(2026, 9, 5, 22, 0))).toBe(7 * 3600); // 5 PM CDT
    expect(secondsUntilLocalMidnight(Date.UTC(2026, 11, 1, 23, 0))).toBe(7 * 3600); // 5 PM CST (UTC-6)
  });

  it("handles the DST end day (Nov 1 2026 is 25 hours long)", () => {
    const justAfterMidnight = Date.UTC(2026, 10, 1, 5, 0); // 00:00 CDT Nov 1
    expect(secondsUntilLocalMidnight(justAfterMidnight)).toBe(25 * 3600);
  });

  it("counts seconds to the next month in Chicago", () => {
    expect(secondsUntilNextLocalMonth(Date.UTC(2026, 9, 31, 5, 0))).toBe(24 * 3600); // Oct 31 00:00 CDT -> Nov 1 00:00 CDT
  });
});

describe("log", () => {
  it("writes one JSON line with the event and fields", () => {
    const line = JSON.parse(formatLogLine("model_call", { latencyMs: 12, promptTokens: 3 }, 0));
    expect(line).toEqual({ ts: "1970-01-01T00:00:00.000Z", event: "model_call", latencyMs: 12, promptTokens: 3 });
  });

  it("redacts credential-like field names and cuts long strings", () => {
    const line = JSON.parse(
      formatLogLine("x", { apiKey: "k1", token: "t1", nested: { authorization: "Bearer z", accessToken: "a" }, note: "y".repeat(500) }),
    );
    expect(line.apiKey).toBe("[redacted]");
    expect(line.token).toBe("[redacted]");
    expect(line.nested).toEqual({ authorization: "[redacted]", accessToken: "[redacted]" });
    expect(line.note.length).toBeLessThanOrEqual(201);
  });

  it("logOnce logs a given id only once; a throwing sink never breaks the caller", () => {
    const lines: string[] = [];
    const restore = setLogSink((_, l) => lines.push(l));
    logOnce("test-once-id", "warned");
    logOnce("test-once-id", "warned");
    restore();
    expect(lines).toHaveLength(1);
    const restore2 = setLogSink(() => {
      throw new Error("sink down");
    });
    expect(() => log("x")).not.toThrow();
    restore2();
  });
});

describe("security headers", () => {
  it("production CSP: self only, no eval, no framing, no upgrade on localhost", () => {
    const csp = buildCsp({ isDev: false, upgradeInsecure: false });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("adds upgrade-insecure-requests only on HTTPS deploys, unsafe-eval only in dev", () => {
    expect(buildCsp({ isDev: false, upgradeInsecure: true })).toContain("upgrade-insecure-requests");
    expect(buildCsp({ isDev: true, upgradeInsecure: false })).toContain("'unsafe-eval'");
  });

  it("sends the starter-kit header set, with geolocation only for our own origin", () => {
    const h = Object.fromEntries(securityHeaders({ isDev: false, upgradeInsecure: false }).map((x) => [x.key, x.value]));
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toContain("geolocation=(self)");
  });
});

describe("error responses", () => {
  it("jsonError sets no-store and Retry-After", async () => {
    const r = jsonError(429, { code: "RATE_LIMITED", message: "m", retryAfter: 12.2 });
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("13");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ error: { code: "RATE_LIMITED", message: "m", retryAfter: 12.2 } });
  });

  it("friendly copy names the problem and the next step", async () => {
    expect(waitText(40)).toBe("about 40 seconds");
    expect(waitText(600)).toBe("about 10 minutes");
    expect(waitText(7 * 3600)).toBe("about 7 hours");
    expect((await tooManyRequests(30, "passes").json()).error.message).toMatch(/Too many passes .* about 30 seconds/);
    const cap = await capReached(7 * 3600, "new passes today", "Example parks still work.").json();
    expect(cap.error.message).toMatch(/for everyone.*about 7 hours\. Example parks still work\./);
    expect(storeUnavailable().status).toBe(503);
  });
});
