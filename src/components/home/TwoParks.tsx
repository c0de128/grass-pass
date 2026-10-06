import Image from "next/image";
import { PARK_PHOTOS, photoCredit } from "@/data/photo-credits";

/**
 * "Why generic hunts fail" (Kevin's v0 dark band). The numbers are real measurements from SPEC §1, taken on
 * Oct 5, 2026 (iNaturalist research-grade species within 1.5 km over 14 days; OpenStreetMap features inside
 * the park), and the band says so.
 */
export const TWO_PARKS = [
  {
    name: "Connemara Meadow",
    slug: "connemara",
    big: { value: "70", label: "wildlife species spotted in 2 weeks" },
    small: { value: "0", label: "playgrounds, courts or shelters" },
    verdict: "So its pass is wild: birds, bugs, blooms.",
  },
  {
    name: "Celebration Park",
    slug: "celebration",
    big: { value: "25", label: "soccer fields, plus 6 courts" },
    small: { value: "0", label: "recent wildlife sightings" },
    verdict: "So its pass is built: hoops, nets, a shelter.",
  },
] as const;

export const TWO_PARKS_SOURCE =
  "Measured Oct 5, 2026: iNaturalist (research-grade sightings within 1.5 km, last 14 days) and OpenStreetMap (features mapped inside each park).";

export function TwoParks() {
  return (
    <section id="why" aria-labelledby="why-title" className="gp-band scroll-mt-28 sm:scroll-mt-16 bg-band text-band-foreground">
      <div className="mx-auto flex max-w-7xl flex-col gap-14 px-5 py-24 md:px-8 lg:py-32">
        <div className="grid gap-6 lg:grid-cols-2 lg:items-end">
          <div className="flex flex-col gap-4">
            <p className="text-xs font-bold tracking-widest text-sun uppercase">Why generic hunts fail</p>
            <h2 id="why-title" className="text-4xl leading-[1] font-extrabold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              &ldquo;Find a pinecone&rdquo; doesn&apos;t work everywhere.
            </h2>
          </div>
          <p className="max-w-lg text-lg leading-relaxed text-pretty text-band-muted">
            We measured two parks in the same town, Allen, TX. They have almost nothing in common, so one printed list would
            fail both. Grass Pass gives each park its own pass: code collects what is really there, and Gemma picks a fair
            mix and writes the clues.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {TWO_PARKS.map((park) => {
            const pic = PARK_PHOTOS[park.slug];
            return (
              <article
                key={park.name}
                aria-labelledby={`two-${park.slug}`}
                className="group flex flex-col overflow-hidden rounded-3xl bg-band-foreground/[0.06] ring-1 ring-band-foreground/10"
              >
                <div className="relative aspect-[16/9] overflow-hidden">
                  <Image
                    src={pic.src}
                    alt={pic.alt}
                    width={pic.width}
                    height={pic.height}
                    sizes="(min-width: 1280px) 600px, (min-width: 768px) 45vw, 100vw"
                    className="h-full w-full object-cover transition-transform duration-700 motion-safe:group-hover:scale-105"
                  />
                  <h3 id={`two-${park.slug}`} className="absolute top-4 left-4 rounded-full bg-paper px-3 py-1 font-sans text-sm font-bold text-ink">
                    {park.name}
                  </h3>
                  <a
                    href={pic.sourceUrl}
                    className="absolute right-3 bottom-3 rounded-full bg-paper/95 px-2.5 py-1 text-[11px] font-semibold text-ink underline-offset-2 hover:underline"
                  >
                    {photoCredit(pic)}
                  </a>
                </div>
                <div className="flex flex-col gap-6 p-6 sm:p-8">
                  <div className="flex items-end gap-8">
                    <p className="flex flex-col">
                      <span className="font-heading text-7xl leading-none font-extrabold tracking-tighter text-sun sm:text-8xl">{park.big.value}</span>
                      <span className="mt-2 text-sm text-band-muted">{park.big.label}</span>
                    </p>
                    <p className="flex flex-col border-l border-band-foreground/15 pl-6">
                      <span className="font-heading text-4xl leading-none font-extrabold text-band-muted">{park.small.value}</span>
                      <span className="mt-2 text-sm text-band-muted">{park.small.label}</span>
                    </p>
                  </div>
                  <p className="font-heading text-xl font-bold">{park.verdict}</p>
                </div>
              </article>
            );
          })}
        </div>
        <p className="-mt-6 text-sm text-band-muted" data-testid="two-parks-source">
          {TWO_PARKS_SOURCE}
        </p>
      </div>
    </section>
  );
}
