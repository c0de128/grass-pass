import Image from "next/image";
import { ArrowDown } from "lucide-react";
import { PARK_PHOTOS, photoCredit } from "@/data/photo-credits";

/**
 * "The problem" (Kevin's copy; redesigned 2026-10-07 as a big logo-green ticket with a two-park "versus", then made
 * compact the same day: Kevin found it too tall). The numbers are real measurements from SPEC §1, taken on Oct 5, 2026
 * (iNaturalist research-grade species within 1.5 km over 14 days; OpenStreetMap features inside the park), and the
 * section says so. The unit charts draw the same numbers, one mark per species / per field or court (SPEC §1:
 * 25 soccer pitches, 4 tennis + 2 basketball courts).
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
  dot: "size-2 shrink-0 rounded-full bg-primary lg:size-2.5",
  field: "size-2 shrink-0 rounded-[2px] bg-foreground lg:size-2.5",
  court: "size-2 shrink-0 rounded-[2px] bg-sun ring-1 ring-foreground/70 lg:size-2.5",
} as const;

/** One mark per real thing counted; decorative (the numbers are in the text next to it). */
function UnitChart({ park }: { park: Park }) {
  const marks = park.marks.flatMap((m) => Array.from({ length: m.count }, () => m.shape));
  return (
    <div aria-hidden="true" className="flex w-fit shrink-0 flex-col gap-2">
      <div className="grid w-fit grid-cols-[repeat(10,minmax(0,1fr))] gap-1 lg:grid-cols-[repeat(14,minmax(0,1fr))] lg:gap-1.5">
        {marks.map((shape, n) => (
          <span key={n} className={`gp-why-mark ${MARK[shape]}`} />
        ))}
      </div>
      <div className="flex w-0 min-w-full flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-tight font-medium text-muted-foreground">
        {park.marks.map((m) => (
          <span key={m.shape} className="flex items-center gap-1">
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
      className="group relative flex flex-col overflow-hidden rounded-[1.75rem] bg-card text-card-foreground shadow-[0_1px_0_rgb(255_255_255/0.4)_inset,0_30px_60px_-30px_rgb(5_30_14/0.55),0_12px_24px_-12px_rgb(5_30_14/0.35)]"
    >
      <div className="relative aspect-[16/7] overflow-hidden lg:aspect-[16/6]">
        <Image
          src={pic.src}
          alt={pic.alt}
          width={pic.width}
          height={pic.height}
          sizes="(min-width: 1536px) 760px, (min-width: 768px) 46vw, 100vw"
          className="h-full w-full object-cover transition-transform duration-700 motion-safe:group-hover:scale-105"
        />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-black/75 via-black/30 to-transparent" />
        {/* UX-6-04: plain text; the linked source and licence are in the one "Photo credits and licences" link. */}
        <span className="absolute top-3 right-3 rounded-full bg-paper/95 px-2.5 py-1 text-[11px] font-semibold text-ink">{photoCredit(pic)}</span>
        <h3 id={`two-${park.slug}`} className="absolute bottom-3 left-5 text-2xl leading-none font-extrabold tracking-tight text-white sm:left-6 lg:bottom-4 lg:text-3xl">
          {park.name}
        </h3>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-5 pt-4 pb-4 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <p className="flex min-w-0 flex-col">
            <span className="font-heading text-6xl leading-[0.8] font-extrabold tracking-tighter text-primary lg:text-7xl">{park.big.value}</span>
            <span className="mt-2 text-sm leading-snug font-semibold">{park.big.label}</span>
          </p>
          <UnitChart park={park} />
        </div>
        <p className="mt-auto flex w-fit items-center gap-2 rounded-full border-2 border-dashed border-line/60 py-0.5 pr-3.5 pl-2.5 text-sm font-medium text-muted-foreground">
          <span className="font-heading text-xl leading-none font-extrabold">{park.small.value}</span>
          {park.small.label}
        </p>
      </div>

      {/* The tear line: a ticket stub with the verdict. */}
      <div aria-hidden="true" className="relative h-0">
        <span className="absolute -top-2.5 -left-2.5 size-5 rounded-full bg-why" />
        <span className="absolute -top-2.5 -right-2.5 size-5 rounded-full bg-why" />
        <span className="absolute inset-x-5 top-0 border-t-2 border-dashed border-line/50" />
      </div>
      <p className="px-5 py-3.5 font-heading text-base leading-snug font-bold sm:px-6 lg:text-lg">
        <span className="mr-2 inline-block rounded-full bg-sun px-2.5 py-0.5 align-[2px] font-sans text-[11px] font-bold tracking-widest text-sun-foreground uppercase">
          {park.hunt}
        </span>
        {park.verdict}
      </p>
    </article>
  );
}

export function TwoParks() {
  return (
    <section id="why" aria-labelledby="why-title" className="scroll-mt-28 overflow-x-clip px-3 py-4 sm:scroll-mt-16 sm:px-5 lg:py-5">
      <div className="relative mx-auto max-w-[106rem] rounded-[2rem] bg-why text-why-foreground sm:rounded-[2.5rem]">
        {/* The logo ticket's notches, blown up. */}
        <span aria-hidden="true" className="absolute top-1/2 -left-4 size-8 -translate-y-1/2 rounded-full bg-background sm:-left-6 sm:size-12" />
        <span aria-hidden="true" className="absolute top-1/2 -right-4 size-8 -translate-y-1/2 rounded-full bg-background sm:-right-6 sm:size-12" />

        <div className="gp-container relative flex flex-col gap-7 pt-9 pb-7 lg:gap-9 lg:pt-12 lg:pb-9">
          <div className="grid gap-5 lg:grid-cols-12 lg:items-end lg:gap-8">
            <div className="flex flex-col gap-4 lg:col-span-5">
              <p className="w-fit rounded-full bg-sun px-3.5 py-1.5 text-xs font-bold tracking-widest text-sun-foreground uppercase">The problem</p>
              <h2 id="why-title" className="text-4xl leading-[0.95] font-extrabold tracking-tighter text-balance sm:text-5xl lg:text-6xl">
                Why &ldquo;Find a pinecone&rdquo; <span className="relative inline-block whitespace-nowrap">
                  fails.
                  <svg aria-hidden="true" viewBox="0 0 200 20" preserveAspectRatio="none" className="absolute -bottom-2 left-0 h-3 w-full text-sun">
                    <path d="M3 14 C 50 4, 120 4, 197 10" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
                  </svg>
                </span>
              </h2>
            </div>
            <div className="flex flex-col gap-3 lg:col-span-7">
              <p className="max-w-[68ch] text-base leading-relaxed text-pretty text-why-muted">
                Generic scavenger hunts fail because parks aren&rsquo;t generic. A manicured city park has basketball hoops; a
                rugged nature preserve has butterflies. That&rsquo;s why Grass Pass builds every adventure from scratch using your
                park&rsquo;s exact map and the last two weeks of local wildlife sightings.
              </p>
              <p className="flex items-center gap-2.5 text-base font-bold text-balance text-why-foreground">
                <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sun text-sun-foreground">
                  <ArrowDown className="size-4" strokeWidth={2.75} />
                </span>
                See the difference for yourself with these two Allen, TX parks:
              </p>
            </div>
          </div>

          <div className="relative grid gap-2 [container-type:inline-size] md:grid-cols-2 md:gap-8 lg:gap-12">
            <ParkTicket park={TWO_PARKS[0]} />
            <span
              aria-hidden="true"
              className="z-10 mx-auto flex size-11 rotate-[-8deg] items-center justify-center rounded-full bg-sun font-heading text-lg font-extrabold text-sun-foreground shadow-[0_10px_30px_-8px_rgb(5_30_14/0.6)] ring-4 ring-why md:absolute md:top-[calc((100cqw-2rem)*0.21875)] md:left-1/2 md:size-14 md:-translate-x-1/2 md:-translate-y-1/2 md:text-xl lg:top-[calc((100cqw-3rem)*0.1875)] lg:size-16 lg:text-2xl"
            >
              vs
            </span>
            <ParkTicket park={TWO_PARKS[1]} />
          </div>

          <p className="-mt-2 max-w-[75ch] text-[13px] leading-snug text-why-muted sm:text-sm" data-testid="two-parks-source">
            {TWO_PARKS_SOURCE}
          </p>
        </div>
      </div>
    </section>
  );
}
