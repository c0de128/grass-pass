import Image from "next/image";
import { ArrowDown } from "lucide-react";
import { ButterflyIcon, HoopIcon } from "@/components/art/icons";
import { PARK_PHOTOS, photoCredit } from "@/data/photo-credits";

/**
 * "The problem" (Kevin's copy). History: 2026-10-07 a big logo-green ticket with a two-park "versus"; 2026-10-09 Kevin
 * found the dark green ticket overwhelming and picked option A "Calm and light": the same paper/soft-green family as
 * "What's a pass?" (eyebrow, heading and text styles, a light page, white cards with thin lines and a soft shadow).
 *
 * The numbers are real measurements from SPEC §1, taken on Oct 5, 2026 (iNaturalist research-grade species within
 * 1.5 km over 14 days; OpenStreetMap features inside the park), and the section says so. The unit charts draw the same
 * numbers, one mark per species / per field or court (SPEC §1: 25 soccer pitches, 4 tennis + 2 basketball courts).
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

/** One hue (the brand green); shape tells species (round) from fields (filled square) and courts (outlined square). */
const MARK = {
  dot: "size-2 shrink-0 rounded-full bg-primary",
  field: "size-2 shrink-0 rounded-[2px] bg-primary",
  court: "size-2 shrink-0 rounded-[2px] ring-[1.5px] ring-primary ring-inset",
} as const;

