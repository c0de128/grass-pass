import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { createElement, type ReactNode } from "react";
import { ButterflyIcon, MapXIcon } from "@/components/art/icons";
import { rowIcon } from "@/components/pass/KidPass";
import { STUB_LOOK_ONLY } from "@/components/pass/ParentStub";
import { mapDescription, SpotMapSvg } from "@/components/pass/SpotMap";
import type { AnatomyPart, NumberedFind, PassAnatomyData } from "@/lib/home/pass-anatomy";
import { octoberHeadline, shortDay } from "@/lib/october";
import { BLOCKED_TAXA, SAFETY_FOOTNOTE } from "@/lib/safety/danger-taxa";
import { drawMap } from "@/lib/spot/render-map";

/** Marker numbers, in the order the parts sit on a printed pass (top to bottom). */
const NUM: Record<AnatomyPart, number> = { park: 1, wild: 2, lucky: 3, spot: 4, october: 5, stub: 6 };
const NAME: Record<AnatomyPart, string> = {
  park: "Park Finds",
  wild: "Wild Finds",
  lucky: "Lucky Finds",
  spot: "Find This Spot",
  october: "October monarch box",
  stub: "The grown-up's tear-off stub",
};

/** "Finds 1–5" / "Find 6": the real row numbers of a group on the pass. */
function rowsLabel(f: readonly NumberedFind[]): string {
  if (f.length === 0) return "";
  const a = f[0].n;
  const b = f[f.length - 1].n;
  return a === b ? `Find ${a}` : `Finds ${a}–${b}`;
}

/** A numbered marker (the same green circle on the pass and in the list; the words beside it carry the meaning). */
function Mark({ part, className = "" }: { part: AnatomyPart; className?: string }) {
  return (
    <span aria-hidden="true" className={`gp-mark flex size-7 shrink-0 items-center justify-center rounded-full bg-mark font-heading text-sm font-extrabold text-mark-foreground ${className}`}>
      {NUM[part]}
    </span>
  );
}

/** One numbered region of the pass: the marker hangs off the sheet's left edge; screen readers hear the part's name. */
const HANG = "gp-region-mark absolute top-0 -left-[2.05rem] sm:-left-[2.1rem]";
/** A boxed part (the October box) sits beside the map on wide sheets: its marker pins the box's top-left corner. */
const CORNER = "gp-region-mark absolute -top-3 -left-3 z-10";

function Region({ part, children, className = "", corner = false }: { part: AnatomyPart; children: ReactNode; className?: string; corner?: boolean }) {
  return (
    <div className={`gp-region relative ${className}`} data-region={part}>
      <Mark part={part} className={corner ? CORNER : HANG} />
      <p className="sr-only">
        Part {NUM[part]}, {NAME[part]}:
      </p>
      {children}
    </div>
  );
}

function FindRow({ f }: { f: NumberedFind }) {
  return (
    <li className="flex items-start gap-2.5" data-testid="anatomy-find" data-section={f.section}>
      <span aria-hidden="true" className="mt-0.5 size-5 shrink-0 rounded-[4px] border-2 border-sheet-ink" />
      <span aria-hidden="true" className="mt-0.5 flex w-8 shrink-0 items-center gap-0.5 font-heading text-sm font-extrabold">
        {f.n}
        {createElement(rowIcon(f), { className: "size-3.5" })}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[0.95rem] leading-snug font-semibold">
          <span className="sr-only">Find {f.n}: </span>
          {f.clue}
        </span>
        <span className="text-xs leading-snug text-sheet-muted">
          {f.safety ? <strong className="font-bold text-sheet-ink">{f.safety} </strong> : null}({f.evidence})
        </span>
      </span>
    </li>
  );
}

