import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Runs the Gemma copy pipeline (scripts/copy) with the app's real TypeScript and @ alias, like the evals.
 * Not part of `pnpm test`: copy:gemma calls the paid model.
 *   pnpm copy:gemma   -> scripts/copy/gemma-revise.mts (Gemma drafts + code check -> docs/copy-by-gemma/run-*.json)
 *   pnpm copy:render  -> scripts/copy/gemma-render.mts (run JSON + the review -> docs/COPY-BY-GEMMA.md, no calls)
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
      "server-only": fileURLToPath(new URL("../../node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
    environment: "node",
    include: ["scripts/copy/gemma-*.mts"],
    testTimeout: 30 * 60 * 1000,
    fileParallelism: false,
    reporters: ["default"],
  },
});
