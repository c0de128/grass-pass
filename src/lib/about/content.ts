/**
 * The facts the /about and /how-it-works pages show, as plain data (v3 redesign, 2026-10-06).
 *
 * Kept as arrays of strings, not JSX, so a new row (for example accounts / sign-in / reports) is one entry in
 * one list, and tests can check every fact without rendering. Every number comes from the app's own constants
 * or the committed eval run (src/lib/about/eval-summary.ts, re-checked against the JSON by tests).
 */
import { ACCOUNT_COPY, ACCOUNT_PASSES_PER_DAY, judgeDemoEnabled, judgeShareCopy, oauthProviderNames, signInWith } from "@/lib/accounts/config";
import { EVAL_PARKS, EVAL_SUMMARY_FILE, EVAL_THRESHOLDS, GEMMA_FAILED_FIRST_CALLS, GEMMA_FIRST_CALL_P50_S, GEMMA_P50_EXACT_S, GEMMA_RUN_COUNTS, GEMMA_SHORT_PASSES, GEMMA_TOKENS_PER_S, PREVIOUS_RUN, SELFHOST, SMOKE_10_13, evalColumn } from "@/lib/about/eval-summary";
import { SERPAPI_FREE_MONTHLY } from "@/lib/limits/config";
import { serpapiCaps } from "@/lib/limits/serpapi";
import { MAX_MODEL_TIMEOUT_MS, MODEL_TIMEOUT_MS } from "@/lib/model";
import { MILKWEED_RADIUS_KM, MONARCH_RADIUS_KM, OCTOBER_WINDOW_LABEL } from "@/lib/october";
import { MIN_MENTIONS } from "@/lib/pool/lucky";
import { WILD_RADIUS_KM, WILD_WINDOW_DAYS } from "@/lib/sources/inat";
import { WINDOW_MONTHS } from "@/lib/sources/serpapi";
import { REPORT_COPY } from "@/lib/reports/kinds";

export const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
export const secs = (n: number | null) => (n === null ? "no model call" : `${n.toFixed(1)} s`);
export const usd = (n: number) => (n === 0 ? "$0" : `$${n.toFixed(5)}`);

