import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    // @x402/next imports "next/server" without an extension; let Vite resolve it.
    server: { deps: { inline: [/@x402[\\/]next/] } },
    include: ["tests/**/*.test.ts"],
    // Live tests need real credentials: `pnpm test:live` (vitest.live.config.mts).
    exclude: ["tests/live/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      include: [
        "src/core/**",
        "src/rust/index.ts",
        "src/config/**",
        "src/adapters/db/memory.ts",
        "src/adapters/db/postgres.ts",
        "src/ops/readiness.ts",
        "src/adapters/db/types.ts",
        "src/adapters/db/index.ts",
        "src/adapters/zerog/client.ts",
        "src/adapters/zerog/verdict.ts",
        "src/adapters/zerog/types.ts",
        "src/adapters/zerog/prompts.ts",
        "src/adapters/hedera/messages.ts",
        "src/adapters/hedera/mirror.ts",
        "src/adapters/hedera/reputation.ts",
        "src/adapters/hedera/types.ts",
        "src/adapters/x402/guard.ts",
        "src/adapters/x402/client.ts",
        "src/adapters/x402/checkers.ts",
        "src/adapters/world/oidc.ts",
        "src/adapters/world/approvals.ts",
        "src/adapters/world/simulator.ts",
        "src/agent/pipeline.ts",
        "src/agent/x402.ts",
        "src/agent/auth.ts",
        "src/agent/types.ts",
        "src/agent/demo.ts",
        "src/ui/explain.ts",
        "src/ui/view.ts",
      ],
      reporter: ["text"],
      thresholds: { lines: 95, branches: 90, functions: 95, statements: 95 },
    },
  },
});
