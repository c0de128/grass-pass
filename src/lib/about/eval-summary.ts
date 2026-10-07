/**
 * The measured numbers the /about page quotes (SPEC §6.4 / §6.5, F14).
 *
 * Copied from the committed eval run `evals/results/2026-10-06-9.json` (summary: `2026-10-06-9.md`, notes:
 * `2026-10-06-9-notes.md`), the first full run with the sized time limits of the slow-provider fix
 * (src/lib/pass/budget.ts: a first call gets 30-40 s, the whole retry the time left, a refill 15-30 s), the stock-frame
 * rewrite and the new bridge facts. Lucky Finds were not in the eval (no SerpApi recordings for the 20 parks). The
 * earlier runs (`2026-10-05.json`, `-2`, `-3`, `-4`, `2026-10-06.json`, `-2` to `-8`) stay in the repo for comparison.
 * tests/unit/about.test.tsx re-reads that JSON and fails if any number here drifts from it, so the page
 * can never show a number that was not measured. When the eval is re-run, point EVAL_RESULTS_FILE at the new
 * results and update the numbers; FAILs stay on the page as current limitations. The full sync list (README, docs/EVALS.md,
 * the self-host notes' "the pages now quote" paragraph) is in evals/README.md.
 */

export const EVAL_RESULTS_FILE = "evals/results/2026-10-06-9.json";
export const EVAL_SUMMARY_FILE = "evals/results/2026-10-06-9.md";
/** Chicago day of the run. */
export const EVAL_DAY = "2026-10-06";
/** Chicago day the closed models on our DigitalOcean tier answered 403. */
export const CLOSED_MODELS_403_DAY = "2026-10-05";

export type EvalColumn = {
  model: string;
  label: string;
  licence: string;
  runs: number;
  /** M1: blocked taxa printed. */
  blockedPrinted: number;
  /** M2: clues whose sourceQuote matched the source, before any filter (percent, 1 decimal). */
  groundedPct: number;
  grounded: number;
  returned: number;
  /** M3: data-rich runs whose pass kept >= n-1 items (percent, 1 decimal). */
  completePct: number;
  complete: number;
  dataRichRuns: number;
  /** M4: honest empty sections (percent). */
  honestEmptiesPct: number;
  /** M5: Flesch-Kincaid grade, median of printed clues (1 decimal). */
  fkGrade: number;
  /** M6: items naming their own answer in the clue or lookWhere, before the filter (percent, 1 decimal). */
  nameLeakPct: number;
  /** M6, the clue text only (percent, 1 decimal). */
  clueLeakPct: number;
  /** M7: wall time per model call (seconds, 1 decimal); null = no model call. */
  p50s: number | null;
  p95s: number | null;
  timeouts: number;
  /** M8: dollars per pass at DigitalOcean list prices (5 decimals). */
  costPerPass: number;
  /** M10: printed clues with a 5-word run also printed on 2+ other parks' passes (percent, 1 decimal). */
  repeatPct: number;
  repeated: number;
  printedClues: number;
  /** M11: printed clues with a wrong count, of the printed count clues; and model items the check removed. */
  wrongCounts: number;
  countClues: number;
  wrongCountsRemoved: number;
};

/**
 * Hand-quoted figures from the same results (checked against the JSON by tests/unit/about.test.tsx):
 * Gemma's exact per-call p50 in seconds (2 decimals), and the p50 of its first calls only (refills excluded).
 */
export const GEMMA_P50_EXACT_S = 9.91;
export const GEMMA_FIRST_CALL_P50_S = 12.8;
/** Median answer tokens per second of Gemma's answered calls, this run and the run before (provider speed). */
export const GEMMA_TOKENS_PER_S = { now: 39.5, before: 28.1 } as const;

/**
 * The full run before this one, for "up from / down from" lines (checked against its JSON by a test): its lost runs and
 * its first calls that hit its fixed 30 s limit (it ran before the sized limits).
 */
