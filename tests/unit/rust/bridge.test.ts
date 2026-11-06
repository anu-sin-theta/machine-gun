import { describe, expect, it } from "vitest";
import { hbar } from "@/core";
import * as rust from "@/rust";
import { KavachError } from "@/rust";

describe("rust bridge", () => {
  it("loads the inlined WASM and reports its version", () => {
    expect(rust.wasmVersion()).toBe("0.1.0");
  });

  it("throws KavachError with a stable kind instead of a raw WASM trap", () => {
    const bad = { amount: hbar(1), verdict: null, autoSpentToday: -1n };
    const config = rust.parsePolicyConfig({
      limits: { HBAR: { autoCap: 1n, hardCap: 2n, dailyAutoBudget: 3n } },
    });
    try {
      rust.decide(bad, config);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(KavachError);
      expect((e as KavachError).kind).toBe("InvalidInput");
    }
    expect(() =>
      rust.parsePolicyConfig({
        limits: { HBAR: { autoCap: 5n, hardCap: 1n, dailyAutoBudget: 9n } },
      }),
    ).toThrow(/hardCap/);
  });

  it("returns bigint money from Rust's decimal strings", () => {
    const config = rust.parsePolicyConfig({
      limits: { HBAR: { autoCap: 1n, hardCap: 2n, dailyAutoBudget: 3n } },
    });
    expect(config.limits.HBAR).toEqual({
      autoCap: 1n,
      hardCap: 2n,
      dailyAutoBudget: 3n,
    });
    // Beyond Number.MAX_SAFE_INTEGER: must not round through a float.
    const huge = 123_456_789_012_345_678_901n;
    const big = rust.parsePolicyConfig({
      limits: { HBAR: { autoCap: 1n, hardCap: huge, dailyAutoBudget: 3n } },
    });
    expect(big.limits.HBAR?.hardCap).toBe(huge);
  });

  it("is deterministic across repeated calls (state does not leak between calls)", () => {
    const a = rust.hashCanonical({ x: [1, 2, 3] });
    for (let i = 0; i < 50; i++)
      expect(rust.hashCanonical({ x: [1, 2, 3] })).toBe(a);
  });
});

describe("rust bridge: link intel", () => {
  it("flags the fake-payment-request tricks and passes real brand links", () => {
    const high = [
      "https://hdfcbamk.com/pay",
      "https://sbi-secure-login.top/",
      "https://paypal.com.account-verify.xyz/",
      "https://paypa1.com.account-verify.top/",
      "https://pаypal.com/", // Cyrillic "а"
      "https://user@paypal.example/",
      "http://192.168.1.5/pay",
      "javascript:alert(1)",
      "not a url",
    ];
    for (const url of high) {
      const r = rust.analyzeLink({ url });
      expect(r.level, `${url}: ${JSON.stringify(r.signals)}`).toBe("high");
    }
    for (const url of [
      "https://www.hdfcbank.com/pay",
      "https://onlinesbi.sbi/",
      "https://example.com/bill/1",
    ]) {
      const r = rust.analyzeLink({ url });
      expect(r.level, url).toBe("low");
      expect(r.signals).toEqual([]);
    }
  });

  it("uses redirect chains and domain age supplied by the caller", () => {
    const r = rust.analyzeLink({
      url: "https://bit.ly/abc",
      redirectChain: ["https://hdfc-login.top/pay"],
      domainAgeDays: 2,
    });
    const codes = r.signals.map((s) => `${s.stage}:${s.code}`);
    expect(codes).toContain("entry:URL_SHORTENER");
    expect(codes).toContain("entry:NEW_DOMAIN");
    expect(codes).toContain("landing:REDIRECT_CROSS_DOMAIN");
    expect(codes).toContain("landing:BRAND_IMPERSONATION");
    expect(r.landingHost).toBe("hdfc-login.top");
    expect(r.level).toBe("high");
  });

  it("shows the user-visible Unicode host for homoglyph domains", () => {
    const r = rust.analyzeLink({ url: "https://аррӏе.com/" });
    expect(r.unicodeHost).toBe("аррӏе.com");
    expect(r.host?.startsWith("xn--")).toBe(true);
  });

  it("accepts a custom config, replacing the built-in brand list", () => {
    const cfg = rust.defaultLinkConfig();
    expect(cfg.brands.length).toBeGreaterThan(5);
    const custom = {
      ...cfg,
      brands: [{ name: "Acme", tokens: ["acmepay"], domains: ["acmepay.in"] }],
    };
    expect(
      rust.analyzeLink({ url: "https://acmepay.in/" }, custom).signals,
    ).toEqual([]);
    expect(
      rust.analyzeLink({ url: "https://acmepay.evil.top/" }, custom).level,
    ).toBe("high");
    // The default brands no longer apply:
    expect(
      rust.analyzeLink({ url: "https://hdfcbamk.com/" }, custom).signals,
    ).toEqual([]);
  });

  it("never throws on hostile input; unparseable links are simply high risk", () => {
    for (const url of [
      "",
      "   ",
      "http://",
      "https://exa mple.com",
      "\u0000",
      "x".repeat(10_000),
      `https://${"a.".repeat(500)}com`,
    ]) {
      expect(() => rust.analyzeLink({ url })).not.toThrow();
    }
    expect(rust.analyzeLink({ url: "" }).level).toBe("high");
  });
});
