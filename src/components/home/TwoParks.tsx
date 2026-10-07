import Image from "next/image";
import { ArrowDown } from "lucide-react";
import { PARK_PHOTOS, photoCredit } from "@/data/photo-credits";

/**
 * "The problem" (Kevin's copy; redesigned 2026-10-07 as a big logo-green ticket with a two-park "versus").
 * The numbers are real measurements from SPEC §1, taken on Oct 5, 2026 (iNaturalist research-grade species within
 * 1.5 km over 14 days; OpenStreetMap features inside the park), and the section says so. The unit charts draw the
 * same numbers, one mark per species / per field or court (SPEC §1: 25 soccer pitches, 4 tennis + 2 basketball courts).
 */
export const TWO_PARKS = [
  {
    name: "Connemara Meadow",
    slug: "connemara",
    kind: "wild",
    big: { value: "70", label: "species spotted nearby in 2 weeks" },
    small: { value: "0", label: "playgrounds, courts or shelters" },
    verdict: "So its pass is wild: birds, bugs, blooms.",
    hunt: "Wild hunt",
    marks: [{ count: 70, shape: "dot", key: "= 1 species" }],
  },
  {
    name: "Celebration Park",
    slug: "celebration",
    kind: "built",
    big: { value: "25", label: "soccer fields, plus 6 courts" },
    small: { value: "0", label: "recent wildlife sightings" },
    verdict: "So its pass is built: hoops, nets, a shelter.",
    hunt: "Built hunt",
    marks: [
      { count: 25, shape: "field", key: "= 1 soccer field" },
      { count: 6, shape: "court", key: "= 1 court" },
    ],
  },
] as const;

export const TWO_PARKS_SOURCE =
  "Measured Oct 5, 2026: iNaturalist (research-grade sightings within 1.5 km, last 14 days) and OpenStreetMap (features mapped inside each park).";

type Park = (typeof TWO_PARKS)[number];

const MARK = {
  dot: "size-2.5 shrink-0 rounded-full bg-primary sm:size-3",
  field: "size-2.5 shrink-0 rounded-[3px] bg-foreground sm:size-3",
  court: "size-2.5 shrink-0 rounded-[3px] bg-sun ring-1 ring-foreground/70 sm:size-3",
} as const;

