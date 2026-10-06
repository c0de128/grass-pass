import { defineConfig, devices } from "@playwright/test";

// SEC-3-01: e2e at the DEFAULT per-IP limits. Unlike playwright.config.ts (which raises the pre-limiter
// for the shared test IP), this starts its OWN server with no PRELIMIT_* env and never reuses a running
// one, so a server with raised limits can't make the test pass. Run `pnpm build` first, then
// `pnpm e2e:limits` (E2E_LIMITS_BASE_URL picks the port; default http://localhost:3124).
const baseURL = process.env.E2E_LIMITS_BASE_URL ?? "http://localhost:3124";
const port = new URL(baseURL).port || "3124";

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("PRELIMIT_")) env[k] = v;
// Empty = the default (src/lib/limits/config.ts), even if Playwright merges this env into process.env.
for (const k of ["PRELIMIT_BURST", "PRELIMIT_PER_SEC", "PRELIMIT_PAGE_BURST", "PRELIMIT_PAGE_PER_MIN", "PRELIMIT_COST_BURST", "PRELIMIT_COST_PER_HOUR"]) env[k] = "";
// No example warm-up (paid model calls) unless asked; the walk says which pages it could open.
env.PREWARM_EXAMPLES = process.env.PREWARM_EXAMPLES ?? "0";

export default defineConfig({
  testDir: "./tests/e2e-limits",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: `pnpm start --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env,
  },
});
