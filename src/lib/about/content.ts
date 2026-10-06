/**
 * The facts the /about and /how-it-works pages show, as plain data (v3 redesign, 2026-10-06).
 *
 * Kept as arrays of strings, not JSX, so a new row (for example accounts / sign-in / reports) is one entry in
 * one list, and tests can check every fact without rendering. Every number comes from the app's own constants
 * or the committed eval run (src/lib/about/eval-summary.ts, re-checked against the JSON by tests).
 */
import { ACCOUNT_COPY, ACCOUNT_PASSES_PER_DAY, judgeDailyCap } from "@/lib/accounts/config";
import { EVAL_PARKS, EVAL_SUMMARY_FILE, EVAL_THRESHOLDS, GEMMA_FIRST_CALL_P50_S, GEMMA_P50_EXACT_S, PREVIOUS_RUN, evalColumn } from "@/lib/about/eval-summary";
import { SERPAPI_FREE_MONTHLY } from "@/lib/limits/config";
import { serpapiCaps } from "@/lib/limits/serpapi";
import { MODEL_TIMEOUT_MS } from "@/lib/model";
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
export const UNIT_TESTS = { passed: 871, files: 46, day: "Oct 6, 2026" } as const;

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
    { value: String(g.blockedPrinted), label: `risky species printed (${g.runs} passes)`, target: "0, always", met: g.blockedPrinted === 0 },
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
  "Our safety rules live in our code, not a vendor's.",
  "Self-hosting is possible; not measured yet.",
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
        "Park names, places and features: © OpenStreetMap contributors, ODbL 1.0, through the Nominatim search and public Overpass API servers. Named parks and nature reserves within 5 km; Park Finds are what is mapped inside the park (courts, playgrounds, shelters, bridges, ponds...). The Find This Spot map is drawn by code from the same data.",
    },
    {
      name: "iNaturalist",
      url: "https://www.inaturalist.org/",
      gives: "Wildlife people really spotted nearby",
      licence: "Names + counts only",
      detail: `Wildlife sightings and monarch counts: iNaturalist observers. Wild Finds are species photographed within ${WILD_RADIUS_KM} km in the last ${WILD_WINDOW_DAYS} days, research grade only. From ${OCTOBER_WINDOW_LABEL} the October special box adds monarch butterfly counts (within ${MONARCH_RADIUS_KM} km, the last 14 days, next to the same days last year) and milkweed seen within ${MILKWEED_RADIUS_KM} km. We show species names and counts only, no photos.`,
    },
    {
      name: "Wikipedia",
      url: "https://www.wikipedia.org/",
      gives: "A short fact about each species",
      licence: "CC BY-SA",
      detail: "Species summaries: Wikipedia (CC BY-SA), through the iNaturalist API. The model must quote these words exactly.",
    },
    {
      name: "SerpApi",
      url: "https://serpapi.com/",
      gives: "How often Google Maps reviews mention dogs or bikes",
      licence: "Counts only, no review text",
      detail: `Lucky Finds: Google Maps review counts via SerpApi. Code finds the same park on Google Maps and counts reviews from the last ${WINDOW_MONTHS / 12} years that mention dogs, bikes, ducks or skateboards; a Lucky Find needs at least ${MIN_MENTIONS} such reviews. We count mentions in Google Maps reviews via SerpApi; review text is never shown or sent to the AI, only the word, the count and the newest month. Nothing about you is sent to SerpApi (only the park's name and map position).`,
    },
  ];
}

/** Short ✓ lines on the Privacy card. */
export const PRIVACY_POINTS: readonly string[] = [
  "Browsing and printing need no account or cookie.",
  "Sign-in only to make a new pass; we keep a scrambled ID, no email or name.",
  "Nothing about your child is asked for.",
  "Your location is rounded to about 1 km first.",
  "Your IP is kept only scrambled, for about a day.",
  "Park facts and age band go to the model (US).",
];

/** The full privacy table: everything that leaves your device, where it goes and why. */
export type PrivacyRow = { what: string; where: string; why: string };

export const PRIVACY_ROWS: readonly PrivacyRow[] = [
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
    where:
      "Our server, then OpenStreetMap (Overpass), iNaturalist and SerpApi (its name and map position, to find the same park on Google Maps and count its reviews).",
    why: "To read the park map, recent wildlife sightings, monarch counts and how often visitors' reviews mention dogs or bikes.",
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
    what: "Signing in with GitHub or Google (grown-ups, only to make a new pass or send a report)",
    where:
      "GitHub or Google tell our server an account number (and a name, which only goes into your own encrypted sign-in cookie for the \"Hi, name\" in the header). Our storage keeps ONLY a scrambled ID made from the account number with a secret key (no email, no name, no picture). The sign-in cookie lasts 30 days (the judge demo: 1 day); Sign out removes it.",
    why: "To count your 2 new passes a day and your found-it reports.",
  },
  {
    what: "Your item reports (Found it, Didn't find it, Not safe)",
    where:
      "Our storage (Upstash Redis): per park and item, how many of each kind per day, plus for \"Not safe\" the scrambled IDs of who said so (so 2 different people are needed). Deleted after 90 days.",
    why: "To learn what is really findable, leave out finds nobody can spot, and catch anything unsafe.",
  },
  {
    what: "The finished pass (park, age band, items, clues, times)",
    where: "Saved in our storage (Upstash Redis) for 30 days, so the pass link and the print page work.",
    why: "Nothing in it is about you or your child.",
  },
];

