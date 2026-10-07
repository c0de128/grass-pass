import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { setLogSink } from "@/lib/log";
import { prettyJson } from "../json";
import { replayResults } from "../replay";
import { RESULTS_DIR, type EvalResults } from "../run";
import { isComplete, taxonOfPrinted } from "../score";
import { jargonProblem, triviaProblem, wrongKindWord } from "@/lib/ai/jargon";
import { dangerClueWord } from "@/lib/safety/danger-taxa";

/**
 * `pnpm eval:replay` (free: no model, no network). EVAL_FROM=<results JSON name> (required),
 * EVAL_REPLAY_MODELS (default gemma-4-31B-it), EVAL_REPLAY_OUT (optional JSON path for the details),
 * EVAL_REPLAY_TPS (slow clock: answer tokens/s), EVAL_REPLAY_OLD_BUDGET=1 (the fixed limits before the slow-provider fix).
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
    const tps = Number(process.env.EVAL_REPLAY_TPS?.trim());
    const opts = { tps: Number.isFinite(tps) && tps > 0 ? tps : null, oldBudget: process.env.EVAL_REPLAY_OLD_BUDGET?.trim() === "1" };
    const { summaries, skipped, contexts } = await replayResults(results, models, opts);
    const say = (s: string) => process.stdout.write(`${s}\n`);
    say(`clock: ${opts.tps ? `slow, every answered call at most ${opts.tps} answer tokens/s` : "recorded latencies"}; limits: ${opts.oldBudget ? "OLD fixed (30 s / 20 s refill / same whole retry)" : "today's budget (src/lib/pass/budget.ts)"}`);
    for (const s of skipped) say(`skipped ${s}`);
    for (const { model, score, runs, unrecorded, optimisticComplete } of summaries) {
      const pct = (r: number | null) => (r === null ? "n/a" : `${(r * 100).toFixed(1)}%`);
      say(`\n== ${model} (${path.basename(file)}, ${runs.length} runs) ==`);
      say(`M3 complete: ${score.m3.complete}/${score.m3.dataRichRuns} = ${pct(score.m3.rate)} (lower bound; ${optimisticComplete}/${score.m3.dataRichRuns} if every unrecorded call had filled its pass)`);
      say(`M10 cross-park repetition: ${score.m10.repeated}/${score.m10.clues} = ${pct(score.m10.rate)}; top: ${score.m10.top.map((t) => `"${t.gram}" (${t.parks})`).join(", ")}`);
      say(`M5 FK median: ${score.m5.medianGrade?.toFixed(1) ?? "n/a"} (${score.m5.clues} clues)`);
      say(`M6 name leaks before filter: ${score.m6.leaks}/${score.m6.returned} = ${pct(score.m6.rate)}`);
      say(`M11 printed wrong counts: ${score.m11.printedWrong} of ${score.m11.printedCountClues}`);
      // r7 follow-ups: what is printed, by today's checks (jargon, trivia, danger words, wrong kind words, M1 by taxon id).
      const band = results.meta.ageBand;
      const printed = runs.flatMap((r) => r.items.map((i) => ({ r, i })));
      const wild = printed.filter(({ i }) => i.section === "wild");
      const jargon = wild.filter(({ i }) => jargonProblem(i.clue, band, "wild") !== null);
      const trivia = wild.filter(({ i }) => triviaProblem(i.clue, band) !== null);
      const danger = printed.filter(({ i }) => dangerClueWord(`${i.clue} ${i.lookWhere}`) !== null);
      const kind = wild.filter(({ r, i }) => {
        const ctx = contexts.get(r.caseN);
        return ctx ? wrongKindWord(i.clue, taxonOfPrinted(i, ctx) ?? undefined) !== null : false;
      });
      say(`M1 blocked printed: ${score.m1.violations}${score.m1.details.length ? ` (${score.m1.details.join("; ")})` : ""}`);
      say(`printed Wild Finds ${wild.length}: jargon ${jargon.length}, trivia ${trivia.length}, wrong kind ${kind.length}; danger words printed (any section) ${danger.length}`);
      for (const { r, i } of [...jargon, ...trivia, ...kind, ...danger]) say(`  weak: case ${r.caseN} r${r.run}: "${i.clue}" (${i.answer})`);
      const s = score.sound;
      if (s) say(`sound clues: ${s.withSound}/${s.passes} passes have one; water-by-ear ${s.waterSound}/${s.passes} passes on ${s.waterSoundParks} parks; passes with 2+ sound clues ${s.twoOrMore}`);
      const timedOut = runs.flatMap((r) => r.calls).filter((c) => c.error === "TimeoutError").length;
      say(`model calls: ${runs.reduce((a, r) => a + r.calls.length, 0)}; timed out: ${timedOut}; lost runs (no pass): ${runs.filter((r) => r.dataRich && r.kind === "error").length}`);
      say(`unrecorded calls today's code would make: ${unrecorded.length} (${unrecorded.map((u) => `case ${u.caseN} r${u.run} call ${u.callIndex + 1} asks ${u.asked}`).join("; ")})`);
      const drops: Record<string, number> = {};
      for (const r of runs) for (const d of r.dropLog) drops[d.reason] = (drops[d.reason] ?? 0) + 1;
      say(`drops (today's code, replayed calls): ${Object.entries(drops).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
      // r7 follow-ups (M8): prompt size of today's code on first calls the saved run had answered.
      const firsts = runs.flatMap((r) => {
        const size = r.promptSizes?.find((p) => p.call === 0);
        const rec = r.calls[0];
        return size && rec?.status === 200 && typeof rec.promptTokens === "number" ? [{ chars: size.systemChars + size.userChars, system: size.systemChars, tokens: rec.promptTokens }] : [];
      });
      const med = (xs: number[]) => (xs.length === 0 ? null : [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)]);
      say(`answered first calls: ${firsts.length}; today's prompt median ${med(firsts.map((f) => f.chars)) ?? "n/a"} chars (system ${med(firsts.map((f) => f.system)) ?? "n/a"}); recorded median ${med(firsts.map((f) => f.tokens)) ?? "n/a"} tokens`);
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
