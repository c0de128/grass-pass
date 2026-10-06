/**
 * The measured numbers the /about page quotes (SPEC §6.4 / §6.5, F14).
 *
 * Copied from the committed eval run `evals/results/2026-10-06-2.json` (summary: `2026-10-06-2.md`), the
 * run after audit round 2 (no copyable example clues, a writing voice per park, rotating facts per kind, the count
 * rule, a spare item, code-written grown-up tip; M10 and M11 added). The earlier runs (`2026-10-05.json`, `-2`, `-3`,
 * `-4`, `2026-10-06.json`) stay in the repo for comparison.
 * tests/unit/about.test.tsx re-reads that JSON and fails if any number here drifts from it, so the page
 * can never show a number that was not measured. When the eval is re-run, point EVAL_RESULTS_FILE at the new
 * results and update the numbers; FAILs stay on the page as current limitations.
 */

export const EVAL_RESULTS_FILE = "evals/results/2026-10-06-2.json";
export const EVAL_SUMMARY_FILE = "evals/results/2026-10-06-2.md";
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
export const EVAL_TOTAL_USD = 0.0612;

export const EVAL_COLUMNS: readonly EvalColumn[] = [
  {
    model: "gemma-4-31B-it",
    label: "Gemma 4 31B (open, the default)",
    licence: "Apache-2.0",
    runs: 60,
    blockedPrinted: 0,
    groundedPct: 99.1,
    grounded: 549,
    returned: 554,
    completePct: 86.3,
    complete: 44,
    dataRichRuns: 51,
    honestEmptiesPct: 100,
    fkGrade: 1.7,
    nameLeakPct: 2.7,
    clueLeakPct: 2.2,
    p50s: 10.1,
    p95s: 20.8,
    timeouts: 1,
    costPerPass: 0.00078,
    repeatPct: 29.2,
    repeated: 112,
    printedClues: 383,
    wrongCounts: 0,
    countClues: 124,
    wrongCountsRemoved: 1,
  },
  {
    model: "llama-4-maverick",
    label: "Llama 4 Maverick (open, the slow fallback)",
    licence: "Llama 4 Community Licence",
    runs: 20,
    blockedPrinted: 0,
    groundedPct: 98.1,
    grounded: 155,
    returned: 158,
    completePct: 41.2,
    complete: 7,
    dataRichRuns: 17,
    honestEmptiesPct: 100,
    fkGrade: 0.8,
    nameLeakPct: 10.8,
    clueLeakPct: 10.8,
    p50s: 39.5,
    p95s: 56.6,
    timeouts: 0,
    costPerPass: 0.00106,
    repeatPct: 5.9,
    repeated: 6,
    printedClues: 102,
    wrongCounts: 0,
    countClues: 11,
    wrongCountsRemoved: 7,
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
    nameLeakPct: 2.8,
    clueLeakPct: 2.8,
    p50s: null,
    p95s: null,
    timeouts: 0,
    costPerPass: 0,
    repeatPct: 30.6,
    repeated: 41,
    printedClues: 134,
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

export function evalColumn(model: string): EvalColumn {
  const c = EVAL_COLUMNS.find((x) => x.model === model);
  if (!c) throw new Error(`no eval column for ${model}`);
  return c;
}
