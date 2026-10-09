import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  cardFacts,
  exampleState,
  liveStatement,
  madeLine,
  noExamplesText,
  placeLabel,
  readyExample,
} from "@/lib/home/showcase";
import { PhotoCredits } from "@/components/home/PhotoCredits";
import { TWO_PARKS } from "@/components/home/TwoParks";
import { PARK_PHOTOS, photoCredit } from "@/data/photo-credits";
import { AGE_BAND_INFO } from "@/lib/pass/schema";
import { EXAMPLE_BAND, type ExampleStatus } from "@/lib/prewarm";

/**
 * "See a real pass, right now" (Kevin's v0 photo cards), wired to the real pre-warmed example passes
 * (src/lib/prewarm.ts). A ready card links its saved pass ("See the pass") and lists real facts from that
 * pass: its real number of finds ("N finds to spot"; Kevin 2026-10-06, A2: no Wild / Mixed / Built label), its finds by
 * section, the extras (map, October box) as tags and when it was really made. A card with no pass is not a
 * link and says why ("No data available yet: ..."). No distances (the page doesn't know where you are).
 * The pill says only a computed, true statement and pulses only while it is about today.
 * Server component, no client JavaScript.
 */
export function SampleParks({
  statuses,
  enabled = true,
}: {
  statuses: readonly ExampleStatus[];
  enabled?: boolean;
}) {
  const live = liveStatement(statuses, enabled);
  const states = statuses.map((s) => exampleState(s, enabled));
  const shown = statuses.flatMap((s, i) => {
    const ex = readyExample(s);
    return ex ? [{ s, state: states[i], ex }] : [];
  });
  return (
    <section
      id="parks"
      aria-labelledby="examples-title"
      className="relative z-[1] scroll-mt-28 bg-background sm:scroll-mt-16"
    >
      <div className="gp-container flex flex-col gap-12 pt-14 pb-24 sm:pt-16 lg:pt-8 lg:pb-32">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex max-w-2xl flex-col gap-4 sm:max-w-none">
            <p className="text-xs font-bold tracking-widest text-primary uppercase">
              Explore
            </p>
            <h2
              id="examples-title"
              className="text-[clamp(1.25rem,7vw,2.25rem)] leading-[1] font-extrabold tracking-tight whitespace-nowrap text-ink sm:text-5xl lg:text-6xl"
            >
              See a real pass, right now.
            </h2>
            <p className="max-w-2xl text-lg leading-relaxed text-pretty text-muted-foreground">
              Example passes for parks near Dallas, made from live data for{" "}
              {AGE_BAND_INFO[EXAMPLE_BAND].label
                .toLowerCase()
                .replace("-", "–")}
              . Tap one to open it; no sign-up needed.
            </p>
          </div>
          <p
            data-testid="examples-live"
            data-live={live.live ? "true" : "false"}
            className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full bg-card px-4 py-2 text-sm font-semibold text-ink ring-1 ring-border"
          >
            <span className="relative flex size-2.5" aria-hidden="true">
              {live.live ? (
                <span className="absolute inline-flex size-full rounded-full bg-primary opacity-60 motion-safe:animate-ping" />
              ) : null}
              <span
                className={`relative inline-flex size-2.5 rounded-full ${live.live ? "bg-primary" : "bg-line"}`}
              />
            </span>
            {live.text}
          </p>
        </div>

        {/* Kevin 2026-10-07: only parks with a real, ready pass are shown; a park with no data is left out. */}
        {shown.length === 0 ? (
          <p
            className="max-w-2xl rounded-2xl bg-card p-5 text-base leading-relaxed text-ink ring-1 ring-border"
            data-testid="examples-none"
          >
            {noExamplesText(statuses, enabled)}
          </p>
        ) : (
          <ul
            className={`grid gap-5 sm:grid-cols-2 ${shown.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}
            aria-label="Example parks"
          >
            {shown.map(({ s, state, ex }) => {
              const pic = PARK_PHOTOS[s.example.slug];
              const facts = cardFacts(ex.pass);
              const picture = pic ? (
                <div className="relative aspect-[4/3] overflow-hidden">
                  <Image
                    src={pic.src}
                    alt={pic.alt}
                    width={pic.width}
                    height={pic.height}
                    sizes="(min-width: 1536px) 500px, (min-width: 1024px) 32vw, (min-width: 640px) 45vw, 100vw"
                    className="h-full w-full object-cover transition-transform duration-700 motion-safe:group-hover:scale-105"
                  />
                  <span className="absolute right-3 bottom-3 left-3 w-fit rounded-full bg-paper/95 px-2.5 py-1 text-[11px] font-semibold text-ink">
                    {photoCredit(pic)}
                  </span>
                </div>
              ) : null;
              const title = (
                <div>
                  <h3 className="text-xl leading-tight font-extrabold text-ink">
                    {s.example.name}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {placeLabel(s.example.place)}
                  </p>
                </div>
              );
              return (
                <li
                  key={s.example.slug}
                  data-testid={`example-${s.example.slug}`}
                  data-state={state}
                >
                  <Link
                    href={ex.href}
                    prefetch={false}
                    className="group flex h-full scroll-mt-28 flex-col overflow-hidden rounded-3xl sm:scroll-mt-24 bg-card ring-1 ring-border transition-all hover:shadow-xl hover:shadow-shadow motion-safe:hover:-translate-y-1"
                  >
                    {picture}
                    <div className="flex flex-1 flex-col gap-3 p-5">
                      {title}
                      {facts.count > 0 ? (
                        <p
                          className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink"
                          data-testid="find-count"
                        >
                          <span>
                            {facts.count} {facts.count === 1 ? "find" : "finds"}{" "}
                            to spot
                          </span>
                        </p>
                      ) : null}
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {facts.facts}
                      </p>
                      {facts.tags.length > 0 ? (
                        <ul
                          className="flex flex-wrap gap-1.5"
                          aria-label="Also on this pass"
                        >
                          {facts.tags.map((tag) => (
                            <li
                              key={tag}
                              className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-ink"
                            >
                              {tag}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <p
                        className="text-xs text-muted-foreground"
                        data-testid="made-line"
                      >
                        {madeLine(s, ex.madeAt)}
                      </p>
                      <span className="mt-auto flex items-center justify-between border-t border-dashed border-line pt-4 font-heading text-sm font-extrabold text-primary">
                        See the pass
                        <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform motion-safe:group-hover:rotate-45">
                          <ArrowUpRight className="size-4" aria-hidden="true" />
                        </span>
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {/* Linked photo credits (the cards themselves are links, so the per-photo credit there is plain text). */}
        <PhotoCredits
          slugs={[
            ...new Set([
              ...shown.map(({ s }) => s.example.slug),
              ...TWO_PARKS.map((p) => p.slug),
            ]),
          ]}
          className="-mt-6 max-w-[75ch] text-xs text-muted-foreground"
        />
      </div>
    </section>
  );
}
