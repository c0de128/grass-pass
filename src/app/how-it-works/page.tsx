import {
  Database,
  ListChecks,
  MapPinned,
  PenLine,
  Printer,
  RotateCcw,
  Search,
  ShieldCheck,
  Timer,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClassName } from "@/components/ui/Button";
import { TicketCard } from "@/components/ui/TicketCard";
import { EVAL_DAY, EVAL_PARKS, EVAL_SUMMARY_FILE, EVAL_THRESHOLDS, SMOKE_10_13, evalColumn } from "@/lib/about/eval-summary";
import { DROP_REASONS } from "@/lib/ai/validate";
import { DROP_REASON_INFO } from "@/lib/how/drop-reasons";
import { configuredModelId, MODEL_TIMEOUT_MS, modelTimeoutMs } from "@/lib/model";
import { OCTOBER_WINDOW_LABEL, MILKWEED_RADIUS_KM, MONARCH_RADIUS_KM } from "@/lib/october";
import { AGE_BAND_INFO, MAX_VARIANTS } from "@/lib/pass/schema";
import { BLOCKED_TAXA } from "@/lib/safety/danger-taxa";
import { WILD_RADIUS_KM, WILD_WINDOW_DAYS } from "@/lib/sources/inat";
import { WINDOW_MONTHS } from "@/lib/sources/serpapi";
import { MIN_MENTIONS } from "@/lib/pool/lucky";
import { limitsConfig } from "@/lib/limits/config";
import { serpapiCaps } from "@/lib/limits/serpapi";
import { REPO_URL } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "How Grass Pass works: the data, the open model and the checks",
  description:
    "Step by step: how Grass Pass turns real park data into a printable kids' pass with one call to the open Gemma 4 model, what the AI does and doesn't do, what code checks, and what we measured.",
};

const ext = "font-semibold text-primary underline underline-offset-2";
const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
const usd = (n: number) => `$${n.toFixed(5)}`;
const secs = (n: number | null) => (n === null ? "no model call" : `${n.toFixed(1)} s`);

