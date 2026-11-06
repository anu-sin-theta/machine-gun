import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "@/config/env";

const issuesOf = (source: Record<string, string>): readonly string[] => {
  try {
    loadConfig(source);
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return (e as ConfigError).issues;
  }
  throw new Error("expected loadConfig to throw");
};

describe("loadConfig", () => {
  it("applies the documented defaults to an empty environment", () => {
    const config = loadConfig({});
    expect(config.baseUrl).toBe("http://localhost:3000");
    expect(config.databaseUrl).toBeUndefined();
    expect(config.hedera.network).toBe("testnet");
    expect(config.zeroG.trustMode).toBe("private");
    expect(config.approvalTtlMs).toBe(600_000);
    expect(config.policy.limits.HBAR).toEqual({
      autoCap: 200_000_000n,
      hardCap: 5_000_000_000n,
      dailyAutoBudget: 500_000_000n,
    });
  });

  it("treats blank values (as in .env.example) as unset", () => {
    const config = loadConfig({
      DATABASE_URL: "",
      HEDERA_AGENT_ACCOUNT_ID: "  ",
      ZG_TRUST_MODE: "",
      APPROVAL_TTL_SECONDS: "",
    });
    expect(config.databaseUrl).toBeUndefined();
    expect(config.hedera.agentAccountId).toBeUndefined();
    expect(config.zeroG.trustMode).toBe("private");
    expect(config.approvalTtlMs).toBe(600_000);
  });

  it("reads overrides, including bigint policy limits beyond 2^53", () => {
    const config = loadConfig({
      POLICY_HBAR_AUTO_CAP: "1",
      POLICY_HBAR_HARD_CAP: "9007199254740993",
      POLICY_HBAR_DAILY_AUTO_BUDGET: "10",
      APPROVAL_TTL_SECONDS: "120",
      ZG_TRUST_MODE: "verified",
    });
    expect(config.policy.limits.HBAR?.hardCap).toBe(9007199254740993n);
    expect(config.approvalTtlMs).toBe(120_000);
    expect(config.zeroG.trustMode).toBe("verified");
  });

  it("accepts a complete integration group", () => {
    const config = loadConfig({
      HEDERA_AGENT_ACCOUNT_ID: "0.0.1001",
      HEDERA_AGENT_PRIVATE_KEY: "302e...",
      HEDERA_PAYEE_ACCOUNT_ID: "0.0.1002",
    });
    expect(config.hedera.agentAccountId).toBe("0.0.1001");
    expect(config.hedera.payeeAccountId).toBe("0.0.1002");
  });

  it("rejects a partly filled integration group", () => {
    expect(issuesOf({ HEDERA_AGENT_ACCOUNT_ID: "0.0.1001" })).toEqual([
      "hedera: HEDERA_AGENT_PRIVATE_KEY, HEDERA_PAYEE_ACCOUNT_ID must be set too",
    ]);
    expect(issuesOf({ WORLD_CLIENT_ID: "abc" })[0]).toContain(
      "WORLD_CLIENT_SECRET",
    );
    expect(issuesOf({ ZG_API_KEY: "k" })[0]).toContain("ZG_MODEL_TEXT");
  });

  it.each([
    ["APP_BASE_URL", "not a url"],
    ["HEDERA_NETWORK", "devnet"],
    ["HEDERA_AGENT_ACCOUNT_ID", "1234"],
    ["ZG_TRUST_MODE", "public"],
    ["POLICY_HBAR_AUTO_CAP", "1.5"],
    ["POLICY_HBAR_AUTO_CAP", "-1"],
    ["POLICY_HBAR_AUTO_CAP", "0"],
    ["APPROVAL_TTL_SECONDS", "5"],
    ["APPROVAL_TTL_SECONDS", "abc"],
  ])("rejects %s=%s with a readable message naming the key", (key, value) => {
    const issues = issuesOf({ [key]: value });
    expect(issues.some((i) => i.startsWith(`${key}:`))).toBe(true);
  });

  it("rejects policy limits the policy engine considers inconsistent", () => {
    const issues = issuesOf({
      POLICY_HBAR_AUTO_CAP: "500",
      POLICY_HBAR_HARD_CAP: "100",
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^policy:/);
  });

  it("defaults the World acr tiers to the values World advertises (orb, orb-face)", () => {
    expect(loadConfig({}).world.acr).toEqual({
      fresh: null,
      human: [
        "https://world.org/oidc/acr/orb",
        "https://world.org/oidc/acr/orb-face",
      ],
      strong: ["https://world.org/oidc/acr/orb-face"],
    });
  });

  it("reads comma-separated acr overrides", () => {
    const config = loadConfig({
      WORLD_ACR_HUMAN:
        "https://world.org/oidc/acr/selfie, https://world.org/oidc/acr/orb-face",
      WORLD_ACR_STRONG: "https://world.org/oidc/acr/orb-face",
    });
    expect(config.world.acr.human).toEqual([
      "https://world.org/oidc/acr/selfie",
      "https://world.org/oidc/acr/orb-face",
    ]);
  });

  it("rejects unknown acr values and a strong tier that the human tier would not accept", () => {
    expect(
      issuesOf({ WORLD_ACR_HUMAN: "orb" }).some((i) =>
        i.startsWith("WORLD_ACR_HUMAN"),
      ),
    ).toBe(true);
    expect(
      issuesOf({
        WORLD_ACR_HUMAN: "https://world.org/oidc/acr/orb",
        WORLD_ACR_STRONG: "https://world.org/oidc/acr/orb-face",
      }),
    ).toEqual([
      "world: WORLD_ACR_STRONG value https://world.org/oidc/acr/orb-face must also be in WORLD_ACR_HUMAN",
    ]);
  });

  it("always allows the app's own origin for merchant resources, plus configured extras", () => {
    expect(loadConfig({}).merchantOrigins).toEqual(["http://localhost:3000"]);
    const config = loadConfig({
      APP_BASE_URL: "https://kavach.example/app",
      MERCHANT_ORIGINS:
        "https://merchant.example/some/path, https://kavach.example, http://other.test:8080",
    });
    expect(config.merchantOrigins).toEqual([
      "https://kavach.example",
      "https://merchant.example",
      "http://other.test:8080",
    ]);
  });

  it("rejects a malformed merchant origin list", () => {
    expect(
      issuesOf({ MERCHANT_ORIGINS: "not a url" }).some((i) =>
        i.startsWith("MERCHANT_ORIGINS"),
      ),
    ).toBe(true);
  });

  it("requires the API token to be at least 16 characters when set", () => {
    expect(loadConfig({}).apiToken).toBeUndefined();
    expect(loadConfig({ API_TOKEN: "0123456789abcdef" }).apiToken).toBe(
      "0123456789abcdef",
    );
    expect(issuesOf({ API_TOKEN: "short" })[0]).toMatch(/^API_TOKEN:/);
  });

  it("runs the live agent unless demo mode is asked for", () => {
    expect(loadConfig({}).agentMode).toBe("live");
    expect(loadConfig({ AGENT_MODE: "demo" }).agentMode).toBe("demo");
    expect(() => loadConfig({ AGENT_MODE: "fake" })).toThrow(/AGENT_MODE/);
  });

  it("derives the World redirect URI from the app's own URL unless one is set", () => {
    expect(loadConfig({}).world.redirectUri).toBe(
      "http://localhost:3000/api/worldid/callback",
    );
    expect(
      loadConfig({ APP_BASE_URL: "https://kavach.example/app" }).world
        .redirectUri,
    ).toBe("https://kavach.example/api/worldid/callback");
    expect(
      loadConfig({
        APP_BASE_URL: "https://kavach.example",
        WORLD_REDIRECT_URI: "https://other.example/cb",
      }).world.redirectUri,
    ).toBe("https://other.example/cb");
  });

  it("collects every field error in one ConfigError", () => {
    const issues = issuesOf({
      APP_BASE_URL: "nope",
      HEDERA_NETWORK: "devnet",
    });
    expect(issues).toHaveLength(2);
  });
});
