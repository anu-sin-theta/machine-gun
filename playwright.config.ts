import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;

/**
 * End-to-end tests run the production build with every outside service
 * stood in: the agent in demo mode (no 0G, Hedera or money) and World ID in
 * simulated mode (the in-app issuer). Run `pnpm build` first, or use `pnpm test:e2e`.
 */
export default defineConfig({
  testDir: "./e2e",
  // One server with one in-memory store: keep tests in a single worker.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node node_modules/next/dist/bin/next start -p ${PORT}`,
    url: `${BASE}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AGENT_MODE: "demo",
      WORLD_MODE: "simulated",
      APP_BASE_URL: BASE,
      WORLD_REDIRECT_URI: `${BASE}/api/worldid/callback`,
      // A developer's local .env must not leak into the tests: blank means unset.
      DATABASE_URL: "",
      API_TOKEN: "",
      MERCHANT_ORIGINS: "",
      WORLD_CLIENT_ID: "",
      WORLD_CLIENT_SECRET: "",
      WORLD_SIM_SECRET: "",
      WORLD_SIM_KEY: "",
      HEDERA_AGENT_ACCOUNT_ID: "",
      HEDERA_AGENT_PRIVATE_KEY: "",
      HEDERA_PAYEE_ACCOUNT_ID: "",
      POLICY_HBAR_AUTO_CAP: "200000000",
      POLICY_HBAR_HARD_CAP: "5000000000",
      // Plenty of room, so tests do not depend on how many auto-payments ran before them.
      POLICY_HBAR_DAILY_AUTO_BUDGET: "100000000000",
    },
  },
});
