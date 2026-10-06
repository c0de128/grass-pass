import {
  ArrowRight,
  Bot,
  Check,
  Code2,
  Database,
  Gauge,
  Hammer,
  ListChecks,
  Lock,
  MapPinned,
  PenLine,
  Printer,
  RotateCcw,
  Scale,
  Search,
  ShieldCheck,
  Smartphone,
  Timer,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClassName } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { OpenOnHash } from "@/components/ui/OpenOnHash";
import { EVAL_RUN_ID, howLimits, howPrivacyPoints, pct, secs, usd } from "@/lib/about/content";
import { ACCOUNT_PASSES_PER_DAY, judgeDailyCap } from "@/lib/accounts/config";
import { REPORT_COPY } from "@/lib/reports/kinds";
import { EVAL_DAY, EVAL_PARKS, EVAL_SUMMARY_FILE, EVAL_THRESHOLDS, SMOKE_10_13, evalColumn } from "@/lib/about/eval-summary";
import { DROP_REASONS } from "@/lib/ai/validate";
import { DROP_REASON_INFO } from "@/lib/how/drop-reasons";
import { limitsConfig } from "@/lib/limits/config";
import { serpapiCaps } from "@/lib/limits/serpapi";
import { configuredModelId, modelTimeoutMs } from "@/lib/model";
import { MILKWEED_RADIUS_KM, MONARCH_RADIUS_KM, OCTOBER_WINDOW_LABEL } from "@/lib/october";
import { AGE_BAND_INFO, MAX_VARIANTS } from "@/lib/pass/schema";
import { MIN_MENTIONS } from "@/lib/pool/lucky";
import { BLOCKED_TAXA } from "@/lib/safety/danger-taxa";
import { WILD_RADIUS_KM, WILD_WINDOW_DAYS } from "@/lib/sources/inat";
import { WINDOW_MONTHS } from "@/lib/sources/serpapi";
import { REPO_URL } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "How Grass Pass works: the data, the open model and the checks",
  description:
    "Step by step: how Grass Pass turns real park data into a printable kids' pass with one call to the open Gemma 4 model, what the AI does and doesn't do, what code checks, and what we measured.",
};

const ext = "font-semibold text-primary underline underline-offset-2";
const bandLink = "font-semibold text-band-foreground underline underline-offset-2";

const gemma = evalColumn("gemma-4-31B-it");
const template = evalColumn("no-AI template");
const resultsUrl = `${REPO_URL}/blob/main/${EVAL_SUMMARY_FILE}`;
const smokeUrl = `${REPO_URL}/blob/main/${SMOKE_10_13.summary}`;
const smokeId = SMOKE_10_13.summary.replace(/^evals\/results\//, "").replace(/\.md$/, "");

/** A full-width band with the v3 section head (eyebrow + big title), like the home page. */
function Band({
  id,
  eyebrow,
  title,
  tone = "plain",
  width = "max-w-5xl",
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  tone?: "plain" | "muted" | "dark";
  width?: string;
  children: ReactNode;
}) {
  const bg = tone === "dark" ? "gp-band bg-band text-band-foreground" : tone === "muted" ? "bg-muted/70" : "";
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`scroll-mt-28 sm:scroll-mt-16 ${bg}`}>
      <div className={`mx-auto flex ${width} flex-col gap-8 px-5 py-16 md:px-8 lg:py-20`}>
        <div className="flex max-w-3xl flex-col gap-3">
          <p className={`text-xs font-bold tracking-widest uppercase ${tone === "dark" ? "text-sun" : "text-primary"}`}>{eyebrow}</p>
          <h2
            id={`${id}-title`}
            className={`text-4xl leading-[1] font-extrabold tracking-tight text-balance sm:text-5xl ${tone === "dark" ? "" : "text-ink"}`}
          >
            {title}
          </h2>
        </div>
        {children}
      </div>
    </section>
  );
}

type Who = "code" | "model" | "you";
const WHO_LABEL: Record<Who, string> = { code: "Done by code", model: "Done by the open model", you: "Done by you" };
const WHO_CLASS: Record<Who, string> = {
  code: "bg-muted text-foreground",
  model: "bg-sun text-sun-foreground",
  you: "bg-primary text-primary-foreground",
};

