import { expect, test } from "vitest";
import { recordAll } from "../record";
import { envList } from "../env";

test("record eval fixtures live (pnpm eval:record)", async () => {
  const only = envList(process.env.EVAL_CASES)?.map(Number);
  const outcomes = await recordAll({ only, force: process.env.EVAL_RECORD_FORCE === "1" });
  const failed = outcomes.filter((o) => !o.ok);
  // Failures are written to tests/fixtures/evals/RECORDING-LOG.md; the run itself is reported as failed.
  expect(failed.map((o) => `${o.case.n} ${o.case.name}`)).toEqual([]);
});
