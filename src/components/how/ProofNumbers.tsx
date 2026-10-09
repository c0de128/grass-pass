import { UNIT_TESTS, pct, usd } from "@/lib/about/content";
import { EVAL_THRESHOLDS, evalColumn } from "@/lib/about/eval-summary";

/**
 * The real-numbers strip on /how-it-works (Kevin's Blueprint, 2026-10-09). Every value comes from the committed eval run
 * (src/lib/about/eval-summary.ts, re-checked against its JSON by tests/unit/about.test.tsx) or the dated unit-test count
 * (src/lib/about/content.ts UNIT_TESTS). The small bars and dots are drawn from the same numbers; a miss is shown as a miss.
 */

function Verdict({ met, target }: { met: boolean | null; target: string }) {
  if (met === null) return <p className="text-xs font-semibold text-muted-foreground">{target}</p>;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-muted-foreground">
      <span className={`rounded-full px-2 py-0.5 font-bold ${met ? "bg-primary text-primary-foreground" : "bg-ink text-on-ink"}`}>{met ? "Met" : "Missed"}</span>
      Target {target}
    </p>
  );
}

/** A value bar with a target tick. `max` is the right end of the track. */
function Bar({ value, target, max, label }: { value: number; target: number; max: number; label: string }) {
  const v = Math.min(100, (value / max) * 100);
  const tk = Math.min(100, (target / max) * 100);
  return (
    <div aria-hidden="true" className="relative mt-1 h-3 w-full rounded-full bg-muted ring-1 ring-border" title={label}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${v}%` }} />
      <div className="absolute -top-1.5 -bottom-1.5 w-0.5 rounded-full bg-ink" style={{ left: `calc(${tk}% - 1px)` }} />
    </div>
  );
}

export function ProofNumbers() {
  const g = evalColumn("gemma-4-31B-it");
  const t = EVAL_THRESHOLDS;
  const costMax = Math.max(g.costPerPass, t.costPerPass) * 1.25;
  const tiles = [
    {
      key: "grounded",
      value: pct(g.groundedPct),
      label: "of clues quote their source exactly",
      verdict: <Verdict met={g.groundedPct >= t.groundedPct} target={`${t.groundedPct}% or more`} />,
      viz: <Bar value={g.groundedPct} target={t.groundedPct} max={100} label={`${g.grounded} of ${g.returned}`} />,
    },
    {
      key: "blocked",
      value: String(g.blockedPrinted),
      label: `risky species printed in ${g.runs} test runs`,
      verdict: <Verdict met={g.blockedPrinted === 0} target="0, always" />,
      viz: (
        <div aria-hidden="true" className="mt-1 grid grid-cols-[repeat(20,minmax(0,1fr))] gap-1">
          {Array.from({ length: g.runs }, (_, i) => (
            <span key={i} className={`aspect-square rounded-full ${i < g.blockedPrinted ? "bg-destructive" : "bg-primary"}`} />
          ))}
        </div>
      ),
    },
    {
      key: "cost",
      value: usd(g.costPerPass),
      label: "per pass for the clues, at list price",
      verdict: <Verdict met={g.costPerPass <= t.costPerPass} target={`${usd(t.costPerPass)} or less`} />,
      viz: <Bar value={g.costPerPass} target={t.costPerPass} max={costMax} label="cost against target" />,
    },
    {
      key: "tests",
      value: UNIT_TESTS.passed.toLocaleString("en-US"),
      label: `unit tests passing, in ${UNIT_TESTS.files} files`,
      verdict: <Verdict met={null} target={`Counted ${UNIT_TESTS.day}`} />,
      viz: null,
    },
  ];
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile) => (
        <li key={tile.key} data-stat={tile.key} className="flex flex-col gap-2 rounded-3xl bg-card p-5 shadow-lg ring-1 shadow-shadow/40 ring-border sm:p-6">
          <p className="font-heading text-5xl leading-none font-extrabold tracking-tight text-ink tabular-nums 2xl:text-6xl">{tile.value}</p>
          <p className="font-semibold text-ink">{tile.label}</p>
          {tile.viz}
          <div className="mt-auto pt-1">{tile.verdict}</div>
        </li>
      ))}
    </ul>
  );
}
