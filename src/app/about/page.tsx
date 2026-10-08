import {
  ArrowRight,
  BadgeCheck,
  Check,
  CircleAlert,
  Cpu,
  Database,
  FileText,
  Code2,
  Lock,
  Scale,
  ShieldCheck,
  Table2,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { EvalTable } from "@/components/about/EvalTable";
import { PhotoCreditLine } from "@/components/home/PhotoCredits";
import { buttonClassName } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { OpenOnHash } from "@/components/ui/OpenOnHash";
import { PARK_PHOTOS } from "@/data/photo-credits";
import {
  EVAL_RUN_ID,
  GEMMA_COPY,
  PRIVACY_NOTES,
  accountNotes,
  PRIVACY_POINTS,
  privacyRows,
  WHY_OPEN_POINTS,
  WEATHER_SOURCES,
  TRIP_TIPS_ABOUT,
  aboutLimitPoints,
  aboutLimits,
  aboutStatTiles,
  selfHostDetail,
  dataSources,
} from "@/lib/about/content";
import { CLOSED_MODELS_403_DAY, EVAL_COLUMNS, EVAL_DAY, EVAL_PARKS, EVAL_SUMMARY_FILE, EVAL_TOTAL_USD, GEMMA_RUN_COUNTS, SELFHOST, evalColumn } from "@/lib/about/eval-summary";
import { ILLUSTRATION_CREDIT } from "@/lib/illustrations";
import { configuredModelId } from "@/lib/model";
import { BUILT_WITH_LLAMA, isLlamaModel } from "@/lib/pass/format";
import { BLOCKED_TAXA } from "@/lib/safety/danger-taxa";
import { REPO_URL } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "About Grass Pass: an open model, a real park and a pencil",
  description:
    "Gemma 4, an open-weight model, writes each Grass Pass from one park's real data: OpenStreetMap, iNaturalist, Wikipedia and Google review counts (SerpApi). Code checks every clue. What we measured (misses included), what leaves your device, and every credit.",
};

const gemma = evalColumn("gemma-4-31B-it");
const template = evalColumn("no-AI template");
const resultsUrl = `${REPO_URL}/blob/main/${EVAL_SUMMARY_FILE}`;
const ext = "font-semibold text-link underline underline-offset-2";
const bandLink = "font-semibold text-band-foreground underline underline-offset-2";

function Eyebrow({ children, onBand = false }: { children: ReactNode; onBand?: boolean }) {
  return <p className={`text-xs font-bold tracking-widest uppercase ${onBand ? "text-sun" : "text-primary"}`}>{children}</p>;
}

