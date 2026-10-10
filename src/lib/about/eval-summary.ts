/**
 * The measured numbers the /about page quotes (SPEC §6.4 / §6.5, F14).
 *
 * Copied from the committed eval run `evals/results/2026-10-10-3.json` (summary: `2026-10-10-3.md`), the first full
 * run after the Oct 10 clue-wording rewrite ("kid voice" for every age band, plain-words Park Finds fact sheets, bank
 * kid-voice-2026-10-10b), with the same sized time limits as run 2026-10-06-9 (src/lib/pass/budget.ts: a first call gets
 * 30-40 s, the whole retry the time left, a refill 15-30 s). Lucky Finds were not in the eval (no SerpApi recordings for
 * the 20 parks). The two full runs of the same day that missed (`2026-10-10.json`: M3 86.3%, M10 6.4%;
 * `2026-10-10-2.json`: M3 78.4%) and every earlier run (`2026-10-05.json` to `2026-10-06-9.json`) stay in the repo.
 * tests/unit/about.test.tsx re-reads that JSON and fails if any number here drifts from it, so the page
 * can never show a number that was not measured. When the eval is re-run, point EVAL_RESULTS_FILE at the new
 * results and update the numbers; FAILs stay on the page as current limitations. The full sync list (README, docs/EVALS.md,
 * the self-host notes' "the pages now quote" paragraph) is in evals/README.md.
 */

export const EVAL_RESULTS_FILE = "evals/results/2026-10-10-3.json";
export const EVAL_SUMMARY_FILE = "evals/results/2026-10-10-3.md";
/** Chicago day of the run. */
export const EVAL_DAY = "2026-10-10";
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
export const GEMMA_P50_EXACT_S = 9.47;
export const GEMMA_FIRST_CALL_P50_S = 11;
/** Median answer tokens per second of Gemma's answered calls, this run and the run before (provider speed). */
export const GEMMA_TOKENS_PER_S = { now: 44.8, before: 39.5 } as const;

/**
 * The run the pages compare with ("in the run before"): 2026-10-06-9, the last full run before the Oct 10 wording rewrite,
 * with the same sized limits (checked against its JSON by a test): its lost runs, and its first calls that hit their
 * sized limit (at most `firstCallLimitS`). The two missed runs of Oct 10 are named in README and docs/EVALS.md.
 */
export const PREVIOUS_RUN = { id: "2026-10-06-9", file: "evals/results/2026-10-06-9.json", repeatPct: 4.1, completePct: 90.2, costPerPass: 0.00108, p50s: 9.9, p95s: 27.1, lostRuns: 0, firstCallTimeouts: 1, firstCallLimitS: 40 } as const;
/** The fixed first-call limit before the sized limits (run 2026-10-06-8 and earlier); `savedBySizedLimit` counts against it. */
export const FIXED_FIRST_CALL_LIMIT_BEFORE_SIZING_S = 30;

/**
 * Gemma's failed calls in this run (checked against the JSON by a test). `timeouts`: first calls that hit their sized
 * limit (at most 40 s), each followed by one whole retry; `rescued`: those passes that still came out complete. `lost`:
 * passes whose retry failed too (`retryTimeouts` timed out again, `retry403` got HTTP 403), so they printed nothing.
 * `refillTimeouts`: refills that hit their sized 15-30 s limit (the pass kept what it had). `http403`: first calls that
 * got HTTP 403. `savedBySizedLimit`: answered first calls that took longer than the old fixed 30 s limit.
 */
/** The first-call limit this run ran with: sized per call, at most 40 s (src/lib/pass/budget.ts). Run -8 had a fixed 30 s. */
export const GEMMA_RUN_FIRST_CALL_LIMIT_S = 40;
export const GEMMA_FAILED_FIRST_CALLS = { timeouts: 3, http403: 0, rescued: 1, lost: 1, retryTimeouts: 1, retry403: 0, refillTimeouts: 0, savedBySizedLimit: 0 } as const;
/**
 * RULES-5-03: Gemma's test runs vs passes. Of its runs, how many made a pass, and how many runs (on how many parks)
 * made none because the park had no usable data (checked against the JSON by tests/unit/about.test.tsx).
 */
export const GEMMA_RUN_COUNTS = { passes: 53, noDataRuns: 6, noDataParks: 2, lostRuns: 1 } as const;
/**
 * Gemma test runs (data-rich) that did not make a complete pass, and on how many different parks: `passes` counts the
 * short passes and the lost runs (GEMMA_FAILED_FIRST_CALLS.lost) together; `printedShort` only the passes that printed
 * with finds missing; `refillTimedOut` the printed-short passes where a refill ran out of time; `afterFirstTimeout` the
 * printed-short passes whose first call timed out (the whole retry answered). The rest were short on content: every
 * call answered, the refills kept too little.
 */
export const GEMMA_SHORT_PASSES = { passes: 5, parks: 3, printedShort: 4, printedShortParks: 2, refillTimedOut: 0, afterFirstTimeout: 1 } as const;