/** The eval run id the stat tiles quote, e.g. "2026-10-06-3". */
export const EVAL_RUN_ID = EVAL_SUMMARY_FILE.replace(/^evals\/results\//, "").replace(/\.md$/, "");

/**
 * Unit tests, counted by running `pnpm test` (vitest) on the branch that changed this page. A dated count, not
 * a live one: update it when you re-run the suite for a page change.
 */
export const UNIT_TESTS = { passed: 1480, files: 53, day: "Oct 6, 2026" } as const;
/** Audit rounds finished (five reviews each; projects/grass-pass/audits/round-N in the factory repo). One place, so pages never disagree. */
export const AUDIT_ROUNDS = { done: 5, day: "Oct 6, 2026" } as const;
const COUNT_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"] as const;
/** "Five rounds so far (Oct 6, 2026)." */
export function auditRoundsLine(r: { done: number; day: string } = AUDIT_ROUNDS): string {
  const n = COUNT_WORDS[r.done] ?? String(r.done);
  return `${n} ${r.done === 1 ? "round" : "rounds"} so far (${r.day}).`;
}

/**
 * The Gemma copy rewrite (docs/COPY-BY-GEMMA.md, 2026-10-06): blocks sent, drafts shipped (accepted + edited),
 * and how many of those were edited by hand. tests/unit/copy-check.test.ts checks these against
 * docs/copy-by-gemma/review.json.
 */
export const GEMMA_COPY = { sent: 184, shipped: 90, edited: 13 } as const;

export type StatTile = {
  value: string;
  label: string;
  /** The goal set before the test, in words. */
  target: string;
  /** null = no target (a count, not a pass mark). */
  met: boolean | null;
};

/** The big numbers at the top of /about: Gemma 4 31B in the committed eval run. Misses are shown as misses. */
export function aboutStatTiles(): StatTile[] {
  const g = evalColumn("gemma-4-31B-it");
  const t = EVAL_THRESHOLDS;
  return [
    { value: pct(g.groundedPct), label: "of clues quote their source exactly", target: `${t.groundedPct}% or more`, met: g.groundedPct >= t.groundedPct },
    { value: String(g.blockedPrinted), label: `risky species printed (${g.runs} runs)`, target: "0, always", met: g.blockedPrinted === 0 },
    { value: usd(g.costPerPass), label: "per pass (list price)", target: `${usd(t.costPerPass)} or less`, met: g.costPerPass <= t.costPerPass },
    { value: `Grade ${g.fkGrade.toFixed(1)}`, label: "reading level (median)", target: `${t.fkGrade} or lower`, met: g.fkGrade <= t.fkGrade },
    { value: pct(g.completePct), label: "of passes complete", target: `${t.completePct}% or more`, met: g.completePct >= t.completePct },
    {
      value: secs(g.p50s),
      label: `typical model wait, ${secs(g.p95s)} slow`,
      target: `${t.p50s} s / ${t.p95s} s`,
      met: (g.p50s ?? Infinity) <= t.p50s && (g.p95s ?? Infinity) <= t.p95s,
    },
    { value: pct(g.repeatPct), label: "of clues repeat across parks", target: `${t.repeatPct}% or lower`, met: g.repeatPct <= t.repeatPct },
    { value: String(UNIT_TESTS.passed), label: `unit tests passing, ${UNIT_TESTS.day}`, target: "all green", met: null },
  ];
}

/** Short "why open" points on the Open model card. */
export const WHY_OPEN_POINTS: readonly string[] = [
  "Anyone can download, run and build on the weights.",
  "Our safety rules are in our code, not a vendor's.",
  "Self-hosted on a laptop CPU: $0, but slow.",
];

/** The four data sources: what they give, and the licence or rule we follow. */
export type DataSource = { name: string; url: string; gives: string; licence: string; detail: string };

export function dataSources(): DataSource[] {
  return [
    {
      name: "OpenStreetMap",
      url: "https://www.openstreetmap.org/copyright",
      gives: "Parks, paths and what is mapped inside them",
      licence: "ODbL 1.0",
      detail:
        "© OpenStreetMap contributors, via Nominatim and public Overpass servers: parks within 5 km and what is mapped inside them. Code draws the Find This Spot map from it.",
    },
    {
      name: "iNaturalist",
      url: "https://www.inaturalist.org/",
      gives: "Wildlife people actually spotted nearby",
      licence: "Names + counts only",
      detail: `iNaturalist observers. Wild Finds: research-grade species photographed within ${WILD_RADIUS_KM} km in the last ${WILD_WINDOW_DAYS} days. From ${OCTOBER_WINDOW_LABEL}, the October box adds monarch counts within ${MONARCH_RADIUS_KM} km (last 14 days, next to the same days last year) and milkweed within ${MILKWEED_RADIUS_KM} km. Names and counts only, no photos.`,
    },
    {
      name: "Wikipedia",
      url: "https://www.wikipedia.org/",
      gives: "A short summary of each species",
      licence: "CC BY-SA",
      detail: "Species summaries, via the iNaturalist API. The model must quote these words exactly.",
    },
    {
      name: "SerpApi",
      url: "https://serpapi.com/",
      gives: "Google Maps review counts for dogs or bikes",
      licence: "Counts only, no review text",
      detail: `Lucky Finds: Google Maps review counts via SerpApi, from the last ${WINDOW_MONTHS / 12} years (dogs, bikes, ducks, skateboards; at least ${MIN_MENTIONS}). We count mentions in Google Maps reviews via SerpApi; review text is never shown or sent to the AI. SerpApi gets only the park's name and position.`,
    },
  ];
}

/** Short ✓ lines on the Privacy card. */
export const PRIVACY_POINTS: readonly string[] = [
  "No account or cookies needed to browse and print.",
  "Sign-in is only for new passes. We keep a scrambled ID, no name or email.",
  "We never ask for info about your child.",
  "Your location is rounded to about 1 km in your browser.",
  "Your IP is kept only scrambled, for about a day.",
  "Park facts and age band go to the model in the US.",
];

/** The full privacy table: everything that leaves your device, where it goes and why. */
export type PrivacyRow = { what: string; where: string; why: string };

/** Built per call: the sign-in row names only the providers set up on this server (RULES-4-02). */
export function privacyRows(): PrivacyRow[] {
  const names = oauthProviderNames();
  return [
    {
      what: "The place you type (for example \"Allen TX\")",
      where: "Our server (never in the web address), then OpenStreetMap's Nominatim. Cached 30 days by the text, not by who typed it.",
      why: "To find the town or park.",
    },
    {
      what: "\"Use my location\"",
      where: "Rounded in your browser to about 1 km, then our server, then OpenStreetMap's Overpass.",
      why: "To list parks near you.",
    },
    {
      what: "The park you pick (a public place)",
      where: "Our server, then OpenStreetMap, iNaturalist and SerpApi (name and map position only).",
      why: "For the park map, sightings, monarch counts and review counts.",
    },
    {
      what: "The age band (for example 6-10)",
      where: "Our server, then the model on DigitalOcean, in the prompt.",
      why: "To set how many finds and how easy the words are.",
    },
    {
      what: "Your IP address",
      where: "Our server. Our storage (Upstash Redis) keeps only a keyed hash, never the address itself, in rate-limit counters that expire within a day.",
      why: "To stop abuse and keep the free model budget fair.",
    },
    {
      what: "Every request (IP address, web address, time)",
      where: "Our hosting provider's request logs (Vercel), kept about 1 hour. They never show what you typed or where you are.",
      why: "Running the website.",
    },
    {
      what: `Signing in ${[names ? `with ${names}` : null, judgeDemoEnabled() ? `with "Try as a judge"` : null].filter(Boolean).join(" or ")} (grown-ups only)`.replace("Signing in  (", "Signing in ("),
      where: "The provider sends an account number and a name. We store only a scrambled ID made from the number: no email, no name, no picture. The name stays in your own encrypted cookie. Sign-in lasts 7 days; the judge demo sign-in stops working after 1 day.",
      why: "To count your 2 new passes a day and your reports.",
    },
    {
      what: "Your reports (Found it, Didn't find it, Not safe)",
      where: "Our storage: your latest report per find and its day, under an ID made for that park only. Deleted after 90 days.",
      why: "To learn what is findable and catch anything unsafe.",
    },
    {
      what: "The finished pass (park, age band, finds, clues, times)",
      where: "Saved in our storage (Upstash Redis) for 30 days, so the link and print page work.",
      why: "Nothing in it is about you or your child.",
    },
  ];
}

/** The paragraph under the privacy table. */
export const PRIVACY_NOTES: readonly string[] = [
  `No names, no photos, no analytics; nothing about the child is asked for. Only a grown-up who signs in gets a cookie. ${ACCOUNT_COPY.privacy} Your browser keeps only your light or dark choice and the last age band.`,
  "The model runs on DigitalOcean servers in the US, so park facts and the age band leave your device.",
  "Our logs record which source or model ran, timing, outcome and pass id; never the prompt, your IP or what you typed.",
];

/** Accounts and visitor reports (Builder O, 2026-10-06): the rules, from the same constants the code uses. */
export function accountNotes(): string[] {
  return [
    `Anyone can search, open examples and shared links, and print. A NEW pass is a real model call, so a grown-up signs in${signInWith()} (judges: "Try as a judge"): ${ACCOUNT_PASSES_PER_DAY} new passes a day each, reset at midnight Dallas time. No password is stored.`,
    `Judges: "Try as a judge" is one click, no sign-up. ${judgeShareCopy()}`,
    `Signed-in grown-ups can report each find (Found it, Didn't find it, Not safe). ${REPORT_COPY.rule}`,
  ];
}

/** Short privacy lines on /how-it-works. */
export function howPrivacyPoints(): string[] {
  return [
    "No names, photos, or analytics. Browsing and printing set no cookie.",
    `Signing in (grown-ups, only for new passes and reports): ${ACCOUNT_COPY.privacy} No password is stored.`,
    "What you type goes to our server and OpenStreetMap, never into the web address.",
    "\"Use my location\" is rounded to about 1 km in your browser before it is sent.",
    "The AI sees park facts and the age band, nothing about you or your child.",
  ];
}

/** A limit: a short visible line, and the full honest detail (folded). */
export type Limit = { title: string; detail: string };

/** The five short lines on the /about "Honest limits" card. */
export function aboutLimitPoints(): string[] {
  const g = evalColumn("gemma-4-31B-it");
  return [
    `Clues repeat across parks (${pct(g.repeatPct)}).`,
    `Model calls were slow (${secs(g.p50s)} typical).`,
    `Short passes: ${GEMMA_SHORT_PASSES.passes} of ${g.dataRichRuns}; they say so.`,
    "The read-it-as-a-7-year-old check is not done yet.",
    "Find This Spot and Lucky Finds are not in the eval yet.",
  ];
}

/** The full "What did not pass yet" list on /about, with every number. */
export function aboutLimits(): Limit[] {
  const g = evalColumn("gemma-4-31B-it");
  const l = evalColumn("llama-4-maverick");
  const t = EVAL_THRESHOLDS;
  const serp = serpapiCaps();
  return [
    {
      title: `Clues repeat across parks: Gemma ${pct(g.repeatPct)}`,
      detail: `of printed clues share 5 words in a row with 2+ other parks (target ${t.repeatPct}%), down from ${pct(PREVIOUS_RUN.repeatPct)} in the run before (${PREVIOUS_RUN.id}): still a miss, by a hair. The top repeat is still Gemma's own opening "Somewhere you will see a" (5 parks), then "for a bird that is" and one Wikipedia description (the Osage-orange's bumpy fruit).`,
    },
    {
      title: `Speed: Gemma misses (${secs(g.p50s)} typical, ${secs(g.p95s)} slow-case; target ${t.p50s} s / ${t.p95s} s).`,
      detail: `The typical call took ${GEMMA_P50_EXACT_S} s; first calls alone took ${GEMMA_FIRST_CALL_P50_S} s. DigitalOcean answered at ${GEMMA_TOKENS_PER_S.now} answer tokens a second (${GEMMA_TOKENS_PER_S.before} in the run before; 46.2 two runs before). ${GEMMA_FAILED_FIRST_CALLS.timeouts} first calls hit the ${MODEL_TIMEOUT_MS / 1000} s limit and were retried. Llama 4 Maverick is too slow to be the default: ${l.timeouts} of its ${l.runs} test runs ended at its 60 s limit, ${pct(l.completePct)} complete passes.`,
    },
    {
      title: `Short passes: ${GEMMA_SHORT_PASSES.passes} of ${g.dataRichRuns} still came out short.`,
      detail: `Complete passes now meet the goal (Gemma ${pct(g.completePct)}, ${g.complete} of ${g.dataRichRuns}; target ${t.completePct}% or more), up from ${pct(PREVIOUS_RUN.completePct)} in the run before. A failed first call now gets one whole retry (${GEMMA_FAILED_FIRST_CALLS.rescued} passes saved: ${GEMMA_FAILED_FIRST_CALLS.timeouts} timeouts, ${GEMMA_FAILED_FIRST_CALLS.http403} HTTP 403), and a refill asks for 2 spares. The short ones were on ${GEMMA_SHORT_PASSES.parks} parks with small pools of finds; a short pass says how many finds are missing.`,
    },
    {
      title: `Cost is close to the goal: Gemma ${usd(g.costPerPass)} a pass.`,
      detail: `Target ${usd(t.costPerPass)}; up from ${usd(PREVIOUS_RUN.costPerPass)}, because more passes make 2 or 3 model calls. A 10-13 pass in the small ${SMOKE_10_13.ageBand} check cost ${usd(SMOKE_10_13.costPerFinishedPass)}, over the goal.`,
    },
    {
      title: "Answers that name themselves:",
      detail: `Gemma passes (${pct(g.nameLeakPct)} of its clues or hints, before the checks; target ${t.nameLeakPct}%), Llama 4 Maverick does not (${pct(l.nameLeakPct)}). Code removes every one.`,
    },
    {
      title: "An earlier glitch:",
      detail: "3 of 56 Gemma answers had the next field stuck onto every quote. Code now cuts it off; not seen since.",
    },
    {
      title: "Not in this test:",
      detail: `Find This Spot (no map data was recorded for the ${EVAL_PARKS} test parks) and Lucky Finds (the test parks have no recorded Google Maps review counts, and the free SerpApi searches are kept for the live site).`,
    },
    {
      title: "Kid check not done yet.",
      detail: "Reading 10 clues as a 7-year-old would is planned for the real walk.",
    },
    {
      title: "Lucky Finds run on a free plan.",
      detail: `SerpApi's free plan allows ${SERPAPI_FREE_MONTHLY} searches a month; a new park uses up to 4. Grass Pass stops at ${serp.daily} searches a day and ${serp.monthly} a month and keeps counts 30 days. A count is a "maybe": visitors wrote about it, it may not be there today.`,
    },
    {
      title: "Sparse data happens.",
      detail: "3 of 17 North Texas test parks had no research-grade sightings in 14 days; their passes say so.",
    },
    {
      title: "Self-hosting works, but slowly on a laptop.",
      detail: selfHostDetail(),
    },
  ];
}

/** The measured self-host result in one paragraph (judge G1; numbers from SELFHOST, checked against the JSON by tests). */
export function selfHostDetail(): string {
  const s = SELFHOST;
  return `We ran the small Gemma 4 E2B (${s.model}, ${s.licence}) with Ollama on ${s.hardware}, on ${s.parks} test parks, for $0. With the app's own ${MAX_MODEL_TIMEOUT_MS / 1000} s limit, ${s.app.lost} of ${s.parks} passes ran out of time and the other ${s.app.passes} came out short. Given more time (an eval-only setting), ${s.patient.complete} of ${s.parks} were complete, ${pct(s.patient.groundedPct)} of clues quoted their source, reading grade ${s.patient.fkGrade.toFixed(1)}, ${s.patient.blockedPrinted} risky species printed, at ${secs(s.patient.p50s)} a typical call (hosted Gemma 4 31B: ${secs(evalColumn("gemma-4-31B-it").p50s)}). The model used about ${s.ramGb} GB of RAM.`;
}

/**
 * The limits on /how-it-works: a short visible title each, and the honest detail (folded). New limits (for
 * example about accounts or reports) are one more entry here.
 */
export function howLimits(): Limit[] {
  const g = evalColumn("gemma-4-31B-it");
  const t = EVAL_THRESHOLDS;
  const serp = serpapiCaps();
  return [
    {
      title: "Clues repeat across parks.",
      detail: `${pct(g.repeatPct)} share 5 words in a row with 2+ other parks (target ${t.repeatPct}%).`,
    },
    {
      title: "Model calls are slower than the target.",
      detail: `${secs(g.p50s)} typical, ${secs(g.p95s)} slow (target ${t.p50s} s / ${t.p95s} s). ${GEMMA_FAILED_FIRST_CALLS.timeouts} first calls hit the ${MODEL_TIMEOUT_MS / 1000} s limit in ${g.runs} test runs (${GEMMA_RUN_COUNTS.passes} passes; ${GEMMA_RUN_COUNTS.noDataRuns} runs on the ${GEMMA_RUN_COUNTS.noDataParks} no-data parks made none); their retries saved both passes.`,
    },
    {
      title: "Some passes come out short.",
      detail: `${pct(g.completePct)} of test passes were complete (target ${t.completePct}%: met); a short one says how many finds are missing.`,
    },
    {
      title: "The kid check is not done yet.",
      detail: "Planned for the real walk.",
    },
    {
      title: "Lucky Finds run on a free plan.",
      detail: `${serp.daily} searches a day; a count is a "maybe", not a promise.`,
    },
    {
      title: "Public map servers can be busy.",
      detail: "Mostly US evenings: search falls back to a saved Dallas-area list.",
    },
    {
      title: "Find This Spot is not in the eval.",
      detail: "No map data was recorded for the test parks.",
    },
    {
      title: "Self-hosting on a laptop CPU is slow.",
      detail: selfHostDetail(),
    },
    {
      title: "A new pass needs a grown-up to sign in.",
      detail: `${ACCOUNT_PASSES_PER_DAY} a day each; judges can press "Try as a judge".`,
    },
    {
      title: "The model runs on DigitalOcean's servers.",
      detail: "The park facts and age band leave your device.",
    },
  ];
}
