import { describe, expect, it } from "vitest";
import { getRepositories } from "@/adapters/db";
import { getConfig } from "@/config/env";

describe("runtime config", () => {
  it("validates once and returns the same object afterwards", () => {
    expect(getConfig()).toBe(getConfig());
  });

  it("falls back to the memory repositories when DATABASE_URL is unset", async () => {
    expect(getConfig().databaseUrl).toBeUndefined();
    const repos = getRepositories();
    expect(getRepositories()).toBe(repos);
    expect(await repos.nonces.markUsed("nonce_runtime_test_0001", 0)).toBe(
      true,
    );
  });
});
