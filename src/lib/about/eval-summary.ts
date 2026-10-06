/**
 * The measured numbers the /about page quotes (SPEC §6.4 / §6.5, F14).
 *
 * Copied from the committed eval run `evals/results/2026-10-06-5.json` (summary: `2026-10-06-5.md`, notes:
 * `2026-10-06-5-notes.md`), the run after audit round 4 (new clue voice, name-phrase leaks, fact word choices,
 * repeated openings as a hard drop). Lucky Finds were not in the eval (no SerpApi recordings for the 20 parks). The
 * earlier runs (`2026-10-05.json`, `-2`, `-3`, `-4`, `2026-10-06.json`, `-2`, `-3`, `-4`) stay in the repo for comparison.
 * tests/unit/about.test.tsx re-reads that JSON and fails if any number here drifts from it, so the page
 * can never show a number that was not measured. When the eval is re-run, point EVAL_RESULTS_FILE at the new
 * results and update the numbers; FAILs stay on the page as current limitations.
 */

export const EVAL_RESULTS_FILE = "evals/results/2026-10-06-5.json";
export const EVAL_SUMMARY_FILE = "evals/results/2026-10-06-5.md";
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
export const GEMMA_P50_EXACT_S = 12.29;
export const GEMMA_FIRST_CALL_P50_S = 13.7;
/** Median answer tokens per second of Gemma's answered calls, this run and the run before (provider speed). */
export const GEMMA_TOKENS_PER_S = { now: 34.3, before: 46.2 } as const;

/** The full run before this one, for "up from / down from" lines (checked against its JSON by a test). */
export const PREVIOUS_RUN = { id: "2026-10-06-4", file: "evals/results/2026-10-06-4.json", repeatPct: 13.4, completePct: 98 } as const;

export const EVAL_PARKS = 20;
export const EVAL_AGE_BAND = "6-10";
export const EVAL_TOTAL_USD = 0.0578;

export const EVAL_COLUMNS: readonly EvalColumn[] = [
  {
    model: "gemma-4-31B-it",
    label: "Gemma 4 31B (open, the default)",
    licence: "Apache-2.0",
    runs: 60,
    blockedPrinted: 0,
    groundedPct: 98.6,
    grounded: 505,
    returned: 512,
    completePct: 84.3,
    complete: 43,
    dataRichRuns: 51,
    honestEmptiesPct: 100,
    fkGrade: 2.3,
    nameLeakPct: 4.5,
    clueLeakPct: 4.3,
    p50s: 12.3,
    p95s: 23.8,
    timeouts: 0,
    costPerPass: 0.00089,
    repeatPct: 9.6,
    repeated: 36,
    printedClues: 374,
    wrongCounts: 0,
    countClues: 81,
    wrongCountsRemoved: 13,
  },
  {
    model: "llama-4-maverick",
    label: "Llama 4 Maverick (open, a slower alternative you can switch to)",
    licence: "Llama 4 Community Licence",
    runs: 20,
    blockedPrinted: 0,
    groundedPct: 98.5,
    grounded: 64,
    returned: 65,
    completePct: 29.4,
    complete: 5,
    dataRichRuns: 17,
    honestEmptiesPct: 100,
    fkGrade: 2.3,
    nameLeakPct: 6.2,
    clueLeakPct: 4.6,
    p50s: 60,
    p95s: 60,
    timeouts: 11,
    costPerPass: 0.00054,
    repeatPct: 0,
    repeated: 0,
    printedClues: 51,
    wrongCounts: 0,
    countClues: 5,
    wrongCountsRemoved: 1,
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
    fkGrade: 3.6,
    nameLeakPct: 1.4,
    clueLeakPct: 1.4,
    p50s: null,
    p95s: null,
    timeouts: 0,
    costPerPass: 0,
    repeatPct: 18.2,
    repeated: 18,
    printedClues: 99,
    wrongCounts: 0,
    countClues: 6,
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
 * run 2026-10-06-5 on the same code. Not the frozen numbers; quoted on /how-it-works next to the full run.
 * tests/unit/how-it-works.test.tsx re-reads the JSON and fails if a number here drifts.
 */
export const SMOKE_10_13 = {
  file: "evals/results/2026-10-06-partial-1439.json",
  summary: "evals/results/2026-10-06-partial-1439.md",
  day: "2026-10-06",
  ageBand: "10-13",
  parks: 3,
  complete: 1,
  /** Calls that hit the 30 s limit (the pass made nothing). */
  timeouts: 1,
  fkGrade: 3.1,
  nameLeakPct: 5,
  p50s: 13.4,
  p95s: 27.6,
  /** Total spend over all 3 cases (the timed-out one billed nothing), as the scorer counts it. */
  costPerPass: 0.00082,
  /** Total spend over the passes that finished (2 of 3), 5 decimals. */
  costPerFinishedPass: 0.00123,
} as const;

export function evalColumn(model: string): EvalColumn {
  const c = EVAL_COLUMNS.find((x) => x.model === model);
  if (!c) throw new Error(`no eval column for ${model}`);
  return c;
}
