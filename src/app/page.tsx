import { after, connection } from "next/server";
import { FinalCta } from "@/components/home/FinalCta";
import { HomeAnchors } from "@/components/home/HomeAnchors";
import { FadeInOnScroll } from "@/components/home/FadeInOnScroll";
import { HomeHero } from "@/components/home/HomeHero";
import { HowItWorks } from "@/components/home/HowItWorks";
import { PassAnatomy } from "@/components/home/PassAnatomy";
import { SampleParks } from "@/components/home/SampleParks";
import { TwoParks } from "@/components/home/TwoParks";
import { RestingNotice } from "@/components/RestingNotice";
import { PassMaker } from "@/components/pass/PassMaker";
import { memoize } from "@/lib/cache/memo";
import { heroCard, readyExamples, spotQuote } from "@/lib/home/showcase";
import { restingState } from "@/lib/limits/budget";
import { exampleStatuses, prewarmEnabled, prewarmIdle, WARMUP_BUDGET_MS } from "@/lib/prewarm";
import { signInOptions } from "@/lib/accounts/config";
import { currentSession } from "@/lib/accounts/current";

/**
 * A background example refresh (one real pass, at most 85 s) may run after the page is sent; after() waits for it at
 * most WARMUP_BUDGET_MS (105 s). Must equal HOME_MAX_DURATION_SEC in src/lib/prewarm.ts (a literal: Next reads it statically).
 */
export const maxDuration = 120;

/**
 * Example status is read from the shared store at most once per this many ms per instance (SEC-1-02:
 * a home-page flood must not spend the store's command quota). SEC-2-01: 5 min, not 30 s: the check is
 * 4 GETs (plus pass reads memoized 30 min), so it costs <= ~42K commands a month per instance however
 * busy the page is (math in src/lib/limits/prelimit.ts). While an example pass is being made (about 30 s),
 * the check runs every 30 s instead, so a new example shows up quickly after a cold start.
 */
const EXAMPLES_MEMO_MS = 5 * 60_000;
const EXAMPLES_UNSETTLED_MEMO_MS = 30_000;

/**
 * v3 home (Kevin's v0 design, 2026-10-06). Every slot the design filled with sample text shows real data from
 * the saved example passes, or says why there is none (src/lib/home/showcase.ts).
 */
export default async function Home() {
  // Request-time: never baked at build.
  await connection();
  let statuses = await memoize("example-statuses", EXAMPLES_MEMO_MS, () => exampleStatuses());
  if (statuses.some((s) => s.refreshing)) {
    statuses = await memoize("example-statuses-unsettled", EXAMPLES_UNSETTLED_MEMO_MS, () => exampleStatuses());
  }
  const enabled = prewarmEnabled();
  // SEC-2-01: near the store's monthly budget the site is read-only until the month ends; say so.
  const resting = restingState();
  // Accounts: signed in or not (the session cookie only, no store command), and which sign-in buttons exist.
  const session = await currentSession();
  const account = { signedIn: session !== null, judge: session?.p === "judge", options: signInOptions() };
  // Keep any background refresh this visit started alive after the response (serverless: Vercel waitUntil), inside a
  // time budget below maxDuration.
  after(() => prewarmIdle({ budgetMs: WARMUP_BUDGET_MS }));
  return (
    <main id="main" tabIndex={-1} className="gp-home flex w-full flex-1 flex-col focus:outline-none">
      <HomeHero card={heroCard(statuses)} examples={readyExamples(statuses)}>
        <RestingNotice state={resting} />
        <PassMaker account={account} notice={<RestingNotice state={resting} />} />
      </HomeHero>
      {/* Kevin 2026-10-07: How it works comes before The problem. */}
      <HowItWorks />
      <TwoParks />
      <PassAnatomy spot={spotQuote(statuses)} />
      <SampleParks statuses={statuses} enabled={enabled} />
      <FinalCta />
      <HomeAnchors />
      <FadeInOnScroll />
    </main>
  );
}