/** One mark per real thing counted; decorative (the numbers are in the text next to it). */
function UnitChart({ park }: { park: Park }) {
  const marks = park.marks.flatMap((m) => Array.from({ length: m.count }, () => m.shape));
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <div className="grid w-fit grid-cols-[repeat(14,minmax(0,1fr))] gap-1.5 sm:gap-2">
        {marks.map((shape, n) => (
          <span key={n} className={`gp-why-mark ${MARK[shape]}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-muted-foreground">
        {park.marks.map((m) => (
          <span key={m.shape} className="flex items-center gap-1.5">
            <span className={MARK[m.shape]} />
            {m.key}
          </span>
        ))}
      </div>
    </div>
  );
}

function ParkTicket({ park }: { park: Park }) {
  const pic = PARK_PHOTOS[park.slug];
  return (
    <article
      aria-labelledby={`two-${park.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-[2rem] bg-card text-card-foreground shadow-[0_1px_0_rgb(255_255_255/0.4)_inset,0_30px_60px_-30px_rgb(5_30_14/0.55),0_12px_24px_-12px_rgb(5_30_14/0.35)]"
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <Image
          src={pic.src}
          alt={pic.alt}
          width={pic.width}
          height={pic.height}
          sizes="(min-width: 1536px) 680px, (min-width: 768px) 46vw, 100vw"
          className="h-full w-full object-cover transition-transform duration-700 motion-safe:group-hover:scale-105"
        />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/75 via-black/30 to-transparent" />
        {/* UX-6-04: plain text; the linked source and licence are in the one "Photo credits and licences" link. */}
        <span className="absolute top-4 right-4 rounded-full bg-paper/95 px-2.5 py-1 text-[11px] font-semibold text-ink">{photoCredit(pic)}</span>
        <h3 id={`two-${park.slug}`} className="absolute bottom-4 left-5 text-3xl leading-none font-extrabold tracking-tight text-white sm:bottom-6 sm:left-7 lg:text-4xl">
          {park.name}
        </h3>
      </div>

      <div className="flex flex-1 flex-col gap-6 p-6 sm:p-8">
        <p className="flex flex-col">
          <span className="font-heading text-[6.5rem] leading-[0.8] font-extrabold tracking-tighter text-primary sm:text-[8rem]">{park.big.value}</span>
          <span className="mt-3 text-base font-semibold">{park.big.label}</span>
        </p>
        <UnitChart park={park} />

        <div className="mt-auto flex items-center gap-4 rounded-2xl border-2 border-dashed border-line/60 px-4 py-3">
          <span className="font-heading text-5xl leading-none font-extrabold text-muted-foreground">{park.small.value}</span>
          <span className="text-sm font-medium text-muted-foreground">{park.small.label}</span>
        </div>
      </div>

      {/* The tear line: a ticket stub with the verdict. */}
      <div aria-hidden="true" className="relative h-0">
        <span className="absolute -top-3 -left-3 size-6 rounded-full bg-why" />
        <span className="absolute -top-3 -right-3 size-6 rounded-full bg-why" />
        <span className="absolute inset-x-6 top-0 border-t-2 border-dashed border-line/50" />
      </div>
      <div className="flex flex-col items-start gap-3 px-6 pt-6 pb-6 sm:px-8 sm:pb-8">
        <span className="rounded-full bg-sun px-3 py-1 text-xs font-bold tracking-widest text-sun-foreground uppercase">{park.hunt}</span>
        <p className="font-heading text-xl leading-snug font-bold sm:text-2xl">{park.verdict}</p>
      </div>
    </article>
  );
}

export function TwoParks() {
  return (
    <section id="why" aria-labelledby="why-title" className="scroll-mt-28 px-3 py-6 sm:scroll-mt-16 sm:px-5 lg:py-10">
      <div className="relative mx-auto max-w-[1600px] rounded-[2rem] bg-why text-why-foreground sm:rounded-[2.75rem]">
        {/* The logo ticket's notches, blown up. */}
        <span aria-hidden="true" className="absolute top-1/2 -left-5 size-10 -translate-y-1/2 rounded-full bg-background sm:-left-8 sm:size-16" />
        <span aria-hidden="true" className="absolute top-1/2 -right-5 size-10 -translate-y-1/2 rounded-full bg-background sm:-right-8 sm:size-16" />
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-[inherit] opacity-[0.12] [background-image:radial-gradient(rgb(255_255_255)_1px,transparent_1px)] [background-size:18px_18px]"
        />

        <div className="relative mx-auto flex max-w-7xl flex-col gap-12 px-5 pt-16 pb-12 sm:px-8 lg:gap-16 lg:pt-24 lg:pb-16">
          <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
            <div className="flex flex-col gap-5 lg:col-span-6">
              <p className="w-fit rounded-full bg-sun px-3.5 py-1.5 text-xs font-bold tracking-widest text-sun-foreground uppercase">The problem</p>
              <h2 id="why-title" className="text-5xl leading-[0.95] font-extrabold tracking-tighter text-balance sm:text-6xl lg:text-7xl 2xl:text-8xl">
                Why &ldquo;Find a pinecone&rdquo; <span className="relative inline-block whitespace-nowrap">
                  fails.
                  <svg aria-hidden="true" viewBox="0 0 200 20" preserveAspectRatio="none" className="absolute -bottom-2 left-0 h-3 w-full text-sun sm:h-4">
                    <path d="M3 14 C 50 4, 120 4, 197 10" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
                  </svg>
                </span>
              </h2>
            </div>
            <div className="flex max-w-xl flex-col gap-5 lg:col-span-6 lg:justify-self-end">
              <p className="text-lg leading-relaxed text-pretty text-why-muted">
                Generic scavenger hunts fail because parks aren&rsquo;t generic. A manicured city park has basketball hoops; a
                rugged nature preserve has butterflies. That&rsquo;s why Grass Pass builds every adventure from scratch using your
                park&rsquo;s exact map and the last two weeks of local wildlife sightings.
              </p>
              <p className="flex items-center gap-3 text-lg font-bold text-balance text-why-foreground">
                <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sun text-sun-foreground">
                  <ArrowDown className="size-4.5" strokeWidth={2.75} />
                </span>
                See the difference for yourself with these two Allen, TX parks:
              </p>
            </div>
          </div>

          <div className="relative grid gap-4 [container-type:inline-size] md:grid-cols-2 md:gap-8 lg:gap-12">
            <ParkTicket park={TWO_PARKS[0]} />
            <span
              aria-hidden="true"
              className="z-10 mx-auto flex size-16 rotate-[-8deg] items-center justify-center rounded-full bg-sun font-heading text-2xl font-extrabold text-sun-foreground shadow-[0_10px_30px_-8px_rgb(5_30_14/0.6)] ring-[6px] ring-why md:absolute md:top-[calc((100cqw-2rem)*0.3125)] md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 lg:top-[calc((100cqw-3rem)*0.3125)] lg:size-24 lg:text-4xl"
            >
              vs
            </span>
            <ParkTicket park={TWO_PARKS[1]} />
          </div>

          <p className="-mt-4 max-w-4xl text-sm text-why-muted" data-testid="two-parks-source">
            {TWO_PARKS_SOURCE}
          </p>
        </div>
      </div>
    </section>
  );
}
