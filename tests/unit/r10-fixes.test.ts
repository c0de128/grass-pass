/**
 * Round 10 fixes (audits/round-10): Q-10-01 (tips never state the target count), Q-10-04 (no tips call when no pass
 * is made), RULES-10-02 / Q-10-03 (every model-call count names the trip-tips call).
 *
 * The tips answers here are the real recorded Gemma answers (tests/fixtures/trip-tips-*-live.json). The aborted
 * signal and the counting reserve are built in the test (no recording can hold them).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_MODEL_CALLS } from "@/lib/ai/build-pass";
import { PASS_FACT_TEXT, withFinalFindCount, type TipFact, type TipFacts } from "@/lib/tips/facts";
import { fromModel, type TipsDeps } from "@/lib/tips/generate";
import type { TripTips } from "@/lib/tips/schema";

const ROOT = process.cwd();
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const rec = JSON.parse(read("tests/fixtures/trip-tips-celebration-park-6to10-live.json")) as {
  facts: TipFacts;
  tripTips: TripTips;
};

describe("Q-10-01: the tips never disagree with the pass's final number of finds", () => {
  it("the pass fact has no count (the tips are written before the final count is known)", () => {
    expect(PASS_FACT_TEXT).not.toMatch(/\d/);
  });

  it("a recorded tip that says '8 finds' says '5 finds' on a pass that kept 5", () => {
    expect(rec.tripTips.items.some((t) => /\b8 finds\b/.test(t.tip))).toBe(true);
    const out = withFinalFindCount(rec.tripTips, 5);
    const text = out.items.map((t) => `${t.tip} ${t.why}`).join(" | ");
    expect(text).not.toMatch(/\b8 finds\b/);
    expect(out.items.find((t) => t.icon === "pencil")?.tip).toBe("Bring a pencil to check off 5 finds");
    // Other numbers (the 88°F heat, the 1 picnic shelter) are untouched.
    expect(text).toContain("88°F");
    expect(text).toContain("1 picnic shelter");
  });

  it("one find is singular; tips without a count are unchanged", () => {
    const t = { items: [{ tip: "Check off the 6 finds", why: "x" }, { tip: "Bring a pencil to check off each find", why: "y" }] };
    expect(withFinalFindCount(t, 1).items.map((i) => i.tip)).toEqual(["Check off the 1 find", "Bring a pencil to check off each find"]);
  });

  it("the pass build applies the final count to the tips it stores", () => {
    const src = read("src/lib/ai/build-pass.ts");
    expect(src).toMatch(/withFinalFindCount\(settledTips, items\.length\)/);
    expect(src).not.toMatch(/tripTips: [^,]*settledTips[^,]*,/);
  });
});

describe("Q-10-04: no tips call when every clue call failed", () => {
  const facts: TipFacts = { ...rec.facts, facts: rec.facts.facts.map((f: TipFact) => (f.id === "x-pass" ? { ...f, text: PASS_FACT_TEXT } : f)) };

  it("an aborted signal skips the call: no AI_DAILY_CAP slot is reserved and nothing is sent", async () => {
    const ac = new AbortController();
    ac.abort();
    let reserved = 0;
    let sent = 0;
    const deps: TipsDeps = {
      env: { DO_INFERENCE_API_KEY: "test-key-not-real" },
      now: () => Date.now(),
      modelFetch: async () => {
        sent++;
        throw new Error("must not be called");
      },
      reserveAiCall: async () => {
        reserved++;
        return null;
      },
      signal: ac.signal,
    };
    const out = await fromModel(facts, deps, Date.now());
    expect(out.source).toBe("rules");
    expect(reserved).toBe(0);
    expect(sent).toBe(0);
  });

  it("the pass build aborts the tips on the no-pass return", () => {
    const src = read("src/lib/ai/build-pass.ts");
    expect(src).toMatch(/if \(!best \|\| best\.items\.length === 0\) \{\n\s+tipsAbort\.abort\(\);/);
    expect(src).toMatch(/signal: tipsAbort\.signal/);
  });
});

describe("RULES-10-02 / Q-10-03: model-call counts include the trip-tips call", () => {
  it("MAX_MODEL_CALLS is still 3 clue calls (the copy below says 1-3 + 1)", () => {
    expect(MAX_MODEL_CALLS).toBe(3);
  });

  const files = ["README.md", ".env.example", "src/lib/limits/config.ts", "src/lib/about/content.ts", "src/app/about/page.tsx", "src/app/how-it-works/page.tsx"];
  it.each(files)("%s has no stale clue-only call count", (f) => {
    const s = read(f).replace(/\s+/g, " ");
    expect(s).not.toMatch(/a pass makes 1-3\)/i);
    expect(s).not.toMatch(/makes 1-3 calls and each one counts/);
    expect(s).not.toMatch(/each pass makes 1-3 calls/);
    expect(s).not.toMatch(/A pass makes 1 to 3 model calls\.`/);
    expect(s).not.toMatch(/One to three calls per pass\./);
    expect(s).not.toMatch(/at most 3 (?:model )?calls per pass[):]/);
    expect(s).not.toMatch(/\*\*How a pass is made:\*\* 1 to 3 model calls\./);
  });

  it("the README states the 2-4 calls and the passes-per-day maths, and labels the cost as clue calls only", () => {
    const s = read("README.md").replace(/\s+/g, " ");
    expect(s).toContain("a pass makes 2-4: 1-3 for the clues plus 1 for the trip tips, so about 100-200 passes a day");
    expect(s).toContain("1 to 3 model calls for the clues, plus 1 for the trip tips (2 to 4 in all");
    // Eval run 2026-10-10-3: the eval still measures the clue calls only (no trip-tips call in the eval).
    expect(s).toContain("This counts the clue calls only; the trip tips add one more short call per pass.");
  });
});

describe("SEC-10-05: an unfinished OAuth sign-in is not called a server misconfiguration", () => {
  it("'Configuration' on a server with OAuth set up says the sign-in took too long; without OAuth it keeps the setup line", async () => {
    const { errorText, oauthReady, TOO_SLOW_ERROR, ERRORS } = await import("@/lib/accounts/signin-errors");
    expect(errorText("Configuration", undefined, 600, true)).toBe(TOO_SLOW_ERROR);
    expect(TOO_SLOW_ERROR).toBe("That sign-in took too long or didn't finish. Please try again.");
    expect(errorText("Configuration", undefined, 600, false)).toBe(ERRORS.Configuration);
    expect(oauthReady({ AUTH_SECRET: "x".repeat(32), AUTH_GITHUB_ID: "id", AUTH_GITHUB_SECRET: "s" })).toBe(true);
    expect(oauthReady({ AUTH_SECRET: "x".repeat(32) })).toBe(false);
    expect(oauthReady({ AUTH_GITHUB_ID: "id", AUTH_GITHUB_SECRET: "s" })).toBe(false);
  });
});

describe("NITs: credits and wording", () => {
  it("footer and credits say Gemma writes the clues AND the trip tips, and the footer credits Open-Meteo and NWS", () => {
    const footer = read("src/components/SiteFooter.tsx").replace(/\s+/g, " ");
    expect(footer).toContain("Clues and trip tips: Gemma 4 by default (open model, Apache-2.0)");
    expect(footer).toMatch(/Open-Meteo <\/a>\{" "\} \(CC BY 4\.0\)/);
    expect(footer).toMatch(/NWS <\/a>\{" "\} alerts \(public domain\)/);
    expect(read("README.md")).toContain("- Clues and trip tips: [Gemma 4]");
    expect(read("src/app/about/page.tsx")).toContain("Clues and trip tips:");
  });
});