function Pill({ children, className = "bg-muted text-ink" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${className}`}>{children}</span>;
}

export default function AboutPage() {
  // Llama 4 Community Licence: show "Built with Llama" whenever the server is set to answer with a Llama model.
  const servingLlama = isLlamaModel(configuredModelId());
  const tiles = aboutStatTiles();
  const sources = dataSources();
  return (
    <main id="main" tabIndex={-1} className="flex w-full flex-1 flex-col focus:outline-none">
      <OpenOnHash />

      {/* 1. Hero: one promise, two ways in. */}
      <section aria-labelledby="about-title" className="grain">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 pt-14 pb-16 md:px-8 lg:pt-20 lg:pb-20">
          <Eyebrow>About</Eyebrow>
          <h1 id="about-title" className="-mt-2 text-5xl leading-[0.95] font-extrabold tracking-tighter text-balance text-ink sm:text-6xl lg:text-7xl">
            An open model, a real park and a pencil.
          </h1>
          <p className="max-w-[60ch] text-xl leading-relaxed text-pretty">
            A one-page treasure hunt for a <em>real</em> park. Gemma 4, an open-weight model, writes clues from its map and recent
            wildlife sightings. Code checks each one. The finding happens on paper.
          </p>
          <ul aria-label="Grass Pass in four facts" className="flex flex-wrap gap-2">
            <li>
              <Pill className="bg-ink text-on-ink">Gemma 4 · Apache-2.0</Pill>
            </li>
            <li>
              <Pill>4 real data sources</Pill>
            </li>
            <li>
              <Pill>No ads, no analytics</Pill>
            </li>
            <li>
              <Pill className="bg-sun text-sun-foreground">MIT open source</Pill>
            </li>
          </ul>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link className={buttonClassName("primary", "group")} href="/how-it-works">
              See how a pass is made
              <ArrowRight aria-hidden="true" className="size-5 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" />
            </Link>
            <Link className={buttonClassName("secondary")} href="/" prefetch={false}>
              Make a pass
            </Link>
          </div>
        </div>
      </section>

      {/* 2. Stat tiles: real measured numbers, misses marked. */}
      <section id="measured" aria-labelledby="measured-title" className="gp-band scroll-mt-28 bg-band text-band-foreground sm:scroll-mt-16">
        <div className="mx-auto flex max-w-7xl flex-col gap-10 px-5 py-20 md:px-8 lg:py-24">
          <div className="grid gap-5 lg:grid-cols-2 lg:items-end">
            <div className="flex flex-col gap-4">
              <Eyebrow onBand>What we measured</Eyebrow>
              <h2 id="measured-title" className="text-4xl leading-[1] font-extrabold tracking-tight text-balance sm:text-5xl">
                Measured, not promised.
              </h2>
            </div>
            <p className="max-w-[55ch] text-band-muted">
              Gemma 4 on {EVAL_PARKS} real parks, ages 6-10, {gemma.runs} runs ({GEMMA_RUN_COUNTS.passes} passes), run <code>{EVAL_RUN_ID}</code> ({EVAL_DAY}). Misses
              stay on the page.{" "}
              <a className={bandLink} href={resultsUrl}>
                Full results
              </a>
            </p>
          </div>
          <ul aria-label="Measured results" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {tiles.map((t) => (
              <li key={t.label} className="flex min-w-0 flex-col gap-3 rounded-3xl bg-band-foreground/[0.06] p-4 ring-1 ring-band-foreground/10 sm:p-6">
                <p className="flex flex-col gap-1">
                  <span className="font-heading text-[1.6rem] leading-none font-extrabold tracking-tight break-words text-sun min-[400px]:text-3xl sm:text-5xl">{t.value}</span>
                  <span className="text-sm text-band-muted">{t.label}</span>
                </p>
                <p className="mt-auto flex flex-wrap items-center gap-2 text-xs">
                  {t.met === null ? (
                    <Pill className="bg-band-foreground/10 text-band-foreground">
                      <BadgeCheck aria-hidden="true" className="mr-1 size-3.5" />
                      Counted
                    </Pill>
                  ) : t.met ? (
                    <Pill className="bg-primary text-primary-foreground">
                      <Check aria-hidden="true" className="mr-1 size-3.5" />
                      Met
                    </Pill>
                  ) : (
                    <Pill className="bg-sun text-sun-foreground">
                      <X aria-hidden="true" className="mr-1 size-3.5" />
                      Missed
                    </Pill>
                  )}
                  <span className="text-band-muted">
                    {t.met === null ? t.target : `target ${t.target}`}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 3. The five cards. */}
      <section aria-labelledby="inside-title" className="scroll-mt-28 sm:scroll-mt-16">
        <div className="mx-auto flex max-w-7xl flex-col gap-10 px-5 py-20 md:px-8 lg:py-24">
          <div className="flex max-w-2xl flex-col gap-4">
            <Eyebrow>In one look</Eyebrow>
            <h2 id="inside-title" className="text-4xl leading-[1] font-extrabold tracking-tight text-balance text-ink sm:text-5xl">
              Open model. Real data. Rules in code.
            </h2>
          </div>

          <div className="grid gap-5 md:grid-cols-6">
            <article id="why-open" aria-labelledby="card-model" className="flex scroll-mt-28 flex-col gap-5 rounded-3xl bg-primary p-7 text-primary-foreground sm:scroll-mt-20 md:col-span-3 lg:p-9">
              <div className="flex items-center justify-between gap-3">
                <Cpu className="size-8" aria-hidden="true" />
                <Pill className="bg-black/20 text-primary-foreground">Open model</Pill>
              </div>
              <h3 id="card-model" className="text-3xl leading-tight font-extrabold">
                Gemma 4 writes the clues
              </h3>
              <p className="leading-relaxed">
                <code>gemma-4-31B-it</code> on DigitalOcean serverless inference (US). One to three calls per pass for the clues, plus one for the trip tips.
              </p>
              <ul aria-label="Model facts" className="flex flex-wrap gap-2">
                <li>
                  <Pill className="bg-paper text-ink">Apache-2.0</Pill>
                </li>
                <li>
                  <Pill className="bg-paper text-ink">Open weights</Pill>
                </li>
                <li>
                  <Pill className="bg-paper text-ink">Runs on DigitalOcean</Pill>
                </li>
              </ul>
              <ul className="mt-auto flex flex-col gap-2">
                {WHY_OPEN_POINTS.map((p) => (
                  <li key={p} className="flex gap-2">
                    <Check aria-hidden="true" className="mt-1 size-4 shrink-0" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              {servingLlama ? (
                <p className="rounded-2xl bg-paper p-3 text-ink">
                  <strong data-testid="built-with-llama">{BUILT_WITH_LLAMA}</strong>: this site is set to use a Llama model right now.
                </p>
              ) : null}
            </article>

            <article aria-labelledby="card-data" className="flex flex-col gap-5 rounded-3xl bg-card p-7 ring-1 ring-border md:col-span-3 lg:p-9">
              <div className="flex items-center justify-between gap-3">
                <Database className="size-8 text-primary" aria-hidden="true" />
                <Pill>Real data</Pill>
              </div>
              <h3 id="card-data" className="text-3xl leading-tight font-extrabold text-ink">
                Four real sources, dated
              </h3>
              <ul className="flex flex-col divide-y divide-border">
                {sources.map((s) => (
                  <li key={s.name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
                    <span className="flex flex-col">
                      <a className={ext} href={s.url}>
                        {s.name}
                      </a>
                      <span className="text-sm text-muted-foreground">{s.gives}</span>
                    </span>
                    <Pill>{s.licence}</Pill>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">
                No data? We say <strong className="text-ink">&quot;No data available&quot;</strong> and why. We never
                pad the list.
              </p>
            </article>

            <article aria-labelledby="card-safety" className="flex flex-col gap-4 rounded-3xl bg-card p-7 ring-1 ring-border md:col-span-2">
              <ShieldCheck className="size-7 text-primary" aria-hidden="true" />
              <h3 id="card-safety" className="text-2xl font-extrabold text-ink">
                Safety by code
              </h3>
              <ul className="flex flex-col gap-2 text-muted-foreground">
                <li>{BLOCKED_TAXA.length} risky groups are never printed, checked before and after the model.</li>
                <li>Every clue quotes its source word for word.</li>
                <li>Code writes every number, date and safety line.</li>
              </ul>
            </article>

            <article id="privacy" aria-labelledby="card-privacy" className="gp-band flex scroll-mt-28 flex-col gap-4 rounded-3xl bg-band p-7 text-band-foreground sm:scroll-mt-20 md:col-span-2">
              <Lock className="size-7 text-sun" aria-hidden="true" />
              <h3 id="card-privacy" className="text-2xl font-extrabold">
                Privacy
              </h3>
              <ul className="flex flex-col gap-2">
                {PRIVACY_POINTS.map((p) => (
                  <li key={p} className="flex gap-2 text-band-muted">
                    <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-sun" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <a className={`${bandLink} mt-auto text-sm`} href="#privacy-table">
                Everything that leaves your device
              </a>
            </article>

            <article id="limits" aria-labelledby="card-limits" className="flex scroll-mt-28 flex-col gap-4 rounded-3xl bg-sun p-7 text-sun-foreground sm:scroll-mt-20 md:col-span-2">
              <TriangleAlert className="size-7" aria-hidden="true" />
              <h3 id="card-limits" className="text-2xl font-extrabold">
                Honest limits
              </h3>
              <ul className="flex list-disc flex-col gap-2 pl-5">
                {aboutLimitPoints().map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <a className="mt-auto text-sm font-semibold underline underline-offset-2" href="#limits-detail">
                Every limit, with the numbers
              </a>
            </article>
          </div>
        </div>
      </section>

      {/* 4. Details on demand: everything else, folded. */}
      <section aria-labelledby="details-title" className="scroll-mt-28 bg-muted/70 sm:scroll-mt-16">
        <div className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-20 md:px-8 lg:py-24">
          <div className="flex flex-col gap-4">
            <Eyebrow>The fine print</Eyebrow>
            <h2 id="details-title" className="text-4xl leading-[1] font-extrabold tracking-tight text-balance text-ink sm:text-5xl">
              Details, one click away.
            </h2>
          </div>

          <Disclosure id="measured-table" icon={Table2} title="Why open: the full measured table" hint="Gemma 4, Llama 4 and a no-AI template, side by side">
            <p>
              <strong>In short:</strong> the real pass builder made passes for {EVAL_PARKS} real parks with each model, and we
              counted how often the clues were safe, true to the data, complete, easy to read, quick and cheap. Failures stay
              in (
              <a className={ext} href={resultsUrl}>
                full results
              </a>
              ; the run cost ${EVAL_TOTAL_USD.toFixed(2)}). The last column is the goal we set before the test. Gemma&apos;s clues
              read at grade {gemma.fkGrade.toFixed(1)}, the no-AI template&apos;s at {template.fkGrade.toFixed(1)}.
            </p>
            <EvalTable columns={EVAL_COLUMNS} />
            <p>
              No closed model was compared: we chose open models only, and the closed models on our DigitalOcean account
              answered &quot;403 Forbidden&quot; on {CLOSED_MODELS_403_DAY}. Switching models is one setting (<code>MODEL_ID</code>).
            </p>
            <p>
              <strong>Run it yourself (measured, a separate small test):</strong> {selfHostDetail()} Setup, every number and how to
              repeat it:{" "}
              <a className={ext} href={`${REPO_URL}/blob/main/${SELFHOST.notes}`}>
                self-host notes
              </a>
              .
            </p>
          </Disclosure>

          <Disclosure id="limits-detail" icon={CircleAlert} title="What did not pass yet (current limitations)" hint="Every miss, with the numbers">
            <ul className="flex list-disc flex-col gap-2 pl-6">
              {aboutLimits().map((l) => (
                <li key={l.title}>
                  <strong>{l.title}</strong> {l.detail}
                </li>
              ))}
            </ul>
          </Disclosure>

          <Disclosure id="privacy-table" icon={Lock} title="Privacy: what leaves your device" hint="What, where and why">
            <div className="overflow-x-auto rounded-2xl bg-card ring-1 ring-border" role="region" aria-labelledby="privacy-caption" tabIndex={0}>
              <table className="w-full min-w-[560px] border-collapse text-left text-base">
                <caption id="privacy-caption" className="px-4 pt-3 pb-2 text-left font-bold">
                  Everything that leaves your device, where it goes and why
                </caption>
                <thead>
                  <tr className="border-b-2 border-line">
                    <th scope="col" className="px-4 py-2">
                      What
                    </th>
                    <th scope="col" className="px-4 py-2">
                      Where it goes
                    </th>
                    <th scope="col" className="px-4 py-2">
                      Why
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {privacyRows().map((r) => (
                    <tr key={r.what} className="border-b border-line last:border-b-0">
                      <th scope="row" className="px-4 py-2 font-semibold">
                        {r.what}
                      </th>
                      <td className="px-4 py-2">{r.where}</td>
                      <td className="px-4 py-2">{r.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {PRIVACY_NOTES.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </Disclosure>

          <Disclosure id="accounts" icon={UserRound} title="Accounts and visitor reports" hint="New passes need sign-in (2 a day). Judges: Try as a judge.">
            {accountNotes().map((n) => (
              <p key={n}>{n}</p>
            ))}
          </Disclosure>

          <Disclosure id="sources-detail" icon={Database} title="Data sources and their licences" hint="How far, how recent, what we keep">
            <ul className="flex flex-col gap-3">
              {sources.map((s) => (
                <li key={s.name}>
                  <a className={ext} href={s.url}>
                    {s.name}
                  </a>{" "}
                  <span className="text-sm text-muted-foreground">({s.licence})</span>: {s.detail}
                </li>
              ))}
            </ul>
            <p className="font-semibold">Weather on the pass page (the card&apos;s words are written by code):</p>
            <ul className="flex flex-col gap-3" data-testid="weather-sources">
              {WEATHER_SOURCES.map((s) => (
                <li key={s.name}>
                  <a className={ext} href={s.url}>
                    {s.name}
                  </a>{" "}
                  <span className="text-sm text-muted-foreground">({s.licence})</span>: {s.detail}
                </li>
              ))}
            </ul>
            <p data-testid="trip-tips-about">{TRIP_TIPS_ABOUT}</p>
          </Disclosure>

          <Disclosure id="blocked" icon={ShieldCheck} title={`Never on a pass (${BLOCKED_TAXA.length} groups)`} hint="Removed before and after the model">
            <ul className="grid list-disc gap-x-8 gap-y-1 pl-6 sm:grid-cols-2">
              {BLOCKED_TAXA.map((t) => (
                <li key={t.id}>
                  {t.common} ({t.why})
                </li>
              ))}
            </ul>
            <p>
              Any other species whose own description says it is poisonous, toxic, venomous, stings or burns the skin is left off
              too, and a clue that uses one of those words is removed.
            </p>
            <p>Every Wild Find carries a fixed &quot;look, don&apos;t touch&quot; line written by code.</p>
          </Disclosure>
        </div>
      </section>

      {/* 5. Credits: photos visible as thumbnails, everything else folded. */}
      <section id="credits" aria-labelledby="credits-title" className="scroll-mt-28 sm:scroll-mt-16">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-20 md:px-8 lg:py-24">
          <div className="flex max-w-2xl flex-col gap-4">
            <Eyebrow>Thank you</Eyebrow>
            <h2 id="credits-title" className="text-4xl leading-[1] font-extrabold tracking-tight text-balance text-ink sm:text-5xl">
              Credits and licences
            </h2>
          </div>
          <ul aria-label="Park photo credits" data-testid="about-photo-credits" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Object.values(PARK_PHOTOS).map((p) => (
              <li key={p.src} className="flex gap-3 rounded-2xl bg-card p-3 ring-1 ring-border">
                <Image src={p.src} alt={p.alt} width={p.width} height={p.height} sizes="80px" className="size-20 shrink-0 rounded-xl object-cover" />
                <p className="min-w-0 text-sm leading-snug break-words">
                  <PhotoCreditLine photo={p} />
                </p>
              </li>
            ))}
          </ul>
          <p className="max-w-[65ch] text-sm text-muted-foreground">
            {ILLUSTRATION_CREDIT} It shows no real child or park.
          </p>

          <Disclosure id="all-credits" icon={FileText} title="All credits and licences" hint="Data, model, design, fonts, code">
            <ul className="flex list-disc flex-col gap-2 pl-6">
              <li>
                Park names, places and features: ©{" "}
                <a className={ext} href="https://www.openstreetmap.org/copyright">
                  OpenStreetMap
                </a>{" "}
                contributors, ODbL 1.0, through Nominatim and public Overpass API servers.
              </li>
              <li>
                Wildlife sightings and monarch counts:{" "}
                <a className={ext} href="https://www.inaturalist.org/">
                  iNaturalist
                </a>{" "}
                observers (names and counts only, no photos).
              </li>
              <li>Species summaries: Wikipedia (CC BY-SA), through the iNaturalist API.</li>
              <li data-testid="weather-credit">
                Weather on the pass page:{" "}
                <a className={ext} href="https://open-meteo.com/">
                  Weather data by Open-Meteo.com
                </a>{" "}
                (CC BY 4.0); official US alerts from the{" "}
                <a className={ext} href="https://www.weather.gov/">
                  National Weather Service
                </a>{" "}
                (api.weather.gov, US public domain).
              </li>
              <li>
                Lucky Finds: Google Maps review counts via{" "}
                <a className={ext} href="https://serpapi.com/">
                  SerpApi
                </a>{" "}
                (counts and months only, never review text or names).
              </li>
              <li>
                Clues and trip tips:{" "}
                <a className={ext} href="https://huggingface.co/google/gemma-4-31B-it">
                  Gemma 4 (gemma-4-31B-it)
                </a>
                , Apache-2.0, on DigitalOcean serverless inference.
              </li>
              <li>
                Eval comparison: Llama 4 Maverick (Llama 4 Community Licence), on DigitalOcean serverless inference. It answers
                visitors only if <code>MODEL_ID</code> is switched to it; passes then show &quot;{BUILT_WITH_LLAMA}&quot;.
              </li>
              <li>
                Site design (v3, Oct 6, 2026): designed by Kevin in v0 by Vercel and ported by hand. Oct 7, 2026 redesign (the home
                page sections and How it works diagram, the footer landscape, the Find This Spot map and the pass wizard with its
                animation): built by AI coding agents (Claude Code) at Kevin&apos;s direction; the footer art is code-drawn SVG, no
                stock art. Oct 8, 2026 (the weather card, the trip tips section, the phone layout and the sign-in page): also built by
                AI coding agents (Claude Code) at Kevin&apos;s direction; the home page text is Kevin&apos;s own. Logo sprout and all icons:{" "}
                <a className={ext} href="https://lucide.dev/">
                  Lucide
                </a>{" "}
                (ISC).
              </li>
              <li data-testid="copy-credit">
                Site copy: Gemma 4 redrafted {GEMMA_COPY.sent} blocks of this site&apos;s text; {GEMMA_COPY.shipped} of its drafts
                shipped ({GEMMA_COPY.edited} with small edits) after a code check and a review by an AI coding agent (Claude
                Code). Every block, old and new:{" "}
                <a className={ext} href={`${REPO_URL}/blob/main/docs/COPY-BY-GEMMA.md`}>
                  docs/COPY-BY-GEMMA.md
                </a>
                . Kevin&apos;s own lines are his.
              </li>
              <li>{ILLUSTRATION_CREDIT} It shows no real child or park.</li>
              <li>
                Printed pass logo: the original banner was made by Kevin with Google Gemini; the logo and scene are a traced,
                hand-cleaned SVG redraw of it. App icons and share images: the v3 logo, drawn as SVG by our own script.
              </li>
              <li>
                Fonts: Bricolage Grotesque and DM Sans (site), Fredoka and Nunito (printed pass), all SIL OFL 1.1, served from
                this site.
              </li>
              <li>
                App code: MIT. A few generic building blocks (model client, rate limits, request guards, in-flight
                de-duplication) were adapted from the same author&apos;s unpublished practice project, written on Oct 2, 2026,
                before the contest entry period. Everything specific to Grass Pass was written from Oct 5, 2026.
              </li>
            </ul>
          </Disclosure>

          <div id="source" className="flex flex-col gap-4 rounded-3xl bg-card p-7 ring-1 ring-border sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-ink text-on-ink">
                <Scale className="size-6" />
              </span>
              <h2 className="text-2xl leading-tight font-extrabold text-ink">Source code: open source (MIT)</h2>
            </div>
            <p className="flex flex-wrap gap-3">
              <a className={buttonClassName("secondary")} href={REPO_URL}>
                <Code2 aria-hidden="true" className="size-5" />
                Grass Pass on GitHub
              </a>
              <Link className={buttonClassName("primary")} href="/" prefetch={false}>
                Make a pass
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
