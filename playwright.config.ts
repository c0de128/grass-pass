import { defineConfig, devices } from "@playwright/test";

// Runs against the production server (`pnpm build` first). Locally the factory starts it with
// `node scripts/app-server.mjs start grass-pass 3123`; set E2E_BASE_URL to use another URL.
// If nothing is listening there (e.g. in CI), Playwright starts `pnpm start` on that URL's port.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const port = new URL(baseURL).port || "3123";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm start --port ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
