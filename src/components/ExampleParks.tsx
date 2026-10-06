import Link from "next/link";
import { formatTime } from "@/lib/pass/format";
import { AGE_BAND_INFO } from "@/lib/pass/schema";
import { EXAMPLE_BAND, type ExampleStatus } from "@/lib/prewarm";

/**
 * "See a real pass now": links to passes made earlier from live data (pre-warmed, SPEC S8). Each link
 * says when that pass was really generated; an example with no pass yet says why instead of linking.
 * Server component, no client JavaScript.
 */
export function ExampleParks({ statuses }: { statuses: readonly ExampleStatus[] }) {
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
          <li key={s.example.slug} data-testid={`example-${s.example.slug}`}>
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
              <div className="flex min-h-11 w-full flex-col items-start rounded-control border-2 border-dashed border-line px-4 py-2">
                <span className="font-display text-lg font-semibold">{s.example.name}</span>
                <span className="text-sm">No data available yet: {s.missing}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