const gemma = evalColumn("gemma-4-31B-it");
const template = evalColumn("no-AI template");
const resultsUrl = `${REPO_URL}/blob/main/${EVAL_SUMMARY_FILE}`;
const smokeUrl = `${REPO_URL}/blob/main/${SMOKE_10_13.summary}`;
const runId = EVAL_SUMMARY_FILE.replace(/^evals\/results\//, "").replace(/\.md$/, "");
const smokeId = SMOKE_10_13.summary.replace(/^evals\/results\//, "").replace(/\.md$/, "");

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex scroll-mt-20 flex-col gap-4">
      <p className="text-xs font-bold tracking-widest text-primary uppercase">{eyebrow}</p>
      <h2 id={id} className="-mt-2 text-3xl leading-tight font-extrabold tracking-tight text-balance text-ink sm:text-4xl">
        {title}
      </h2>
      {children}
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

type Step = { id: string; icon: LucideIcon; who: Who; title: string; body: ReactNode };

function Steps({ steps }: { steps: readonly Step[] }) {
  return (
    <ol aria-label="How a pass is made, step by step" className="relative flex flex-col gap-5">
      {steps.map((s, i) => (
        <li key={s.id} id={`step-${s.id}`} className="relative flex scroll-mt-20 gap-4 sm:gap-5">
          {/* The connecting line of the diagram (decorative). */}
          {i < steps.length - 1 ? (
            <span aria-hidden="true" className="absolute top-14 bottom-[-1.25rem] left-6 w-0.5 -translate-x-1/2 bg-line sm:left-7" />
          ) : null}
          <span
            aria-hidden="true"
            className="relative z-10 flex size-12 shrink-0 items-center justify-center rounded-2xl bg-ink text-on-ink sm:size-14"
          >
            <s.icon className="size-6" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-3xl bg-card p-5 ring-1 ring-border sm:p-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h3 className="text-xl leading-tight font-extrabold text-ink">
                <span className="text-muted-foreground">Step {i + 1}.</span> {s.title}
              </h3>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${WHO_CLASS[s.who]}`}>{WHO_LABEL[s.who]}</span>
            </div>
            <div className="flex flex-col gap-2 leading-relaxed text-card-foreground">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

const bullets = "flex list-disc flex-col gap-1.5 pl-5";

export default function HowItWorksPage() {
  const modelId = configuredModelId();
  const limits = limitsConfig();
  const serp = serpapiCaps();
  const always = DROP_REASONS.filter((r) => DROP_REASON_INFO[r].kind === "always");
  const softer = DROP_REASONS.filter((r) => DROP_REASON_INFO[r].kind !== "always");

  const steps: Step[] = [
    {
      id: "park",
      icon: Search,
      who: "code",
      title: "Find the park",
      body: (
        <>
          <p>
            You type a town, a ZIP code or a park name, or press &quot;Use my location&quot; (rounded in your browser to
            about 1 km). Code looks the place up with OpenStreetMap&apos;s Nominatim search and lists named parks and nature
            reserves within 5 km from the Overpass API (the 10 nearest).
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
      body: (
        <>
          <p>Code fills three lists (we call them pools). Each item keeps where it came from and when.</p>
          <ul className={bullets}>
            <li>
              <strong>Park Finds:</strong> what is mapped inside the park&apos;s outline on OpenStreetMap (courts,
              playgrounds, shelters, bridges, benches, ponds...), with the map&apos;s own count and a short fact sheet that
              code writes for each kind.
            </li>
            <li>
              <strong>Wild Finds:</strong> species people photographed within {WILD_RADIUS_KM} km in the last{" "}
              {WILD_WINDOW_DAYS} days on iNaturalist, research grade only, each with the first sentences of its Wikipedia
              summary. A species whose summary never says how it looks is left out (a clue could only be generic).
            </li>
            <li>
              <strong>Lucky Finds:</strong> &quot;maybe&quot; finds (a dog, a bike, ducks or a skateboard). Code finds the same
              park on Google Maps through SerpApi and counts reviews from the last {WINDOW_MONTHS / 12} years whose own text
              mentions the thing. A keyword needs at least {MIN_MENTIONS} such reviews. Only the word, the count and the newest
              month are kept: review text is never stored, shown or sent to the AI.
            </li>
          </ul>
          <p>
            From {OCTOBER_WINDOW_LABEL} code also counts monarch butterflies seen within {MONARCH_RADIUS_KM} km in the last
            14 full days, next to the same days last year, and checks for milkweed within {MILKWEED_RADIUS_KM} km. That box is
            all code; the AI never sees it.
          </p>
        </>
      ),
    },
    {
      id: "safety",
      icon: ShieldCheck,
      who: "code",
      title: "Take out anything unsafe",
      body: (
        <>
          <p>
            Before the model sees the list, code removes every species in {BLOCKED_TAXA.length} blocked groups (venomous
            snakes and spiders, fire ants, poison ivy, stinging plants and caterpillars...) by its iNaturalist taxon id and
            all of its parent groups. The same check runs again on every item the model picks, and a clue that even names a
            blocked thing is removed.
          </p>
          <p>
            Every Wild Find gets a fixed safety line written by code (&quot;Look, don&apos;t touch.&quot;), and
            a pond or creek gets &quot;Stay with your grown-up near water.&quot; The model never decides what is safe.
          </p>
        </>
      ),
    },
    {
      id: "model",
      icon: PenLine,
      who: "model",
      title: "One call to an open model writes the clues",
      body: (
        <>
          <p>
            The server makes <strong>one</strong> request to <code>{modelId}</code>
            {modelId === "gemma-4-31B-it" ? " (Google's Gemma 4, open weights, Apache-2.0)" : ""} on DigitalOcean serverless
            inference in the US. There is no automatic switch to another model: if it fails, the pass says so. The model can
            be changed with one setting (<code>MODEL_ID</code>), and every pass names the model that really answered.
          </p>
          <p>
            <strong>What the model is given:</strong> the park&apos;s name; for each item an id, its section, its kind and its
            fact text (the OpenStreetMap fact sheet, the Wikipedia sentences, or a Lucky Find line such as &quot;reviews from
            the last two years mention dogs&quot;); the age band&apos;s rules (how many finds: {AGE_BAND_INFO["4-6"].items}{" "}
            for ages 4-6, {AGE_BAND_INFO["6-10"].items} for 6-10, {AGE_BAND_INFO["10-13"].items} with{" "}
            {AGE_BAND_INFO["10-13"].hardMin} hard ones for 10-13, and the reading level); the month; and, when the park has a
            landmark, the one place code picked for Find This Spot.
          </p>
          <p>
            <strong>What it is NOT given:</strong> review text, reviewer names or review counts, and anything about you or
            your child (no name, no location, no IP address, nothing you typed).
          </p>
          <p>
            <strong>What it sends back:</strong> a strict JSON answer whose shape (a JSON schema) only allows the real ids
            from the list. For each item: the id, a short clue, an optional &quot;look where&quot; hint, easy / medium / hard,
            and a proof quote copied from the item&apos;s facts. Plus one riddle for the Find This Spot X. It waits at most{" "}
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
      body: (
        <>
          <p>
            The model&apos;s answer is never trusted as it is. Code checks each clue, one by one, and removes it for any of
            these reasons:
          </p>
          <ul className={bullets} aria-label="Reasons a clue is removed">
            {always.map((r) => (
              <li key={r}>
                {DROP_REASON_INFO[r].plain} <code className="text-sm text-muted-foreground">{r}</code>
              </li>
            ))}
          </ul>
          <p>
            Some checks are about style, not truth. A clue that fails one is only the first to go when a spare clue can take
            its place:
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
            Safety, the proof quote, name leaks, numbers and counts are never relaxed. A &quot;look where&quot; hint that
            names the answer (or says &quot;map&quot; on a pass with no map) is left off, and the clue stays.
          </p>
        </>
      ),
    },
    {
      id: "retry",
      icon: RotateCcw,
      who: "code",
      title: "Refill once, or print it short",
      body: (
        <>
          <p>
            On a park with little data, the model is asked for one spare item. If fewer than all but one of the finds survive
            the checks, code asks the model <strong>once more</strong>:
          </p>
          <ul className={bullets}>
            <li>
              When some clues were kept, the second call is a <strong>refill</strong>: it asks only for the missing finds
              (plus one spare), from items not used yet, skips items whose clue already failed when it can, and tells the
              model which words it copied or which clues were too generic.
            </li>
            <li>When nothing was kept, the second call is the whole request again.</li>
            <li>
              A network error or a server error is tried once more inside the same call. A timeout is not retried, and the
              second call only starts when at least 20 s of the pass&apos;s 85 s budget is left.
            </li>
          </ul>
          <p>
            If the pass is still short, it prints what passed and says how many finds are missing. It is never padded with
            made-up items. A section with no data says &quot;No data available&quot; and why.
          </p>
        </>
      ),
    },
    {
      id: "spot",
      icon: MapPinned,
      who: "code",
      title: "Find This Spot and the October box",
      body: (
        <>
          <p>
            Code picks one real place in the park from OpenStreetMap: a landmark the park has only one of (a picnic
            shelter, a playground, a bridge), or else the middle of one sports field. It draws a black-and-white map of the
            park&apos;s paths with an X on that place, a START at the nearest mapped parking lot or entrance, a north arrow and
            a scale. The walking distance and direction on the grown-up&apos;s stub are measured by code.
          </p>
          <p>
            The model writes the riddle in the same call, from that place&apos;s fact sheet. The riddle gets the same checks
            (proof quote, no name, no new numbers). If it fails, or the map arrives late (code waits about 2 s before the model
            call and 3 s after it), the pass uses a fixed riddle written by code. A park with nothing to point at gets
            &quot;No Find This Spot today&quot;.
          </p>
          <p>
            The October special box (monarch counts and milkweed, step 2) is written entirely by code, with its numbers and
            dates.
          </p>
        </>
      ),
    },
    {
      id: "print",
      icon: Printer,
      who: "you",
      title: "Print one page",
      body: (
        <>
          <p>
            One US Letter page, black and white (A4 works too). The kid&apos;s pass is on top: the finds with tick boxes, each
            with its safety line and where its fact came from in small print, the Find This Spot map and riddle, and the
            October box. Then a dashed tear line. Below it, the grown-up&apos;s stub: the answers, the safety notes, the sources
            with their dates, and the model that answered and when.
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
      body: (
        <>
          <p>
            A finished pass is saved per park, age band and day (Chicago time) for 30 days, so the next visitor gets it at
            once and the link and print page keep working. &quot;Make a different pass&quot; can make up to {MAX_VARIANTS} per
            day. Park data is saved too: park map features 7 days, park outlines for the map 7 days, the iNaturalist sightings
            list 6 hours, species summaries 7 days, Lucky Find counts 30 days, place searches 30 days, park lists 7 days. A
            failed lookup (for example a map server that timed out) is usually remembered for 15 minutes, so a busy server is not
            asked again and again.
          </p>
          <p>Daily limits, so the free model budget and the free public map servers stay fair:</p>
          <ul className={bullets}>
            <li>
              At most {limits.aiDailyCap} model calls a day for everyone together ({limits.aiReservePct}% kept for the
              example parks).
            </li>
            <li>
              Each internet address: {limits.passPerIpPerDay} new passes a day ({limits.passPerIpPerMin} a minute) and{" "}
              {limits.parksPerIpPerDay} new park searches a day; {limits.parksDailyCap} new park searches a day for everyone.
            </li>
            <li>
              Lucky Finds: {serp.daily} SerpApi searches a day and {serp.monthly} a month (the free plan).
            </li>
            <li>A pass that came out degraded (a source was down) is rebuilt at most 3 times a day.</li>
          </ul>
          <p>When a limit is reached, the page says so in plain words; saved passes and the example passes keep working.</p>
        </>
      ),
    },
  ];

  return (
    <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-14 px-5 py-10 focus:outline-none sm:py-14">
      <TicketCard as="section" aria-labelledby="how-title">
        <div className="flex flex-col gap-3">
          <p className="text-xs font-bold tracking-widest text-primary uppercase">How it works</p>
          <h1 id="how-title" className="text-5xl leading-[0.95] font-extrabold tracking-tighter text-balance text-ink">
            How Grass Pass works
          </h1>
          <p className="text-lg font-semibold">The data, the open model, and the checks in between.</p>
          <nav aria-label="On this page">
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold">
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
                  <a className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" href={href}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </TicketCard>

      <Section id="quick" eyebrow="The 30-second version" title="Pick a park. Print a pass. Phone away.">
        <ol className="flex list-decimal flex-col gap-2 pl-6 text-lg leading-relaxed">
          <li>A grown-up picks a real park and the child&apos;s age (4-6, 6-10 or 10-13).</li>
          <li>
            Grass Pass reads that park&apos;s real data: its map, what people spotted nearby in the last {WILD_WINDOW_DAYS}{" "}
            days, and how often visitor reviews mention dogs or bikes.
          </li>
          <li>One call to an open AI model picks a fair mix and writes kid-sized clues. Code checks every clue against its source.</li>
          <li>
            You print one black-and-white page: the kid&apos;s pass with tick boxes, a tear line, and a stub for the grown-up
            with the answers, safety notes and sources.
          </li>
        </ol>
        <p>
          A new pass usually takes 10-30 seconds. If a source has nothing for a park, the pass says &quot;No data
          available&quot; and why. It never fills the gap with made-up items.
        </p>
      </Section>

      <Section id="steps" eyebrow="Step by step" title="From a park name to a printed page">
        <p>
          Each step says who does it: <strong>code</strong> (our own program, the same every time) or{" "}
          <strong>the open model</strong> (the AI). The AI does one step.
        </p>
        <Steps steps={steps} />
      </Section>

      <Section id="ai-role" eyebrow="What the AI does and doesn't do" title="The AI picks and writes. Code does the rest.">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-3xl bg-card p-5 ring-1 ring-border">
            <h3 className="text-lg font-extrabold text-ink">The AI does</h3>
            <ul className={bullets}>
              <li>Pick which items from the list go on the pass (inside the mix code allows).</li>
              <li>Write a short clue for each one in kid words, plus an optional &quot;look where&quot; hint.</li>
              <li>Say how hard each find is.</li>
              <li>Copy a proof quote from each item&apos;s facts.</li>
              <li>Write the Find This Spot riddle.</li>
            </ul>
          </div>
          <div className="flex flex-col gap-2 rounded-3xl bg-card p-5 ring-1 ring-border">
            <h3 className="text-lg font-extrabold text-ink">Code does</h3>
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
        <p>
          Code never rewrites a clue to make it pass. The only two edits it makes: it takes a filler opener (&quot;Quick!&quot;,
          &quot;Psst,&quot;) off the front, and it turns the question mark after a command (&quot;Track 3 fields?&quot;) into a
          full stop. The AI can never add an item: the answer&apos;s schema only allows ids from the park&apos;s own list.
        </p>
      </Section>

      <Section id="why-open" eyebrow="Why an open model" title="Open weights, our own rules">
        <ul className={bullets}>
          <li>
            <strong>The licence is open.</strong> Gemma 4&apos;s weights are released under Apache-2.0: anyone can download,
            run and build on them.
          </li>
          <li>
            <strong>It can be self-hosted.</strong> The app talks to any OpenAI-compatible server (for example Ollama on your
            own computer). We have <em>not</em> measured a self-hosted run for this app yet.
          </li>
          <li>
            <strong>The safety rules live in our code, not in a vendor&apos;s.</strong> The same checks run on any model;
            Llama 4 Maverick went through the same code in our test.
          </li>
        </ul>
        <p>
          What we measured, on {EVAL_PARKS} real parks, age band 6-10, run <code>{runId}</code> on {EVAL_DAY} (
          <a className={ext} href={resultsUrl}>
            full results
          </a>
          ):
        </p>
        <div className="overflow-x-auto rounded-3xl bg-card ring-1 ring-border" role="region" aria-labelledby="measured-caption" tabIndex={0}>
          <table className="w-full min-w-[520px] border-collapse text-left text-base">
            <caption id="measured-caption" className="px-4 pt-3 pb-2 text-left font-bold">
              Gemma 4 31B, {gemma.runs} runs, run {runId} ({EVAL_DAY})
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
              {[
                ["Cost per pass (DigitalOcean list prices)", usd(gemma.costPerPass), `${usd(EVAL_THRESHOLDS.costPerPass)} or less`, gemma.costPerPass <= EVAL_THRESHOLDS.costPerPass],
                [
                  "Model time per call, typical / slow",
                  `${secs(gemma.p50s)} / ${secs(gemma.p95s)}`,
                  `${EVAL_THRESHOLDS.p50s} s / ${EVAL_THRESHOLDS.p95s} s`,
                  (gemma.p50s ?? Infinity) <= EVAL_THRESHOLDS.p50s && (gemma.p95s ?? Infinity) <= EVAL_THRESHOLDS.p95s,
                ],
                ["Complete passes (at most 1 find missing)", `${pct(gemma.completePct)} (${gemma.complete}/${gemma.dataRichRuns})`, `${EVAL_THRESHOLDS.completePct}% or more`, gemma.completePct >= EVAL_THRESHOLDS.completePct],
                ["Reading level (grade, median)", gemma.fkGrade.toFixed(1), `${EVAL_THRESHOLDS.fkGrade} or lower`, gemma.fkGrade <= EVAL_THRESHOLDS.fkGrade],
                ["Clues quoting their source word for word, before the checks", pct(gemma.groundedPct), `${EVAL_THRESHOLDS.groundedPct}% or more`, gemma.groundedPct >= EVAL_THRESHOLDS.groundedPct],
                ["Blocked species printed", String(gemma.blockedPrinted), "0", gemma.blockedPrinted === 0],
                ["Clues repeated across parks", pct(gemma.repeatPct), `${EVAL_THRESHOLDS.repeatPct}% or lower`, gemma.repeatPct <= EVAL_THRESHOLDS.repeatPct],
              ].map(([what, measured, target, ok]) => (
                <tr key={String(what)} className="border-b border-line last:border-b-0">
                  <th scope="row" className="px-4 py-2 font-semibold">
                    {what}
                  </th>
                  <td className="px-4 py-2">{measured}</td>
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
          The newest results file is a smaller check for ages {SMOKE_10_13.ageBand} (run <code>{smokeId}</code>,{" "}
          {SMOKE_10_13.day}, {SMOKE_10_13.parks} parks, one run each,{" "}
          <a className={ext} href={smokeUrl}>
            results
          </a>
          ): {SMOKE_10_13.complete} of {SMOKE_10_13.parks} passes complete, reading grade {SMOKE_10_13.fkGrade}, model time{" "}
          {SMOKE_10_13.p50s} s typical and {SMOKE_10_13.p95s} s slow, and {usd(SMOKE_10_13.costPerPass)} per pass, which is{" "}
          <strong>over</strong> the {usd(EVAL_THRESHOLDS.costPerPass)} target (the 10-13 pass is longer). Before the checks,{" "}
          {SMOKE_10_13.nameLeakPct}% of its clues named their own answer; code removed all of them before printing. It is a
          partial run, not the frozen numbers.
        </p>
      </Section>

      <Section id="limits" eyebrow="Honest limits" title="What does not work yet">
        <ul className={bullets}>
          <li>
            <strong>Speed is just over target</strong> ({secs(gemma.p50s)} typical, {secs(gemma.p95s)} slow per model call;
            target {EVAL_THRESHOLDS.p50s} s / {EVAL_THRESHOLDS.p95s} s), and {gemma.timeouts} model calls in {gemma.runs} test passes
            hit the {MODEL_TIMEOUT_MS / 1000} s limit.
          </li>
          <li>
            <strong>Clues still repeat across parks a little</strong> ({pct(gemma.repeatPct)}; target{" "}
            {EVAL_THRESHOLDS.repeatPct}%).
          </li>
          <li>
            <strong>Parks with little data make shorter passes.</strong> A short pass says how many finds are missing. Some
            parks had no research-grade sightings in the last {WILD_WINDOW_DAYS} days.
          </li>
          <li>
            <strong>The kid check is not done yet.</strong> A grown-up reading 10 printed clues as a 7-year-old would is
            planned; until then it is pending, not passed.
          </li>
          <li>
            <strong>Lucky Finds run on a free plan</strong> ({serp.daily} searches a day). A count means visitors wrote about
            a thing, not that it is there today, so the pass says &quot;maybe&quot;.
          </li>
          <li>
            <strong>Public map servers can be busy</strong>, mostly in the US evening. Then a park search may use the saved
            Dallas-area list, and a new pass may say its map data could not be fetched in time.
          </li>
          <li>
            <strong>Find This Spot is not in the eval</strong> (its map data was not recorded for the test parks), and a
            self-hosted model run has not been measured.
          </li>
          <li>
            <strong>The model runs on DigitalOcean&apos;s servers</strong>, so the park facts and the age band leave your
            device.
          </li>
        </ul>
        <p>
          The full list, with the numbers, is on the{" "}
          <Link className={ext} href="/about#why-open">
            About page
          </Link>{" "}
          and in the README.
        </p>
      </Section>

      <Section id="privacy" eyebrow="Privacy in short" title="Nothing about your child">
        <ul className={bullets}>
          <li>No accounts, no names, no photos, no cookies, no analytics.</li>
          <li>The place you type goes to our server and OpenStreetMap&apos;s search, never in the web address.</li>
          <li>&quot;Use my location&quot; is rounded to about 1 km in your browser first.</li>
          <li>Your IP address is only kept as a scrambled code inside rate-limit counters that delete themselves within about a day.</li>
          <li>The model sees the park&apos;s public facts and the age band, nothing about you.</li>
          <li>Your browser keeps only your light or dark choice and the last age band.</li>
        </ul>
        <p>
          The full table of what leaves your device, where it goes and why is on the{" "}
          <Link className={ext} href="/about#privacy">
            About page
          </Link>
          .
        </p>
      </Section>

      <Section id="built" eyebrow="How this app was built" title="Built in the contest week, with AI coding agents">
        <p>
          Grass Pass was built during the Hacktoberfest 2026 Week 1 entry period; the first commit is from Oct 5, 2026. Kevin
          made the decisions. AI coding agents (Claude Code) wrote most of the code as &quot;builders&quot; and reviewed it as
          &quot;auditors&quot;.
        </p>
        <ul className={bullets}>
          <li>
            Each audit round runs five separate reviews: contest rules, security, quality, accessibility and design, and a
            judge simulator. The builders then fix what they found. Three audit rounds have run so far.
          </li>
          <li>
            Every change is checked before it is merged: lint, type checks, more than 800 unit tests on recorded real API
            answers, a production build, and browser tests with automatic accessibility checks.
          </li>
          <li>
            Claude helped build the app. It never writes a pass: the clues on every pass come from the open model named on
            that pass.
          </li>
        </ul>
        <p className="flex flex-wrap gap-3">
          <a className={buttonClassName("secondary")} href={REPO_URL}>
            Source code on GitHub (MIT)
          </a>
          <Link className={buttonClassName("primary")} href="/" prefetch={false}>
            Make a pass
          </Link>
        </p>
      </Section>
    </main>
  );
}
