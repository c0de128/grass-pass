import { ArrowRight } from "lucide-react";

/** The big closing banner at the end of the home page (Kevin 2026-10-07: same sage background as "What's a pass?"). Kevin 2026-10-08: top space, so it never runs into the sage band above it. */
export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="gp-container pt-20 pb-24 lg:pt-28">
      <div className="relative overflow-hidden rounded-[2.5rem] bg-muted/70 text-ink">
        <div className="relative flex flex-col items-center gap-8 px-6 py-20 text-center sm:py-24">
          <h2 id="cta-title" className="max-w-4xl text-5xl leading-[0.95] font-extrabold tracking-tighter text-balance sm:text-6xl lg:text-7xl">
            Print the pass. Pocket the pencil. Leave the phone.
          </h2>
          <p className="max-w-xl text-lg leading-relaxed text-pretty">
            Free, one printable page, written for the park across the street, not some park somewhere else.
          </p>
          <a
            href="#find"
            className="group inline-flex h-14 items-center gap-2 rounded-full bg-primary px-8 font-heading text-lg font-extrabold text-primary-foreground transition-transform motion-safe:hover:-translate-y-0.5"
          >
            Make a free pass
            <ArrowRight className="size-5 transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}
