/**
 * The facts the /about and /how-it-works pages show, as plain data (v3 redesign, 2026-10-06).
 *
 * Kept as arrays of strings, not JSX, so a new row (for example accounts / sign-in / reports) is one entry in
 * one list, and tests can check every fact without rendering. Every number comes from the app's own constants
 * or the committed eval run (src/lib/about/eval-summary.ts, re-checked against the JSON by tests).
 */
import {
  ACCOUNT_COPY,
  accountPassesPerDay,
  anonPassesPerIpPerDay,
  freePassesPerDay,
  judgeDemoEnabled,
  judgeShareCopy,
  oauthProviderNames,
  signInWith,
} from "@/lib/accounts/config";
import { FEEDBACK_KEEP_DAYS } from "@/lib/feedback/kinds";
import { EVAL_PARKS, EVAL_SUMMARY_FILE, EVAL_THRESHOLDS, GEMMA_FAILED_FIRST_CALLS, GEMMA_FIRST_CALL_P50_S, GEMMA_FIRST_PROMPT_TOKENS, GEMMA_COST_RANGE, GEMMA_P50_EXACT_S, GEMMA_RUN_COUNTS, GEMMA_RUN_FIRST_CALL_LIMIT_S, GEMMA_SHORT_PASSES, GEMMA_TOKENS_PER_S, GEMMA_TOP_REPEAT, GEMMA_VAGUE_CLUES, GEMMA_WATER_BY_EAR, PREVIOUS_RUN, SELFHOST, SMOKE_10_13, SMOKE_13PLUS, evalColumn } from "@/lib/about/eval-summary";
import { SERPAPI_FREE_MONTHLY } from "@/lib/limits/config";
import { serpapiCaps } from "@/lib/limits/serpapi";
import { MAX_MODEL_TIMEOUT_MS } from "@/lib/model";
import { FIRST_CALL_MAX_MS, FIRST_CALL_MIN_MS } from "@/lib/pass/budget";
import { MILKWEED_RADIUS_KM, MONARCH_RADIUS_KM, OCTOBER_WINDOW_LABEL } from "@/lib/october";
import { MIN_MENTIONS } from "@/lib/pool/lucky";
import { WILD_RADIUS_KM, WILD_WINDOW_DAYS } from "@/lib/sources/inat";
import { WINDOW_MONTHS } from "@/lib/sources/serpapi";
import { REPORT_COPY } from "@/lib/reports/kinds";

export const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
export const secs = (n: number | null) => (n === null ? "no model call" : `${n.toFixed(1)} s`);
export const usd = (n: number) => (n === 0 ? "$0" : `$${n.toFixed(5)}`);

/** Q-5-02: "up to $0.00127 if 15 timed-out calls were billed in full" (the high end of the cost range). */
export function costHighNote(r: { timedOutCalls: number; high: number } = GEMMA_COST_RANGE): string {
  return `up to ${usd(r.high)} if ${r.timedOutCalls === 1 ? "1 timed-out call was" : `${r.timedOutCalls} timed-out calls were`} billed in full`;
}

