import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeroOffer } from "@/components/pass/PassMaker";
import type { SignInOptions } from "@/lib/accounts/config";

// Kevin 2026-10-09: the line under the hero search says what it costs and what signing in adds, from the real settings.
const opts = (o: Partial<SignInOptions> = {}): SignInOptions => ({ configured: true, providers: ["google", "github"], judge: true, perDay: 5, free: 1, ...o });
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("HeroOffer", () => {
  it("signed out: always free, the free pass, and a sign-in link for more + feedback", () => {
    const html = renderToStaticMarkup(<HeroOffer account={{ signedIn: false, options: opts() }} />);
    expect(text(html)).toBe("Always free · 1 pass a day, or Sign in for 5 a day + feedback");
    expect(html).toContain('href="/signin"');
  });

  it("uses the configured numbers", () => {
    const html = renderToStaticMarkup(<HeroOffer account={{ signedIn: false, options: opts({ free: 2, perDay: 8 }) }} />);
    expect(text(html)).toBe("Always free · 2 passes a day, or Sign in for 8 a day + feedback");
  });

  it("no free pass: only the sign-in offer", () => {
    expect(text(renderToStaticMarkup(<HeroOffer account={{ signedIn: false, options: opts({ free: 0 }) }} />))).toBe(
      "Always free · Sign in for 5 a day + feedback",
    );
  });

  it("sign-in not set up: no sign-in promise", () => {
    const html = renderToStaticMarkup(<HeroOffer account={{ signedIn: false, options: opts({ configured: false, providers: [], judge: false }) }} />);
    expect(text(html)).toBe("Always free · 1 pass a day");
    expect(html).not.toContain("/signin");
  });

  it("signed in: what the account gets; the judge demo says so", () => {
    expect(text(renderToStaticMarkup(<HeroOffer account={{ signedIn: true, options: opts() }} />))).toBe("Signed in · 5 new passes a day · rate each pass");
    expect(text(renderToStaticMarkup(<HeroOffer account={{ signedIn: true, judge: true, options: opts() }} />))).toBe("Signed in as a judge · rate each pass");
  });
});
