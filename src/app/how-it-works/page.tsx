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
import { EVAL_RUN_ID, UNIT_TESTS, auditRoundsLine, howLimits, howPrivacyPoints, pct, secs, usd } from "@/lib/about/content";
import { ACCOUNT_PASSES_PER_DAY, judgeShareCopy, signInWith } from "@/lib/accounts/config";
import { REPORT_COPY } from "@/lib/reports/kinds";
import { EVAL_DAY, EVAL_PARKS, EVAL_SUMMARY_FILE, EVAL_THRESHOLDS, GEMMA_COST_RANGE, GEMMA_FIRST_CALL_P50_S, GEMMA_P50_EXACT_S, GEMMA_TOKENS_PER_S, SMOKE_10_13, evalColumn } from "@/lib/about/eval-summary";
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
  title: "How Grass Pass works: real park data in, one open model, paper out",
  description:
    "See how we turn a park's real map and wildlife sightings into a printable pass. Gemma 4, an open model, writes the clues and code fact-checks every one. What the AI does, what it doesn't, and what we measured.",
};

const ext = "font-semibold text-link underline underline-offset-2";
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
          <p className={`text-xs font-bold tracking-widest uppercase ${tone === "dark" ? "text-sun" : tone === "muted" ? "text-link" : "text-primary"}`}>{eyebrow}</p>
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
  { icon: MapPinned, title: "Pick a park & age", body: "A real park near you, plus your kid's age: 4-6, 6-10 or 10-13." },
  {
    icon: Database,
    title: "We read the park",
    body: `Its map, the last ${WILD_WINDOW_DAYS} days of wildlife sightings nearby, and what visitor reviews mention.`,
  },
  {
    icon: Bot,
    title: "AI writes, code checks",
    body: "Gemma 4 writes kid-friendly clues. Code checks every one for accuracy and asks again if too many fail.",
  },
  { icon: Printer, title: "Print and go", body: "One page. The kid gets the hunt and you keep the answer key." },
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
      title: "Pick your park",
      summary: "Search by town, ZIP, park name, or tap Use my location (rounded to about 1 km). Code finds parks within 5 km using OpenStreetMap.",
      more: (
        <>
          <p>
            Nominatim finds the place; the Overpass API lists the 10 nearest named parks and nature reserves. If Overpass takes
            over 10 s, code falls back to a saved list of 1,321 Dallas-area parks, then a Nominatim park search, and says so.
          </p>
        </>
      ),
    },
    {
      id: "data",
      icon: Database,
      who: "code",
      title: "Gather what's really there",
      summary:
        "Code builds three dated, sourced lists. Park Finds come from OpenStreetMap, Wild Finds from iNaturalist and Wikipedia, and Lucky Finds from Google review counts via SerpApi.",
      more: (
        <>
          <ul className={bullets}>
            <li>
              <strong>Park Finds:</strong> what is mapped inside the park, with the map&apos;s count and a short fact sheet per
              kind.
            </li>
            <li>
              <strong>Wild Finds:</strong> research-grade iNaturalist species within {WILD_RADIUS_KM} km, last{" "}
              {WILD_WINDOW_DAYS} days, each with the start of its Wikipedia summary. If the summary never says how it looks, it is
              left out.
            </li>
            <li>
              <strong>Lucky Finds:</strong> &quot;maybe&quot; finds (a dog, a bike, ducks, a skateboard) that at least{" "}
              {MIN_MENTIONS} Google Maps reviews from the last {WINDOW_MONTHS / 12} years mention, counted via SerpApi. Review
              text is never stored, shown or sent to the AI.
            </li>
          </ul>
          <p>
            From {OCTOBER_WINDOW_LABEL}, code also counts monarchs seen within {MONARCH_RADIUS_KM} km in the last 14 full days
            (next to the same days last year) and checks for milkweed within {MILKWEED_RADIUS_KM} km. The AI never sees that box.
          </p>
        </>
      ),
    },
    {
      id: "safety",
      icon: ShieldCheck,
      who: "code",
      title: "Take out anything that bites, stings or itches",
      summary: `Code removes ${BLOCKED_TAXA.length} groups of risky species, like fire ants and poison ivy, before the model sees the list and checks again after.`,
      more: (
        <>
          <p>
            Code checks each species&apos; iNaturalist taxon id and all its parent groups against the blocked list (venomous
            snakes and spiders, fire ants, poison ivy, stinging plants and caterpillars...). The check runs again on every
            find the model picks, and a clue that even names a blocked thing is removed.
          </p>
          <p>
            Code writes the safety lines (&quot;Look, don&apos;t touch.&quot;, &quot;Stay with your grown-up near water.&quot;).
            The model never decides what is safe.
          </p>
        </>
      ),
    },
    {
      id: "model",
      icon: PenLine,
      who: "model",
      title: "The AI writes the clues",
      summary: (
        <>
          Code sends the park&apos;s fact list to <code>{modelId}</code>
          {modelId === "gemma-4-31B-it" ? " (Google's Gemma 4, open weights, Apache-2.0)" : ""} on DigitalOcean serverless
          inference. It picks the finds by id and writes a clue and a proof quote for each, plus one riddle. Usually that is
          one call; step 6 is the exception.
        </>
      ),
      more: (
        <>
          <p>
            There is no automatic switch to another model: if the call fails, the pass says so. <code>MODEL_ID</code> changes
            the model, and every pass names the one that answered.
          </p>
          <p>
            <strong>What the model is given:</strong> the park&apos;s name; each fact&apos;s id, section, kind and text; the age
            rules ({AGE_BAND_INFO["4-6"].items} finds for 4-6, {AGE_BAND_INFO["6-10"].items} for 6-10,{" "}
            {AGE_BAND_INFO["10-13"].items} with {AGE_BAND_INFO["10-13"].hardMin} hard ones for 10-13, and a reading level); the
            month; and the Find This Spot place, if code picked one.
          </p>
          <p>
            <strong>What it is NOT given:</strong> review text, reviewer names or review counts, and nothing about you or your
            child (no name, location, IP address or anything you typed).
          </p>
          <p>
            <strong>What it sends back:</strong> strict JSON whose schema only allows the real ids. For each find: the id, a
            clue, an optional &quot;look where&quot; hint, easy / medium / hard, and a proof quote from its facts. Plus the
            riddle. It waits at most {modelTimeoutMs() / 1000} s.
          </p>
        </>
      ),
    },
    {
      id: "checks",
      icon: ListChecks,
      who: "code",
      title: "Code fact-checks every clue",
      summary: `Code never takes the AI's word for it. It removes any clue that breaks one of ${always.length} hard rules (proof quote, name leaks, numbers, safety), and swaps out clues that miss ${softer.length} style rules when it can.`,
      more: (
        <>
          <p>A clue is removed when:</p>
          <ul className={bullets} aria-label="Reasons a clue is removed">
            {always.map((r) => (
              <li key={r}>
                {DROP_REASON_INFO[r].plain} <code className="text-sm text-muted-foreground">{r}</code>
              </li>
            ))}
          </ul>
          <p>Style rules (not truth): a clue that misses one goes first when a spare can replace it.</p>
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
            Safety, proof quotes, name leaks, numbers and counts are never relaxed. A &quot;look where&quot; hint that names the
            answer (or says &quot;map&quot; with no map) is dropped; its clue stays.
          </p>
          <p>
            Code never rewrites a clue to make it pass. It makes only two edits: it cuts a filler opener (&quot;Quick!&quot;,
            &quot;Psst,&quot;) and turns &quot;?&quot; after a command (&quot;Track 3 fields?&quot;) into a full stop.
          </p>
        </>
      ),
    },
    {
      id: "retry",
      icon: RotateCcw,
      who: "code",
      title: "Refill, or print it short",
      summary: "Too few clues pass the check? Code asks the AI again for the missing ones (at most 3 calls per pass). Still short? We list how many are missing. No made-up filler.",
      more: (
        <>
          <p>
            Little data: the model is asked for one spare. More than one find lost: code asks <strong>again</strong>, at most 3 model calls per pass:
          </p>
          <ul className={bullets}>
            <li>
              Some clues kept: a <strong>refill</strong> for the missing finds (plus up to two spares) from unused facts, naming what
              was copied or too generic.
            </li>
            <li>If nothing was kept, it is the whole request again.</li>
            <li>
              A first call that fails (timeout, network or server error, or an unusable answer) gets one whole retry. A pass still short after a refill gets one more refill. A whole retry needs 25 s of the 85 s budget left, a refill 20 s.
            </li>
          </ul>
          <p>Nothing is padded with made-up finds.</p>
        </>
      ),
    },
    {
      id: "spot",
      icon: MapPinned,
      who: "code",
      title: "Find This Spot and the October box",
      summary: "Code picks a landmark, draws a map with an X, and measures the walk. The October box is all code.",
      more: (
        <>
          <p>
            Code picks a landmark the park has only one of (a shelter, a playground, a bridge), or else a sports field. It
            draws the paths with an X there, a START at the nearest parking lot or entrance, a north arrow and a scale, and
            measures the walk.
          </p>
          <p>
            The model writes the riddle in the same call, under the same checks. If it fails or the map is late (about 2 s
            before the call, 3 s after), code uses a fixed riddle. No landmark: &quot;No Find This Spot today&quot;.
          </p>
          <p>The October box (step 2) is all code, numbers and dates included.</p>
        </>
      ),
    },
    {
      id: "print",
      icon: Printer,
      who: "you",
      title: "Print and ditch the phone",
      summary: "One black-and-white page: the kid's hunt on top, your answer key and sources below. Then the phone goes in the bag.",
      more: (
        <>
          <p>
            US Letter (A4 works too). Top: finds with tick boxes, safety lines and sources, the map and riddle, the October box.
            Bottom: answers, safety notes, dated sources, and which model answered when.
          </p>
          <p>Code writes every number and date on the page.</p>
        </>
      ),
    },
    {
      id: "cache",
      icon: Timer,
      who: "code",
      title: "Saved passes and fair limits",
      summary: `Passes are saved for 30 days. A new pass needs a grown-up signed in (${ACCOUNT_PASSES_PER_DAY} a day); daily limits protect the model budget and the free map servers.`,
      more: (
        <>
          <p>
            A pass is saved per park, age band and day (Dallas time) for 30 days, so the next visitor gets it at once.
            &quot;Make a different pass&quot; allows {MAX_VARIANTS} a day. Park data is cached for 6 hours (sightings) to 30
            days (review counts, place searches); a failed lookup is remembered for about 15 minutes.
          </p>
          <ul className={bullets}>
            <li>{limits.aiDailyCap} model calls a day for everyone ({limits.aiReservePct}% kept for the examples).</li>
            <li>
              Per internet address: {limits.passPerIpPerDay} new passes a day ({limits.passPerIpPerMin} a minute) and{" "}
              {limits.parksPerIpPerDay} park searches; {limits.parksDailyCap} searches a day for everyone.
            </li>
            <li>Lucky Finds: {serp.daily} SerpApi searches a day, {serp.monthly} a month (free plan).</li>
            <li>A pass made while a source was down is rebuilt at most 3 times a day, not counted toward anyone&apos;s {ACCOUNT_PASSES_PER_DAY}.</li>
            <li>
              A new pass needs a grown-up signed in{signInWith()}: {ACCOUNT_PASSES_PER_DAY} new passes a day each. Judges
              can press &quot;Try as a judge&quot;: {judgeShareCopy()}
            </li>
          </ul>
          <p>Reports: {REPORT_COPY.rule}</p>
          <p>At a limit, the page says so; saved and example passes keep working.</p>
        </>
      ),
    },
  ];

  const measured: [string, string, string, boolean][] = [
    ["Cost per pass (DigitalOcean list prices)", `${usd(gemma.costPerPass)} (up to ${usd(GEMMA_COST_RANGE.high)} if ${GEMMA_COST_RANGE.timedOutCalls} timed-out calls were billed)`, `${usd(EVAL_THRESHOLDS.costPerPass)} or less`, gemma.costPerPass <= EVAL_THRESHOLDS.costPerPass],
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
            How a park becomes a pass.
          </h1>
          <p className="max-w-[55ch] text-xl leading-relaxed text-pretty">
            You pick the park. Gemma 4, an open AI model, writes the clues from its real map and the last two weeks of
            wildlife sightings. Code fact-checks every one. Your printer does the rest.
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
                    className="inline-flex min-h-11 items-center rounded-full bg-card px-4 text-sm font-semibold text-link underline-offset-4 ring-1 ring-border hover:underline"
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
            A new pass usually takes 10-30 seconds, roughly the time it takes to find a missing shoe. If data is missing,
            the pass says &quot;No data available&quot; and why.
          </span>
        </p>
      </Band>

      <Band id="steps" eyebrow="Step by step" title="From “which park?” to “found it!”" tone="muted" width="max-w-4xl">
        <p className="-mt-2 max-w-[65ch]">
          Each step is handled by <strong>code</strong>, <strong>the open model</strong>, or <strong>you</strong>. The AI has
          one job: picking the finds and writing the words.
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
              <li>Pick the finds, inside the mix code allows.</li>
              <li>Write each clue in kid words, plus a hint.</li>
              <li>Rate each find easy, medium or hard.</li>
              <li>Copy a proof quote from its facts.</li>
              <li>Write the Find This Spot riddle.</li>
            </ul>
          </div>
          <div className="gp-band flex flex-col gap-3 rounded-3xl bg-band p-6 text-band-foreground">
            <h3 className="flex items-center gap-2 text-xl font-extrabold">
              <Code2 aria-hidden="true" className="size-6 text-sun" />
              Code does
            </h3>
            <ul className={bullets}>
              <li>Collect every fact, with its source and date.</li>
              <li>Remove unsafe species, before and after.</li>
              <li>Set the mix and the number of finds.</li>
              <li>Check every clue; remove failures.</li>
              <li>Pick the spot, draw the map, measure the walk.</li>
              <li>Write every number, date, safety line and answer.</li>
            </ul>
          </div>
        </div>
        <p className="max-w-[65ch]">
          The AI cannot invent finds because it can only use ids from the park&apos;s own fact list.
        </p>
      </Band>

      <Band id="why-open" eyebrow="Why an open model" title="Open weights, our own rules" tone="dark">
        <ul className="grid gap-4 md:grid-cols-3">
          {[
            { icon: Scale, title: "The licence is open.", body: "Gemma 4's weights are Apache-2.0: anyone can download, run and build on them." },
            {
              icon: Hammer,
              title: "It can be self-hosted.",
              body: "Any OpenAI-compatible server, like Ollama. On a laptop CPU: $0, but 1-3 minutes a pass.",
            },
            {
              icon: ShieldCheck,
              title: "Our rules, not a vendor's.",
              body: "The same checks run on any model; Llama 4 Maverick went through them in our test.",
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
            On {EVAL_PARKS} parks: {usd(gemma.costPerPass)} a pass, reading grade {gemma.fkGrade.toFixed(1)} (no-AI template:{" "}
            {template.fkGrade.toFixed(1)}). All numbers: the{" "}
            <Link className={bandLink} href="/about#measured">
              About page
            </Link>
            .
          </span>
        </p>
        <Disclosure tone="band" icon={Gauge} title={`What we measured: run ${EVAL_RUN_ID}`} hint="Each number, its target, met or missed">
          <p>
            {EVAL_PARKS} real parks, ages 6-10 (
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
            Speed is missed: the typical call took {GEMMA_P50_EXACT_S} s, first calls alone {GEMMA_FIRST_CALL_P50_S} s, with
            DigitalOcean answering at {GEMMA_TOKENS_PER_S.now} answer tokens a second ({GEMMA_TOKENS_PER_S.before} the run before).
            Lucky Finds and Find This Spot are not in this test.
          </p>
          <p>
            Ages {SMOKE_10_13.ageBand}, a smaller partial check (run <code>{smokeId}</code>, {SMOKE_10_13.day},{" "}
            {SMOKE_10_13.parks} parks, one run each,{" "}
            <a className={bandLink} href={smokeUrl}>
              results
            </a>
            ): {SMOKE_10_13.complete} of {SMOKE_10_13.parks} passes complete in {SMOKE_10_13.calls} model calls, grade{" "}
            {SMOKE_10_13.fkGrade}, {SMOKE_10_13.p50s} s typical and {SMOKE_10_13.p95s} s slow. A finished 10-13 pass cost
            about {usd(SMOKE_10_13.costPerFinishedPass)}, which is <strong>over</strong> the {usd(EVAL_THRESHOLDS.costPerPass)} target
            (a 10-13 pass is longer). Before the checks, {SMOKE_10_13.nameLeakPct}% of its clues named their answer; code removed
            them all.
          </p>
        </Disclosure>
      </Band>

      <Band id="limits" eyebrow="Honest limits" title="Where we fall short">
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
            All limits, with numbers:{" "}
            <Link className={ext} href="/about#limits-detail">
              About page
            </Link>
            .
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
            What leaves your device, in full: the{" "}
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
          agents wrote and reviewed most of the code.
        </p>
        <Disclosure icon={Hammer} title="Who built what, and how it is checked" hint="Builders, auditors and the tests">
          <ul className={bullets}>
            <li>AI coding agents (Claude Code) wrote most of the code as &quot;builders&quot; and reviewed it as &quot;auditors&quot;.</li>
            <li>
              Each audit round runs five reviews (contest rules, security, quality, accessibility and design, and a judge
              simulator); builders then fix the findings. {auditRoundsLine()}
            </li>
            <li>
              Every change passes lint, type checks, {UNIT_TESTS.passed} unit tests (counted {UNIT_TESTS.day}) on recorded real API
              answers, a production build, and browser tests with accessibility checks.
            </li>
            <li>Claude never writes a pass: every clue comes from the open model named on that pass.</li>
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
