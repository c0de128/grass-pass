/**
 * The measured numbers the /about page quotes (SPEC §6.4 / §6.5, F14).
 *
 * Copied from the committed eval run `evals/results/2026-10-06-7.json` (summary: `2026-10-06-7.md`, notes:
 * `2026-10-06-7-notes.md`), the run after the round-5 safety and clue-quality work (32 blocked groups, the danger-word
 * filter, the `jargon` drop and `trivia` preference, the kid-words prompt rule, cleaned species text). Lucky Finds were
 * not in the eval (no SerpApi recordings for the 20 parks). The earlier runs (`2026-10-05.json`, `-2`, `-3`, `-4`,
 * `2026-10-06.json`, `-2` to `-6`) stay in the repo for comparison.
 * tests/unit/about.test.tsx re-reads that JSON and fails if any number here drifts from it, so the page
 * can never show a number that was not measured. When the eval is re-run, point EVAL_RESULTS_FILE at the new
 * results and update the numbers; FAILs stay on the page as current limitations.
 */

export const EVAL_RESULTS_FILE = "evals/results/2026-10-06-7.json";
export const EVAL_SUMMARY_FILE = "evals/results/2026-10-06-7.md";
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
export const GEMMA_P50_EXACT_S = 9.37;
export const GEMMA_FIRST_CALL_P50_S = 10.2;
/** Median answer tokens per second of Gemma's answered calls, this run and the run before (provider speed). */
export const GEMMA_TOKENS_PER_S = { now: 47.3, before: 36.8 } as const;

/** The full run before this one, for "up from / down from" lines (checked against its JSON by a test). */
export const PREVIOUS_RUN = { id: "2026-10-06-6", file: "evals/results/2026-10-06-6.json", repeatPct: 5.1, completePct: 94.1, costPerPass: 0.00097, p50s: 12, p95s: 22.7 } as const;

/**
 * Gemma's failed first calls in this run, each followed by one whole retry (checked against the JSON by a test):
 * how many hit the 30 s limit, how many were HTTP 403, and how many of those passes still came out complete.
 */
export const GEMMA_FAILED_FIRST_CALLS = { timeouts: 1, http403: 0, rescued: 1 } as const;
/**
 * RULES-5-03: Gemma's test runs vs passes. Of its runs, how many made a pass, and how many runs (on how many parks)
 * made none because the park had no usable data (checked against the JSON by tests/unit/about.test.tsx).
 */
export const GEMMA_RUN_COUNTS = { passes: 54, noDataRuns: 6, noDataParks: 2 } as const;
/** Gemma test passes (data-rich) that ended short, and on how many different parks. */
export const GEMMA_SHORT_PASSES = { passes: 2, parks: 1 } as const;

/**
 * Q-5-02: Gemma's cost per pass as a range. Since run -7 the scorer prices a timed-out call (no answer, so no token
 * count) at its prompt size in `costPerPass` (the low end, the column's costPerPass); `high` also bills a full
 * max_tokens answer for it. `atZero` is the cost with the timed-out call priced at $0 (as the runs before -7 did).
 * Whether DigitalOcean bills a timed-out request is not known. Checked against the JSON by tests/unit/about.test.tsx.
 */
export const GEMMA_COST_RANGE = { timedOutCalls: 1, atZero: 0.00102, high: 0.00105, maxTokens: 1_200 } as const;

/**
 * Why M8 rose in run -7: the mean prompt tokens of Gemma's answered first calls, this run and the run before (the new
 * kid-words rule). Checked against both JSON files by tests/unit/about.test.tsx.
 */
export const GEMMA_FIRST_PROMPT_TOKENS = { now: 3084, before: 2836 } as const;

/**
 * Audit R5 Q-5-01: printed Gemma Wild Finds whose clue our own checks call jargon or trivia (src/lib/ai/jargon.ts),
 * this run and the run before. Trivia is a preference: it prints when no spare can replace it. Re-derived from both
 * JSON files with jargonProblem / triviaProblem by tests/unit/about.test.tsx.
 */
