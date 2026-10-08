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
 * starts above the fold. Only spacing changed; the words and the 640 px+ layout are as before.
 */
export function HomeHero({ card, examples, children }: { card: HeroCard | null; examples: readonly ReadyExample[]; children: ReactNode }) {
  return (
    <section id="find" aria-labelledby="hero-title" className="relative scroll-mt-28 sm:scroll-mt-16 overflow-hidden">
      <div className="grain absolute inset-0 opacity-60" aria-hidden="true" />
      <div className="relative mx-auto grid max-w-7xl gap-14 px-5 pt-3 pb-20 sm:pt-12 sm:pb-32 md:px-8 lg:grid-cols-12 lg:items-start lg:gap-8 lg:pt-20 lg:pb-40">
        <div className="flex min-w-0 flex-col gap-4 sm:gap-8 lg:col-span-7">

          <h1 id="hero-title" className="flex w-fit max-w-full flex-col text-6xl leading-[0.95] font-extrabold tracking-tighter text-ink sm:text-7xl lg:text-[clamp(2.75rem,4.1vw,3.75rem)]">
            <span className="text-[1.25em] leading-[0.95] lg:whitespace-nowrap">Family time is back!</span>{" "}
            <span className="relative mt-2 inline-block self-end text-[0.667em] text-primary lg:whitespace-nowrap">
              powered by AI.
              <svg aria-hidden="true" viewBox="0 0 300 20" preserveAspectRatio="none" className="absolute -bottom-2 left-0 h-3 w-full text-sun sm:h-4">
                <path d="M2 14 C 80 4, 200 4, 298 12" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
              </svg>
            </span>
          </h1>

          {/* Kevin's own words (2026-10-08), two paragraphs. */}
          <div className="flex max-w-xl flex-col gap-2 text-base leading-relaxed text-pretty text-muted-foreground sm:gap-4 sm:text-lg">
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
            <p className="inline-flex items-center gap-3 font-heading text-2xl font-extrabold tracking-tight text-ink sm:text-3xl" data-testid="hero-cta">
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-sun text-sun-foreground shadow-sm" aria-hidden="true">
                <ArrowDown className="size-5" />
              </span>
              Create your pass now
            </p>
            {children}
          </div>

          {/* Phones only. Kevin 2026-10-08 (UX-8-03): below the search box, so "Create your pass now" comes first. */}
          <ExampleChips examples={examples} />
        </div>

        <div className="relative lg:sticky lg:top-24 lg:col-span-5">
          <div className="relative mx-auto max-w-md lg:mr-0 lg:ml-auto lg:max-w-none lg:pl-16">
            <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] shadow-2xl shadow-shadow">
              <Image
                src={HERO_ILLUSTRATION.src}
                alt={HERO_ILLUSTRATION.alt}
                width={HERO_ILLUSTRATION.width}
                height={HERO_ILLUSTRATION.height}
                // UX-4-02: no preload/eager. On phones this picture sits below the search card (the LCP there is the
                // lead text), and an eager preload competed with the first paint; on desktop it loads at layout.
                loading="lazy"
                sizes="(min-width: 1280px) 560px, (min-width: 1024px) 40vw, (min-width: 448px) 448px, 90vw"
                className="h-full w-full object-cover"
              />
              {/* Kevin 2026-10-08: the honest AI label sits inside the picture, bottom right, in white (a soft dark
                  backing keeps it readable on any part of the photo). Phones: top right, since the pass card covers the bottom there. */}
              <p className="absolute top-4 right-4 z-20 rounded-full sm:top-auto sm:bottom-4 bg-black/45 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                {HERO_ILLUSTRATION.caption}
              </p>
            </div>
            {/* Phones: in the flow, overlapping the picture's lower part (a real pass is taller than v0's sample, so an
                absolute card would cover the search card). From 640 px: v0's absolute, tilted placement. */}
            <div className="gp-rise relative z-10 -mt-44 w-[88%] max-w-80 -rotate-6 sm:absolute sm:-bottom-24 sm:-left-10 sm:mt-0 sm:w-60 lg:-bottom-32 lg:-left-2 lg:w-64">
              <HeroPassCard card={card} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
