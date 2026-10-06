import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest runs the eval scripts (SPEC 6.4 "Vitest harness") so they use the app's real TypeScript
 * code with the `@` alias. Not part of `pnpm test`: these call live APIs or the paid model.
 *   pnpm eval:record  -> evals/cli/record.ts (live Overpass + iNaturalist -> tests/fixtures/evals)
 *   pnpm eval         -> evals/cli/eval.ts   (recorded park data + the real models -> evals/results)
 *   pnpm eval:report  -> evals/cli/report.ts (re-render a results JSON, no calls)
 *   pnpm eval:human-check -> evals/cli/human-check.ts (rebuild human-check.md from a full run, no calls)
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../src", import.meta.url)),
      "server-only": fileURLToPath(new URL("../node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    root: fileURLToPath(new URL("..", import.meta.url)),
    environment: "node",
    include: ["evals/cli/*.ts"],
    testTimeout: 3 * 60 * 60 * 1000,
    hookTimeout: 60_000,
    fileParallelism: false,
    reporters: ["default"],
  },
});
