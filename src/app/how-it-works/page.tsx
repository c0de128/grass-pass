import {
  ArrowRight,
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
  Timer,
  TriangleAlert,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AiJobs } from "@/components/how/AiJobs";
import { Blueprint } from "@/components/how/Blueprint";
import { ProofNumbers } from "@/components/how/ProofNumbers";
import { RunsOnDo } from "@/components/how/RunsOnDo";
import { buttonClassName } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { OpenOnHash } from "@/components/ui/OpenOnHash";
import { EVAL_RUN_ID, UNIT_TESTS, aboutLimitPoints, auditRoundsLine, costHighNote, howLimits, howPrivacyPoints, pct, secs, usd } from "@/lib/about/content";
import { accountPassesPerDay, anonPassesPerIpPerDay, freePassesPerDay, freePassRule, judgeShareCopy, signInWith } from "@/lib/accounts/config";
import { REPORT_COPY } from "@/lib/reports/kinds";
import { EVAL_DAY, EVAL_PARKS, EVAL_SUMMARY_FILE, EVAL_THRESHOLDS, GEMMA_FIRST_CALL_P50_S, GEMMA_P50_EXACT_S, GEMMA_RUN_FIRST_CALL_LIMIT_S, GEMMA_TOKENS_PER_S, PREVIOUS_RUN, SMOKE_10_13, SMOKE_13PLUS, evalColumn } from "@/lib/about/eval-summary";
import { HARD_EXTRA } from "@/lib/ai/prompt";
import { DROP_REASONS } from "@/lib/ai/validate";
import { DROP_REASON_INFO } from "@/lib/how/drop-reasons";
import { services } from "@/lib/how/services";
import { limitsConfig } from "@/lib/limits/config";
import { serpapiCaps } from "@/lib/limits/serpapi";
import { configuredModelId, modelTimeoutCapMs } from "@/lib/model";
import { FIRST_CALL_MAX_MS, PASS_DEADLINE_MS, REFILL_MAX_MS, REFILL_MIN_MS } from "@/lib/pass/budget";
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

/*
 * Kevin, 2026-10-09 (option A, "Blueprint"): "I want the how-it-works page to be for the judges of the hackathon. It
 * should be a page that shows the services the app uses and how it implements AI ... easy to understand and not too
 * wordy." One architecture diagram (src/components/how/Blueprint.tsx), the model's three jobs with real recorded
 * examples (AiJobs.tsx), real numbers (ProofNumbers.tsx), a services table, and one line each for limits and privacy.
 * Every detail the old long page had stays reachable in closed disclosures at the bottom ("Under the hood").
 */

const ext = "font-semibold text-link underline underline-offset-2";