/** One mark per real thing counted; decorative (the numbers are in the text next to it). */
function UnitChart({ park }: { park: Park }) {
  const marks = park.marks.flatMap((m) => Array.from({ length: m.count }, () => m.shape));
  return (
    <div aria-hidden="true" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-[5px]">
        {marks.map((shape, n) => (
          <span key={n} className={`gp-why-mark ${MARK[shape]}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] leading-tight font-medium text-muted-foreground">
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

/** The verdict, word for word, with its one key word ("wild" / "built") in green. */
function Verdict({ park }: { park: Park }) {
  const at = park.verdict.indexOf(park.kind);
  if (at < 0) return <>{park.verdict}</>;
  return (
    <>
      {park.verdict.slice(0, at)}
      <span className="text-link">{park.kind}</span>
      {park.verdict.slice(at + park.kind.length)}
    </>
  );
}

function ParkCard({ park }: { park: Park }) {
  const pic = PARK_PHOTOS[park.slug];
  const Icon = park.kind === "wild" ? ButterflyIcon : HoopIcon;
  return (
    <article
      aria-labelledby={`two-${park.slug}`}
      className="gp-why-card group row-span-4 grid grid-rows-subgrid gap-0 rounded-[1.75rem] bg-card text-card-foreground"
      data-park={park.slug}
    >
      {/* 1. The park: a framed photo, its credit, its name. */}
      <div className="flex flex-col gap-4 p-2.5 pb-0">
        <div className="relative aspect-[16/7] overflow-hidden rounded-[1.3rem] bg-muted md:aspect-[2/1] lg:aspect-[21/9]">
          <Image
            src={pic.src}
            alt={pic.alt}
            width={pic.width}
            height={pic.height}
            sizes="(min-width: 1280px) 600px, (min-width: 768px) 46vw, 100vw"
            className="h-full w-full object-cover transition-transform duration-700 ease-out motion-safe:group-hover:scale-[1.03]"
          />
          {/* UX-6-04: plain text; the linked source and licence are in the one "Photo credits and licences" link. */}
          <span className="absolute right-2.5 bottom-2.5 rounded-full bg-paper/95 px-2.5 py-1 text-[11px] font-semibold text-ink">{photoCredit(pic)}</span>
        </div>
        <h3 id={`two-${park.slug}`} className="px-3.5 font-heading text-2xl leading-tight font-extrabold tracking-tight text-ink sm:px-4 lg:text-[1.7rem]">
          {park.name}
        </h3>
      </div>

      {/* 2. The big real number and its unit chart. */}
      <div className="flex flex-col gap-4 px-6 pt-4 pb-5 sm:px-6.5">
        <p className="flex items-end gap-4">
          <span className="font-heading text-7xl leading-[0.78] font-extrabold tracking-tighter text-link lg:text-8xl">{park.big.value}</span>
          <span className="max-w-[12rem] pb-0.5 text-[0.95rem] leading-snug font-semibold text-pretty">{park.big.label}</span>
        </p>
        <UnitChart park={park} />
      </div>

      {/* 3. What it does NOT have. */}
      <div className="px-6 sm:px-6.5">
        <p className="flex items-center gap-3 border-t border-border py-3.5 text-[0.95rem] text-muted-foreground">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-line font-heading text-base leading-none font-extrabold text-foreground">
            {park.small.value}
          </span>
          {park.small.label}
        </p>
      </div>

      {/* 4. The verdict. */}
      <div className="flex flex-col items-start gap-2.5 rounded-b-[1.75rem] border-t border-border bg-muted/45 px-6 pt-4 pb-5 sm:px-6.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-[11px] font-bold tracking-widest text-link uppercase ring-1 ring-border">
          <Icon className="size-3.5" />
          {park.hunt}
        </span>
        <p className="font-heading text-lg leading-snug font-bold text-balance text-ink lg:text-xl">
          <Verdict park={park} />
        </p>
      </div>
    </article>
  );
}

export function TwoParks() {
  return (
    <section id="why" aria-labelledby="why-title" className="scroll-mt-28 overflow-x-clip sm:scroll-mt-16">
      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-5 pt-16 pb-2 md:px-8 lg:gap-12 lg:pt-24 lg:pb-4">
        <div className="grid gap-5 lg:grid-cols-12 lg:items-end lg:gap-x-14">
          <div className="flex flex-col gap-4 lg:col-span-6">
            <p className="text-xs font-bold tracking-widest text-link uppercase">The problem</p>
            <h2 id="why-title" className="text-3xl leading-[1] font-extrabold tracking-tight text-balance text-ink sm:text-4xl lg:text-5xl">
              Why &ldquo;Find a pinecone&rdquo;{" "}
              <span className="relative inline-block whitespace-nowrap">
                fails.
                {/* A small sunflower swash under the word (decorative; it sits below the letters, never behind them). */}
                <svg aria-hidden="true" viewBox="0 0 200 20" preserveAspectRatio="none" className="absolute -bottom-[0.14em] left-0 h-[0.2em] w-full fill-sun">
                  <path d="M3 13 C 50 3, 120 3, 197 8 L 196 14 C 130 10, 60 12, 4 19 Z" />
                </svg>
              </span>
            </h2>
          </div>
          <div className="flex flex-col gap-4 lg:col-span-6">
            <p className="max-w-2xl text-base leading-relaxed text-pretty text-muted-foreground">
              Generic scavenger hunts fail because parks aren&rsquo;t generic. A manicured city park has basketball hoops; a
              rugged nature preserve has butterflies. That&rsquo;s why Grass Pass builds every adventure from scratch using your
              park&rsquo;s exact map and the last two weeks of local wildlife sightings.
            </p>
            <p className="flex items-center gap-2.5 text-base font-semibold text-balance text-ink">
              <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-mark text-mark-foreground">
                <ArrowDown className="size-4" strokeWidth={2.5} />
              </span>
              See the difference for yourself with these two Allen, TX parks:
            </p>
          </div>
        </div>

        <div className="relative isolate flex flex-col gap-5">
          {/* The hero's dotted grain behind the cards, fading out (decorative; as behind the "What's a pass?" sheet). */}
          <span aria-hidden="true" className="grain gp-why-grain pointer-events-none absolute -inset-x-5 -top-10 bottom-0 -z-10 sm:-inset-x-10" />
          <div className="grid grid-cols-1 gap-x-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-x-6">
            <ParkCard park={TWO_PARKS[0]} />
            <div aria-hidden="true" className="row-span-1 flex items-center justify-center py-3 md:row-span-4 md:py-0">
              <span className="flex size-11 items-center justify-center rounded-full bg-card font-heading text-base font-extrabold text-link italic ring-1 ring-border shadow-[0_6px_16px_-8px_var(--gp-shadow)]">
                vs
              </span>
            </div>
            <ParkCard park={TWO_PARKS[1]} />
          </div>

          <p className="text-[13px] leading-snug text-pretty text-muted-foreground sm:text-sm" data-testid="two-parks-source">
            {TWO_PARKS_SOURCE}
          </p>
        </div>
      </div>
    </section>
  );
}
