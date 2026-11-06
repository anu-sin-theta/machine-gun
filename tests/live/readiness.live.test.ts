import { describe, expect, it } from "vitest";
import { createMemoryRepositories } from "@/adapters/db";
import { createNeonRepositories } from "@/adapters/db/neon";
import { createMirrorNode } from "@/adapters/hedera";
import { loadConfig } from "@/config/env";
import { checkReadiness, formatReadiness, summarize } from "@/ops/readiness";

const config = loadConfig(process.env);

describe("deployment readiness (live)", () => {
  it("has no failing integration (warnings and not-configured items are listed, not fatal)", async () => {
    const items = await checkReadiness(config, {
      mirror: createMirrorNode({ baseUrl: config.hedera.mirrorNodeUrl }),
      repos: config.databaseUrl
        ? createNeonRepositories(config.databaseUrl)
        : createMemoryRepositories(),
    });
    console.log(`\n${formatReadiness(items)}\n`);
    const failing = items.filter((i) => i.status === "fail");
    expect(failing, formatReadiness(failing)).toEqual([]);
    expect(summarize(items).ready).toBe(true);
  });
});
