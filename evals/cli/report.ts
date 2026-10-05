import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { RESULTS_DIR, type EvalResults } from "../run";
import { renderConsoleTable, renderMarkdown } from "../report";

// `pnpm eval:report`: re-render a results JSON (EVAL_FROM=<file name>, default the newest) without any calls.
test("re-render eval results (pnpm eval:report)", () => {
  const files = readdirSync(RESULTS_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}.*\.json$/.test(f)).sort();
  const name = process.env.EVAL_FROM?.trim() || files.at(-1);
  expect(name, "No data available: no results JSON in evals/results yet (run pnpm eval first)").toBeTruthy();
  const file = path.join(RESULTS_DIR, path.basename(name as string));
  const results = JSON.parse(readFileSync(file, "utf8")) as EvalResults;
  writeFileSync(file.replace(/\.json$/, ".md"), renderMarkdown(results, path.basename(file)));
  process.stdout.write(`${renderConsoleTable(results)}\n`);
});
