import { ArrowRight } from "lucide-react";

/** The big sunflower banner at the end of the home page (Kevin's v0 design). */
export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="px-5 pb-24 md:px-8">
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[2.5rem] bg-sun text-sun-foreground">
        <div className="relative flex flex-col items-center gap-8 px-6 py-20 text-center sm:py-24">
          <h2 id="cta-title" className="max-w-4xl text-5xl leading-[0.95] font-extrabold tracking-tighter text-balance sm:text-6xl lg:text-7xl">
            Print the pass. Pocket the pencil. Leave the phone.
          </h2>
          <p className="max-w-xl text-lg leading-relaxed text-pretty">
            Free, one printable page, written for the park across the street, not some park somewhere else.
          </p>
          <a
            href="#find"
            className="group inline-flex h-14 items-center gap-2 rounded-full bg-[#10291a] px-8 font-heading text-lg font-extrabold text-[#eef3e2] transition-transform [--gp-ring:#10291a] motion-safe:hover:-translate-y-0.5"
          >
            Make a free pass
            <ArrowRight className="size-5 transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}