/** The eval run id the stat tiles quote, e.g. "2026-10-06-3". */
export const EVAL_RUN_ID = EVAL_SUMMARY_FILE.replace(/^evals\/results\//, "").replace(/\.md$/, "");

/**
 * Unit tests, counted by running `pnpm test` (vitest) on the branch that changed this page. A dated count, not
 * a live one: update it when you re-run the suite for a page change.
 */
export const UNIT_TESTS = { passed: 2421, files: 95, day: "Oct 9, 2026" } as const;
/** Audit rounds finished (five reviews each; projects/grass-pass/audits/round-N in the factory repo). One place, so pages never disagree. */
// Round 10 ran on production on Oct 8 (audits/round-10/SUMMARY.md). RULES-8-03: round 7 finished late on Oct 6 and round 8 ran on Oct 7 (audits/round-8/SUMMARY.md). Hand-typed because the
// audit reports live in the factory repo, not in this one: re-count at ship (a ship gate).
export const AUDIT_ROUNDS = { done: 10, day: "Oct 8, 2026" } as const;
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
export const GEMMA_COPY = { sent: 184, shipped: 90, edited: 15, live: 80 } as const;

/**
 * RULES-11-03 (round 11): who wrote and built what, after Oct 8. One wording for /about and the README (about.test
 * checks both). Kevin's own words: logs/decision-log.md (2026-10-08 ~1:45 PM hero text, locked) and round-11 CONTEXT
 * ("Kevin's locked copy"). Agent-built Oct 8-9: commits 7495597, 1b4b444, 657ce51, 1ab32e0, aa136bc, f67d8db, c839da3,
 * 5ffce8d (each Co-Authored-By: Claude).
 */
export const AGENT_BUILT_OCT_8_9 = `the full-screen hero, "What's a pass?" (its layout and its copy), the redesigned "The problem" section, map v2, sign-in v2, the wide layout, pass limits and feedback, and the new How it works page`;
export const KEVIN_OWN_WORDS = `the home hero headline and paragraphs, "Why Find a pinecone fails" and its paragraphs, the nav labels, the button labels "Make a free pass" and "Create your pass now", the footer's closing line, and the idea for the hero offer line`;

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
    { value: usd(g.costPerPass), label: `per pass for the clues (list price; ${costHighNote()})`, target: `${usd(t.costPerPass)} or less`, met: g.costPerPass <= t.costPerPass },
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
      gives: "Nominatim search, parks and what's mapped",
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

/**
 * Weather on the pass page (Kevin, Oct 8): not clue data, so not one of the four sources above (the trip tips use a few
 * code-written forecast facts: TRIP_TIPS_ABOUT).
 * Listed with the sources and in the credits.
 */
export const WEATHER_SOURCES: readonly DataSource[] = [
  {
    name: "Open-Meteo",
    url: "https://open-meteo.com/",
    gives: "The forecast on each pass page",
    licence: "CC BY 4.0",
    detail:
      "Weather data by Open-Meteo.com: today's (after 6 PM, tomorrow's) forecast for the park's position, rounded to about 1 km. Code writes the weather card's words. When a pass is made, a few code-written facts from it (high and low, rain chance, UV, sunset, alert names) also go to the model for the trip tips. Cached 30 minutes; if it doesn't answer within 8 s the card says \"No weather data available\" and why.",
  },
  {
    name: "National Weather Service",
    url: "https://www.weather.gov/",
    gives: "Official weather alerts for US parks",
    licence: "US public domain",
    detail:
      "Active alerts for the park's position from api.weather.gov (US parks only). We show the 2 most severe, who sent them and when they end, and link to weather.gov; we never write our own instructions for an alert.",
  },
];

/**
 * Trip tips (Kevin, Oct 8): one honest line on /about (src/lib/tips). Kept here so the page and its test read one text.
 */
export const TRIP_TIPS_ABOUT =
  "Trip tips (\"How to make this a great trip\", on screen only): written once per pass by the same open model, from facts code writes first: that day's forecast and alerts, the park's mapped fountains, restrooms, shelters, water and paths, and the few sightings worth planning for (poison ivy, ticks, fire ants, mosquitoes, venomous snakes, stinging insects). Code drops any tip not based on one of those facts, or that says to touch, pick, feed, wade, leave the path or take medicine. If the model doesn't answer within 10 seconds, the page shows a short code-written list from the same facts and says so. One more model call per pass.";

/** Short ✓ lines on the Privacy card. */
export const PRIVACY_POINTS: readonly string[] = [
  "No account or cookies needed to browse and print.",
  "Your free pass sets one small signed cookie: the date and a count, no ID.",
  "Sign-in is for more new passes, reports and ratings. We keep a scrambled ID, no name or email.",
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
      where:
        "Our server, then OpenStreetMap, iNaturalist and SerpApi (name and map position only). The pass page, and making a pass, send only the park's position, rounded to about 1 km, to Open-Meteo and (US parks) the National Weather Service.",
      why: "For the park map, sightings, monarch counts and review counts, the weather card and the trip tips.",
    },
    {
      what: "The age band (for example 6-10)",
      where: "Our server, then the model on DigitalOcean, in the prompt.",
      why: "To set how many finds and how easy the words are.",
    },
    {
      what: "Your IP address",
      where: "Our server. Our storage (Upstash Redis) keeps only a keyed hash, never the address itself, in rate-limit counters that expire within a day.",
      why: "To stop abuse and keep the model budget fair.",
    },
    {
      what: "Every request (IP address, web address, time)",
      where: "Our hosting provider's request logs (Vercel), kept about 1 hour. They never show what you typed or where you are.",
      why: "Running the website.",
    },
    {
      what: `Signing in ${[names ? `with ${names}` : null, judgeDemoEnabled() ? `with "Try as a judge"` : null].filter(Boolean).join(" or ")} (grown-ups only)`.replace("Signing in  (", "Signing in ("),
      // SEC-5-04: what really arrives (the public profile), naming only the providers set up here (RULES-4-02).
      where: `${names ? `${names} ${names.includes(" or ") ? "send" : "sends"} your public profile (account number, name, picture link${names.includes("GitHub") ? "; for GitHub any public email" : ""}). ` : ""}We store only a scrambled ID made from the number; the rest is dropped at once, except your first name, which stays in your own encrypted cookie. Sign-in lasts 7 days; the judge demo sign-in stops working after 1 day.`,
      why: `To count your ${accountPassesPerDay()} new passes a day, your reports and your ratings.`,
    },
    {
      what: "Your free pass (no sign-in)",
      where:
        "One cookie in your own browser, set only when you use a free pass: today's date (Dallas time) and how many free passes you used, signed so it can't be changed. No ID. It expires at midnight Dallas time. Our server keeps no copy.",
      why: `To count your ${freePassesPerDay()} free new pass a day.`,
    },
    {
      what: "Your pass ratings (1 to 5 stars and tags, no text; signed-in grown-ups)",
      where: `Our storage: your latest rating per pass and its day, under an ID made for that park only. Deleted after ${FEEDBACK_KEEP_DAYS} days. Never shown publicly; only the site owner sees the totals.`,
      why: "To learn which passes work for kids.",
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
  `No names, no photos, no analytics; nothing about the child is asked for. Browsing and printing set no cookie. Using a free pass sets one small signed cookie (the date and a count, no ID), and a grown-up who signs in gets a sign-in cookie. ${ACCOUNT_COPY.privacy} Your browser keeps only your light or dark choice and the last age band.`,
  "The model runs on DigitalOcean servers in the US, so park facts and the age band leave your device.",
  "Our logs record which source or model ran, timing, outcome and pass id; never the prompt, your IP or what you typed.",
];

/** Accounts and visitor reports (Builder O, 2026-10-06): the rules, from the same constants the code uses. */
export function accountNotes(): string[] {
  return [
    `Anyone can search, open examples and shared links, and print. A NEW pass is a real model call. Without signing in you get ${freePassesPerDay()} free new pass a day (counted by one small signed cookie, and at most ${anonPassesPerIpPerDay()} signed-out new passes a day per internet connection). After that a grown-up signs in${signInWith()} (judges: "Try as a judge"): ${accountPassesPerDay()} new passes a day each, reset at midnight Dallas time. No password is stored.`,
    `Judges: "Try as a judge" is one click, no sign-up. ${judgeShareCopy()}`,
    `Signed-in grown-ups can report each find (Found it, Didn't find it, Not safe). ${REPORT_COPY.rule}`,
    `Signed-in grown-ups can also rate a pass: 1 to 5 stars and tags (Too easy, Too hard, Kids loved it, Something was missing, Not safe), no text. One rating per account per pass (the newest counts), deleted after ${FEEDBACK_KEEP_DAYS} days. Judge demo ratings are only logged, never counted. The totals are never shown publicly.`,
  ];
}

/** Short privacy lines on /how-it-works. */
export function howPrivacyPoints(): string[] {
  return [
    "No names, photos, or analytics. Browsing and printing set no cookie.",
    "Using your free pass sets one small signed cookie: the date and a count, no ID. It expires at midnight Dallas time.",
    `Signing in (grown-ups: more new passes, reports and ratings): ${ACCOUNT_COPY.privacy} No password is stored.`,
    "What you type goes to our server and OpenStreetMap, never into the web address.",
    "\"Use my location\" is rounded to about 1 km in your browser before it is sent.",
    "The AI sees park facts and the age band, nothing about you or your child.",
  ];
}

/** A limit: a short visible line, and the full honest detail (folded). */
export type Limit = { title: string; detail: string };

/** The five short lines on the /about "Honest limits" card. */
export function aboutLimitPoints(): string[] {
  return [
    "Cost and slow calls missed the goal.",
    "A few passes come out short.",
    "Some clues are vague.",
    "The read-it-as-a-7-year-old check is not done yet.",
    "Find This Spot and Lucky Finds are not in the eval yet.",
  ];
}

/** "met" / "missed" for a measured value against its goal. */
const metWord = (ok: boolean) => (ok ? "met" : "missed");

/** The full "What did not pass yet" list on /about, with every number. */
export function aboutLimits(): Limit[] {
  const g = evalColumn("gemma-4-31B-it");
  const l = evalColumn("llama-4-maverick");
  const t = EVAL_THRESHOLDS;
  const serp = serpapiCaps();
  const f = GEMMA_FAILED_FIRST_CALLS;
  const w = GEMMA_WATER_BY_EAR;
  const sh = GEMMA_SHORT_PASSES;
  const p50Met = (g.p50s ?? Infinity) <= t.p50s;
  const p95Met = (g.p95s ?? Infinity) <= t.p95s;
  const completeMet = g.completePct >= t.completePct;
  const repeatMet = g.repeatPct <= t.repeatPct;
  return [
    {
      title: `Speed: the typical call ${metWord(p50Met)} the goal, the slow ones ${metWord(p95Met)} it (${secs(g.p50s)} typical, ${secs(g.p95s)} slow).`,
      detail: `Target ${t.p50s} s / ${t.p95s} s. The typical call took ${GEMMA_P50_EXACT_S} s; first calls alone took ${GEMMA_FIRST_CALL_P50_S} s. DigitalOcean answered at ${GEMMA_TOKENS_PER_S.now} answer tokens a second (${GEMMA_TOKENS_PER_S.before} in the run before, when the typical call took ${secs(PREVIOUS_RUN.p50s)}). Run ${EVAL_RUN_ID} is the first full run with time limits sized to each call (a first call gets up to ${GEMMA_RUN_FIRST_CALL_LIMIT_S} s; the run before had a fixed ${PREVIOUS_RUN.firstCallLimitS} s): ${f.savedBySizedLimit} first calls took longer than ${PREVIOUS_RUN.firstCallLimitS} s and still answered, ${f.timeouts === 1 ? "1 first call" : `${f.timeouts} first calls`} hit the limit and the retry saved ${f.rescued === 1 ? "that pass" : `${f.rescued} passes`}, and ${f.lost === 0 ? "no test run was lost" : `${f.lost} test runs were lost`} (${PREVIOUS_RUN.lostRuns} in the run before). Llama 4 Maverick is too slow to be the default: ${l.timeouts} of its ${l.runs} test runs ran out of time, ${pct(l.completePct)} complete passes.`,
    },
    {
      title: `Some passes still come out short: ${sh.printedShort} of ${g.dataRichRuns} (${pct(g.completePct)} complete; goal ${t.completePct}%: ${metWord(completeMet)}).`,
      detail: `${pct(PREVIOUS_RUN.completePct)} in the run before. ${f.lost === 0 ? "Every data-rich test run made a pass." : `${f.lost} test runs made no pass.`} The ${sh.printedShort} short passes are on ${sh.printedShortParks} parks: ${sh.printedShort - sh.refillTimedOut} because the park's wildlife data has little to see (every call answered, the refills found too few good clues), ${sh.refillTimedOut} because a refill ran out of time. A short pass says how many finds are missing. A pass makes 1 to 3 model calls for the clues, plus 1 for the trip tips.`,
    },
    {
      title: `Cost missed the goal: Gemma ${usd(g.costPerPass)} a pass.`,
      detail: `Target ${usd(t.costPerPass)}; ${usd(PREVIOUS_RUN.costPerPass)} in the run before (${PREVIOUS_RUN.id}). Only ${GEMMA_COST_RANGE.timedOutCalls} calls timed out this time, so the miss is the real price of the answered calls: ${usd(GEMMA_COST_RANGE.atZero)} a pass even if those were free. Most of it is the prompt (${GEMMA_FIRST_PROMPT_TOKENS.now.toLocaleString("en-US")} prompt tokens on a first call, ${GEMMA_FIRST_PROMPT_TOKENS.before.toLocaleString("en-US")} before). Each timed-out call is priced at its prompt size, ${costHighNote()}. These numbers are for ages 6-10. Longer passes cost more in their small checks: a ${SMOKE_10_13.ageBand} pass ${usd(SMOKE_10_13.costPerFinishedPass)} and a ${SMOKE_13PLUS.ageBand} pass ${usd(SMOKE_13PLUS.costPerPass)}, both over the goal. All of these count the clue calls only, measured before trip tips existed (Oct 7); the trip tips add one more short call per pass.`,
    },
    {
      title: `Some clues are still vague: ${GEMMA_VAGUE_CLUES.flagged} of ${GEMMA_VAGUE_CLUES.wildPrinted} Wild Finds.`,
      detail: `Our checks flag Wikipedia words and bare facts ("Check for a small bird that is yellow."). They go first when a spare can replace them, so ${GEMMA_VAGUE_CLUES.flagged} printed; ${GEMMA_VAGUE_CLUES.before} of ${GEMMA_VAGUE_CLUES.beforeWildPrinted} in the run before, counted with the same checks. The checks still miss some, like "Spot a vine with flowers that are not white."`,
    },
    {
      title: `Some clues repeat across parks: ${pct(g.repeatPct)} (goal ${t.repeatPct}% or lower: ${metWord(repeatMet)}).`,
      detail: `${g.repeated} of ${g.printedClues} printed clues share 5 words in a row with clues on 2 or more other parks (${pct(PREVIOUS_RUN.repeatPct)} in the run before). The top one is "${GEMMA_TOP_REPEAT.gram}" (${GEMMA_TOP_REPEAT.parks} parks). A clue that listens for water: ${w.passes} of ${w.of} passes (${w.before} of ${w.beforeOf} before).`,
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
      title: "Example passes are chosen.",
      detail: "The example passes are real Gemma passes, but we keep complete ones as examples, so they show a good day, not a typical one. A new pass can come out short; it says how many finds are missing.",
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
  const b = s.browser;
  return `We ran the small Gemma 4 E2B (${s.model}, ${s.licence}) with Ollama on ${s.hardware}, on ${s.parks} test parks, for $0. With a ${MAX_MODEL_TIMEOUT_MS / 1000} s limit per model call (the most the app allows; the hosted site gives a first call ${FIRST_CALL_MIN_MS / 1000}-${FIRST_CALL_MAX_MS / 1000} s), 0 of ${s.parks} passes were complete: ${s.app.lost} ran out of time and the other ${s.app.passes} came out short. Given more time (an eval-only setting), ${s.patient.complete} of ${s.parks} were complete, ${pct(s.patient.groundedPct)} of clues quoted their source, reading grade ${s.patient.fkGrade.toFixed(1)}, ${s.patient.blockedPrinted} risky species printed, at ${secs(s.patient.p50s)} a typical call (hosted Gemma 4 31B: ${secs(evalColumn("gemma-4-31B-it").p50s)}). The app now has a longer clock for a model on your own computer (LOCAL_MODEL_TIMEOUT_MS, off by default): in one browser try, a ${b.park} pass came out with ${b.finds} of ${b.asked} finds and its map in ${b.seconds} s (${b.calls} model calls). The model used about ${s.ram.label} GB of RAM.`;
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
      title: "Cost missed the goal.",
      detail: `${usd(g.costPerPass)} a pass for the clue calls (target ${usd(t.costPerPass)}; ${costHighNote()}). The trip tips add one more short call.`,
    },
    {
      title: "Some clues are still vague.",
      detail: `${GEMMA_VAGUE_CLUES.flagged} of ${GEMMA_VAGUE_CLUES.wildPrinted} printed Wild Finds, like "Check for a small bird that is yellow."`,
    },
    {
      title: "Some clues repeat across parks.",
      detail: `${pct(g.repeatPct)} of printed clues (target ${t.repeatPct}%: ${g.repeatPct <= t.repeatPct ? "met" : "missed"}; ${pct(PREVIOUS_RUN.repeatPct)} the run before).`,
    },
    {
      title: "Model speed depends on DigitalOcean.",
      detail: `${secs(g.p50s)} typical, ${secs(g.p95s)} slow (target ${t.p50s} s / ${t.p95s} s: typical ${(g.p50s ?? Infinity) <= t.p50s ? "met" : "missed"}, slow ${(g.p95s ?? Infinity) <= t.p95s ? "met" : "missed"}; ${secs(PREVIOUS_RUN.p50s)} typical the run before). The first full run with sized time limits (a first call up to ${GEMMA_RUN_FIRST_CALL_LIMIT_S} s; it was a fixed ${PREVIOUS_RUN.firstCallLimitS} s): in ${g.runs} test runs (${GEMMA_RUN_COUNTS.passes} passes; ${GEMMA_RUN_COUNTS.noDataRuns} runs on the ${GEMMA_RUN_COUNTS.noDataParks} no-data parks made none), ${GEMMA_FAILED_FIRST_CALLS.timeouts} first call hit its limit and ${GEMMA_RUN_COUNTS.lostRuns} runs were lost (${PREVIOUS_RUN.lostRuns} the run before).`,
    },
    {
      title: "Some passes come out short.",
      detail: `${pct(g.completePct)} of data-rich test runs made a complete pass (target ${t.completePct}%: ${g.completePct >= t.completePct ? "met" : "missed"}); a short one says how many finds are missing.`,
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
      title: `After ${freePassesPerDay()} free pass a day, a grown-up signs in.`,
      detail: `${accountPassesPerDay()} new passes a day each; judges can press "Try as a judge".`,
    },
    {
      title: "The model runs on DigitalOcean's servers.",
      detail: "The park facts and age band leave your device.",
    },
  ];
}
