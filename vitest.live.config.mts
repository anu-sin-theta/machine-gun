import { defineConfig } from "vitest/config";

// Live tests talk to real services with real credentials from .env. They are
// kept out of the normal run (`pnpm test`); run them with `pnpm test:live`.
// Each file skips itself, with a reason, when its credentials are missing.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env: tests that need credentials will skip.
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/live/**/*.live.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Real services, real money, real rate limits: one file at a time.
    fileParallelism: false,
  },
});
