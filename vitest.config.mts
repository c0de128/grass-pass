import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside React Server Components; unit tests run server code directly.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Pass tests replay recorded iNaturalist answers through the app's real 1 request/second queue; a cold
    // Connemara pass makes 5 iNat calls since the R1-M4 season check (species, taxa, 3 phenology), about 4-5 s.
    testTimeout: 15_000,
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    // next-auth's ESM imports "next/server" without an extension; letting Vite transform it resolves that.
    server: { deps: { inline: ["next-auth"] } },
    // R1 follow-up: the clock starts at the recording time and moves (support/recording-clock.ts), so the
    // October-only recordings (season check, October box) keep matching after October. Loaded first.
    // R1: background OSM refreshes off by default (tests that check them switch them on).
    setupFiles: ["tests/unit/support/recording-clock.ts", "tests/unit/support/setup.ts"],
  },
});
