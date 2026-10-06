import { expect, test } from "vitest";
import { checkReplay } from "../run";

// `pnpm eval:check`: free dry run (no model) proving every fixture replays through buildPass.
test("every case replays through buildPass with no unrecorded request (pnpm eval:check)", async () => {
  const out = await checkReplay();
  const misses = out.filter((o) => o.errorCode === "FIXTURE_MISS");
  process.stdout.write(`${out.length} replays, ${misses.length} with a fixture miss\n`);
  expect(misses).toEqual([]);
  // With the model off, each case ends at the model step (or the no-data path): nothing else failed.
  const other = out.filter((o) => o.kind !== "empty" && o.errorCode !== "MODEL_NOT_CONFIGURED");
  expect(other).toEqual([]);
});
