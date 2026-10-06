import Link from "next/link";
import { buttonClassName } from "@/components/ui/Button";
import { formatTime } from "@/lib/pass/format";
import { AGE_BAND_INFO } from "@/lib/pass/schema";
import { EXAMPLE_BAND, type ExampleStatus } from "@/lib/prewarm";

/**
 * The state of one example card, as a data attribute for tests and tooling (never shown):
 * ready (links a real pass), off (PREWARM_EXAMPLES=0), making (a pass is being made now),
 * waiting (no pass yet and nothing running; the card says why).
 */
export type ExampleState = "ready" | "off" | "making" | "waiting";

export function exampleState(s: ExampleStatus, enabled: boolean): ExampleState {
  if (s.pass) return "ready";
  if (!enabled) return "off";
  return s.refreshing ? "making" : "waiting";
}

/**
 * "See a real pass now": links to passes made earlier from live data (pre-warmed, SPEC S8). Each link
 * says when that pass was really generated. An example with no pass yet is NOT a dashed failure card
 * (R1-B1 / ux M1, Q-1-10): one line with its name and ONE sentence saying why (from prewarm.ts, a single
 * "No data available yet:"). Below the list, one "Try again" button (a plain GET form, so no client
 * JavaScript) reloads the page. It is a button, not a link: every link in the list is a ready pass.
 * Server component, no client JavaScript.
 */
export function ExampleParks({ statuses, enabled = true }: { statuses: readonly ExampleStatus[]; enabled?: boolean }) {
  return (
    <section aria-labelledby="examples-title" className="flex flex-col gap-3">
      <h2 id="examples-title" className="text-2xl">
        See a real pass now
      </h2>
      <p className="text-base">
        Example parks near Dallas, already made from today&apos;s live park data ({AGE_BAND_INFO[EXAMPLE_BAND].label}).
      </p>
      <ul className="grid gap-2 sm:grid-cols-2" aria-label="Example parks">
        {statuses.map((s) => (
          <li key={s.example.slug} data-testid={`example-${s.example.slug}`} data-state={exampleState(s, enabled)}>
            {s.pass ? (
              <Link
                href={`/pass/${s.pass.passId}?example=1`}
                className="flex min-h-11 w-full flex-col items-start rounded-control border-2 border-line bg-surface px-4 py-2 text-left text-fg hover:bg-secondary-hover focus-visible:outline-offset-2"
              >
                <span className="font-display text-lg font-semibold">{s.example.name}</span>
                <span className="text-base">
                  {s.example.place} · {s.example.blurb}
                </span>
                <span className="text-sm">
                  Made {formatTime(s.pass.generatedAt)}
                  {s.fresh ? "" : s.refreshing ? " (an older pass; today's is being made)" : " (an older pass)"}
                </span>
              </Link>
            ) : (
              <p className="px-1 py-2 text-sm">
                <span className="font-semibold">{s.example.name}:</span> {s.missing}
              </p>
            )}
          </li>
        ))}
      </ul>
      {statuses.some((s) => exampleState(s, enabled) === "waiting" || exampleState(s, enabled) === "making") ? (
        <form action="/" method="get">
          <button type="submit" className={buttonClassName("secondary")}>
            Try again
          </button>
        </form>
      ) : null}
    </section>
  );
}

/**
 * Phones only (R1 UX m8): the ready example passes as a compact row of links above the form, so a
 * first-time visitor at 360 px sees a real pass is one tap away. Hidden from 640 px up, where the
 * example cards are already above the fold. Nothing is shown when no example is ready.
 */
export function ExampleChips({ statuses }: { statuses: readonly ExampleStatus[] }) {
  const ready = statuses.filter((s) => s.pass);
  if (ready.length === 0) return null;
  return (
    <nav aria-label="Open an example pass" className="sm:hidden">
      <ul className="flex flex-wrap gap-2">
        {ready.map((s) => (
          <li key={s.example.slug}>
            <Link
              href={`/pass/${s.pass!.passId}?example=1`}
              className="inline-flex min-h-11 items-center rounded-control border-2 border-line bg-surface px-3 text-base font-semibold text-fg hover:bg-secondary-hover"
            >
              {s.example.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
