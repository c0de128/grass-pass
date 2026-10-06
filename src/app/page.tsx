import { after, connection } from "next/server";
import { ExampleChips, ExampleParks } from "@/components/ExampleParks";
import { Hero } from "@/components/Hero";
import { RestingNotice } from "@/components/RestingNotice";
import { PassMaker } from "@/components/pass/PassMaker";
import { memoize } from "@/lib/cache/memo";
import { restingState } from "@/lib/limits/budget";
import { exampleStatuses, prewarmEnabled, prewarmIdle } from "@/lib/prewarm";

/** A background example refresh (one real pass) may run after the page is sent. */
export const maxDuration = 90;

/**
 * Example status is read from the shared store at most once per this many ms per instance (SEC-1-02:
 * a home-page flood must not spend the store's command quota). SEC-2-01: 5 min, not 30 s: the check is
 * 4 GETs (plus pass reads memoized 30 min), so it costs <= ~42K commands a month per instance however
 * busy the page is (math in src/lib/limits/prelimit.ts). While an example pass is being made (about 30 s),
 * the check runs every 30 s instead, so a new example shows up quickly after a cold start.
 */
const EXAMPLES_MEMO_MS = 5 * 60_000;
const EXAMPLES_UNSETTLED_MEMO_MS = 30_000;

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
  // Keep any background refresh this visit started alive after the response (serverless).
  after(() => prewarmIdle());
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-5 py-8 focus:outline-none">
      <Hero title="Your ticket to get outside." lead="Pick a park. Print a pass. Phone away.">
        <div className="flex flex-col gap-2">
          <p className="text-base">
            Just looking?{" "}
            <a href="#examples-title" className="font-semibold underline">
              See a real example pass
            </a>
            .
          </p>
          {/* Phones: the example cards sit below the fold, so the ready ones are one tap away here. */}
          <ExampleChips statuses={statuses} />
        </div>
        <RestingNotice state={resting} />
        <PassMaker />
      </Hero>
      <ExampleParks statuses={statuses} enabled={enabled} />
    </main>
  );
}
