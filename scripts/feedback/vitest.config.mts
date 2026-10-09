import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Runs Kevin's private feedback report (scripts/feedback/report.mts) with the app's real TypeScript and @ alias.
 * Not part of `pnpm test`: it reads the shared Upstash store (read-only: SCAN + HGETALL + GET).
 *   pnpm feedback:report
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
    include: ["scripts/feedback/report.mts"],
    testTimeout: 5 * 60 * 1000,
    fileParallelism: false,
    reporters: ["default"],
  },
});
