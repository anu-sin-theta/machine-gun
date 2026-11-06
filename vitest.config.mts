import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Live testnet tests only run with LIVE=1 (see tests/live).
    exclude: process.env.LIVE === "1" ? [] : ["tests/live/**"],
    coverage: {
      provider: "v8",
      include: ["src/core/**", "src/rust/index.ts"],
      reporter: ["text"],
      thresholds: { lines: 95, branches: 90, functions: 95, statements: 95 },
    },
  },
});
