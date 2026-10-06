import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClassName } from "@/components/ui/Button";
import { TicketCard } from "@/components/ui/TicketCard";
import {
  EVAL_AGE_BAND,
  EVAL_COLUMNS,
  EVAL_DAY,
  EVAL_PARKS,
  EVAL_SUMMARY_FILE,
  EVAL_THRESHOLDS,
  EVAL_TOTAL_USD,
  evalColumn,
  type EvalColumn,
} from "@/lib/about/eval-summary";
import { configuredModelId } from "@/lib/model";
import { OCTOBER_WINDOW_LABEL } from "@/lib/october";
import { BUILT_WITH_LLAMA, isLlamaModel } from "@/lib/pass/format";
import { BLOCKED_TAXA } from "@/lib/safety/danger-taxa";
import { REPO_URL } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "About Grass Pass: how a pass is made, why open, privacy",
  description:
    "How Grass Pass builds a printable park pass from OpenStreetMap and iNaturalist data with the open Gemma 4 model, what we measured, and what leaves your device.",
};

const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
const secs = (n: number | null) => (n === null ? "no model call" : `${n.toFixed(1)} s`);
const usd = (n: number) => (n === 0 ? "$0" : `$${n.toFixed(5)}`);

const gemma = evalColumn("gemma-4-31B-it");
const llama = evalColumn("llama-4-maverick");
const template = evalColumn("no-AI template");
const resultsUrl = `${REPO_URL}/blob/main/${EVAL_SUMMARY_FILE}`;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-2xl font-bold sm:text-3xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

const ext = "underline underline-offset-2";

