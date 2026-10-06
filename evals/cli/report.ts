import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { setLogSink } from "@/lib/log";
import { RESULTS_DIR, rescore, type EvalResults } from "../run";
import { prettyJson } from "../json";
import { renderConsoleTable, renderMarkdown } from "../report";

// `pnpm eval:report`: re-score and re-render a results JSON (EVAL_FROM=<file name>, default the newest)
// from its saved raw run records with the current scorer. No network, no model calls.
test("re-render eval results (pnpm eval:report)", async () => {
  const files = readdirSync(RESULTS_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}.*\.json$/.test(f)).sort();
  const name = process.env.EVAL_FROM?.trim() || files.at(-1);
  expect(name, "No data available: no results JSON in evals/results yet (run pnpm eval first)").toBeTruthy();
  const file = path.join(RESULTS_DIR, path.basename(name as string));
  const restore = setLogSink(() => undefined);
  try {
    const results = await rescore(JSON.parse(readFileSync(file, "utf8")) as EvalResults);
    writeFileSync(file, prettyJson(results, 4));
    writeFileSync(file.replace(/\.json$/, ".md"), renderMarkdown(results, path.basename(file)));
    process.stdout.write(`${renderConsoleTable(results)}\n`);
  } finally {
    restore();
  }
});
