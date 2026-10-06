import { EVAL_AGE_BAND, EVAL_DAY, EVAL_PARKS, EVAL_THRESHOLDS, type EvalColumn } from "@/lib/about/eval-summary";
import { pct, secs, usd } from "@/lib/about/content";

/** The full measured open-vs-open-vs-no-AI table (SPEC §6.5), every row explained in plain words. */
export function EvalTable({ columns }: { columns: readonly EvalColumn[] }) {
  const rows: { label: string; plain: string; cell: (c: EvalColumn) => string; target?: string }[] = [
    {
      label: "Blocked (dangerous) species printed",
      plain: "Risky things like snakes or poison ivy. Must be zero.",
      cell: (c) => String(c.blockedPrinted),
      target: "0, always",
    },
    {
      label: "Clues quoting their source word for word, before any filter",
      plain: "How often the model quoted its real fact exactly.",
      cell: (c) => `${pct(c.groundedPct)} (${c.grounded}/${c.returned})`,
      target: `${EVAL_THRESHOLDS.groundedPct}% or more`,
    },
    {
      label: "Complete passes (kept at least n-1 items)",
      plain: "At most one find missing.",
      cell: (c) => `${pct(c.completePct)} (${c.complete}/${c.dataRichRuns})`,
      target: `${EVAL_THRESHOLDS.completePct}% or more`,
    },
    {
      label: "Honest empty sections",
      plain: "No data? The pass says so instead of filling the gap.",
      cell: (c) => pct(c.honestEmptiesPct),
      target: "100%",
    },
    {
      label: "Reading level (Flesch-Kincaid grade, median)",
      plain: "3 means a 3rd grader can read them.",
      cell: (c) => c.fkGrade.toFixed(1),
      target: `${EVAL_THRESHOLDS.fkGrade} or lower`,
    },
    {
      label: "Clues or hints naming their own answer, before the filter",
      plain: "Code removes these before printing.",
      cell: (c) => `${pct(c.nameLeakPct)} (clue only ${pct(c.clueLeakPct)})`,
      target: `${EVAL_THRESHOLDS.nameLeakPct}% or lower`,
    },
    {
      label: "Model time per call, p50 / p95",
      plain: "a usual wait / a slow wait (1 in 20 is slower).",
      cell: (c) => (c.p50s === null ? "no model call" : `${secs(c.p50s)} / ${secs(c.p95s)}`),
      target: `${EVAL_THRESHOLDS.p50s} s / ${EVAL_THRESHOLDS.p95s} s`,
    },
    {
      label: "Cost per pass",
      plain: "At the provider's list price.",
      cell: (c) => usd(c.costPerPass),
      target: `${usd(EVAL_THRESHOLDS.costPerPass)} or less`,
    },
    {
      label: "Printed clues repeated across parks",
      plain: "Shares 5 words in a row with clues for at least 2 other parks.",
      cell: (c) => `${pct(c.repeatPct)} (${c.repeated}/${c.printedClues})`,
      target: `${EVAL_THRESHOLDS.repeatPct}% or lower`,
    },
    {
      label: "Printed clues with a wrong count",
      plain: "A count must match the map. In brackets: wrong counts code removed first.",
      cell: (c) => `${c.wrongCounts} of ${c.countClues} count clues (${c.wrongCountsRemoved} removed)`,
      target: String(EVAL_THRESHOLDS.wrongCounts),
    },
    { label: "Licence", plain: "The terms for using the weights.", cell: (c) => c.licence },
  ];
  return (
    <div className="overflow-x-auto rounded-2xl bg-card ring-1 ring-border" role="region" aria-labelledby="eval-caption" tabIndex={0}>
      <table className="w-full min-w-[640px] border-collapse text-left text-base">
        <caption id="eval-caption" className="px-4 pt-3 pb-2 text-left font-bold">
          {EVAL_PARKS} real parks, ages {EVAL_AGE_BAND}, {EVAL_DAY}: the same park data and the same checks for every column
        </caption>
        <thead>
          <tr className="border-b-2 border-line">
            <th scope="col" className="px-4 py-2">
              What we measured
            </th>
            {columns.map((c) => (
              <th key={c.model} scope="col" className="px-4 py-2">
                {c.label}
                <span className="block text-sm font-normal">
                  {c.runs} {c.runs === 1 ? "run" : "runs"}
                </span>
              </th>
            ))}
            <th scope="col" className="px-4 py-2">
              Target
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-line last:border-b-0">
              <th scope="row" className="px-4 py-2 font-semibold">
                {r.label}
                <span className="block text-sm font-normal">{r.plain}</span>
              </th>
              {columns.map((c) => (
                <td key={c.model} className="px-4 py-2">
                  {r.cell(c)}
                </td>
              ))}
              <td className="px-4 py-2">{r.target ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
