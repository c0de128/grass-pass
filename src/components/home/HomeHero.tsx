import Image from "next/image";
import { ArrowDown } from "lucide-react";
import type { ReactNode } from "react";
import { ExampleChips } from "@/components/home/ExampleChips";
import { HeroPassCard } from "@/components/home/HeroPassCard";
import type { HeroCard, ReadyExample } from "@/lib/home/showcase";
import { HERO_ILLUSTRATION } from "@/lib/illustrations";

/**
 * v3 hero (Kevin's v0 design, Kevin's home copy 2026-10-06): the big
 * headline with the sunflower underline under "powered by AI.", the lead (the "about 30 seconds" is PASS_WAIT_COPY's
 * usual 10-30 s), the real park search card (children: RestingNotice + PassMaker); on the
 * right the meadow picture with the tilted real example pass.
 *
 * UX-10-03 (round 10): on phones (below 640 px) the top padding and the gaps are tighter, so at 360x740 the search box
 * starts above the fold, and the headline (52 px) and lead (normal line height) are a little tighter, so the whole box
 * fits (measured: input 678-734 px at 360x740; it was 768-824). Only spacing and size changed; the words and the
 * 640 px+ layout are as before.
 *
 * Full-screen hero (Kevin 2026-10-08, option A): from 1024 px the hero fills the first screen under the header, less a
 * small peek of the Explore heading; the type, the search card and the picture grow with the screen (the --hero-*
 * sizes in globals.css, capped for very wide or tall screens). The picture stretches to the left column's height and
 * the real pass card hangs inside the hero's bottom padding (scaled at 1024-1279 px and on short screens so it never
 * hides the child's face). Below 1024 px only the space under the hero is tighter. Words unchanged.
 */
export function HomeHero({ card, examples, children }: { card: HeroCard | null; examples: readonly ReadyExample[]; children: ReactNode }) {
  return (
    <section id="find" aria-labelledby="hero-title" className="gp-hero relative z-[2] scroll-mt-28 overflow-x-clip sm:scroll-mt-16">
      <div className="grain absolute inset-0 opacity-60" aria-hidden="true" />
      <div className="relative mx-auto grid max-w-7xl gap-14 px-5 pt-3 pb-10 sm:pt-12 sm:pb-28 md:px-8 lg:min-h-(--hero-h) lg:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)] lg:content-center lg:gap-x-8 lg:gap-y-0 lg:pt-(--hero-pt) lg:pb-(--hero-pb)">
        <div className="flex min-w-0 flex-col gap-4 sm:gap-8 lg:gap-(--hero-gap)">

          <h1 id="hero-title" className="flex w-fit max-w-full flex-col text-[3.25rem] leading-[0.95] font-extrabold tracking-tighter text-ink sm:text-7xl lg:text-(length:--hero-h1)">
            <span className="text-[1.25em] leading-[0.95] lg:whitespace-nowrap">Family time is back!</span>{" "}
            <span className="relative mt-2 inline-block self-end text-[0.667em] text-primary lg:whitespace-nowrap">
              powered by AI.
              <svg aria-hidden="true" viewBox="0 0 300 20" preserveAspectRatio="none" className="absolute -bottom-2 left-0 h-3 w-full text-sun sm:h-4">
                <path d="M2 14 C 80 4, 200 4, 298 12" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
              </svg>
            </span>
          </h1>

          {/* Kevin's own words (2026-10-08), two paragraphs. */}
          <div className="flex max-w-xl flex-col gap-2 text-base leading-normal text-pretty text-muted-foreground sm:gap-4 sm:text-lg sm:leading-relaxed lg:max-w-[31em] lg:gap-[0.7em] lg:text-(length:--hero-lead) lg:leading-[1.55]">
            <p>
              Your local park, turned into an adventure. Grass Pass uses AI, real park maps and recent wildlife sightings
              to write a scavenger hunt made for you or your kids.
            </p>
            <p>
              Pick a park and who&apos;s coming, from little kids to teens and adults. In about 30 seconds you get one
              printable page, plus today&apos;s weather and tips for the trip. Print it, grab a pencil, and leave the
              phone at home.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:gap-4">
            {/* Kevin 2026-10-07: a call to action right above the search box. */}
            <p className="inline-flex items-center gap-3 font-heading text-2xl font-extrabold tracking-tight text-ink sm:text-3xl lg:gap-[0.4em] lg:text-(length:--hero-cta)" data-testid="hero-cta">
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-sun text-sun-foreground shadow-sm lg:size-[1.15em]" aria-hidden="true">
                <ArrowDown className="size-5 lg:size-[0.6em]" />
              </span>
              Create your pass now
            </p>
            {children}
          </div>

          {/* Phones only. Kevin 2026-10-08 (UX-8-03): below the search box, so "Create your pass now" comes first. */}
          <ExampleChips examples={examples} />
        </div>

        <div className="relative">
          <div className="relative mx-auto max-w-md lg:mr-0 lg:ml-auto lg:h-full lg:max-w-none lg:pl-10">
            <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] shadow-2xl shadow-shadow lg:aspect-auto lg:h-full">
              <Image
                src={HERO_ILLUSTRATION.src}
                alt={HERO_ILLUSTRATION.alt}
                width={HERO_ILLUSTRATION.width}
                height={HERO_ILLUSTRATION.height}
                // UX-4-02: no preload/eager. On phones this picture sits below the search card (the LCP there is the
                // lead text), and an eager preload competed with the first paint; on desktop it loads at layout.
                loading="lazy"
                sizes="(min-width: 1280px) 560px, (min-width: 1024px) 40vw, (min-width: 448px) 448px, 90vw"
                className="h-full w-full object-cover lg:absolute lg:inset-0"
              />
              {/* Kevin 2026-10-08: the honest AI label sits inside the picture, bottom right, in white (a soft dark
                  backing keeps it readable on any part of the photo). Phones: top right, since the pass card covers the bottom there. */}
              <p className="absolute top-4 right-4 z-20 rounded-full sm:top-auto sm:bottom-4 bg-black/45 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                {HERO_ILLUSTRATION.caption}
              </p>
            </div>
            {/* Phones: in the flow, overlapping the picture's lower part (a real pass is taller than v0's sample, so an
                absolute card would cover the search card). From 640 px: v0's absolute, tilted placement. */}
            <div className="gp-rise relative z-10 -mt-44 w-[88%] max-w-80 -rotate-6 sm:absolute sm:-bottom-24 sm:-left-10 sm:mt-0 sm:w-60 lg:bottom-[calc(1.75rem-var(--hero-pb))] lg:left-2 lg:w-[17rem] lg:origin-bottom-left lg:scale-[0.8] xl:scale-[0.9] xl:[@media(min-height:55rem)]:scale-100">
              <HeroPassCard card={card} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