const gemma = evalColumn("gemma-4-31B-it");
const template = evalColumn("no-AI template");
const resultsUrl = `${REPO_URL}/blob/main/${EVAL_SUMMARY_FILE}`;
const smokeUrl = `${REPO_URL}/blob/main/${SMOKE_10_13.summary}`;
const smokeId = SMOKE_10_13.summary.replace(/^evals\/results\//, "").replace(/\.md$/, "");
const smoke13Url = `${REPO_URL}/blob/main/${SMOKE_13PLUS.summary}`;
const smoke13Id = SMOKE_13PLUS.summary.replace(/^evals\/results\//, "").replace(/\.md$/, "");

/** A section with the site's section head (eyebrow + big title) over the shared container. */
function Section({ id, eyebrow, title, intro, tone = "plain", children }: { id: string; eyebrow: string; title: string; intro?: ReactNode; tone?: "plain" | "muted"; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`scroll-mt-4 sm:scroll-mt-0 ${tone === "muted" ? "bg-muted/70" : ""}`}>
      <div className="gp-container flex flex-col gap-8 py-14 lg:py-20">
        <div className="flex max-w-3xl flex-col gap-3">
          <p className={`text-xs font-bold tracking-widest uppercase ${tone === "muted" ? "text-link" : "text-primary"}`}>{eyebrow}</p>
          <h2 id={`${id}-title`} className="text-4xl leading-[1] font-extrabold tracking-tight text-balance text-ink sm:text-5xl">
            {title}
          </h2>
          {intro ? <p className="max-w-[60ch] text-lg leading-relaxed text-pretty">{intro}</p> : null}
        </div>
        {children}
      </div>
    </section>
  );
}

type Who = "code" | "model" | "you";
const WHO_LABEL: Record<Who, string> = { code: "Done by code", model: "Done by the open model", you: "Done by you" };

/** A step of the detailed walk-through (folded at the bottom of the page): its summary and its full detail. */
type Step = { id: string; icon: LucideIcon; who: Who; title: string; summary: ReactNode; more?: ReactNode };

function Steps({ steps }: { steps: readonly Step[] }) {
  return (
    <ol aria-label="How a pass is made, step by step" className="flex flex-col gap-6">
      {steps.map((s, i) => (
        <li key={s.id} id={`step-${s.id}`} className="flex scroll-mt-4 flex-col gap-2 border-l-4 border-line pl-4 sm:scroll-mt-3">
          <h4 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-lg leading-tight font-extrabold text-ink">
            <s.icon aria-hidden="true" className="size-5 shrink-0" />
            <span>
              <span className="text-muted-foreground">Step {i + 1}.</span> {s.title}
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${s.who === "model" ? "bg-sun text-sun-foreground" : s.who === "you" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
              {WHO_LABEL[s.who]}
            </span>
          </h4>
          <p className="max-w-[70ch]">{s.summary}</p>
          {s.more ? <div className="flex max-w-[75ch] flex-col gap-3 text-[0.95rem] text-muted-foreground [&_strong]:text-foreground">{s.more}</div> : null}
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
  const speedMet = (gemma.p50s ?? Infinity) <= EVAL_THRESHOLDS.p50s && (gemma.p95s ?? Infinity) <= EVAL_THRESHOLDS.p95s;
  const speedMetBefore = PREVIOUS_RUN.p50s <= EVAL_THRESHOLDS.p50s && PREVIOUS_RUN.p95s <= EVAL_THRESHOLDS.p95s;
  const p50Met = (gemma.p50s ?? Infinity) <= EVAL_THRESHOLDS.p50s;
  const smokeP50Over = SMOKE_10_13.p50s > EVAL_THRESHOLDS.p50s;
  const smokeP95Over = SMOKE_10_13.p95s > EVAL_THRESHOLDS.p95s;
  const all = services();
  // The model itself is not counted as an outside service (judge R11); DigitalOcean, which serves it, is.
  const outside = all.filter((s) => s.group !== "model");
  const limitsList = howLimits();
  const aiPrivacy = howPrivacyPoints().find((p) => p.startsWith("The AI sees")) ?? "";

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
          one call; step 6 is the exception. The trip tips are one more call.
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
            {AGE_BAND_INFO["10-13"].items} with {AGE_BAND_INFO["10-13"].hardMin} hard ones for 10-13,{" "}
            {AGE_BAND_INFO["13+"].items} with {AGE_BAND_INFO["13+"].hardMin} hard ones for teens and adults (13+), and a reading
            level); the
            month; and the Find This Spot place, if code picked one. For the bands with hard finds, the model is asked for{" "}
            {HARD_EXTRA === 1 ? "one" : HARD_EXTRA} more hard {HARD_EXTRA === 1 ? "find" : "finds"} than the pass promises (
            {AGE_BAND_INFO["10-13"].hardMin + HARD_EXTRA} for 10-13, {AGE_BAND_INFO["13+"].hardMin + HARD_EXTRA} for 13+), as a
            spare, so one dropped hard clue still leaves the promised number.
          </p>
          <p>
            <strong>What it is NOT given:</strong> review text, reviewer names or review counts, and nothing about you or your
            child (no name, location, IP address or anything you typed).
          </p>
          <p>
            <strong>What it sends back:</strong> strict JSON whose schema only allows the real ids. For each find: the id, a
            clue, an optional &quot;look where&quot; hint, easy / medium / hard, and a proof quote from its facts. Plus the
            riddle. Its time limit fits the answer it asks for: up to {Math.min(FIRST_CALL_MAX_MS, modelTimeoutCapMs() ?? FIRST_CALL_MAX_MS) / 1000} s for the first call.
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
            Code never rewrites what a clue says. It makes four small edits: it cuts a filler opener (&quot;Quick!&quot;,
            &quot;Psst,&quot;), turns &quot;?&quot; after a command (&quot;Track 3 fields?&quot;) into a full stop, swaps a worn-out
            opening (&quot;Somewhere you will see a&quot;) for a plain word (&quot;Spot a&quot;), and says &quot;What&quot;, not
            &quot;Who&quot;, for a plant, fungus or lichen.
          </p>
        </>
      ),
    },
    {
      id: "retry",
      icon: RotateCcw,
      who: "code",
      title: "Refill, or print it short",
      summary: "Too few clues pass the check? Code asks the AI again for the missing ones (at most 3 clue calls per pass). Still short? We list how many are missing. No made-up filler.",
      more: (
        <>
          <p>
            Little data: the model is asked for one spare. More than one find lost: code asks <strong>again</strong>, at most 3 clue calls per pass (plus 1 for the trip tips):
          </p>
          <ul className={bullets}>
            <li>
              Some clues kept: a <strong>refill</strong> for the missing finds (plus up to two spares) from unused facts, naming what
              was copied or too generic.
            </li>
            <li>If nothing was kept, it is the whole request again.</li>
            <li>
              A first call that fails (timeout, network or server error, or an unusable answer) gets one whole retry, cut to the finds an answer can carry in the time left. A pass still short after a refill gets one more refill. Limits come from measured answer sizes and slow-evening speeds: a refill gets {REFILL_MIN_MS / 1000}-{REFILL_MAX_MS / 1000} s, the whole pass {PASS_DEADLINE_MS / 1000} s. A short &quot;403&quot; refusal is asked once more after 1 s.
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
      summary: `Passes are saved for 30 days. ${freePassRule(freePassesPerDay(), accountPassesPerDay())} Daily limits protect the model budget and the free map servers.`,
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
            <li>A pass made while a source was down is rebuilt at most 3 times a day, not counted toward anyone&apos;s daily passes.</li>
            <li>
              Without signing in: {freePassesPerDay()} free new pass a day per browser, counted by one small signed cookie (the
              date and a count, no ID), and at most {anonPassesPerIpPerDay()} signed-out new passes a day per internet address.
            </li>
            <li>
              Signed in{signInWith()}: {accountPassesPerDay()} new passes a day each. Judges can press &quot;Try as a judge&quot;:{" "}
              {judgeShareCopy()}
            </li>
          </ul>
          <p>Reports: {REPORT_COPY.rule}</p>
          <p>At a limit, the page says so; saved and example passes keep working.</p>
        </>
      ),
    },
  ];

  const measured: [string, string, string, boolean][] = [
    ["Cost per pass for the clues (DigitalOcean list prices; trip tips add one more short call)", `${usd(gemma.costPerPass)} (${costHighNote()})`, `${usd(EVAL_THRESHOLDS.costPerPass)} or less`, gemma.costPerPass <= EVAL_THRESHOLDS.costPerPass],
    ["Model time per call, typical / slow", `${secs(gemma.p50s)} / ${secs(gemma.p95s)}`, `${EVAL_THRESHOLDS.p50s} s / ${EVAL_THRESHOLDS.p95s} s`, speedMet],
    ["Complete passes (at most 1 find missing)", `${pct(gemma.completePct)} (${gemma.complete}/${gemma.dataRichRuns})`, `${EVAL_THRESHOLDS.completePct}% or more`, gemma.completePct >= EVAL_THRESHOLDS.completePct],
    ["Reading level (grade, median)", gemma.fkGrade.toFixed(1), `${EVAL_THRESHOLDS.fkGrade} or lower`, gemma.fkGrade <= EVAL_THRESHOLDS.fkGrade],
    ["Clues quoting their source word for word, before the checks", pct(gemma.groundedPct), `${EVAL_THRESHOLDS.groundedPct}% or more`, gemma.groundedPct >= EVAL_THRESHOLDS.groundedPct],
    ["Blocked species printed", String(gemma.blockedPrinted), "0", gemma.blockedPrinted === 0],
    ["Clues repeated across parks", pct(gemma.repeatPct), `${EVAL_THRESHOLDS.repeatPct}% or lower`, gemma.repeatPct <= EVAL_THRESHOLDS.repeatPct],
  ];

  const GROUP_LABEL = { data: "Data", model: "Open model", platform: "Platform" } as const;

  return (
    <main id="main" tabIndex={-1} className="flex w-full flex-1 flex-col focus:outline-none">
      <OpenOnHash />

      <section aria-labelledby="how-title" className="grain">
        <div className="gp-container flex flex-col gap-5 pt-14 pb-10 lg:pt-20 lg:pb-12">
          <p className="text-xs font-bold tracking-widest text-primary uppercase">How it works</p>
          <h1 id="how-title" className="-mt-2 text-5xl leading-[0.95] font-extrabold tracking-tighter text-balance text-ink sm:text-6xl lg:text-7xl">
            How a park becomes a pass.
          </h1>
          <p className="max-w-[55ch] text-xl leading-relaxed text-pretty sm:text-2xl">
            Real park data in. One open AI model writes. Code checks every line. Paper out.
          </p>
          <ul aria-label="In short" className="flex flex-wrap gap-2">
            {[
              { icon: Scale, text: modelId === "gemma-4-31B-it" ? "Gemma 4 · open weights, Apache-2.0" : "Open weights, Apache-2.0" },
              { icon: Database, text: `${outside.length} outside services, all listed below` },
              { icon: ListChecks, text: `${always.length} code checks on every clue` },
            ].map((c) => (
              <li key={c.text} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-card px-4 text-sm font-semibold text-ink shadow-sm ring-1 ring-border">
                <c.icon aria-hidden="true" className="size-4 text-primary" />
                {c.text}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Section
        id="blueprint"
        eyebrow="The blueprint"
        title="Every service, and where the AI sits"
        intro="Follow the arrows: real data, code, one open model, code again, paper."
      >
        <Blueprint hardRules={always.length} blockedGroups={BLOCKED_TAXA.length} modelId={modelId} />
      </Section>

      <Section
        id="ai"
        tone="muted"
        eyebrow="Where the AI is"
        title="The AI picks and writes. Code does the rest."
        intro="The AI cannot invent finds because it can only use ids from the park's own fact list."
      >
        <AiJobs />
        <RunsOnDo />
        <div id="why-open" className="gp-band flex scroll-mt-4 flex-col gap-6 rounded-3xl bg-band p-6 text-band-foreground sm:scroll-mt-3 sm:p-8 xl:flex-row xl:items-start xl:gap-10">
          <div className="flex flex-col gap-2 xl:w-1/4 xl:shrink-0">
            <p className="text-xs font-bold tracking-widest text-sun uppercase">Why an open model</p>
            <h3 className="text-3xl leading-tight font-extrabold">Open weights, our own rules</h3>
          </div>
          <ul className="grid flex-1 gap-5 md:grid-cols-3">
            {[
              { icon: Scale, title: "The licence is open.", body: "Gemma 4's weights are Apache-2.0: anyone can download, run and build on them." },
              {
                icon: Hammer,
                title: "It can be self-hosted.",
                body: "Any OpenAI-compatible server, like Ollama. On a laptop CPU it costs $0, but it is slow.",
              },
              {
                icon: ShieldCheck,
                title: "Our rules, not a vendor's.",
                body: "The same checks run on any model; Llama 4 Maverick went through them in our test.",
              },
            ].map((c) => (
              <li key={c.title} className="flex flex-col gap-1.5">
                <h4 className="flex items-center gap-2 text-lg font-extrabold">
                  <c.icon aria-hidden="true" className="size-5 shrink-0 text-sun" />
                  {c.title}
                </h4>
                <p className="text-sm leading-relaxed text-band-muted">{c.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section
        id="numbers"
        eyebrow="Measured"
        title="Real numbers, misses included"
        intro={
          <>
            Eval run {EVAL_RUN_ID}: {EVAL_PARKS} real parks, ages 6-10, {gemma.runs} runs (
            <a className={ext} href={resultsUrl}>
              full results
            </a>
            ).
          </>
        }
      >
        <ProofNumbers />
      </Section>

      <Section id="services" tone="muted" eyebrow="Services" title="What it runs on, and what it costs">
        <div className="overflow-hidden rounded-3xl bg-card text-card-foreground shadow-lg ring-1 shadow-shadow/40 ring-border">
          <table className="w-full border-collapse text-left" data-testid="services-table">
            <caption className="sr-only">Every outside service Grass Pass uses, what it is for, and its licence or cost</caption>
            <thead className="bg-muted/70 text-xs tracking-wider uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 sm:px-6">
                  Service
                </th>
                <th scope="col" className="px-4 py-3 sm:px-6">
                  What it&apos;s for
                </th>
                <th scope="col" className="hidden px-4 py-3 sm:px-6 md:table-cell">
                  Licence or cost
                </th>
              </tr>
            </thead>
            <tbody>
              {all.map((s) => (
                <tr key={s.id} data-service-row={s.id} className={`border-t border-border align-top ${s.group === "model" ? "bg-sun/15" : ""}`}>
                  <th scope="row" className="px-4 py-3 sm:px-6">
                    <a className="font-heading font-extrabold text-ink underline-offset-2 hover:underline" href={s.url}>
                      {s.name}
                    </a>
                    <span className="block text-xs font-semibold text-muted-foreground">{GROUP_LABEL[s.group]}</span>
                  </th>
                  <td className="px-4 py-3 sm:px-6">
                    {s.usedFor}
                    <span className="mt-1 block text-sm text-muted-foreground md:hidden">{s.terms}</span>
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground sm:px-6 md:table-cell">{s.terms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="flex flex-wrap gap-3">
          <a className={buttonClassName("secondary")} href={REPO_URL}>
            Source code on GitHub (MIT)
          </a>
          <Link className={buttonClassName("primary", "group")} href="/" prefetch={false}>
            Make a pass
            <ArrowRight aria-hidden="true" className="size-5 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" />
          </Link>
        </p>
      </Section>

      <Section id="fine-print" eyebrow="Fine print" title="Limits, privacy and every detail">
        <div className="grid gap-4 md:grid-cols-2">
          <article id="limits" aria-labelledby="limits-title" className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-3xl bg-card p-6 ring-1 ring-border [overflow-wrap:anywhere] sm:scroll-mt-3">
            <h3 id="limits-title" className="flex items-center gap-2 text-2xl font-extrabold text-ink">
              <TriangleAlert aria-hidden="true" className="size-6 shrink-0" />
              Where we fall short
            </h3>
            <p>
              {aboutLimitPoints()[0]} All of them:{" "}
              <Link className={ext} href="/about#limits-detail">
                About page
              </Link>
              .
            </p>
            <Disclosure id="limits-detail" tone="inset" level={4} title={`All ${limitsList.length} limits, with the numbers`}>
              <ul className={bullets}>
                {limitsList.map((l) => (
                  <li key={l.title}>
                    <strong>{l.title}</strong> {l.detail}
                  </li>
                ))}
              </ul>
            </Disclosure>
          </article>
          <article id="privacy" aria-labelledby="privacy-title" className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-3xl bg-card p-6 ring-1 ring-border [overflow-wrap:anywhere] sm:scroll-mt-3">
            <h3 id="privacy-title" className="flex items-center gap-2 text-2xl font-extrabold text-ink">
              <Lock aria-hidden="true" className="size-6 shrink-0" />
              Nothing about your child
            </h3>
            <p>
              {aiPrivacy} Everything that leaves your device: the{" "}
              <Link className={ext} href="/about#privacy-table">
                About page
              </Link>
              .
            </p>
            <Disclosure id="privacy-detail" tone="inset" level={4} title="Privacy in short">
              <ul className={bullets}>
                {howPrivacyPoints().map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Disclosure>
          </article>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-bold tracking-widest text-primary uppercase">Under the hood</h3>
          <Disclosure id="steps" icon={Workflow} title="From “which park?” to “found it!”">
            <p className="max-w-[65ch]">
              Each step is handled by <strong>code</strong>, <strong>the open model</strong>, or <strong>you</strong>. The AI has
              one job: picking the finds and writing the words.
            </p>
            <Steps steps={steps} />
          </Disclosure>
          <Disclosure id="measured-detail" icon={Gauge} title={`What we measured: run ${EVAL_RUN_ID}`}>
          <p>
            On {EVAL_PARKS} parks, ages 6-10: {usd(gemma.costPerPass)} a pass for the clue calls (trip tips add one more short call), reading grade {gemma.fkGrade.toFixed(1)} (no-AI template:{" "}
            {template.fkGrade.toFixed(1)}). All numbers: the{" "}
            <Link className={ext} href="/about#measured">
              About page
            </Link>
            .
          </p>
          <p>
            {EVAL_PARKS} real parks, ages 6-10 (
            <a className={ext} href={resultsUrl}>
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
            Speed is {speedMet ? "met" : p50Met ? "met for a typical call and missed for the slow ones" : "missed"}: the typical
            call took {GEMMA_P50_EXACT_S} s, first calls alone {GEMMA_FIRST_CALL_P50_S} s, with DigitalOcean answering at{" "}
            {GEMMA_TOKENS_PER_S.now} answer tokens a second ({GEMMA_TOKENS_PER_S.before} the run before, when speed was{" "}
            {speedMetBefore ? "met" : "missed"}). Time limits are sized to each call (up to {GEMMA_RUN_FIRST_CALL_LIMIT_S} s for a
            first call). This is the first full run after the Oct 10 clue-wording rewrite; the run before is {PREVIOUS_RUN.id}. Lucky
            Finds and Find This Spot are not in this test.
          </p>
          <p>
            Ages {SMOKE_10_13.ageBand}, a smaller partial check (run <code>{smokeId}</code>, {SMOKE_10_13.day},{" "}
            {SMOKE_10_13.parks} parks, one run each,{" "}
            <a className={ext} href={smokeUrl}>
              results
            </a>
            ): {SMOKE_10_13.complete} of {SMOKE_10_13.parks} passes complete in {SMOKE_10_13.calls} model calls,{" "}
            {(SMOKE_10_13.hardKept as number) === SMOKE_10_13.parks ? `all ${SMOKE_10_13.hardKept}` : `${SMOKE_10_13.hardKept} of ${SMOKE_10_13.parks}`} with their 2 hard
            finds, grade {SMOKE_10_13.fkGrade}, {SMOKE_10_13.p50s} s typical{" "}
            {smokeP50Over && !smokeP95Over ? (
              <>
                (<strong>over</strong> the {EVAL_THRESHOLDS.p50s} s target) and {SMOKE_10_13.p95s} s slow (under {EVAL_THRESHOLDS.p95s} s)
              </>
            ) : (
              <>
                and {SMOKE_10_13.p95s} s slow ({smokeP50Over ? <strong>over</strong> : "within"} the {EVAL_THRESHOLDS.p50s} s / {EVAL_THRESHOLDS.p95s} s
                targets)
              </>
            )}
            . A finished 10-13 pass cost about{" "}
            {usd(SMOKE_10_13.costPerFinishedPass)}, which is <strong>over</strong> the {usd(EVAL_THRESHOLDS.costPerPass)} target (a
            10-13 pass is longer). Before the checks, {SMOKE_10_13.nameLeakPct}% of its clues named their answer (
            <strong>over</strong> the {EVAL_THRESHOLDS.nameLeakPct}% target); code removed them all. Only {SMOKE_10_13.calls} model
            calls, so a small sample.
          </p>
          <p>
            Teens and adults ({SMOKE_13PLUS.ageBand}), a smaller partial check (run <code>{smoke13Id}</code>, {SMOKE_13PLUS.day},{" "}
            {SMOKE_13PLUS.parks} parks, one run each,{" "}
            <a className={ext} href={smoke13Url}>
              results
            </a>
            ): {SMOKE_13PLUS.complete} of {SMOKE_13PLUS.parks} passes complete (at most one find short; {SMOKE_13PLUS.full} printed
            every find) in {SMOKE_13PLUS.calls} model calls, {SMOKE_13PLUS.hardKept} of {SMOKE_13PLUS.parks} with their{" "}
            {SMOKE_13PLUS.hardMin} hard finds, {SMOKE_13PLUS.p50s} s typical and {SMOKE_13PLUS.p95s} s slow (within the{" "}
            {EVAL_THRESHOLDS.p50s} s / {EVAL_THRESHOLDS.p95s} s targets), {SMOKE_13PLUS.nameLeakPct}% of clues named their answer
            before the checks (code removed them). A 13+ pass cost about {usd(SMOKE_13PLUS.costPerPass)}, which is{" "}
            <strong>over</strong> the {usd(EVAL_THRESHOLDS.costPerPass)} target. Its clues read at grade {SMOKE_13PLUS.fkGrade}; the
            grade {EVAL_THRESHOLDS.fkGrade} reading target is for kids and does not apply to 13+. Only {SMOKE_13PLUS.calls} model
            calls, so a small sample.
          </p>
        </Disclosure>
          <Disclosure id="built" icon={Hammer} title="Built in the contest week, with AI coding agents">
            <p className="max-w-[65ch]">
              Built during the Hacktoberfest 2026 Week 1 entry period (first commit Oct 5, 2026). Kevin made the decisions; AI coding
              agents wrote and reviewed most of the code.
            </p>
            <ul className={bullets}>
              <li>AI coding agents (Claude Code) wrote most of the code as &quot;builders&quot; and reviewed it as &quot;auditors&quot;.</li>
              <li>
                Each audit round runs five reviews (contest rules, security, quality, accessibility and design, and a judge
                simulator); builders then fix the findings. {auditRoundsLine()}
              </li>
              <li>
                GitHub Actions runs lint, type checks, {UNIT_TESTS.passed} unit tests (counted {UNIT_TESTS.day}) on recorded real API
                answers, a production build, and browser tests with accessibility checks on every push to main. Each run&apos;s
                result, green or red, is public on the repo&apos;s Actions tab.
              </li>
              <li>Claude never writes a pass: every clue comes from the open model named on that pass.</li>
            </ul>
          </Disclosure>
        </div>
      </Section>
    </main>
  );
}