export const PREVIOUS_RUN = { id: "2026-10-06-8", file: "evals/results/2026-10-06-8.json", repeatPct: 9.7, completePct: 82.4, costPerPass: 0.00111, p50s: 15.3, p95s: 30, lostRuns: 4, firstCallTimeouts: 10, firstCallLimitS: 30 } as const;

/**
 * Gemma's failed calls in this run (checked against the JSON by a test). `timeouts`: first calls that hit their sized
 * limit (at most 40 s), each followed by one whole retry; `rescued`: those passes that still came out complete. `lost`:
 * passes whose retry failed too (`retryTimeouts` timed out again, `retry403` got HTTP 403), so they printed nothing.
 * `refillTimeouts`: refills that hit their sized 15-30 s limit (the pass kept what it had). `http403`: first calls that
 * got HTTP 403. `savedBySizedLimit`: answered first calls that took longer than the old fixed 30 s limit.
 */
/** The first-call limit this run ran with: sized per call, at most 40 s (src/lib/pass/budget.ts). Run -8 had a fixed 30 s. */
export const GEMMA_RUN_FIRST_CALL_LIMIT_S = 40;
export const GEMMA_FAILED_FIRST_CALLS = { timeouts: 1, http403: 0, rescued: 1, lost: 0, retryTimeouts: 0, retry403: 0, refillTimeouts: 1, savedBySizedLimit: 3 } as const;
/**
 * RULES-5-03: Gemma's test runs vs passes. Of its runs, how many made a pass, and how many runs (on how many parks)
 * made none because the park had no usable data (checked against the JSON by tests/unit/about.test.tsx).
 */
export const GEMMA_RUN_COUNTS = { passes: 54, noDataRuns: 6, noDataParks: 2, lostRuns: 0 } as const;
/**
 * Gemma test runs (data-rich) that did not make a complete pass, and on how many different parks: `passes` counts the
 * short passes and the lost runs (GEMMA_FAILED_FIRST_CALLS.lost) together; `printedShort` only the passes that printed
 * with finds missing; `refillTimedOut` the printed-short passes where a refill ran out of time (the rest were short on
 * content: every call answered, the refills kept too little).
 */
export const GEMMA_SHORT_PASSES = { passes: 5, parks: 3, printedShort: 5, printedShortParks: 3, refillTimedOut: 1 } as const;

/**
 * Q-5-02: Gemma's cost per pass as a range. Since run -7 the scorer prices a timed-out call (no answer, so no token
 * count) at its prompt size in `costPerPass` (the low end, the column's costPerPass); `high` also bills a full
 * max_tokens answer for it. `atZero` is the cost with the timed-out call priced at $0 (as the runs before -7 did).
 * Whether DigitalOcean bills a timed-out request is not known. Since run -9 each call's max_tokens is sized to what it
 * asks (400-1,200), so `high` bills each timed-out call's own max_tokens. Checked against the JSON by
 * tests/unit/about.test.tsx.
 */
export const GEMMA_COST_RANGE = { timedOutCalls: 2, atZero: 0.00106, high: 0.00109 } as const;

/**
 * The mean prompt tokens of Gemma's answered first calls, this run and the run before (r7 follow-ups: the shorter
 * prompt). Checked against both JSON files by tests/unit/about.test.tsx.
 */
export const GEMMA_FIRST_PROMPT_TOKENS = { now: 2844, before: 2872 } as const;

/**
 * Audit R5 Q-5-01: printed Gemma Wild Finds whose clue our own checks call jargon or trivia (src/lib/ai/jargon.ts),
 * this run and the run before, both counted with today's checks.
 * Trivia prints when no spare can replace it. Re-derived from both JSON files with jargonProblem / triviaProblem by
 * tests/unit/about.test.tsx.
 */
export const GEMMA_VAGUE_CLUES = { flagged: 11, wildPrinted: 119, before: 8, beforeWildPrinted: 112 } as const;
/**
 * Round-6 judge C4 (the "listen for the water" clue on every example pass): passes with a water-by-ear clue, of
 * Gemma's passes, and on how many parks; this run and run -8 (soundThemes in evals/score.ts; test: about.test.tsx).
 */