/**
 * Q-5-02: Gemma's cost per pass as a range. Since run -7 the scorer prices a timed-out call (no answer, so no token
 * count) at its prompt size in `costPerPass` (the low end, the column's costPerPass); `high` also bills a full
 * max_tokens answer for it. `atZero` is the cost with the timed-out call priced at $0 (as the runs before -7 did).
 * Whether DigitalOcean bills a timed-out request is not known. Since run -9 each call's max_tokens is sized to what it
 * asks (400-1,200), so `high` bills each timed-out call's own max_tokens. Checked against the JSON by
 * tests/unit/about.test.tsx.
 */
export const GEMMA_COST_RANGE = { timedOutCalls: 4, atZero: 0.00104, high: 0.00111 } as const;

/**
 * The mean prompt tokens of Gemma's answered first calls, this run and the run before (the Oct 10 kid-voice rules made
 * the prompt longer). Checked against both JSON files by tests/unit/about.test.tsx.
 */
export const GEMMA_FIRST_PROMPT_TOKENS = { now: 2936, before: 2844 } as const;

/**
 * Audit R5 Q-5-01: printed Gemma Wild Finds whose clue our own checks call jargon or trivia (src/lib/ai/jargon.ts),
 * this run and the run before, both counted with today's checks.
 * Trivia prints when no spare can replace it. Re-derived from both JSON files with jargonProblem / triviaProblem by
 * tests/unit/about.test.tsx.
 */
export const GEMMA_VAGUE_CLUES = { flagged: 13, wildPrinted: 123, before: 11, beforeWildPrinted: 119 } as const;
/**
 * Round-6 judge C4 (the "listen for the water" clue on every example pass): passes with a water-by-ear clue, of
 * Gemma's passes, and on how many parks; this run and the run before (soundThemes in evals/score.ts; test: about.test.tsx).
 */
export const GEMMA_WATER_BY_EAR = { passes: 15, of: 53, parks: 6, before: 14, beforeOf: 54, beforeParks: 6 } as const;

/** M10's most repeated 5-word run in this run, and on how many parks (scores[].m10.top[0]; checked by about.test.tsx). */
export const GEMMA_TOP_REPEAT = { gram: "point to the still water", parks: 3 } as const;

export const EVAL_PARKS = 20;
export const EVAL_AGE_BAND = "6-10";
export const EVAL_TOTAL_USD = 0.0916;

export const EVAL_COLUMNS: readonly EvalColumn[] = [
  {
    model: "gemma-4-31B-it",
    label: "Gemma 4 31B (open, the default)",
    licence: "Apache-2.0",
    runs: 60,
    blockedPrinted: 0,
    groundedPct: 98,
    grounded: 541,
    returned: 552,
    completePct: 90.2,
    complete: 46,
    dataRichRuns: 51,
    honestEmptiesPct: 100,
    fkGrade: 2.5,
    nameLeakPct: 3.3,
    clueLeakPct: 2.9,
    p50s: 9.5,
    p95s: 25.3,
    timeouts: 1,
    costPerPass: 0.00107,
    repeatPct: 1.6,
    repeated: 6,
    printedClues: 383,
    wrongCounts: 0,
    countClues: 74,
    wrongCountsRemoved: 15,
  },
  {
    model: "llama-4-maverick",
    label: "Llama 4 Maverick (open, a slower alternative you can switch to)",
    licence: "Llama 4 Community Licence",
    runs: 20,
    blockedPrinted: 0,
    groundedPct: 94.4,
    grounded: 201,
    returned: 213,
    completePct: 94.1,
    complete: 16,
    dataRichRuns: 17,
    honestEmptiesPct: 100,
    fkGrade: 2.5,
    nameLeakPct: 12.7,
    clueLeakPct: 11.7,
    p50s: 20.6,
    p95s: 31.3,
    timeouts: 0,
    costPerPass: 0.00188,
    repeatPct: 2.3,
    repeated: 3,
    printedClues: 130,
    wrongCounts: 0,
    countClues: 12,
    wrongCountsRemoved: 5,
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
    fkGrade: 2.5,
    nameLeakPct: 1.4,
    clueLeakPct: 1.4,
    p50s: null,
    p95s: null,
    timeouts: 0,
    costPerPass: 0,
    repeatPct: 20.7,
    repeated: 19,
    printedClues: 92,
    wrongCounts: 0,
    countClues: 3,
    wrongCountsRemoved: 1,
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
 * RULES-8-04: the Teens & adults (13+) partial check (2026-10-07, 3 parks, one run each, 6 model calls). Notes:
 * evals/results/2026-10-07-13plus-notes.md. tests/unit/how-it-works.test.tsx re-reads the JSON.
 */
export const SMOKE_13PLUS = {
  file: "evals/results/2026-10-07-partial-1617.json",
  summary: "evals/results/2026-10-07-partial-1617.md",
  day: "2026-10-07",
  ageBand: "13+",
  parks: 3,
  /** Complete by the M3 rule (at most one find short). */
  complete: 3,
  /** Passes that printed every find they asked for (Oak Point 8/8, White Rock 8/8; Celebration 7/8). */
  full: 2,
  calls: 6,
  /** Reading grade: the kid target (3.5 or less) does not apply to 13+. */
  fkGrade: 3.9,
  nameLeakPct: 2.4,
  p50s: 9.5,
  p95s: 11.8,
  costPerPass: 0.00162,
  /** Passes that printed the promised 3 hard finds. */
  hardKept: 2,
  hardMin: 3,
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
