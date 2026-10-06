/**
 * The measured numbers the /about page quotes (SPEC §6.4 / §6.5, F14).
 *
 * Copied from the committed eval run `evals/results/2026-10-05.json` (summary: `2026-10-05.md`).
 * tests/unit/about.test.tsx re-reads that JSON and fails if any number here drifts from it, so the page
 * can never show a number that was not measured. When the eval is re-run, point EVAL_RESULTS_FILE at the new
 * results and update the numbers; FAILs stay on the page as current limitations.
 */

export const EVAL_RESULTS_FILE = "evals/results/2026-10-05.json";
export const EVAL_SUMMARY_FILE = "evals/results/2026-10-05.md";
/** Chicago day of the run. */
export const EVAL_DAY = "2026-10-05";

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
};

export const EVAL_PARKS = 20;
export const EVAL_AGE_BAND = "6-10";
export const EVAL_TOTAL_USD = 0.06415;

export const EVAL_COLUMNS: readonly EvalColumn[] = [
  {
    model: "gemma-4-31B-it",
    label: "Gemma 4 31B (open, the default)",
    licence: "Apache-2.0",
    runs: 60,
    blockedPrinted: 0,
    groundedPct: 99.2,
    grounded: 483,
    returned: 487,
    completePct: 64.7,
    complete: 33,
    dataRichRuns: 51,
    honestEmptiesPct: 100,
    fkGrade: 2.3,
    nameLeakPct: 17.5,
    clueLeakPct: 7.6,
    p50s: 13.8,
    p95s: 24.3,
    timeouts: 0,
    costPerPass: 0.00086,
  },
  {
    model: "llama-4-maverick",
    label: "Llama 4 Maverick (open, the slow fallback)",
    licence: "Llama 4 Community Licence",
    runs: 20,
    blockedPrinted: 0,
    groundedPct: 97.4,
    grounded: 114,
    returned: 117,
    completePct: 58.8,
    complete: 10,
    dataRichRuns: 17,
    honestEmptiesPct: 100,
    fkGrade: 2.3,
    nameLeakPct: 9.4,
    clueLeakPct: 6.0,
    p50s: 28.8,
    p95s: 60.0,
    timeouts: 4,
    costPerPass: 0.00098,
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
    completePct: 100,
    complete: 17,
    dataRichRuns: 17,
    honestEmptiesPct: 100,
    fkGrade: 5.9,
    nameLeakPct: 0,
    clueLeakPct: 0,
    p50s: null,
    p95s: null,
    timeouts: 0,
    costPerPass: 0,
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
} as const;

export function evalColumn(model: string): EvalColumn {
  const c = EVAL_COLUMNS.find((x) => x.model === model);
  if (!c) throw new Error(`no eval column for ${model}`);
  return c;
}