export const GEMMA_WATER_BY_EAR = { passes: 14, of: 54, parks: 6, before: 11, beforeOf: 50, beforeParks: 6 } as const;

/** M10's most repeated 5-word run in this run, and on how many parks (scores[].m10.top[0]; checked by about.test.tsx). */
export const GEMMA_TOP_REPEAT = { gram: "the still water where you", parks: 4 } as const;

export const EVAL_PARKS = 20;
export const EVAL_AGE_BAND = "6-10";
export const EVAL_TOTAL_USD = 0.0922;

export const EVAL_COLUMNS: readonly EvalColumn[] = [
  {
    model: "gemma-4-31B-it",
    label: "Gemma 4 31B (open, the default)",
    licence: "Apache-2.0",
    runs: 60,
    blockedPrinted: 0,
    groundedPct: 99.8,
    grounded: 568,
    returned: 569,
    completePct: 90.2,
    complete: 46,
    dataRichRuns: 51,
    honestEmptiesPct: 100,
    fkGrade: 2.3,
    nameLeakPct: 4,
    clueLeakPct: 4,
    p50s: 9.9,
    p95s: 27.1,
    timeouts: 0,
    costPerPass: 0.00108,
    repeatPct: 4.1,
    repeated: 16,
    printedClues: 387,
    wrongCounts: 0,
    countClues: 97,
    wrongCountsRemoved: 11,
  },
  {
    model: "llama-4-maverick",
    label: "Llama 4 Maverick (open, a slower alternative you can switch to)",
    licence: "Llama 4 Community Licence",
    runs: 20,
    blockedPrinted: 0,
    groundedPct: 93.6,
    grounded: 190,
    returned: 203,
    completePct: 64.7,
    complete: 11,
    dataRichRuns: 17,
    honestEmptiesPct: 100,
    fkGrade: 2.3,
    nameLeakPct: 10.3,
    clueLeakPct: 9.9,
    p50s: 20.6,
    p95s: 57,
    timeouts: 3,
    costPerPass: 0.0019,
    repeatPct: 0,
    repeated: 0,
    printedClues: 101,
    wrongCounts: 0,
    countClues: 10,
    wrongCountsRemoved: 21,
  },
  {
    model: "no-AI template",
    label: "No-AI template (our code, no model)",
    licence: "MIT (our code)",
    runs: 20,
    blockedPrinted: 0,
    groundedPct: 100,
    grounded: 141,
    returned: 141,
    completePct: 17.6,
    complete: 3,
    dataRichRuns: 17,
    honestEmptiesPct: 100,
    fkGrade: 2.8,
    nameLeakPct: 1.4,
    clueLeakPct: 1.4,
    p50s: null,
    p95s: null,
    timeouts: 0,
    costPerPass: 0,
    repeatPct: 20.4,
    repeated: 19,
    printedClues: 93,
    wrongCounts: 0,
    countClues: 3,
    wrongCountsRemoved: 0,
  },
];

/** SPEC §6.4 pass marks (for Gemma 4 31B). */
export const EVAL_THRESHOLDS = {
  completePct: 90,
  fkGrade: 3.5,
  nameLeakPct: 5,
  groundedPct: 85,
  p50s: 10,
  p95s: 20,
  costPerPass: 0.001,
  repeatPct: 5,
  wrongCounts: 0,
} as const;

/**
 * The newest committed results file: a PARTIAL 10-13 smoke (3 parks, 1 Gemma run each), made right after the full
 * run 2026-10-06-9 on the same tree, on the same 3 parks as the smokes before it (`partial-1439`, `partial-1621`,
 * `partial-1853`, `partial-2121`), capped at 8 model calls (EVAL_MAX_CALLS). Not the frozen numbers; quoted on
 * /how-it-works next to the full run.
 * tests/unit/how-it-works.test.tsx re-reads the JSON and fails if a number here drifts.
 */
