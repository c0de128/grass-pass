import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { RESULTS_DIR, writeHumanCheck, type EvalResults } from "../run";

// `pnpm eval:human-check`: rebuild evals/results/human-check.md (the M9 kid-check sheet) from a saved full run
// (EVAL_FROM=<file name>, default the newest full run). No network, no model calls; the results JSON is not changed.
test("write the M9 kid-check sheet (pnpm eval:human-check)", () => {
  const full = readdirSync(RESULTS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}(-\d+)?\.json$/.test(f))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const name = process.env.EVAL_FROM?.trim() || full.at(-1);
  expect(name, "No data available: no full results JSON in evals/results yet (run pnpm eval first)").toBeTruthy();
  const file = path.join(RESULTS_DIR, path.basename(name as string));
  const results = JSON.parse(readFileSync(file, "utf8")) as EvalResults;
  expect(results.meta.partial, `${path.basename(file)} is a partial run; the kid check uses a full run`).toBe(false);
  const out = writeHumanCheck(results, path.basename(file).replace(/\.json$/, ".md"));
  expect(out, "No data available: that run printed no model clues to check").not.toBeNull();
  process.stdout.write(`Wrote ${path.relative(process.cwd(), out as string)} from ${path.basename(file)}\n`);
});
