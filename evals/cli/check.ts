import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { APP_ROOT } from "../fixture";
import { replayResults } from "../replay";
import { checkReplay, type EvalResults } from "../run";

// `pnpm eval:check`: free dry run (no model) proving every fixture replays through buildPass.
test("every case replays through buildPass with no unrecorded request (pnpm eval:check)", async () => {
  const out = await checkReplay();
  const misses = out.filter((o) => o.errorCode === "FIXTURE_MISS");
  process.stdout.write(`${out.length} replays (bands ${[...new Set(out.map((o) => o.band))].join(", ")}), ${misses.length} with a fixture miss\n`);
  expect(misses).toEqual([]);
  // With the model off, each case ends at the model step (or the no-data path): nothing else failed.
  const other = out.filter((o) => o.kind !== "empty" && o.errorCode !== "MODEL_NOT_CONFIGURED");
  expect(other).toEqual([]);
  expect(out.some((o) => o.band === "13+")).toBe(true);
});

/**
 * Teens & adults (13+, 2026-10-07): the recorded 13+ run (real gemma-4-31B-it answers for Celebration, Oak Point and
 * White Rock) replays through today's buildPass with no unrecorded call and prints the same clues it printed live.
 */
export const RUN_13PLUS = "evals/results/2026-10-07-partial-1617.json";

test("the recorded 13+ run replays to the same passes (no model, no network)", async () => {
  const results = JSON.parse(readFileSync(path.join(APP_ROOT, RUN_13PLUS), "utf8")) as EvalResults;
  expect(results.meta.ageBand).toBe("13+");
  const { summaries, skipped } = await replayResults(results, ["gemma-4-31B-it"]);
  expect(skipped).toEqual([]);
  const runs = summaries[0].runs;
  expect(runs).toHaveLength(3);
  for (const r of runs) {
    const rec = results.runs.find((x) => x.caseN === r.caseN && x.model === "gemma-4-31B-it")!;
    expect(r.unrecorded, r.slug).toEqual([]);
    expect(r.kind, r.slug).toBe("pass");
    // Kid voice (2026-10-10): a rewritten stock frame now opens with a new plain word ("Notice 25 ..." -> "Find 25 ...").
    // Only that first word may differ from what printed live; the rest of every clue must match.
    const body = (c: string) => c.replace(/^(Notice|Peek at|Check for|Watch for|Spot|Find|Look for|Hunt for|Search for)\s+/, "");
    expect(r.items.map((i) => body(i.clue)), r.slug).toEqual(rec.items.map((i) => body(i.clue)));
    expect(r.pass?.ageBand).toBe("13+");
  }
  process.stdout.write(`13+ replay: ${runs.map((r) => `${r.parkName} ${r.items.length}/${r.n}`).join(", ")}\n`);
});