function EvalTable({ columns }: { columns: readonly EvalColumn[] }) {
  const rows: { label: string; plain: string; cell: (c: EvalColumn) => string; target?: string }[] = [
    {
      label: "Blocked (dangerous) species printed",
      plain: "Did a pass ever show something risky, like a snake or poison ivy? It must be zero.",
      cell: (c) => String(c.blockedPrinted),
      target: "0, always",
    },
    {
      label: "Clues quoting their source word for word, before any filter",
      plain: "How often the model copied its fact exactly from the real data, so it didn't make things up.",
      cell: (c) => `${pct(c.groundedPct)} (${c.grounded}/${c.returned})`,
      target: `${EVAL_THRESHOLDS.groundedPct}% or more`,
    },
    {
      label: "Complete passes (kept at least n-1 items)",
      plain: "How often a pass came out full: at most one find missing.",
      cell: (c) => `${pct(c.completePct)} (${c.complete}/${c.dataRichRuns})`,
      target: `${EVAL_THRESHOLDS.completePct}% or more`,
    },
    {
      label: "Honest empty sections",
      plain: "When there was no data, did the pass say so instead of filling the gap?",
      cell: (c) => pct(c.honestEmptiesPct),
      target: "100%",
    },
    {
      label: "Reading level (Flesch-Kincaid grade, median)",
      plain: "How hard the words are. 3 means a 3rd grader can read them.",
      cell: (c) => c.fkGrade.toFixed(1),
      target: `${EVAL_THRESHOLDS.fkGrade} or lower`,
    },
    {
      label: "Clues or hints naming their own answer, before the filter",
      plain: "How often a clue gave away the answer (code removes those before printing).",
      cell: (c) => `${pct(c.nameLeakPct)} (clue only ${pct(c.clueLeakPct)})`,
      target: `${EVAL_THRESHOLDS.nameLeakPct}% or lower`,
    },
    {
      label: "Model time per call, p50 / p95",
      plain: "How long the model took: a usual wait / a slow wait (1 in 20 is slower).",
      cell: (c) => (c.p50s === null ? "no model call" : `${secs(c.p50s)} / ${secs(c.p95s)}`),
      target: `${EVAL_THRESHOLDS.p50s} s / ${EVAL_THRESHOLDS.p95s} s`,
    },
    {
      label: "Cost per pass",
      plain: "What one pass costs us at the provider's list price.",
      cell: (c) => usd(c.costPerPass),
      target: `${EVAL_THRESHOLDS.costPerPass} or less`,
    },
    { label: "Licence", plain: "The rules for using the model's weights.", cell: (c) => c.licence },
  ];
  return (
    <div className="overflow-x-auto rounded-control border-2 border-line" role="region" aria-labelledby="eval-caption" tabIndex={0}>
      <table className="w-full min-w-[640px] border-collapse text-left text-base">
        <caption id="eval-caption" className="px-4 pt-3 pb-2 text-left font-bold">
          Measured on {EVAL_PARKS} real parks, age band {EVAL_AGE_BAND}, {EVAL_DAY} (same park data, same safety and grounding
          checks for every column)
        </caption>
        <thead>
          <tr className="border-b-2 border-line">
            <th scope="col" className="px-4 py-2">
              What we measured
            </th>
            {columns.map((c) => (
              <th key={c.model} scope="col" className="px-4 py-2">
                {c.label}
                <span className="block text-sm font-normal">
                  {c.runs} {c.runs === 1 ? "run" : "runs"}
                </span>
              </th>
            ))}
            <th scope="col" className="px-4 py-2">
              Target
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-line last:border-b-0">
              <th scope="row" className="px-4 py-2 font-semibold">
                {r.label}
                <span className="block text-sm font-normal">{r.plain}</span>
              </th>
              {columns.map((c) => (
                <td key={c.model} className="px-4 py-2">
                  {r.cell(c)}
                </td>
              ))}
              <td className="px-4 py-2">{r.target ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PRIVACY: { what: string; where: string; why: string }[] = [
  {
    what: "The place you type (for example \"Allen TX\")",
    where:
      "Our server (inside the request, never in the web address), then OpenStreetMap's Nominatim search. Answers are cached for 30 days in our storage (Upstash Redis) by the text typed, not by who typed it.",
    why: "To find the town or park.",
  },
  {
    what: "\"Use my location\"",
    where: "Rounded in your browser to 2 decimals (about 1 km), then our server, then OpenStreetMap's Overpass servers.",
    why: "To list parks near you.",
  },
  {
    what: "The park you pick (a public place and its map position)",
    where: "Our server, then OpenStreetMap (Overpass) and iNaturalist.",
    why: "To read the park map, recent wildlife sightings and monarch counts.",
  },
  {
    what: "The age band (for example 6-10)",
    where: "Our server, then the model on DigitalOcean, inside the prompt with the park facts.",
    why: "To set how many items and how easy the words are.",
  },
  {
    what: "Your IP address",
    where:
      "Our server. Our storage (Upstash Redis) gets only a scrambled code made from it (a keyed hash), never the address itself, inside rate-limit counters that delete themselves within about a day (IPv6 by its /64 and /48 network).",
    why: "To stop abuse and keep the free model budget fair.",
  },
  {
    what: "Every page or search request (your IP address, the web address, the time)",
    where:
      "Our hosting provider's request logs (Vercel), kept for a short time (about 1 hour on our plan). Park searches are sent inside the request, so these logs never show the place you typed or your location.",
    why: "Running the website.",
  },
  {
    what: "The finished pass (park, age band, items, clues, times)",
    where: "Saved in our storage (Upstash Redis) for 30 days, so the pass link and the print page work.",
    why: "Nothing in it is about you or your child.",
  },
];

export default function AboutPage() {
  // Llama 4 Community Licence: show "Built with Llama" whenever the server is set to answer with a Llama model.
  const servingLlama = isLlamaModel(configuredModelId());
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-5 py-8 focus:outline-none">
      <TicketCard as="section" aria-labelledby="about-title">
        <div className="flex flex-col gap-3">
          <h1 id="about-title" className="text-4xl font-bold">
            About Grass Pass
          </h1>
          <p className="text-lg font-semibold">Your ticket to get outside.</p>
          <p>
            Grass Pass makes a one-page, printable scavenger pass for a real park and a child&apos;s age. Every item on it is
            backed by real, dated data about <em>that</em> park. The goal: about half a minute on a screen, then you
            print, and the phone goes away. The child ticks boxes with a pencil; the grown-up keeps the stub with the answers, safety notes
            and sources.
          </p>
          <p>
            If a source has nothing for a park, the pass says <strong>&quot;No data available&quot;</strong> and why. It never
            pads the pass with generic items.
          </p>
        </div>
      </TicketCard>

      <Section id="how" title="How a pass is made">
        <ol className="flex list-decimal flex-col gap-3 pl-6">
          <li>
            <strong>You pick a park.</strong> Parks come from{" "}
            <a className={ext} href="https://www.openstreetmap.org/">
              OpenStreetMap
            </a>
            : named parks and nature reserves within 5 km, found with the Nominatim search and the Overpass API.
          </li>
          <li>
            <strong>Code collects real facts.</strong> <em>Park Finds</em> are what is mapped inside the park on OpenStreetMap
            (courts, playgrounds, shelters, bridges, ponds...). <em>Wild Finds</em> are species people photographed within
            1.5 km in the last 14 days, research grade only, from{" "}
            <a className={ext} href="https://www.inaturalist.org/">
              iNaturalist
            </a>
            , each with its Wikipedia summary (through the iNaturalist API). From {OCTOBER_WINDOW_LABEL} the{" "}
            <em>October special</em> box adds real monarch butterfly counts from iNaturalist (within 25 km, the last 14 days,
            next to the same days last year) and whether milkweed has been seen near the park.
          </li>
          <li>
            <strong>Code draws a Find This Spot map.</strong> Code picks one real place inside the park from OpenStreetMap: a
            landmark the park has only one of (a picnic shelter, a playground, a bridge), or else the middle of one sports
            field. It marks that place with an X on a simple black-and-white map of the park&apos;s paths, with a START at
            the nearest mapped parking lot or entrance, a north arrow and a scale. The walking distance and direction on
            the parent stub are measured by code. A park with nothing to point at gets &quot;No Find This Spot today&quot;
            instead of a guess.
          </li>
          <li>
            <strong>Code decides what is safe.</strong> Dangerous species are removed by their iNaturalist taxon before the
            model sees the list, and checked again after. Every Wild Find carries a fixed &quot;look, don&apos;t touch&quot;
            line written by code, not by the model.
            <details className="mt-2">
              <summary className="cursor-pointer font-semibold">Never on a pass ({BLOCKED_TAXA.length} groups)</summary>
              <ul className="mt-2 list-disc pl-6">
                {BLOCKED_TAXA.map((t) => (
                  <li key={t.id}>
                    {t.common} ({t.why})
                  </li>
                ))}
              </ul>
            </details>
          </li>
          <li>
            <strong>One call to an open model writes the clues.</strong> By default that is <code>gemma-4-31B-it</code>{" "}
            (Google&apos;s Gemma 4, open weights, Apache-2.0) on DigitalOcean serverless inference. It picks items from the
            list by id, writes a short clue for each and a riddle for the X on the map. Code then checks every clue: its
            quote must appear word for word in that item&apos;s source, it must not name the answer, it must not add numbers
            or links. Clues that fail are dropped (a &quot;look where&quot; hint that names the answer is left off). Every
            number and date on a pass is written by code. Each pass names the model that actually answered.
          </li>
          <li>
            <strong>You print it.</strong> Kid pass on top, a dashed tear line, and a parent stub below with the answers,
            evidence, safety lines and sources. Black and white, one page.
          </li>
        </ol>
      </Section>

      <Section id="why-open" title="Why open">
        <p>
          The clue writer is an open-weight model, and that matters for this app in ways we can show with numbers. We ran
          the real pass builder on {EVAL_PARKS} real parks and wrote down every result, including the ones that failed (
          <a className={ext} href={resultsUrl}>
            full results
          </a>
          ; the whole run cost ${EVAL_TOTAL_USD.toFixed(2)}).
        </p>
        <ul className="flex list-disc flex-col gap-2 pl-6">
          <li>
            <strong>It makes the words kid-sized.</strong> Gemma&apos;s clues read at a grade {gemma.fkGrade.toFixed(1)}{" "}
            level (median). A no-AI template on the same data reads at grade {template.fkGrade.toFixed(1)}.
          </li>
          <li>
            <strong>It sticks to the facts.</strong> {pct(gemma.groundedPct)} of Gemma&apos;s clues quoted their source word
            for word before any filter, and {gemma.blockedPrinted} dangerous species were printed in {gemma.runs} runs.
          </li>
          <li>
            <strong>It is cheap enough for a classroom.</strong> About {usd(gemma.costPerPass)} per pass at DigitalOcean list
            prices.
          </li>
          <li>
            <strong>The safety rules live in our code, not in a vendor&apos;s.</strong> The same checks run on any model.
            Switching models is one setting (<code>MODEL_ID</code>); Llama 4 Maverick ran through the same code in this test.
          </li>
          <li>
            <strong>You can run it yourself.</strong> Gemma 4&apos;s weights are downloadable under Apache-2.0, and the app talks
            to any OpenAI-compatible server (for example Ollama). We have <em>not</em> measured a self-hosted run for this app
            yet.
          </li>
        </ul>
        <p>
          No closed model was compared: we chose open models only, and the closed models on our DigitalOcean account
          answered &quot;403 Forbidden&quot; when we tried them on {EVAL_DAY}.
        </p>
        <p>
          <strong>In short:</strong> we made passes for {EVAL_PARKS} real parks with each model and counted how often the
          clues were safe, true to the data, complete, easy to read, quick and cheap. Each row says in plain words what
          it counts; the last column is the goal we set before the test.
        </p>
        <EvalTable columns={EVAL_COLUMNS} />

        <h3 className="mt-2 text-xl font-bold">What did not pass yet (current limitations)</h3>
        <ul className="flex list-disc flex-col gap-2 pl-6">
          <li>
            <strong>Answers that name themselves: {pct(gemma.nameLeakPct)}</strong> of Gemma&apos;s clues or &quot;look
            where&quot; hints used a word of their own answer before the filter (target {EVAL_THRESHOLDS.nameLeakPct}% or
            lower; in the clue itself {pct(gemma.clueLeakPct)}). Code catches every one: a clue that names its answer is
            dropped, and a hint that does is left off. So nothing is given away on the pass, but those clues are lost.
          </li>
          <li>
            <strong>Llama 4 Maverick is too slow to be the default:</strong> {secs(llama.p50s)} typical per model call
            (target {EVAL_THRESHOLDS.p50s} s), and {pct(llama.completePct)} complete passes. Gemma took {secs(gemma.p50s)}{" "}
            typical and {secs(gemma.p95s)} slow-case; most of that wait is the model writing its answer, so we made the answer
            shorter.
          </li>
          <li>
            <strong>A model glitch we saw in an earlier run:</strong> in 3 of Gemma&apos;s 56 answers, all for the same park,
            the next part of the answer was stuck onto the end of every quote. Code now cuts that stuck-on text off and keeps
            the quote only if what is left is really, word for word, in the source. It did not happen in the run above.
          </li>
          <li>
            <strong>Not in this test:</strong> the Find This Spot map and riddle (the map data was not recorded for the 20
            test parks).
          </li>
          <li>
            <strong>Kid check not done yet.</strong> A grown-up reading 10 clues as a 7-year-old would is planned; it is not
            automated.
          </li>
          <li>
            <strong>Not built yet:</strong> Lucky Finds (visitor-review counts) show &quot;not available yet&quot; on the pass,
            and no photos are printed.
          </li>
          <li>
            <strong>Sparse data happens.</strong> 3 of the 17 North Texas parks in the test had no research-grade
            iNaturalist sightings in the last 14 days; the pass then says so instead of inventing Wild Finds.
          </li>
        </ul>
      </Section>

      <Section id="privacy" title="Privacy: what leaves your device">
        <p>
          No accounts, no names, no photos, no cookies, no analytics. The only things kept in your browser are your light or
          dark choice and the last age band you picked. Nothing about the child is ever asked for or sent.
        </p>
        <div className="overflow-x-auto rounded-control border-2 border-line" role="region" aria-labelledby="privacy-caption" tabIndex={0}>
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
              {PRIVACY.map((r) => (
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
        <p>
          The model runs on DigitalOcean&apos;s servers in the US, so the park facts and the age band do leave your device.
          Our own server logs say what happened (which source or model, how long it took, the outcome, the pass id) and
          never the prompt, your IP address or the text you typed. Our storage is Upstash Redis (caches, saved passes and
          rate-limit counters). Our hosting provider (Vercel) keeps its own short request logs, as every website host does.
        </p>
      </Section>

      <Section id="credits" title="Credits and licences">
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
            observers (we show species names and counts only, no photos).
          </li>
          <li>Species summaries: Wikipedia (CC BY-SA), through the iNaturalist API.</li>
          <li>
            Clues:{" "}
            <a className={ext} href="https://huggingface.co/google/gemma-4-31B-it">
              Gemma 4 (gemma-4-31B-it)
            </a>
            , Apache-2.0, on DigitalOcean serverless inference.
          </li>
          <li>
            Eval comparison: Llama 4 Maverick (Llama 4 Community Licence), on DigitalOcean serverless inference. It only
            answers real visitors if the server is switched to it (<code>MODEL_ID</code>); every pass names the model that
            answered and shows &quot;{BUILT_WITH_LLAMA}&quot; when it is a Llama model.
            {servingLlama ? (
              <>
                {" "}
                <strong data-testid="built-with-llama">{BUILT_WITH_LLAMA}</strong>: this site is set to use a Llama model right now.
              </>
            ) : null}
          </li>
          <li>
            Logo and art: the original banner was made by Kevin with Google Gemini; the logo and scene are a traced,
            hand-cleaned SVG redraw of it.
          </li>
          <li>Fonts: Fredoka and Nunito (SIL Open Font License 1.1), served from this site.</li>
          <li>
            App code: MIT licence. A few generic building blocks (the model client, rate limits and caps, request guards
            and in-flight de-duplication) were adapted from the same author&apos;s unpublished practice project, written on
            Oct 2, 2026, before the contest entry period. Everything specific to Grass Pass was written from Oct 5, 2026.
          </li>
        </ul>
      </Section>

      <Section id="source" title="Source code">
        <p>
          Grass Pass is open source (MIT). The code, the eval harness and its results are on GitHub.
        </p>
        <p className="flex flex-wrap gap-3">
          <a className={buttonClassName("secondary")} href={REPO_URL}>
            Grass Pass on GitHub
          </a>
          <Link className={buttonClassName("primary")} href="/">
            Make a pass
          </Link>
        </p>
      </Section>
    </main>
  );
}
