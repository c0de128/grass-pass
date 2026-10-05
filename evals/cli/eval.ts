import { test } from "vitest";
import { main } from "../run";

// `pnpm eval`: recorded park data + live open models -> evals/results/<date>.md/.json (see evals/run.ts).
test("SPEC 6.4 eval (pnpm eval)", async () => {
  await main();
});
