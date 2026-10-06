/**
 * Accounts: /about and /how-it-works say the real rules (sign-in only for new passes, 2 a day, the judge
 * demo's shared cap, the report rule and the privacy promise), taken from the same constants the code uses.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AboutPage from "@/app/about/page";
import HowItWorksPage from "@/app/how-it-works/page";
import { ACCOUNT_COPY, judgeDailyCap, judgeLimitMessage, oauthProviderNames, signInWith } from "@/lib/accounts/config";
import { REPORT_COPY } from "@/lib/reports/kinds";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

describe("accounts copy on /about and /how-it-works", () => {
  for (const [name, el] of [
    ["/about", <AboutPage key="a" />],
    ["/how-it-works", <HowItWorksPage key="h" />],
  ] as const) {
    it(`${name}: the report rule, the privacy promise, 2 a day and the judge cap`, () => {
      const t = text(renderToStaticMarkup(el));
      expect(t).toContain(REPORT_COPY.rule);
      expect(t).toContain(ACCOUNT_COPY.privacy);
      expect(t).toMatch(/2 new passes a day/);
      expect(t).toContain(`${judgeDailyCap()} new passes a day`);
      expect(t).toContain("Try as a judge");
      // The old promise is no longer true for signed-in grown-ups.
      expect(t).not.toContain("No accounts, no names, no photos, no cookies");
    });
  }
});

describe("RULES-4-02/03/04: the pages name only the sign-in providers set up on this server", () => {
  const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
    const keys = ["AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"] as const;
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    try {
      fn();
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  };
  const githubOnly = { AUTH_GITHUB_ID: "id", AUTH_GITHUB_SECRET: "secret" };
  const both = { ...githubOnly, AUTH_GOOGLE_ID: "id", AUTH_GOOGLE_SECRET: "secret" };

  it("names and the 'with ...' phrase follow enabledOAuthProviders()", () => {
    withEnv({}, () => {
      expect(oauthProviderNames()).toBeNull();
      expect(signInWith()).toBe("");
      expect(judgeLimitMessage("global")).not.toMatch(/GitHub|Google/);
    });
    withEnv(githubOnly, () => {
      expect(oauthProviderNames()).toBe("GitHub");
      expect(signInWith()).toBe(" with GitHub");
      expect(judgeLimitMessage("global")).toContain("or sign in with GitHub.");
      expect(judgeLimitMessage("global")).not.toContain("Google");
    });
    withEnv(both, () => {
      expect(oauthProviderNames()).toBe("GitHub or Google");
      expect(judgeLimitMessage("global")).toContain("or sign in with GitHub or Google.");
    });
  });

  for (const [name, el] of [
    ["/about", () => <AboutPage key="a" />],
    ["/how-it-works", () => <HowItWorksPage key="h" />],
  ] as const) {
    it(`${name}: GitHub only -> never says Google; neither -> names neither`, () => {
      withEnv(githubOnly, () => {
        const t = text(renderToStaticMarkup(el()));
        expect(t).toContain("with GitHub");
        expect(t).not.toMatch(/GitHub or Google|Google tell/);
      });
      withEnv({}, () => {
        const t = text(renderToStaticMarkup(el()));
        expect(t).not.toMatch(/with GitHub|GitHub or Google|GitHub tells/);
        expect(t).toContain("Try as a judge");
      });
    });
  }

  it("/about: Llama is an alternative you switch to, not a fallback; the judge sign-in wording is exact", () => {
    const t = text(renderToStaticMarkup(<AboutPage />));
    expect(t).not.toMatch(/slow fallback/i);
    expect(t).toContain("a slower alternative you can switch to");
    expect(t).toContain("the judge demo sign-in stops working after 1 day");
    expect(t).not.toContain("the judge demo: 1 day");
  });
});
