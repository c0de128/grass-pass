import { defineConfig, devices } from "@playwright/test";

// Runs against the production server (`pnpm build` first). Locally the factory starts it with
// `node scripts/app-server.mjs start grass-pass 3123`; set E2E_BASE_URL to use another URL.
// If nothing is listening there (e.g. in CI), Playwright starts `pnpm start` on that URL's port with the
// env below.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const port = new URL(baseURL).port || "3123";

/** Specs that call live services (OpenStreetMap, iNaturalist, the model) through the per-IP limits. */
const LIVE = [
  "accounts.spec.ts",
  "find-a-park.spec.ts",
  "make-a-pass.spec.ts",
  "print.spec.ts",
  "spot-map.spec.ts",
  "examples-about.spec.ts",
  // Kevin 2026-10-08: the free pass against the real cookie (live iNaturalist; never a model or SerpApi call keyless).
  "free-pass-live.spec.ts",
];

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [
    // Pages and checks with no upstream call: in parallel.
    { name: "chromium", testIgnore: LIVE, use: { ...devices["Desktop Chrome"] } },
    // Live-data specs one at a time (R1-B2): every browser request comes from one IP, and the server
    // allows 3 new passes and 10 park searches a minute per IP.
    { name: "live", testMatch: LIVE, fullyParallel: false, workers: 1, use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `pnpm start --port ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      // Keyless CI: no example warm-up (it would only end in "no AI key"); the home page then says the
      // examples are switched off, and examples-about.spec.ts checks that copy and skips.
      PREWARM_EXAMPLES: process.env.PREWARM_EXAMPLES ?? (process.env.CI ? "0" : "1"),
      // Round 8 (Q-8-01): the print tests open recorded real passes from tests/fixtures (src/lib/pass/e2e-fixtures.ts).
      GP_E2E_FIXTURE_PASSES: "1",
      // Every test browser shares one IP; the in-process pre-limiter (default 40 burst, 4/s) would trip on
      // parallel page loads. A big burst with a slow refill: round1.spec.ts floods it with its own
      // forwarded address and must see 429s even though page renders take a while.
      PRELIMIT_BURST: process.env.PRELIMIT_BURST ?? "300",
      PRELIMIT_PER_SEC: process.env.PRELIMIT_PER_SEC ?? "2",
      // SEC-2-01 page and store-cost buckets (defaults 20 + 6/min, 60 + 45/h): roomy for one shared test IP.
      PRELIMIT_PAGE_BURST: process.env.PRELIMIT_PAGE_BURST ?? "300",
      PRELIMIT_PAGE_PER_MIN: process.env.PRELIMIT_PAGE_PER_MIN ?? "120",
      PRELIMIT_COST_BURST: process.env.PRELIMIT_COST_BURST ?? "3000",
      PRELIMIT_COST_PER_HOUR: process.env.PRELIMIT_COST_PER_HOUR ?? "36000",
    },
  },
});