export const GEMMA_VAGUE_CLUES = { flagged: 6, wildPrinted: 133, before: 27, beforeWildPrinted: 126 } as const;
/**
 * r7 follow-ups: the same printed Wild Finds of runs -7 and -6 counted with today's stricter jargon/trivia checks
 * (range and habitat facts, two-word bare colours, plurals, numbered segments). Not shown on the page; the next
 * paid run's numbers replace both (unit test: about.test.tsx).
 */
export const GEMMA_VAGUE_CLUES_TODAY = { flagged: 22, before: 30 } as const;

export const EVAL_PARKS = 20;
export const EVAL_AGE_BAND = "6-10";
export const EVAL_TOTAL_USD = 0.0894;

export const EVAL_COLUMNS: readonly EvalColumn[] = [
  {
    model: "gemma-4-31B-it",
    label: "Gemma 4 31B (open, the default)",
    licence: "Apache-2.0",
    runs: 60,
    blockedPrinted: 0,
    groundedPct: 97.2,
    grounded: 518,
    returned: 533,
    completePct: 96.1,
    complete: 49,
    dataRichRuns: 51,
    honestEmptiesPct: 100,
    fkGrade: 2.5,
    nameLeakPct: 2.8,
    clueLeakPct: 2.6,
    p50s: 9.4,
    p95s: 13.8,
    timeouts: 0,
    costPerPass: 0.00103,
    repeatPct: 2.8,
    repeated: 11,
    printedClues: 390,
    wrongCounts: 0,
    countClues: 86,
    wrongCountsRemoved: 4,
  },
  {
    model: "llama-4-maverick",
    label: "Llama 4 Maverick (open, a slower alternative you can switch to)",
    licence: "Llama 4 Community Licence",
    runs: 20,
    blockedPrinted: 0,
    groundedPct: 96.2,
    grounded: 152,
    returned: 158,
    completePct: 47.1,
    complete: 8,
    dataRichRuns: 17,
    honestEmptiesPct: 100,
    fkGrade: 2.3,
    nameLeakPct: 14.6,
    clueLeakPct: 14.6,
    p50s: 26.1,
    p95s: 52.6,
    timeouts: 1,
    costPerPass: 0.00186,
    repeatPct: 0,
    repeated: 0,
    printedClues: 98,
    wrongCounts: 0,
    countClues: 7,
    wrongCountsRemoved: 9,
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
    fkGrade: 3.2,
    nameLeakPct: 1.4,
    clueLeakPct: 1.4,
    p50s: null,
    p95s: null,
    timeouts: 0,
    costPerPass: 0,
    repeatPct: 18.8,
    repeated: 18,
    printedClues: 96,
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
 * run 2026-10-06-7 on the same code, on the same 3 parks as the smokes before it (`partial-1439`, `partial-1621`). Not the frozen numbers; quoted on /how-it-works next to the full run.
 * tests/unit/how-it-works.test.tsx re-reads the JSON and fails if a number here drifts.
 */
export const SMOKE_10_13 = {
  file: "evals/results/2026-10-06-partial-1853.json",
  summary: "evals/results/2026-10-06-partial-1853.md",
  day: "2026-10-06",
  ageBand: "10-13",
  parks: 3,
  complete: 3,
  /** Calls that hit the 30 s limit. */
  timeouts: 0,
  /** Model calls made in the smoke. */
  calls: 4,
  fkGrade: 3.8,
  nameLeakPct: 7.1,
  p50s: 16.2,
  p95s: 21.4,
  /** Total spend over all 3 cases, as the scorer counts it. */
  costPerPass: 0.00117,
  /** Total spend over the passes that finished (3 of 3), 5 decimals. */
  costPerFinishedPass: 0.00117,
  /** Q-5-05: passes that printed at least the promised hard finds (2 for 10-13). */
  hardKept: 3,
} as const;

/**
 * Self-hosted row (judge G1, Builder W, 2026-10-06): Gemma 4 E2B (`gemma4:e2b-it-qat`, Apache-2.0) served by Ollama on
 * a laptop CPU with no GPU, 5 parks x 1 run, 6-10 band, $0. Two PARTIAL runs: `app` with the app's own limits (70 s per
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
