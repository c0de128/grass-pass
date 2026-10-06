/**
 * Accounts: /about and /how-it-works say the real rules (sign-in only for new passes, 2 a day, the judge
 * demo's shared cap, the report rule and the privacy promise), taken from the same constants the code uses.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AboutPage from "@/app/about/page";
import HowItWorksPage from "@/app/how-it-works/page";
import { ACCOUNT_COPY, judgeDailyCap } from "@/lib/accounts/config";
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
