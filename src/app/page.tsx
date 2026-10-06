import { after, connection } from "next/server";
import { ExampleChips, ExampleParks } from "@/components/ExampleParks";
import { Hero } from "@/components/Hero";
import { PassMaker } from "@/components/pass/PassMaker";
import { memoize } from "@/lib/cache/memo";
import { exampleStatuses, prewarmEnabled, prewarmIdle } from "@/lib/prewarm";

/** A background example refresh (one real pass) may run after the page is sent. */
export const maxDuration = 90;

/**
 * Example status is read from the shared store at most once per this many ms per instance (SEC-1-02:
 * a home-page flood must not spend the store's command quota). A new example pass shows up within 30 s.
 */
const EXAMPLES_MEMO_MS = 30_000;

export default async function Home() {
  // Request-time: never baked at build.
  await connection();
  const statuses = await memoize("example-statuses", EXAMPLES_MEMO_MS, () => exampleStatuses());
  const enabled = prewarmEnabled();
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
        <PassMaker />
      </Hero>
      <ExampleParks statuses={statuses} enabled={enabled} />
    </main>
  );
}
