/**
 * Round 5 (RULES-5-04, UX-5-02, UX-5-05): the over-the-limit page and sign-in redirect, the /signin wait line,
 * and the ?signedin=1 way back from /signin.
 */
import { describe, expect, it } from "vitest";
import { busyActionResponse, busyPageHtml, busyPageResponse, signInBusyPath } from "@/lib/http/busy-page";
import { errorText, ERRORS } from "@/lib/accounts/signin-errors";
import { allowedReturnPath, withSignedInFlag } from "@/lib/accounts/redirect";
import { signedInAnnouncement, withoutSignedInFlag } from "@/components/account/AccountMenu";

const BASE = "http://localhost:3123";

describe("busy page (UX-5-02)", () => {
  it("is a styled 429 with the wait, a retry link to the same page, a home link and no script", async () => {
    const r = busyPageResponse(32, "/pass/w1-6to10-20261005-1");
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("32");
    expect(r.headers.get("content-type")).toMatch(/^text\/html/);
    const html = await r.text();
    expect(html).toMatch(/<html lang="en">/);
    expect(html).toContain("Please wait about 32 seconds, then try again.");
    expect(html).toContain('<a class="button" href="/pass/w1-6to10-20261005-1">Try again</a>');
    expect(html).toContain('<a href="/">Go to the home page</a>');
    expect(html).not.toMatch(/<script/i);
  });

  it("never echoes an odd path into the page", () => {
    expect(busyPageHtml(5, '/"><img src=x>')).toContain('<a class="button" href="/">Try again</a>');
    expect(busyPageHtml(5, "//evil.example")).toContain('<a class="button" href="/">Try again</a>');
  });
});

describe("refused sign-in button (RULES-5-04)", () => {
  it("redirects to /signin with the wait (seconds) and the way back", () => {
    expect(signInBusyPath(47, "/")).toBe("/signin?error=rate_limited&wait=47");
    expect(signInBusyPath(0.2, "/signin")).toBe("/signin?error=rate_limited&wait=1");
    expect(signInBusyPath(10, "/pass/w1-6to10-20261005-1")).toBe("/signin?error=rate_limited&wait=10&from=%2Fpass%2Fw1-6to10-20261005-1");
    const r = busyActionResponse(47, "/");
    expect(r.status).toBe(429);
    expect(r.headers.get("x-action-redirect")).toBe("/signin?error=rate_limited&wait=47;push");
  });

  it("/signin says how long to wait when it knows, and the old line when it doesn't", () => {
    expect(errorText("rate_limited", "47")).toBe(
      "Whoa, that's a lot of sign-ins from your connection (shared Wi-Fi or a phone network can do that). Please wait about 47 seconds, then press the button again.",
    );
    expect(errorText("rate_limited", "300")).toMatch(/Please wait about 5 minutes/);
    expect(errorText("rate_limited", undefined)).toBe(ERRORS.rate_limited);
    expect(errorText("rate_limited", "abc")).toBe(ERRORS.rate_limited);
    expect(errorText("nope", undefined)).toMatch(/didn't work this time/);
  });
});

describe("back from /signin (UX-5-05)", () => {
  it("adds ?signedin=1 to the way back, and the allowlist accepts it (and nothing else new)", () => {
    expect(withSignedInFlag("/")).toBe("/?signedin=1");
    expect(withSignedInFlag("/?resume=1")).toBe("/?resume=1");
    expect(withSignedInFlag("/pass/w1-6to10-20261005-1")).toBe("/pass/w1-6to10-20261005-1?signedin=1");
    expect(allowedReturnPath("/?signedin=1", BASE)).toBe("/?signedin=1");
    expect(allowedReturnPath("/pass/w1-6to10-20261005-1?signedin=1", BASE)).toBe("/pass/w1-6to10-20261005-1?signedin=1");
    expect(allowedReturnPath("/?signedin=2", BASE)).toBeNull();
    expect(allowedReturnPath("/signin?signedin=1", BASE)).toBeNull();
    expect(allowedReturnPath("https://evil.example/?signedin=1", BASE)).toBeNull();
  });

  it("the header announces who signed in and cleans the address", () => {
    expect(signedInAnnouncement("judge")).toBe("Signed in as a judge. You can make a pass now.");
    expect(signedInAnnouncement("github")).toBe("Signed in. You can make a pass now.");
    expect(withoutSignedInFlag(`${BASE}/?signedin=1`)).toBe("/");
    expect(withoutSignedInFlag(`${BASE}/pass/x?signedin=1#find`)).toBe("/pass/x#find");
  });
});
