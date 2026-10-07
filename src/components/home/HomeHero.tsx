import { CircleCheck, PhoneOff } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { ExampleChips } from "@/components/home/ExampleChips";
import { HeroPassCard } from "@/components/home/HeroPassCard";
import type { HeroCard, ReadyExample } from "@/lib/home/showcase";
import { HERO_ILLUSTRATION } from "@/lib/illustrations";

/**
 * v3 hero (Kevin's v0 design, Kevin's home copy 2026-10-06): the yellow "Screen-free & re-wilded" badge, the big
 * headline with the sunflower underline under "kids back.", the lead (the "about 30 seconds" is PASS_WAIT_COPY's
 * usual 10-30 s), the real park search card (children: RestingNotice + PassMaker) and the "Free for parents." line; on the
 * right the meadow picture with the tilted real example pass and the "Fits on 1 page" sticker.
 */
export function HomeHero({ card, examples, children }: { card: HeroCard | null; examples: readonly ReadyExample[]; children: ReactNode }) {
  return (
    <section id="find" aria-labelledby="hero-title" className="relative scroll-mt-28 sm:scroll-mt-16 overflow-hidden">
      <div className="grain absolute inset-0 opacity-60" aria-hidden="true" />
      <div className="relative mx-auto grid max-w-7xl gap-14 px-5 pt-12 pb-20 md:px-8 lg:grid-cols-12 lg:items-start lg:gap-8 lg:pt-20 lg:pb-28">
        <div className="flex min-w-0 flex-col gap-8 lg:col-span-7">
          <p className="gp-rise inline-flex w-fit items-center gap-2 rounded-full bg-sun px-3.5 py-1.5 text-xs font-bold tracking-widest text-sun-foreground uppercase">
            <PhoneOff className="size-3.5" aria-hidden="true" />
            Screen-free &amp; re-wilded
          </p>

          <h1 id="hero-title" className="flex w-fit max-w-full flex-col text-6xl leading-[0.95] font-extrabold tracking-tighter text-ink sm:text-7xl lg:text-[clamp(2.75rem,4.1vw,3.75rem)]">
            <span className="text-[1.25em] leading-[0.95] lg:whitespace-nowrap">Family time is back!</span>{" "}
            <span className="relative mt-2 inline-block self-end text-[0.667em] text-primary lg:whitespace-nowrap">
              powered by AI.
              <svg aria-hidden="true" viewBox="0 0 300 20" preserveAspectRatio="none" className="absolute -bottom-2 left-0 h-3 w-full text-sun sm:h-4">
                <path d="M2 14 C 80 4, 200 4, 298 12" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
              </svg>
            </span>
          </h1>

          <p className="max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
            Grass Pass turns your local park into an interactive adventure. Our AI analyzes real-world maps and actual
            wildlife sightings to craft a custom scavenger hunt in seconds. Just hit print, grab a pencil, and head
            outside&mdash;no screens required.
          </p>

          <ExampleChips examples={examples} />

          <div className="flex flex-col gap-4">
            {children}
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink" data-testid="hero-trust">
              <CircleCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
              Free for parents.
            </p>
          </div>
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
            </div>
            {/* Kept outside the picture so the tilted pass card can never cover it (honest AI label). */}
            <p className="mt-2 text-right text-xs font-semibold text-muted-foreground">{HERO_ILLUSTRATION.caption}</p>
            {/* Phones: in the flow, overlapping the picture's lower part (a real pass is taller than v0's sample, so an
                absolute card would cover the search card). From 640 px: v0's absolute, tilted placement. */}
            <div className="gp-rise relative z-10 -mt-44 w-[88%] max-w-80 -rotate-6 sm:absolute sm:-bottom-24 sm:-left-10 sm:mt-0 sm:w-60 lg:-bottom-32 lg:-left-2 lg:w-64">
              <HeroPassCard card={card} />
            </div>
            <p className="absolute top-8 -right-1 rotate-6 rounded-full bg-sun px-4 py-2 font-heading text-sm font-extrabold text-sun-foreground shadow-lg sm:-right-6">
              Fits on 1 page
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