/** A step: one short visible summary, and the full detail folded under it. */
type Step = { id: string; icon: LucideIcon; who: Who; title: string; summary: ReactNode; more?: ReactNode };

function Steps({ steps }: { steps: readonly Step[] }) {
  return (
    <ol aria-label="How a pass is made, step by step" className="relative flex flex-col gap-5">
      {steps.map((s, i) => (
        <li key={s.id} id={`step-${s.id}`} className="relative flex scroll-mt-28 gap-4 sm:scroll-mt-20 sm:gap-5">
          {/* The connecting line of the diagram (decorative): down the icon rail from 640 px, between the cards on phones. */}
          {i < steps.length - 1 ? (
            <>
              <span aria-hidden="true" className="absolute top-14 bottom-[-1.25rem] left-7 hidden w-0.5 -translate-x-1/2 bg-line sm:block" />
              <span aria-hidden="true" className="absolute bottom-[-1.25rem] left-1/2 h-5 w-0.5 -translate-x-1/2 bg-line sm:hidden" />
            </>
          ) : null}
          <span
            aria-hidden="true"
            className={`relative z-10 hidden size-14 shrink-0 items-center justify-center rounded-2xl sm:flex ${s.who === "model" ? "bg-sun text-sun-foreground" : "bg-ink text-on-ink"}`}
          >
            <s.icon className="size-6" />
          </span>
          <div
            className={`flex min-w-0 flex-1 flex-col gap-3 rounded-3xl bg-card p-5 sm:p-6 ${s.who === "model" ? "shadow-xl shadow-shadow ring-2 ring-sun" : "ring-1 ring-border"}`}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink text-on-ink sm:hidden">
                <s.icon className="size-5" />
              </span>
              <h3 className="text-xl leading-tight font-extrabold text-ink">
                <span className="text-muted-foreground">Step {i + 1}.</span> {s.title}
              </h3>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${WHO_CLASS[s.who]}`}>{WHO_LABEL[s.who]}</span>
            </div>
            <p className="max-w-[65ch] leading-relaxed text-card-foreground">{s.summary}</p>
            {s.more ? (
              <Disclosure tone="inset" level={4} title={`More on step ${i + 1}: ${s.title.toLowerCase()}`}>
                {s.more}
              </Disclosure>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

const bullets = "flex list-disc flex-col gap-1.5 pl-5";

const QUICK: readonly { icon: LucideIcon; title: string; body: string }[] = [
  { icon: MapPinned, title: "Pick a park", body: "A grown-up picks a real park and the child's age (4-6, 6-10 or 10-13)." },
  {
    icon: Database,
    title: "Read real data",
    body: `That park's map, what people spotted nearby in the last ${WILD_WINDOW_DAYS} days, and what visitor reviews mention.`,
  },
  { icon: Bot, title: "One AI call", body: "An open model picks a fair mix and writes kid-sized clues. Code checks every one." },
  { icon: Printer, title: "Print, phone away", body: "One black-and-white page: the kid's pass, a tear line, the grown-up's stub." },
];

export default function HowItWorksPage() {
  const modelId = configuredModelId();
  const limits = limitsConfig();
  const serp = serpapiCaps();
  const always = DROP_REASONS.filter((r) => DROP_REASON_INFO[r].kind === "always");
  const softer = DROP_REASONS.filter((r) => DROP_REASON_INFO[r].kind !== "always");
  const speedMet = (gemma.p50s ?? Infinity) <= EVAL_THRESHOLDS.p50s && (gemma.p95s ?? Infinity) <= EVAL_THRESHOLDS.p95s;

  const steps: Step[] = [
    {
      id: "park",
      icon: Search,
      who: "code",
      title: "Find the park",
      summary: "Type a town, ZIP or park name, or use your location (rounded to about 1 km). Code lists named parks within 5 km from OpenStreetMap.",
      more: (
        <>
          <p>
            You type a town, a ZIP code or a park name, or press &quot;Use my location&quot; (rounded in your browser to about
            1 km). Code looks the place up with OpenStreetMap&apos;s Nominatim search and lists named parks and nature reserves
            within 5 km from the Overpass API (the 10 nearest).
          </p>
          <p>
            If Overpass is slow (it waits 10 s), code uses a saved list of 1,321 named parks in the Dallas area, and then one
            Nominatim park search. The list says when it came from a fallback. When nothing can answer, the page says
            &quot;No data available&quot; and why.
          </p>
        </>
      ),
    },
    {
      id: "data",
      icon: Database,
      who: "code",
      title: "Collect real facts about that park",
      summary:
        "Code fills three lists, each item with its source and date: Park Finds (OpenStreetMap), Wild Finds (iNaturalist and Wikipedia) and Lucky Finds (Google Maps review counts via SerpApi).",
      more: (
        <>
          <ul className={bullets}>
            <li>
              <strong>Park Finds:</strong> what is mapped inside the park&apos;s outline on OpenStreetMap (courts, playgrounds,
              shelters, bridges, benches, ponds...), with the map&apos;s own count and a short fact sheet that code writes for
              each kind.
            </li>
            <li>
              <strong>Wild Finds:</strong> species people photographed within {WILD_RADIUS_KM} km in the last {WILD_WINDOW_DAYS}{" "}
              days on iNaturalist, research grade only, each with the first sentences of its Wikipedia summary. A species whose
              summary never says how it looks is left out (a clue could only be generic).
            </li>
            <li>
              <strong>Lucky Finds:</strong> &quot;maybe&quot; finds (a dog, a bike, ducks or a skateboard). Code finds the same
              park on Google Maps through SerpApi and counts reviews from the last {WINDOW_MONTHS / 12} years whose own text
              mentions the thing. A keyword needs at least {MIN_MENTIONS} such reviews. Only the word, the count and the newest
              month are kept: review text is never stored, shown or sent to the AI.
            </li>
          </ul>
          <p>
            From {OCTOBER_WINDOW_LABEL} code also counts monarch butterflies seen within {MONARCH_RADIUS_KM} km in the last 14
            full days, next to the same days last year, and checks for milkweed within {MILKWEED_RADIUS_KM} km. That box is all
            code; the AI never sees it.
          </p>
        </>
      ),
    },
    {
      id: "safety",
      icon: ShieldCheck,
      who: "code",
      title: "Take out anything unsafe",
      summary: `Code removes ${BLOCKED_TAXA.length} blocked groups of risky species before the model sees the list, and checks again after. Every Wild Find gets a fixed "Look, don't touch." line.`,
      more: (
        <>
          <p>
            Before the model sees the list, code removes every species in {BLOCKED_TAXA.length} blocked groups (venomous snakes
            and spiders, fire ants, poison ivy, stinging plants and caterpillars...) by its iNaturalist taxon id and all of its
            parent groups. The same check runs again on every item the model picks, and a clue that even names a blocked thing
            is removed.
          </p>
          <p>
            Every Wild Find gets a fixed safety line written by code (&quot;Look, don&apos;t touch.&quot;), and a pond or creek
            gets &quot;Stay with your grown-up near water.&quot; The model never decides what is safe.
          </p>
        </>
      ),
    },
    {
      id: "model",
      icon: PenLine,
      who: "model",
      title: "One call to an open model writes the clues",
      summary: (
        <>
          <strong>One</strong> request to <code>{modelId}</code>
          {modelId === "gemma-4-31B-it" ? " (Google's Gemma 4, open weights, Apache-2.0)" : ""} on DigitalOcean serverless
          inference. It picks items by id and writes a short clue and a proof quote for each, plus one riddle.
        </>
      ),
      more: (
        <>
          <p>
            The server makes one request, in the US. There is no automatic switch to another model: if it fails, the pass says
            so. The model can be changed with one setting (<code>MODEL_ID</code>), and every pass names the model that really
            answered.
          </p>
          <p>
            <strong>What the model is given:</strong> the park&apos;s name; for each item an id, its section, its kind and its
            fact text (the OpenStreetMap fact sheet, the Wikipedia sentences, or a Lucky Find line such as &quot;reviews from
            the last two years mention dogs&quot;); the age band&apos;s rules (how many finds: {AGE_BAND_INFO["4-6"].items} for
            ages 4-6, {AGE_BAND_INFO["6-10"].items} for 6-10, {AGE_BAND_INFO["10-13"].items} with {AGE_BAND_INFO["10-13"].hardMin}{" "}
            hard ones for 10-13, and the reading level); the month; and, when the park has a landmark, the one place code picked
            for Find This Spot.
          </p>
          <p>
            <strong>What it is NOT given:</strong> review text, reviewer names or review counts, and anything about you or your
            child (no name, no location, no IP address, nothing you typed).
          </p>
          <p>
            <strong>What it sends back:</strong> a strict JSON answer whose shape (a JSON schema) only allows the real ids from
            the list. For each item: the id, a short clue, an optional &quot;look where&quot; hint, easy / medium / hard, and a
            proof quote copied from the item&apos;s facts. Plus one riddle for the Find This Spot X. It waits at most{" "}
            {modelTimeoutMs() / 1000} s.
          </p>
        </>
      ),
    },
    {
      id: "checks",
      icon: ListChecks,
      who: "code",
      title: "Code checks every clue",
      summary: `The answer is never trusted as it is. Code removes any clue that fails a check: ${always.length} hard rules (proof quote, name leaks, numbers, safety) and ${softer.length} style preferences.`,
      more: (
        <>
          <p>Code checks each clue, one by one, and removes it for any of these reasons:</p>
          <ul className={bullets} aria-label="Reasons a clue is removed">
            {always.map((r) => (
              <li key={r}>
                {DROP_REASON_INFO[r].plain} <code className="text-sm text-muted-foreground">{r}</code>
              </li>
            ))}
          </ul>
          <p>
            Some checks are about style, not truth. A clue that fails one is only the first to go when a spare clue can take its
            place:
          </p>
          <ul className={bullets} aria-label="Style preferences">
            {softer.map((r) => (
              <li key={r}>
                {DROP_REASON_INFO[r].plain}
                {DROP_REASON_INFO[r].kind === "low-data" ? " (removed, except on a park with little data)" : ""}{" "}
                <code className="text-sm text-muted-foreground">{r}</code>
              </li>
            ))}
          </ul>
          <p>
            Safety, the proof quote, name leaks, numbers and counts are never relaxed. A &quot;look where&quot; hint that names
            the answer (or says &quot;map&quot; on a pass with no map) is left off, and the clue stays.
          </p>
          <p>
            Code never rewrites a clue to make it pass. The only two edits it makes: it takes a filler opener (&quot;Quick!&quot;,
            &quot;Psst,&quot;) off the front, and it turns the question mark after a command (&quot;Track 3 fields?&quot;) into a
            full stop.
          </p>
        </>
      ),
    },
    {
      id: "retry",
      icon: RotateCcw,
      who: "code",
      title: "Refill once, or print it short",
      summary: "Too few clues survive? Code asks the model once more for the missing ones. Still short? The pass prints what passed and says how many are missing.",
      more: (
        <>
          <p>
            On a park with little data, the model is asked for one spare item. If fewer than all but one of the finds survive the
            checks, code asks the model <strong>once more</strong>:
          </p>
          <ul className={bullets}>
            <li>
              When some clues were kept, the second call is a <strong>refill</strong>: it asks only for the missing finds (plus
              one spare), from items not used yet, skips items whose clue already failed when it can, and tells the model which
              words it copied or which clues were too generic.
            </li>
            <li>When nothing was kept, the second call is the whole request again.</li>
            <li>
              A network error or a server error is tried once more inside the same call. A timeout is not retried, and the
              second call only starts when at least 20 s of the pass&apos;s 85 s budget is left.
            </li>
          </ul>
          <p>
            It is never padded with made-up items. A section with no data says &quot;No data available&quot; and why.
          </p>
        </>
      ),
    },
    {
      id: "spot",
      icon: MapPinned,
      who: "code",
      title: "Find This Spot and the October box",
      summary: "Code picks one real landmark, draws a map with an X and measures the walk. The October monarch box is all code.",
      more: (
        <>
          <p>
            Code picks one real place in the park from OpenStreetMap: a landmark the park has only one of (a picnic shelter, a
            playground, a bridge), or else the middle of one sports field. It draws a black-and-white map of the park&apos;s
            paths with an X on that place, a START at the nearest mapped parking lot or entrance, a north arrow and a scale. The
            walking distance and direction on the grown-up&apos;s stub are measured by code.
          </p>
          <p>
            The model writes the riddle in the same call, from that place&apos;s fact sheet. The riddle gets the same checks
            (proof quote, no name, no new numbers). If it fails, or the map arrives late (code waits about 2 s before the model
            call and 3 s after it), the pass uses a fixed riddle written by code. A park with nothing to point at gets &quot;No
            Find This Spot today&quot;.
          </p>
          <p>The October special box (monarch counts and milkweed, step 2) is written entirely by code, with its numbers and dates.</p>
        </>
      ),
    },
    {
      id: "print",
      icon: Printer,
      who: "you",
      title: "Print one page",
      summary: "One black-and-white page: the kid's pass on top, a dashed tear line, and the grown-up's stub with answers, safety notes and sources.",
      more: (
        <>
          <p>
            One US Letter page (A4 works too). The kid&apos;s pass has the finds with tick boxes, each with its safety line and
            where its fact came from in small print, the Find This Spot map and riddle, and the October box. The grown-up&apos;s
            stub has the answers, the safety notes, the sources with their dates, and the model that answered and when.
          </p>
          <p>Every number and date on the page is written by code, never by the model.</p>
        </>
      ),
    },
    {
      id: "cache",
      icon: Timer,
      who: "code",
      title: "Saving work, and fair limits",
      summary: `Finished passes are saved for 30 days. A new pass needs a grown-up signed in (${ACCOUNT_PASSES_PER_DAY} a day); daily limits keep the free model budget and the public map servers fair.`,
      more: (
        <>
          <p>
            A finished pass is saved per park, age band and day (Chicago time) for 30 days, so the next visitor gets it at once
            and the link and print page keep working. &quot;Make a different pass&quot; can make up to {MAX_VARIANTS} per day.
            Park data is saved too: park map features 7 days, park outlines for the map 7 days, the iNaturalist sightings list 6
            hours, species summaries 7 days, Lucky Find counts 30 days, place searches 30 days, park lists 7 days. A failed lookup
            (for example a map server that timed out) is usually remembered for 15 minutes, so a busy server is not asked again
            and again.
          </p>
          <ul className={bullets}>
            <li>
              At most {limits.aiDailyCap} model calls a day for everyone together ({limits.aiReservePct}% kept for the example
              parks).
            </li>
            <li>
              Each internet address: {limits.passPerIpPerDay} new passes a day ({limits.passPerIpPerMin} a minute) and{" "}
              {limits.parksPerIpPerDay} new park searches a day; {limits.parksDailyCap} new park searches a day for everyone.
            </li>
            <li>
              Lucky Finds: {serp.daily} SerpApi searches a day and {serp.monthly} a month (the free plan).
            </li>
            <li>A pass that came out degraded (a source was down) is rebuilt at most 3 times a day.</li>
            <li>
              A new pass needs a grown-up signed in with GitHub or Google: {ACCOUNT_PASSES_PER_DAY} new passes a day each. Judges
              can press &quot;Try as a judge&quot; (a shared demo account, {judgeDailyCap()} new passes a day for all judges
              together). Saved passes, shared links, the examples and printing need no sign-in.
            </li>
          </ul>
          <p>Visitor reports feed back in: {REPORT_COPY.rule}</p>
          <p>When a limit is reached, the page says so in plain words; saved passes and the example passes keep working.</p>
        </>
      ),
    },
  ];

  const measured: [string, string, string, boolean][] = [
    ["Cost per pass (DigitalOcean list prices)", usd(gemma.costPerPass), `${usd(EVAL_THRESHOLDS.costPerPass)} or less`, gemma.costPerPass <= EVAL_THRESHOLDS.costPerPass],
    ["Model time per call, typical / slow", `${secs(gemma.p50s)} / ${secs(gemma.p95s)}`, `${EVAL_THRESHOLDS.p50s} s / ${EVAL_THRESHOLDS.p95s} s`, speedMet],
    ["Complete passes (at most 1 find missing)", `${pct(gemma.completePct)} (${gemma.complete}/${gemma.dataRichRuns})`, `${EVAL_THRESHOLDS.completePct}% or more`, gemma.completePct >= EVAL_THRESHOLDS.completePct],
    ["Reading level (grade, median)", gemma.fkGrade.toFixed(1), `${EVAL_THRESHOLDS.fkGrade} or lower`, gemma.fkGrade <= EVAL_THRESHOLDS.fkGrade],
    ["Clues quoting their source word for word, before the checks", pct(gemma.groundedPct), `${EVAL_THRESHOLDS.groundedPct}% or more`, gemma.groundedPct >= EVAL_THRESHOLDS.groundedPct],
    ["Blocked species printed", String(gemma.blockedPrinted), "0", gemma.blockedPrinted === 0],
    ["Clues repeated across parks", pct(gemma.repeatPct), `${EVAL_THRESHOLDS.repeatPct}% or lower`, gemma.repeatPct <= EVAL_THRESHOLDS.repeatPct],
  ];

  return (
    <main id="main" tabIndex={-1} className="flex w-full flex-1 flex-col focus:outline-none">
      <OpenOnHash />

      <section aria-labelledby="how-title" className="grain">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 px-5 pt-14 pb-12 md:px-8 lg:pt-20">
          <p className="text-xs font-bold tracking-widest text-primary uppercase">How it works</p>
          <h1 id="how-title" className="-mt-2 text-5xl leading-[0.95] font-extrabold tracking-tighter text-balance text-ink sm:text-6xl lg:text-7xl">
            How Grass Pass works
          </h1>
          <p className="max-w-[55ch] text-xl leading-relaxed text-pretty">
            Real park data in, one call to an open model, every clue checked by code, one printed page out.
          </p>
          <nav aria-label="On this page">
            <ul className="flex flex-wrap gap-2">
              {[
                ["#quick", "The 30-second version"],
                ["#steps", "Step by step"],
                ["#ai-role", "What the AI does"],
                ["#why-open", "Why an open model"],
                ["#limits", "Honest limits"],
                ["#privacy", "Privacy"],
                ["#built", "How it was built"],
              ].map(([href, label]) => (
                <li key={href}>
                  <a
                    className="inline-flex min-h-11 items-center rounded-full bg-card px-4 text-sm font-semibold text-primary underline-offset-4 ring-1 ring-border hover:underline"
                    href={href}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </section>

      <Band id="quick" eyebrow="The 30-second version" title="Pick a park. Print a pass. Phone away.">
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK.map((q, i) => (
            <li key={q.title} className="flex flex-col gap-3 rounded-3xl bg-card p-5 ring-1 ring-border">
              <div className="flex items-center justify-between">
                <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                  <q.icon className="size-5" />
                </span>
                <span aria-hidden="true" className="font-heading text-4xl leading-none font-extrabold text-muted">
                  {i + 1}
                </span>
              </div>
              <h3 className="text-lg font-extrabold text-ink">
                <span className="sr-only">{i + 1}. </span>
                {q.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{q.body}</p>
            </li>
          ))}
        </ol>
        <p className="flex items-start gap-2 text-muted-foreground">
          <Smartphone aria-hidden="true" className="mt-1 size-4 shrink-0" />
          <span>
            A new pass usually takes 10-30 seconds. No data for a section? It says &quot;No data available&quot; and why, never a
            made-up item.
          </span>
        </p>
      </Band>

      <Band id="steps" eyebrow="Step by step" title="From a park name to a printed page" tone="muted" width="max-w-4xl">
        <p className="-mt-2 max-w-[65ch]">
          Each step says who does it: <strong>code</strong> (our own program, the same every time) or{" "}
          <strong>the open model</strong> (the AI). The AI does one step.
        </p>
        <Steps steps={steps} />
      </Band>

      <Band id="ai-role" eyebrow="What the AI does and doesn't do" title="The AI picks and writes. Code does the rest.">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-3xl bg-sun p-6 text-sun-foreground">
            <h3 className="flex items-center gap-2 text-xl font-extrabold">
              <Bot aria-hidden="true" className="size-6" />
              The AI does
            </h3>
            <ul className={bullets}>
              <li>Pick which items from the list go on the pass (inside the mix code allows).</li>
              <li>Write a short clue for each one in kid words, plus an optional &quot;look where&quot; hint.</li>
              <li>Say how hard each find is.</li>
              <li>Copy a proof quote from each item&apos;s facts.</li>
              <li>Write the Find This Spot riddle.</li>
            </ul>
          </div>
          <div className="gp-band flex flex-col gap-3 rounded-3xl bg-band p-6 text-band-foreground">
            <h3 className="flex items-center gap-2 text-xl font-extrabold">
              <Code2 aria-hidden="true" className="size-6 text-sun" />
              Code does
            </h3>
            <ul className={bullets}>
              <li>Find the park and collect every fact, with its source and date.</li>
              <li>Remove unsafe species, before and after the model.</li>
              <li>Decide the mix and the number of finds.</li>
              <li>Check every clue and remove the ones that fail.</li>
              <li>Pick the Find This Spot place, draw the map, measure the walk.</li>
              <li>Write every number, date, safety line, answer and the grown-up&apos;s tip.</li>
            </ul>
          </div>
        </div>
        <p className="max-w-[65ch]">
          The AI can never add an item: the answer&apos;s schema only allows ids from the park&apos;s own list.
        </p>
      </Band>

      <Band id="why-open" eyebrow="Why an open model" title="Open weights, our own rules" tone="dark">
        <ul className="grid gap-4 md:grid-cols-3">
          {[
            { icon: Scale, title: "The licence is open.", body: "Gemma 4's weights are released under Apache-2.0: anyone can download, run and build on them." },
            {
              icon: Hammer,
              title: "It can be self-hosted.",
              body: "The app talks to any OpenAI-compatible server (for example Ollama on your own computer). We have not measured a self-hosted run for this app yet.",
            },
            {
              icon: ShieldCheck,
              title: "Our rules, not a vendor's.",
              body: "The same checks run on any model; Llama 4 Maverick went through the same code in our test.",
            },
          ].map((c) => (
            <li key={c.title} className="flex flex-col gap-2 rounded-3xl bg-band-foreground/[0.06] p-6 ring-1 ring-band-foreground/10">
              <c.icon aria-hidden="true" className="size-6 text-sun" />
              <h3 className="text-lg font-extrabold">{c.title}</h3>
              <p className="text-sm leading-relaxed text-band-muted">{c.body}</p>
            </li>
          ))}
        </ul>
        <p className="flex max-w-[65ch] items-start gap-2 text-band-muted">
          <Gauge aria-hidden="true" className="mt-1 size-4 shrink-0 text-sun" />
          <span>
            Measured on {EVAL_PARKS} parks: {usd(gemma.costPerPass)} a pass, reading grade {gemma.fkGrade.toFixed(1)} (a no-AI
            template: {template.fkGrade.toFixed(1)}), speed missed just. All numbers on the{" "}
            <Link className={bandLink} href="/about#measured">
              About page
            </Link>
            .
          </span>
        </p>
        <Disclosure tone="band" icon={Gauge} title={`What we measured: run ${EVAL_RUN_ID}`} hint="Each number, its target, met or missed">
          <p>
            What we measured, on {EVAL_PARKS} real parks, age band 6-10, run <code>{EVAL_RUN_ID}</code> on {EVAL_DAY} (
            <a className={bandLink} href={resultsUrl}>
              full results
            </a>
            ):
          </p>
          <div className="overflow-x-auto rounded-2xl bg-card text-card-foreground ring-1 ring-border" role="region" aria-labelledby="measured-caption" tabIndex={0}>
            <table className="w-full min-w-[520px] border-collapse text-left text-base">
              <caption id="measured-caption" className="px-4 pt-3 pb-2 text-left font-bold">
                Gemma 4 31B, {gemma.runs} runs, run {EVAL_RUN_ID} ({EVAL_DAY})
              </caption>
              <thead>
                <tr className="border-b-2 border-line">
                  <th scope="col" className="px-4 py-2">
                    What
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Measured
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Target
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Result
                  </th>
                </tr>
              </thead>
              <tbody>
                {measured.map(([what, value, target, ok]) => (
                  <tr key={what} className="border-b border-line last:border-b-0">
                    <th scope="row" className="px-4 py-2 font-semibold">
                      {what}
                    </th>
                    <td className="px-4 py-2">{value}</td>
                    <td className="px-4 py-2">{target}</td>
                    <td className="px-4 py-2 font-bold">{ok ? "Met" : "Missed"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The no-AI template on the same data reads at grade {template.fkGrade.toFixed(1)}; Gemma&apos;s clues read at grade{" "}
            {gemma.fkGrade.toFixed(1)}. Speed is missed, just: the typical call took 10.04 s.
          </p>
          <p>
            The newest results file is a smaller check for ages {SMOKE_10_13.ageBand} (run <code>{smokeId}</code>, {SMOKE_10_13.day},{" "}
            {SMOKE_10_13.parks} parks, one run each,{" "}
            <a className={bandLink} href={smokeUrl}>
              results
            </a>
            ): {SMOKE_10_13.complete} of {SMOKE_10_13.parks} passes complete, reading grade {SMOKE_10_13.fkGrade}, model time{" "}
            {SMOKE_10_13.p50s} s typical and {SMOKE_10_13.p95s} s slow, and {usd(SMOKE_10_13.costPerPass)} per pass, which is{" "}
            <strong>over</strong> the {usd(EVAL_THRESHOLDS.costPerPass)} target (the 10-13 pass is longer). Before the checks,{" "}
            {SMOKE_10_13.nameLeakPct}% of its clues named their own answer; code removed all of them before printing. It is a
            partial run, not the frozen numbers.
          </p>
        </Disclosure>
      </Band>

      <Band id="limits" eyebrow="Honest limits" title="What does not work yet">
        <ul className="grid gap-3 sm:grid-cols-2">
          {howLimits().map((l) => (
            <li key={l.title} className="flex gap-3 rounded-2xl bg-card p-4 ring-1 ring-border">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ink" />
              <span className="font-semibold text-ink">{l.title}</span>
            </li>
          ))}
        </ul>
        <Disclosure id="limits-detail" icon={TriangleAlert} title="The limits, with the numbers" hint="One line of detail for each">
          <ul className={bullets}>
            {howLimits().map((l) => (
              <li key={l.title}>
                <strong>{l.title}</strong> {l.detail}
              </li>
            ))}
          </ul>
          <p>
            The full list, with the numbers, is on the{" "}
            <Link className={ext} href="/about#limits-detail">
              About page
            </Link>{" "}
            and in the README.
          </p>
        </Disclosure>
      </Band>

      <Band id="privacy" eyebrow="Privacy in short" title="Nothing about your child" tone="muted">
        <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {howPrivacyPoints().map((p) => (
            <li key={p} className="flex gap-2">
              <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
        <p className="flex items-center gap-2">
          <Lock aria-hidden="true" className="size-4 shrink-0 text-primary" />
          <span>
            The full table of what leaves your device is on the{" "}
            <Link className={ext} href="/about#privacy-table">
              About page
            </Link>
            .
          </span>
        </p>
      </Band>

      <Band id="built" eyebrow="How this app was built" title="Built in the contest week, with AI coding agents">
        <p className="max-w-[65ch]">
          Built during the Hacktoberfest 2026 Week 1 entry period (first commit Oct 5, 2026). Kevin made the decisions; AI coding
          agents wrote and reviewed most of the code. The clues on every pass come from the open model named on that pass.
        </p>
        <Disclosure icon={Hammer} title="Who built what, and how it is checked" hint="Builders, auditors and the tests">
          <ul className={bullets}>
            <li>
              AI coding agents (Claude Code) wrote most of the code as &quot;builders&quot; and reviewed it as
              &quot;auditors&quot;.
            </li>
            <li>
              Each audit round runs five separate reviews: contest rules, security, quality, accessibility and design, and a
              judge simulator. The builders then fix what they found. Three audit rounds have run so far.
            </li>
            <li>
              Every change is checked before it is merged: lint, type checks, more than 800 unit tests on recorded real API
              answers, a production build, and browser tests with automatic accessibility checks.
            </li>
            <li>Claude helped build the app. It never writes a pass: the clues on every pass come from the open model named on that pass.</li>
          </ul>
        </Disclosure>
        <p className="flex flex-wrap gap-3">
          <a className={buttonClassName("secondary")} href={REPO_URL}>
            Source code on GitHub (MIT)
          </a>
          <Link className={buttonClassName("primary", "group")} href="/" prefetch={false}>
            Make a pass
            <ArrowRight aria-hidden="true" className="size-5 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" />
          </Link>
        </p>
      </Band>
    </main>
  );
}
