import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { setLogSink } from "@/lib/log";
import { prettyJson } from "../json";
import { replayResults } from "../replay";
import { RESULTS_DIR, type EvalResults } from "../run";
import { isComplete } from "../score";

/**
 * `pnpm eval:replay` (free: no model, no network). EVAL_FROM=<results JSON name> (required),
 * EVAL_REPLAY_MODELS (default gemma-4-31B-it), EVAL_REPLAY_OUT (optional JSON path for the details).
 * Prints M3 / M10 / M6 / drops of the saved run's own answers through today's code.
 */
test("replay a saved eval run through today's checks (pnpm eval:replay)", async () => {
  const name = process.env.EVAL_FROM?.trim();
  expect(name, "No data available: set EVAL_FROM to a results JSON in evals/results").toBeTruthy();
  const file = path.join(RESULTS_DIR, path.basename(name as string));
  const results = JSON.parse(readFileSync(file, "utf8")) as EvalResults;
  const models = (process.env.EVAL_REPLAY_MODELS?.trim() || "gemma-4-31B-it").split(",").map((s) => s.trim()).filter(Boolean);
  const restore = setLogSink(() => undefined);
  try {
    const { summaries, skipped } = await replayResults(results, models);
    const say = (s: string) => process.stdout.write(`${s}\n`);
    for (const s of skipped) say(`skipped ${s}`);
    for (const { model, score, runs, unrecorded, optimisticComplete } of summaries) {
      const pct = (r: number | null) => (r === null ? "n/a" : `${(r * 100).toFixed(1)}%`);
      say(`\n== ${model} (${path.basename(file)}, ${runs.length} runs) ==`);
      say(`M3 complete: ${score.m3.complete}/${score.m3.dataRichRuns} = ${pct(score.m3.rate)} (lower bound; ${optimisticComplete}/${score.m3.dataRichRuns} if every unrecorded call had filled its pass)`);
      say(`M10 cross-park repetition: ${score.m10.repeated}/${score.m10.clues} = ${pct(score.m10.rate)}; top: ${score.m10.top.map((t) => `"${t.gram}" (${t.parks})`).join(", ")}`);
      say(`M5 FK median: ${score.m5.medianGrade?.toFixed(1) ?? "n/a"} (${score.m5.clues} clues)`);
      say(`M6 name leaks before filter: ${score.m6.leaks}/${score.m6.returned} = ${pct(score.m6.rate)}`);
      say(`M11 printed wrong counts: ${score.m11.printedWrong} of ${score.m11.printedCountClues}`);
      say(`unrecorded calls today's code would make: ${unrecorded.length} (${unrecorded.map((u) => `case ${u.caseN} r${u.run} call ${u.callIndex + 1} asks ${u.asked}`).join("; ")})`);
      const drops: Record<string, number> = {};
      for (const r of runs) for (const d of r.dropLog) drops[d.reason] = (drops[d.reason] ?? 0) + 1;
      say(`drops (today's code, replayed calls): ${Object.entries(drops).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
      for (const r of runs.filter((x) => x.dataRich && !isComplete(x))) {
        say(`  short: case ${r.caseN} ${r.slug} r${r.run}: ${r.kind}${r.errorCode ? ` ${r.errorCode}` : ""} ${r.items.length}/${r.n} calls ${r.calls.length}`);
      }
    }
    const out = process.env.EVAL_REPLAY_OUT?.trim();
    if (out) {
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, prettyJson({ from: path.basename(file), summaries: summaries.map((s) => ({ ...s, score: { ...s.score, drops: undefined } })) }, 2));
      say(`wrote ${out}`);
    }
  } finally {
    restore();
  }
});
