import { Bird, Dog, Landmark, MapIcon, ShieldAlert } from "lucide-react";
import type { SpotQuote } from "@/lib/home/showcase";
import { BLOCKED_TAXA } from "@/lib/safety/danger-taxa";

/**
 * "What's on a pass" (Kevin's v0 bento). Copy checked against the app: blocked species are never printed
 * (they are not shown as "look, don't touch"); Lucky Finds need >= 3 Google Maps reviews from the last
 * 2 years via SerpApi and are left off with a reason otherwise; the Find This Spot quote is a REAL riddle
 * from a saved example pass, or nothing.
 */
export function PassAnatomy({ spot }: { spot: SpotQuote | null }) {
  return (
    <section id="pass" aria-labelledby="pass-title" className="scroll-mt-16 bg-muted/70">
      <div className="mx-auto flex max-w-7xl flex-col gap-14 px-5 py-24 md:px-8 lg:py-32">
        <div className="grid gap-6 lg:grid-cols-2 lg:items-end">
          <div className="flex flex-col gap-4">
            <p className="text-xs font-bold tracking-widest text-primary uppercase">What&apos;s on a pass</p>
            <h2 id="pass-title" className="text-4xl leading-[1] font-extrabold tracking-tight text-balance text-ink sm:text-5xl lg:text-6xl">
              Every clue comes with its receipts.
            </h2>
          </div>
          <p className="max-w-lg text-lg leading-relaxed text-pretty text-muted-foreground">
            Each item on the pass is backed by a real, dated source, printed on the parent stub, so nobody spends an hour
            hunting for a heron that left in 2019.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-6">
          <article className="flex flex-col gap-6 rounded-3xl bg-primary p-7 text-primary-foreground md:col-span-3 md:row-span-2 lg:p-9">
            <div className="flex items-center justify-between gap-3">
              <Bird className="size-8" aria-hidden="true" />
              <span className="rounded-full bg-black/20 px-3 py-1 text-xs font-semibold">iNaturalist · last 14 days</span>
            </div>
            <h3 className="text-3xl leading-tight font-extrabold sm:text-4xl">Wild Finds</h3>
            <p className="max-w-md leading-relaxed">
              Plants and animals people really photographed in and around that park (within 1.5 km) in the past two
              weeks. Every clue is checked word for word against its source.
            </p>
            <div className="mt-auto flex flex-col gap-3 rounded-2xl bg-paper p-5 text-ink">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
                <p className="text-sm leading-relaxed">
                  <strong className="font-bold">Safety built in.</strong> Venomous snakes, poison ivy, stinging bugs and more ({BLOCKED_TAXA.length}{" "}
                  risky groups in all) are never printed. Every Wild Find says &ldquo;look,
                  don&apos;t touch.&rdquo;
                </p>
              </div>
            </div>
          </article>

          <article className="flex flex-col gap-4 rounded-3xl bg-card p-7 ring-1 ring-border md:col-span-3">
            <div className="flex items-center justify-between gap-3">
              <Landmark className="size-7 text-primary" aria-hidden="true" />
              <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">OpenStreetMap</span>
            </div>
            <h3 className="text-2xl font-extrabold text-ink">Park Finds</h3>
            <p className="leading-relaxed text-muted-foreground">
              Hoops, shelters, bridges. Things on the park map, with real counts like &ldquo;2 basketball courts.&rdquo;
            </p>
          </article>

          <article className="flex flex-col gap-4 rounded-3xl bg-card p-7 ring-1 ring-border md:col-span-3">
            <div className="flex items-center justify-between gap-3">
              <Dog className="size-7 text-primary" aria-hidden="true" />
              <span className="rounded-full bg-sun px-3 py-1 text-xs font-bold text-sun-foreground">New</span>
            </div>
            <h3 className="text-2xl font-extrabold text-ink">Lucky Finds</h3>
            <p className="leading-relaxed text-muted-foreground">
              &ldquo;Maybe&rdquo; finds like a dog or a bike, backed by at least 3 Google Maps reviews from the last 2 years
              that mention them (counted via SerpApi). No evidence, no Lucky Finds: the pass leaves them off and says why.
            </p>
          </article>

          <article className="gp-band flex flex-col gap-5 rounded-3xl bg-band p-7 text-band-foreground md:col-span-4 lg:p-9">
            <MapIcon className="size-7 text-sun" aria-hidden="true" />
            <h3 className="text-2xl font-extrabold sm:text-3xl">Find This Spot</h3>
            <p className="max-w-lg leading-relaxed text-band-muted">
              A small black-and-white map of the park with a start point and an X, plus a riddle.
            </p>
            {spot ? (
              <figure className="mt-auto flex flex-col gap-2" data-testid="spot-quote">
                <blockquote className="border-l-4 border-sun pl-4 font-heading text-xl leading-snug font-bold italic">
                  &ldquo;{spot.riddle}&rdquo;
                </blockquote>
                <figcaption className="pl-5 text-xs text-band-muted">
                  The real riddle on the {spot.park} example pass (made {spot.madeAt}).
                </figcaption>
              </figure>
            ) : null}
          </article>

          <article className="flex flex-col gap-4 rounded-3xl bg-sun p-7 text-sun-foreground md:col-span-2">
            <p className="text-xs font-bold tracking-widest uppercase">Sept 15 to Nov 15</p>
            <h3 className="text-2xl font-extrabold">October monarch box</h3>
            <p className="text-sm leading-relaxed">
              Monarchs reported nearby in the past two weeks vs. the same weeks last year. Printed honestly, even when
              it&apos;s zero.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}