/** The paragraph under the privacy table. */
export const PRIVACY_NOTES: readonly string[] = [
  `No names, no photos, no analytics, and nothing about the child is ever asked for or sent. Browsing, the example passes, shared pass links and printing need no account and set no cookie. Only a grown-up who signs in (to make a new pass or send a report) gets one sign-in cookie. ${ACCOUNT_COPY.privacy} The only other things kept in your browser are your light or dark choice and the last age band you picked.`,
  "The model runs on DigitalOcean's servers in the US, so the park facts and the age band do leave your device. For Lucky Finds we count mentions in Google Maps reviews via SerpApi; review text is never shown or sent to the AI, and nothing about you is sent to SerpApi (only the park's name and map position).",
  "Our own server logs say what happened (which source or model, how long it took, the outcome, the pass id) and never the prompt, your IP address or the text you typed. Our storage is Upstash Redis (caches, saved passes and rate-limit counters). Our hosting provider (Vercel) keeps its own short request logs, as every website host does.",
];

/** Accounts and visitor reports (Builder O, 2026-10-06): the rules, from the same constants the code uses. */
export function accountNotes(): string[] {
  return [
    `Anyone can search parks, open the example passes and any shared pass link, and print. Making a NEW pass needs a grown-up to sign in with GitHub or Google (${ACCOUNT_PASSES_PER_DAY} new passes a day each, reset at midnight Dallas time), because every new pass costs a real model call. ${ACCOUNT_COPY.grownUps} We never store a password.`,
    `Judges can press "Try as a judge": one click signs in to a shared demo account with no sign-up. All judges together can make ${judgeDailyCap()} new passes a day, on top of the usual per-address limits.`,
    `Signed-in grown-ups can tell us about each find on a pass: Found it, Didn't find it or Not safe (one report per find per day). ${REPORT_COPY.rule}`,
  ];
}

/** Short privacy lines on /how-it-works. */
export function howPrivacyPoints(): string[] {
  return [
    "No names, no photos, no analytics. Browsing, the examples, shared passes and printing need no account and set no cookie.",
    `Signing in (grown-ups, only to make a new pass or send a report): ${ACCOUNT_COPY.privacy} No password is ever stored. Reports are deleted after 90 days.`,
    "The place you type goes to our server and OpenStreetMap's search, never in the web address.",
    "\"Use my location\" is rounded to about 1 km in your browser first.",
    "Your IP address is only kept as a scrambled code inside rate-limit counters that delete themselves within about a day.",
    "The model sees the park's public facts and the age band, nothing about you.",
    "Your browser keeps only your light or dark choice and the last age band.",
  ];
}

/** A limit: a short visible line, and the full honest detail (folded). */
export type Limit = { title: string; detail: string };