export const SMOKE_10_13 = {
  file: "evals/results/2026-10-06-partial-2320.json",
  summary: "evals/results/2026-10-06-partial-2320.md",
  day: "2026-10-06",
  ageBand: "10-13",
  parks: 3,
  complete: 3,
  /** Calls that hit their time limit. */
  timeouts: 0,
  /** Model calls made in the smoke. */
  calls: 6,
  fkGrade: 3.6,
  nameLeakPct: 5.4,
  p50s: 12.2,
  p95s: 18.5,
  /** Total spend over all 3 cases, as the scorer counts it. */
  costPerPass: 0.00145,
  /** Total spend over the passes that finished (3 of 3), 5 decimals. */
  costPerFinishedPass: 0.00145,
  /** Q-5-05: passes that printed at least the promised hard finds (2 for 10-13). */
  hardKept: 3,
} as const;

/**
 * Self-hosted row (judge G1, Builder W, 2026-10-06): Gemma 4 E2B (`gemma4:e2b-it-qat`, Apache-2.0) served by Ollama on
 * a laptop CPU with no GPU, 5 parks x 1 run, 6-10 band, $0. Two PARTIAL runs: `app` with a 70 s limit per call, the most the app allows (the hosted site sizes a first call to 30-40 s) (70 s per
 * call, 85 s per pass), `patient` with the eval-only longer clock (EVAL_LOCAL_PATIENT=1). Notes:
 * `evals/results/2026-10-06-selfhost-notes.md`. tests/unit/selfhost-summary.test.ts re-reads both JSON files.
 */
export const SELFHOST = {
  notes: "evals/results/2026-10-06-selfhost-notes.md",
  model: "gemma4:e2b-it-qat",
  modelId: "gemma4-e2b-8k",
  licence: "Apache-2.0",
  hardware: "a Windows laptop CPU (Intel Core Ultra 7 155H, 32 GB RAM, no GPU)",
  parks: 5,
  /**
   * The model runner's RAM (RULES-6-01): 4.9-5.2 GB working set and 5.8 GB private bytes at most, so "about 5-6 GB"
   * on the pages.
   */
  ram: { workingSetMaxGb: 5.2, privateMaxGb: 5.8, label: "5-6" },
  /** Measured once on the real Arbor Hills request: prompt reading and answer writing speed (tokens/s). */
  promptTokensPerS: 99.6,
  answerTokensPerS: 17.9,
  app: {
    file: "evals/results/2026-10-06-selfhost-1656.json",
    passes: 2,
    complete: 0,
    /** Passes lost to the 70 s model limit. */
    lost: 3,
    groundedPct: 100,
    nameLeakPct: 0,
    fkGrade: 2.5,
    p50s: 68,
    p95s: 70,
  },
  patient: {
    file: "evals/results/2026-10-06-selfhost-patient-1704.json",
    passes: 5,
    complete: 4,
    lost: 0,
    groundedPct: 96.7,
    nameLeakPct: 4.9,
    fkGrade: 2.9,
    p50s: 59.3,
    p95s: 84.8,
    /** Model time per pass, median (s). */
    perPassP50s: 104.1,
    blockedPrinted: 0,
    wrongCounts: 0,
  },
  /**
   * Judge G2: ONE browser click-through of the app itself with the longer local clock (LOCAL_MODEL_TIMEOUT_MS=270000,
   * src/lib/pass/local-clock.ts). evals/results/2026-10-06-selfhost-browser-1959.{md,json}; tests/unit/selfhost-summary
   * re-reads the JSON. One run, not a benchmark.
   */
  browser: {
    file: "evals/results/2026-10-06-selfhost-browser-1959.json",
    notes: "evals/results/2026-10-06-selfhost-browser-1959.md",
    park: "Celebration Park",
    ageBand: "6-10",
    localTimeoutMs: 270_000,
    /** From pressing "Make my pass" to the pass page. */
    seconds: 96,
    calls: 2,
    finds: 7,
    asked: 8,
    spot: true,
  },
} as const;

export function evalColumn(model: string): EvalColumn {
  const c = EVAL_COLUMNS.find((x) => x.model === model);
  if (!c) throw new Error(`no eval column for ${model}`);
  return c;
}