/** The real pass, printed-style: every line read from the pinned file. */
function Sheet({ a }: { a: PassAnatomyData }) {
  const drawing = a.spot ? drawMap(a.spot.map, a.spot.walk) : null;
  return (
    <div className="gp-sheet relative rounded-2xl bg-sheet text-sheet-ink" data-testid="anatomy-sheet">
      <div className="flex flex-col gap-5 px-4 pt-5 pb-5 sm:px-7 sm:pt-7">
        {/* Head: the printed pass's 1-colour logo, the park, the day and the age band. */}
        <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2 border-b-2 border-sheet-ink pb-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a tiny static SVG; next/image adds nothing here */}
          <img src="/logo-print-1c.svg" alt="" width={140} height={32} loading="lazy" decoding="async" className="h-8 w-auto" />
          <p className="flex min-w-0 flex-col text-sm sm:text-right">
            <span className="font-heading text-base leading-tight font-extrabold text-balance">{a.parkName}</span>
            <span className="text-sheet-muted">
              {a.day} · {a.band}
            </span>
          </p>
        </div>
        <p className="-mt-2 text-sm font-semibold">Find these {a.total} things. Spot one? Tick its box!</p>

        {a.park.length > 0 ? (
          <Region part="park">
            <ol className="flex flex-col gap-2.5" aria-label={`${NAME.park}, ${rowsLabel(a.park)}`}>
              {a.park.map((f) => (
                <FindRow key={f.n} f={f} />
              ))}
            </ol>
          </Region>
        ) : null}
        {a.wild.length > 0 ? (
          <Region part="wild">
            <ol className="flex flex-col gap-2.5" aria-label={`${NAME.wild}, ${rowsLabel(a.wild)}`}>
              {a.wild.map((f) => (
                <FindRow key={f.n} f={f} />
              ))}
            </ol>
          </Region>
        ) : null}
        {a.lucky.length > 0 ? (
          <Region part="lucky">
            <ol className="flex flex-col gap-2.5" aria-label={`${NAME.lucky}, ${rowsLabel(a.lucky)}`}>
              {a.lucky.map((f) => (
                <FindRow key={f.n} f={f} />
              ))}
            </ol>
          </Region>
        ) : null}

        {a.spot || a.october ? (
          <div className="grid gap-5 border-t border-dashed border-sheet-line pt-5 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            {a.spot && drawing ? (
              <Region part="spot" className="sm:row-span-2">
                <div className="flex flex-col gap-2">
                  <div className="gp-anatomy-map overflow-hidden rounded-md">
                    <SpotMapSvg drawing={drawing} title={mapDescription(a.parkName, a.spot, drawing)} tone="color" />
                  </div>
                  <p className="flex items-center gap-1.5 text-sm font-extrabold">
                    <MapXIcon className="size-4" aria-hidden="true" /> Find This Spot
                  </p>
                  <p className="text-[0.95rem] leading-snug font-semibold italic" data-testid="anatomy-riddle">
                    &ldquo;{a.spot.riddle}&rdquo;
                  </p>
                </div>
              </Region>
            ) : null}
            {a.october ? (
              <Region part="october" className="self-start" corner>
                <div className="flex flex-col gap-1 rounded-md border-2 border-dashed border-sheet-ink py-3 pr-3 pl-5">
                  <p className="flex items-center gap-1.5 text-sm font-extrabold">
                    <ButterflyIcon className="size-4 shrink-0" aria-hidden="true" /> October special: monarch butterflies
                  </p>
                  <p className="text-sm" data-testid="anatomy-october">
                    {octoberHeadline(a.october)}
                  </p>
                </div>
              </Region>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* The tear line: two notches show the page behind, scissors on the left (decorative). */}
      <div aria-hidden="true" className="relative flex h-5 items-center px-4 sm:px-7">
        <span className="gp-sheet-notch absolute top-1/2 -left-2.5 size-5 -translate-y-1/2 rounded-full" />
        <span className="gp-sheet-notch absolute top-1/2 -right-2.5 size-5 -translate-y-1/2 rounded-full" />
        <span className="w-full border-t-2 border-dashed border-sheet-line" />
      </div>

      <div className="rounded-b-2xl px-4 pt-4 pb-6 sm:px-7">
        <Region part="stub">
          <div className="flex flex-col gap-3 text-xs leading-snug">
            <p className="font-heading text-sm font-extrabold">For the grown-up: answer key</p>
            <ol className="gap-x-5 sm:columns-2 [&>li]:mb-0.5 [&>li]:break-inside-avoid" aria-label="Answers">
              {a.answers.map((ans, i) => (
                <li key={i} className="min-w-0">
                  {i + 1}. {ans}
                </li>
              ))}
            </ol>
            <p>
              <strong className="font-bold">Safety.</strong> {STUB_LOOK_ONLY}
              {a.safetyFiltered > 0 ? ` ${SAFETY_FOOTNOTE}` : ""}
            </p>
            {a.notOnPass.length > 0 ? (
              <div className={a.has.lucky ? "" : "gp-region relative"} data-region={a.has.lucky ? undefined : "lucky"}>
                {a.has.lucky ? null : (
                  <>
                    <Mark part="lucky" className={HANG} />
                    <p className="sr-only">Part {NUM.lucky}, {NAME.lucky} (not on this pass):</p>
                  </>
                )}
                <p className="font-bold">Not on this pass</p>
                <ul className="flex flex-col gap-0.5 text-sheet-muted">
                  {a.notOnPass.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <p className="font-bold">Where this came from</p>
              <ul className="flex flex-col gap-0.5 text-sheet-muted">
                {a.sources.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
        </Region>
      </div>
    </div>
  );
}

/** A tiny bar pair from the pass's real monarch counts (the numbers are printed beside the bars). */
function MonarchBars({ box }: { box: NonNullable<PassAnatomyData["october"]> }) {
  const max = Math.max(box.thisYear.count, box.lastYear.count, 1);
  const rows = [
    { label: `${shortDay(box.thisYear.d1)}–${shortDay(box.thisYear.d2)}, ${box.thisYear.d1.slice(0, 4)}`, n: box.thisYear.count, now: true },
    { label: `Same days, ${box.lastYear.d1.slice(0, 4)}`, n: box.lastYear.count, now: false },
  ];
  return (
    <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-xs" data-testid="anatomy-monarch-bars">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="flex items-center gap-2">
            <span aria-hidden="true" className={`h-2.5 rounded-full ${r.now ? "bg-mark" : "bg-line/60"}`} style={{ width: `${Math.max(4, (r.n / max) * 100)}%` }} />
            <span className="font-bold text-foreground">{r.n}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

type LegendItem = { part: AnatomyPart; source: string; where: string | null; body: ReactNode; extra?: ReactNode; missing?: string | null };

/**
 * "What's a pass?" (Kevin's option A "Show a real pass", 2026-10-08): ONE real pinned example pass, printed-style, with
 * numbered parts and a numbered list that names each part. Every line on the pass is read from the pinned file
 * (src/lib/home/pass-anatomy.ts); a part the pass doesn't have says "when the data has it", never a made-up clue.
 * Facts checked against the app: blocked species are never printed; every Wild Find carries a fixed look-only safety
 * line; Lucky Finds need >= 3 Google Maps reviews from the last 2 years via SerpApi, else they are left off with a reason.
 */
export function PassAnatomy({ anatomy: a }: { anatomy: PassAnatomyData | null }) {
  const has = (p: AnatomyPart) => (a ? a.has[p] : false);
  const whenData = "When the data has it";
  const items: LegendItem[] = [
    {
      part: "park",
      source: "OpenStreetMap",
      where: a && a.park.length > 0 ? rowsLabel(a.park) : null,
      body: (
        <>
          Hoops, bridges and playgrounds pulled from OpenStreetMap. Code adds real counts, like &ldquo;2 basketball courts.&rdquo;
        </>
      ),
      missing: has("park") ? null : whenData,
    },
    {
      part: "wild",
      source: "iNaturalist · last 14 days",
      where: a && a.wild.length > 0 ? rowsLabel(a.wild) : null,
      body: <>Real birds, bugs and blooms photographed within 1.5 km of the park in the last 14 days. Gemma quotes the source for each find, and code checks it word for word.</>,
      extra: (
        <p className="text-sm leading-relaxed text-muted-foreground">
          <strong className="font-bold text-foreground">Safety built in.</strong> Venomous snakes, poison ivy, stinging bugs and more ({BLOCKED_TAXA.length} risky
          groups in all) are never printed. Every Wild Find carries a look-only safety line, like &ldquo;look, don&apos;t touch.&rdquo;
          {a && a.safetyFiltered > 0 ? ` On this pass, ${a.safetyFiltered} nearby ${a.safetyFiltered === 1 ? "sighting was" : "sightings were"} left off for safety.` : ""}
        </p>
      ),
      missing: has("wild") ? null : whenData,
    },
    {
      part: "lucky",
      source: "Google reviews via SerpApi",
      where: has("lucky") && a ? rowsLabel(a.lucky) : a ? "see the stub’s “Not on this pass” list" : null,
      body: <>Maybe-sightings, like dogs or bikes, mentioned in at least 3 Google Maps reviews from the last 2 years. SerpApi counts them. No proof? The pass leaves them off and says why.</>,
      missing: has("lucky") ? null : whenData,
    },
    {
      part: "spot",
      source: "OpenStreetMap + Gemma",
      where: has("spot") ? "under the finds" : null,
      body: <>Code draws a simple map with a START and an X. Gemma writes a riddle to help the kids find the spot.</>,
      missing: has("spot") ? null : whenData,
    },
    {
      part: "october",
      source: "iNaturalist · Sept 15 to Nov 15",
      where: has("october") ? "after the map" : null,
      body: <>Code counts nearby monarchs from the last 14 days versus the same days last year. It prints the real number, even if it is zero.</>,
      extra: a?.october ? <MonarchBars box={a.october} /> : null,
      missing: has("october") ? null : whenData,
    },
    {
      part: "stub",
      source: "Code-written",
      where: a ? "below the dashed line" : null,
      body: <>Tear it off and keep it: the answers, the safety notes, what&apos;s missing and why, and every source with its date.</>,
    },
  ];

  return (
    <section id="pass" aria-labelledby="pass-title" className="gp-anatomy scroll-mt-28 bg-muted/70 sm:scroll-mt-16">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 md:px-8 lg:grid-cols-12 lg:gap-x-14 lg:gap-y-10 lg:py-24">
        <div className="flex flex-col gap-4 lg:col-span-5 lg:col-start-8 lg:row-start-1">
          <p className="text-xs font-bold tracking-widest text-link uppercase">What&apos;s a pass?</p>
          <h2 id="pass-title" className="text-3xl leading-[1] font-extrabold tracking-tight text-balance text-ink sm:text-4xl lg:text-5xl">
            Proof in every clue.
          </h2>
          <p className="max-w-lg text-base leading-relaxed text-pretty text-muted-foreground">
            Every clue comes from a real, dated source, listed on the grown-up&apos;s stub. So nobody spends 40 minutes hunting
            for a heron that flew off in 2019.
          </p>
        </div>

        <figure className="relative isolate flex flex-col gap-4 pl-6 sm:pl-9 lg:col-span-7 lg:col-start-1 lg:row-span-2 lg:row-start-1" data-testid="anatomy-figure">
          {a ? (
            <>
              <span aria-hidden="true" className="grain gp-anatomy-grain pointer-events-none absolute -inset-x-5 -top-8 bottom-10 -z-10 sm:-inset-x-10" />
              <Sheet a={a} />
              <figcaption className="text-sm text-pretty text-muted-foreground" data-testid="anatomy-caption">
                <strong className="font-semibold text-foreground">A real pass:</strong> {a.parkName}
                {a.place ? `, ${a.place}` : ""}, made {a.madeAt} from that day&apos;s data. Shown as printed, nothing added.{" "}
                <Link href={a.href} prefetch={false} className="inline-flex min-h-11 items-center gap-0.5 font-semibold whitespace-nowrap text-link underline underline-offset-4">
                  See the whole pass
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </Link>
              </figcaption>
            </>
          ) : (
            <p className="rounded-2xl border-2 border-dashed border-line p-6 text-muted-foreground" data-testid="anatomy-no-data">
              No data available: the saved example pass couldn&apos;t be loaded, so there is no real pass to show here. The list
              explains each part.
            </p>
          )}
        </figure>

        <ol className="flex flex-col md:grid md:grid-cols-2 md:gap-x-10 lg:col-span-5 lg:col-start-8 lg:row-start-2 lg:flex" aria-label="The parts of a pass" data-testid="anatomy-legend">
          {items.map((it) => (
            <li key={it.part} className="gp-legend-item flex gap-4 border-t border-border py-5 first:border-t-0 first:pt-0 md:nth-2:border-t-0 md:nth-2:pt-0 lg:nth-2:border-t lg:nth-2:pt-5" data-legend={it.part} data-has={it.missing ? "false" : "true"}>
              <Mark part={it.part} className={`mt-0.5 ${it.missing ? "gp-mark-off" : ""}`} />
              <div className="flex min-w-0 flex-col gap-1.5">
                <h3 className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-heading text-lg leading-tight font-extrabold text-ink">
                  {NAME[it.part]}
                  <span className="text-xs font-semibold tracking-wide text-muted-foreground">{it.source}</span>
                </h3>
                {it.missing ? (
                  <p className="w-fit rounded-full border border-dashed border-line px-2.5 py-0.5 text-xs font-semibold text-muted-foreground" data-testid="anatomy-when-data">
                    {it.missing}
                  </p>
                ) : null}
                {it.where ? (
                  <p className="text-sm font-bold text-link">
                    {it.missing ? "Not on this example: " : "On this pass: "}
                    {it.where}
                  </p>
                ) : null}
                <p className="text-[0.95rem] leading-relaxed text-pretty text-muted-foreground">{it.body}</p>
                {it.extra}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