/** The five short lines on the /about "Honest limits" card. */
export function aboutLimitPoints(): string[] {
  const g = evalColumn("gemma-4-31B-it");
  return [
    `Clues repeat across parks (${pct(g.repeatPct)}).`,
    `Speed just meets target (${secs(g.p50s)}).`,
    "Sparse parks get shorter passes, and say so.",
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
      detail: `of printed clues share 5 words in a row with clues on at least 2 other parks (target ${t.repeatPct}% or lower). That is up from ${pct(PREVIOUS_RUN.repeatPct)} in the run before (${PREVIOUS_RUN.id}), so it got worse and does not pass. Most of the repeats are Park Finds that copy a phrase of the code-written park facts ("paths that cross over water"). Wrong counts pass: ${g.wrongCounts} of ${g.countClues} printed count clues (${g.wrongCountsRemoved} wrong ones were removed by code before printing).`,
    },
    {
      title: `Speed: Gemma only just passes (${secs(g.p50s)} typical, ${secs(g.p95s)} slow-case; target ${t.p50s} s / ${t.p95s} s).`,
      detail: `The typical call took ${GEMMA_P50_EXACT_S} s, and that per-call figure includes the short second calls that fill a short pass (about 4 s each). First calls alone took ${GEMMA_FIRST_CALL_P50_S} s typical, which is over the mark. Most of the wait is the model writing its answer. Llama 4 Maverick is too slow to be the default: ${secs(l.p50s)} typical, with ${pct(l.completePct)} complete passes and ${usd(l.costPerPass)} a pass, over the ${usd(t.costPerPass)} mark (${l.timeouts} of its calls hit its 60 s limit).`,
    },
    {
      title: `Complete passes: Gemma passes (${pct(g.completePct)}, ${g.complete} of ${g.dataRichRuns}; target ${t.completePct}% or more).`,
      detail: `The one short pass was Spring Creek Forest Preserve, a park with little data, which ended 2 finds short even after its second try. No call failed or timed out in this run. A short pass says how many finds are missing; it is never padded.`,
    },
    {
      title: "Answers that name themselves:",
      detail: `Gemma passes (${pct(g.nameLeakPct)} of its clues or "look where" hints used a word of their own answer before the filter; target ${t.nameLeakPct}% or lower), but Llama 4 Maverick does not (${pct(l.nameLeakPct)}). Code catches every one: a clue that names its answer is dropped, and a hint that does is left off. So nothing is given away on the pass, but those clues are lost.`,
    },
    {
      title: "A model glitch we saw in an earlier run:",
      detail:
        "in 3 of Gemma's 56 answers, all for the same park, the next part of the answer was stuck onto the end of every quote. Code now cuts that stuck-on text off and keeps the quote only if what is left is really, word for word, in the source. It did not happen in the run above.",
    },
    {
      title: "Not in this test:",
      detail: `the Find This Spot map and riddle (the map data was not recorded for the ${EVAL_PARKS} test parks), and Lucky Finds (the test parks have no recorded Google Maps review counts, and the free SerpApi searches are kept for the live site).`,
    },
    {
      title: "Kid check not done yet.",
      detail: "A grown-up reading 10 clues as a 7-year-old would is planned; it is not automated.",
    },
    {
      title: "Lucky Finds run on a free plan.",
      detail: `SerpApi's free plan allows ${SERPAPI_FREE_MONTHLY} searches a month, and a new park uses up to 4 (one to find it on Google Maps, up to 3 review counts). Grass Pass stops at ${serp.daily} searches a day and ${serp.monthly} a month and keeps each park's counts for 30 days. When a limit is reached, the pass says "free search limit reached today" instead of Lucky Finds. A count says how many reviews mention a thing, not that it is there today, so the pass calls them "maybe". No photos are printed.`,
    },
    {
      title: "Sparse data happens.",
      detail:
        "3 of the 17 North Texas parks in the test had no research-grade iNaturalist sightings in the last 14 days; the pass then says so instead of inventing Wild Finds.",
    },
    {
      title: "Self-hosting is not measured.",
      detail:
        "Gemma 4's weights are downloadable under Apache-2.0, and the app talks to any OpenAI-compatible server (for example Ollama). We have not measured a self-hosted run for this app yet.",
    },
  ];
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
      detail: `${pct(g.repeatPct)} of printed clues share 5 words in a row with clues on at least 2 other parks (target ${t.repeatPct}%), up from ${pct(PREVIOUS_RUN.repeatPct)} in the run before.`,
    },
    {
      title: "Speed only just meets its target.",
      detail: `${secs(g.p50s)} typical, ${secs(g.p95s)} slow per model call (target ${t.p50s} s / ${t.p95s} s), and ${g.timeouts} model calls in ${g.runs} test passes hit the ${MODEL_TIMEOUT_MS / 1000} s limit. First calls alone took ${GEMMA_FIRST_CALL_P50_S} s typical.`,
    },
    {
      title: "Parks with little data make shorter passes.",
      detail: `A short pass says how many finds are missing. Some parks had no research-grade sightings in the last ${WILD_WINDOW_DAYS} days.`,
    },
    {
      title: "The kid check is not done yet.",
      detail: "A grown-up reading 10 printed clues as a 7-year-old would is planned; until then it is pending, not passed.",
    },
    {
      title: "Lucky Finds run on a free plan.",
      detail: `${serp.daily} searches a day. A count means visitors wrote about a thing, not that it is there today, so the pass says "maybe".`,
    },
    {
      title: "Public map servers can be busy.",
      detail:
        "Mostly in the US evening. Then a park search may use the saved Dallas-area list, and a new pass may say its map data could not be fetched in time.",
    },
    {
      title: "Find This Spot is not in the eval, and self-hosting is not measured.",
      detail: "Its map data was not recorded for the test parks, and a self-hosted model run has not been measured.",
    },
    {
      title: "A new pass needs a grown-up to sign in.",
      detail: `${ACCOUNT_PASSES_PER_DAY} new passes a day each, with GitHub or Google. Judges can press "Try as a judge" (a shared demo account, ${judgeDailyCap()} new passes a day for all judges together). Saved passes, shared links, the examples and printing need no sign-in.`,
    },
    {
      title: "The model runs on DigitalOcean's servers.",
      detail: "So the park facts and the age band leave your device.",
    },
  ];
}
