/**
 * The measured numbers the /about page quotes (SPEC §6.4 / §6.5, F14).
 *
 * Copied from the committed eval run `evals/results/2026-10-06-3.json` (summary: `2026-10-06-3.md`, notes:
 * `2026-10-06-3-notes.md`), the run after the content tuning (per-park clue openers, word variants in the Park
 * Finds facts, spares scaled to the pool, the retry as a refill, drop reasons in the results). The earlier runs
 * (`2026-10-05.json`, `-2`, `-3`, `-4`, `2026-10-06.json`, `2026-10-06-2.json`) stay in the repo for comparison.
 * tests/unit/about.test.tsx re-reads that JSON and fails if any number here drifts from it, so the page
 * can never show a number that was not measured. When the eval is re-run, point EVAL_RESULTS_FILE at the new
 * results and update the numbers; FAILs stay on the page as current limitations.
 */

export const EVAL_RESULTS_FILE = "evals/results/2026-10-06-3.json";
export const EVAL_SUMMARY_FILE = "evals/results/2026-10-06-3.md";
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

export const EVAL_PARKS = 20;
export const EVAL_AGE_BAND = "6-10";
export const EVAL_TOTAL_USD = 0.0508;

export const EVAL_COLUMNS: readonly EvalColumn[] = [
  {
    model: "gemma-4-31B-it",
    label: "Gemma 4 31B (open, the default)",
    licence: "Apache-2.0",
    runs: 60,
    blockedPrinted: 0,
    groundedPct: 98.9,
    grounded: 436,
    returned: 441,
    completePct: 90.2,
    complete: 46,
    dataRichRuns: 51,
    honestEmptiesPct: 100,
    fkGrade: 1.7,
    nameLeakPct: 2,
    clueLeakPct: 2,
    p50s: 10,
    p95s: 20.5,
    timeouts: 3,
    costPerPass: 0.0007,
    repeatPct: 6.8,
    repeated: 25,
    printedClues: 366,
    wrongCounts: 0,
    countClues: 135,
    wrongCountsRemoved: 11,
  },
  {
    model: "llama-4-maverick",
    label: "Llama 4 Maverick (open, the slow fallback)",
    licence: "Llama 4 Community Licence",
    runs: 20,
    blockedPrinted: 0,
    groundedPct: 95.6,
    grounded: 86,
    returned: 90,
    completePct: 47.1,
    complete: 8,
    dataRichRuns: 17,
    honestEmptiesPct: 100,
    fkGrade: 2.2,
    nameLeakPct: 11.1,
    clueLeakPct: 10,
    p50s: 39.4,
    p95s: 60,
    timeouts: 9,
    costPerPass: 0.00073,
    repeatPct: 0,
    repeated: 0,
    printedClues: 66,
    wrongCounts: 0,
    countClues: 10,
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
    completePct: 94.1,
    complete: 16,
    dataRichRuns: 17,
    honestEmptiesPct: 100,
    fkGrade: 3.8,
    nameLeakPct: 3.5,
    clueLeakPct: 3.5,
    p50s: null,
    p95s: null,
    timeouts: 0,
    costPerPass: 0,
    repeatPct: 23.1,
    repeated: 30,
    printedClues: 130,
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
 * The newest committed results file: a PARTIAL 10-13 smoke (3 parks, 1 Gemma run each), made after the R3
 * reading rules for ages 10-13. Not the frozen numbers; quoted on /how-it-works next to the full run.
 * tests/unit/how-it-works.test.tsx re-reads the JSON and fails if a number here drifts.
 */
export const SMOKE_10_13 = {
  file: "evals/results/2026-10-06-partial-1015.json",
  summary: "evals/results/2026-10-06-partial-1015.md",
  day: "2026-10-06",
  ageBand: "10-13",
  parks: 3,
  complete: 3,
  fkGrade: 4.3,
  nameLeakPct: 15.2,
  p50s: 11.3,
  p95s: 19.8,
  costPerPass: 0.00122,
} as const;

export function evalColumn(model: string): EvalColumn {
  const c = EVAL_COLUMNS.find((x) => x.model === model);
  if (!c) throw new Error(`no eval column for ${model}`);
  return c;
}
